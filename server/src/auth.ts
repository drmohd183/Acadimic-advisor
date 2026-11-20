// المصادقة وإدارة الجلسات والصلاحيات
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { q } from './db/pool';
import { config } from './config';

export const COOKIE = 'sa_session';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export interface AuthUser {
  id: number;
  username: string;
  role: 'student' | 'admin';
  studentId: number | null;
  displayName: string | null;
  csrf: string;
  sessionId: string;
  mustChangePassword: boolean;
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
// تجزئة وهمية للتوقيت الثابت عند عدم وجود المستخدم
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

export async function audit(req: Request | null, action: string, entity?: string, entityId?: string | number | null, details?: unknown) {
  try {
    await q('INSERT INTO audit_logs (user_id, action, entity, entity_id, details, ip) VALUES ($1,$2,$3,$4,$5,$6)', [
      req?.user?.id ?? null, action, entity ?? null, entityId != null ? String(entityId) : null, details ? JSON.stringify(details) : null, req?.ip ?? null,
    ]);
  } catch (e) {
    console.error('audit failed', e);
  }
}

export async function login(req: Request, res: Response) {
  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  if (!/^[0-9A-Za-z_.-]{3,32}$/.test(username) || password.length < 1 || password.length > 128) {
    return res.status(400).json({ error: 'يرجى إدخال الرقم الجامعي وكلمة المرور بصيغة صحيحة.' });
  }
  const [u] = await q('SELECT * FROM users WHERE username = $1', [username]);
  if (!u) {
    await bcrypt.compare(password, DUMMY_HASH);
    await audit(req, 'LOGIN_FAILED', 'user', null, { username });
    return res.status(401).json({ error: 'الرقم الجامعي أو كلمة المرور غير صحيحة.' });
  }
  if (!u.is_active) return res.status(403).json({ error: 'الحساب موقوف. يرجى مراجعة إدارة النظام.' });
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(u.locked_until).getTime() - Date.now()) / 60000);
    return res.status(423).json({ error: `تم قفل الحساب مؤقتًا بسبب محاولات دخول متكررة. حاول بعد ${mins} دقيقة.` });
  }
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) {
    const fails = u.failed_attempts + 1;
    const lock = fails >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null;
    await q('UPDATE users SET failed_attempts = $2, locked_until = $3 WHERE id = $1', [u.id, lock ? 0 : fails, lock]);
    await audit(req, 'LOGIN_FAILED', 'user', u.id, { attempts: fails });
    return res.status(401).json({ error: lock ? `تم قفل الحساب ${LOCK_MINUTES} دقيقة بعد ${MAX_FAILED} محاولات خاطئة.` : `الرقم الجامعي أو كلمة المرور غير صحيحة. (المحاولات المتبقية: ${MAX_FAILED - fails})` });
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const csrf = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + config.sessionHours * 3600000);
  await q('INSERT INTO sessions (id, user_id, csrf_token, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5,$6)', [sha(token), u.id, csrf, expires, req.ip, String(req.headers['user-agent'] ?? '').slice(0, 200)]);
  await q('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
  await q('DELETE FROM sessions WHERE expires_at < now()');
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, expires, path: '/' });
  req.user = { id: u.id, username: u.username, role: u.role, studentId: u.student_id, displayName: u.display_name, csrf, sessionId: sha(token), mustChangePassword: !!u.must_change_password };
  await audit(req, 'LOGIN', 'user', u.id);
  return res.json({ user: publicUser(req.user) });
}

export const publicUser = (u: AuthUser) => ({ id: u.id, username: u.username, role: u.role, studentId: u.studentId, displayName: u.displayName, csrf: u.csrf, mustChangePassword: u.mustChangePassword });

export async function logout(req: Request, res: Response) {
  if (req.user) {
    await q('DELETE FROM sessions WHERE id = $1', [req.user.sessionId]);
    await audit(req, 'LOGOUT', 'user', req.user.id);
  }
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}

/** يقرأ الجلسة إن وجدت (لا يرفض) */
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (token && typeof token === 'string' && token.length < 100) {
      const id = sha(token);
      const [s] = await q(
        `SELECT s.id, s.csrf_token, u.id AS uid, u.username, u.role, u.student_id, u.display_name, u.is_active, u.must_change_password
           FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now()`, [id]);
      if (s && s.is_active) req.user = { id: s.uid, username: s.username, role: s.role, studentId: s.student_id, displayName: s.display_name, csrf: s.csrf_token, sessionId: s.id, mustChangePassword: !!s.must_change_password };
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(role?: 'student' | 'admin', opts: { allowPendingPassword?: boolean } = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'انتهت الجلسة أو لم تسجل الدخول. يرجى تسجيل الدخول.' });
    if (req.user.mustChangePassword && !opts.allowPendingPassword) {
      return res.status(403).json({ error: 'يجب تغيير كلمة المرور الأولية قبل المتابعة.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    if (role && req.user.role !== role) {
      void audit(req, 'FORBIDDEN', 'route', req.originalUrl);
      return res.status(403).json({ error: 'لا تملك صلاحية الوصول إلى هذا المورد.' });
    }
    // حماية CSRF للطلبات المعدِّلة
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const h = req.headers['x-csrf-token'];
      if (!h || h !== req.user.csrf) return res.status(403).json({ error: 'رمز الحماية غير صالح. أعد تحميل الصفحة.' });
    }
    next();
  };
}

export async function changePassword(req: Request, res: Response) {
  const current = String(req.body?.currentPassword ?? '');
  const next = String(req.body?.newPassword ?? '');
  const [u] = await q('SELECT id, username, password_hash FROM users WHERE id = $1', [req.user!.id]);
  if (!u || !(await bcrypt.compare(current, u.password_hash))) return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
  if (next === current) return res.status(400).json({ error: 'اختر كلمة مرور مختلفة عن الحالية.' });
  if (next.toLowerCase().includes(String(u.username).toLowerCase())) return res.status(400).json({ error: 'كلمة المرور يجب ألا تحتوي على الرقم الجامعي.' });
  const hash = await hashPassword(next);
  await q('UPDATE users SET password_hash = $2, must_change_password = FALSE, password_changed_at = now() WHERE id = $1', [u.id, hash]);
  // إنهاء الجلسات الأخرى والإبقاء على الحالية
  await q('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [u.id, req.user!.sessionId]);
  req.user!.mustChangePassword = false;
  await audit(req, 'PASSWORD_CHANGE', 'user', u.id);
  res.json({ user: publicUser(req.user!) });
}

export async function hashPassword(p: string) {
  if (p.length < 8 || !/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) throw Object.assign(new Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل وتحتوي حروفًا وأرقامًا.'), { status: 400 });
  return bcrypt.hash(p, 12);
}
