import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config';
import { sessionMiddleware, login, logout, requireAuth, publicUser, changePassword } from './auth';
import { studentRouter } from './routes/student';
import { adminRouter } from './routes/admin';
import { errorHandler, ah } from './util';
import { q } from './db/pool';

export function createApp() {
  const app = express();
  app.set('trust proxy', /^\d+$/.test(config.trustProxy) ? Number(config.trustProxy) : config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
      },
    },
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(sessionMiddleware);

  const api = express.Router();
  api.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: config.loginRateLimit, standardHeaders: true, legacyHeaders: false, message: { error: 'محاولات كثيرة لتسجيل الدخول. حاول بعد قليل.' } });
  api.use(rateLimit({ windowMs: 60 * 1000, limit: config.apiRateLimit, standardHeaders: true, legacyHeaders: false, message: { error: 'طلبات كثيرة. حاول بعد قليل.' } }));

  api.get('/health', ah(async (_req, res) => { await q('SELECT 1'); res.json({ ok: true, mode: config.appMode }); }));
  api.get('/public/info', ah(async (_req, res) => {
    const [t] = await q('SELECT code, name_ar FROM academic_terms WHERE is_current');
    res.json({ mode: config.appMode, currentTerm: t ?? null });
  }));
  api.post('/auth/login', loginLimiter, ah(login));
  api.post('/auth/logout', requireAuth(undefined, { allowPendingPassword: true }), ah(logout));
  api.post('/auth/change-password', requireAuth(undefined, { allowPendingPassword: true }), ah(changePassword));
  api.get('/auth/me', (req, res) => (req.user ? res.json({ user: publicUser(req.user) }) : res.status(401).json({ error: 'غير مسجل الدخول' })));
  api.use('/student', studentRouter);
  api.use('/admin', adminRouter);
  api.use((_req, res) => res.status(404).json({ error: 'المسار غير موجود' }));
  app.use('/api', api);

  // تقديم الواجهة المبنية في وضع الإنتاج
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dist = path.resolve(here, '../../dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use(errorHandler);
  return app;
}

if (process.argv[1] && process.argv[1].endsWith('index.ts')) {
  createApp().listen(config.port, () => console.log(`✔ الخادم يعمل على http://localhost:${config.port} (الوضع: ${config.appMode})`));
}
