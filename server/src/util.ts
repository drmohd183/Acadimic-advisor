import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { q } from './db/pool';

export const ah = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** تحويل الأخطاء إلى رسائل عربية مفهومة */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'بيانات غير صالحة: ' + err.issues.map((i) => `${i.path.join('.') || 'الحقل'} – ${i.message}`).join('؛ ') });
  }
  if (err instanceof HttpError || (err?.status && err.status < 600 && err.message)) {
    return res.status(err.status).json({ error: err.message });
  }
  const pgMap: Record<string, [number, string]> = {
    '23505': [409, 'السجل موجود مسبقًا (تكرار غير مسموح).'],
    '23503': [409, 'لا يمكن تنفيذ العملية لارتباطها ببيانات أخرى (مرجع غير موجود أو مستخدم).'],
    '23514': [400, 'القيمة المدخلة تخالف قيود البيانات المسموحة.'],
    '23P01': [409, 'نطاق سنوات تطبيق الخطة يتداخل مع إصدار فعّال آخر لنفس المسار.'],
    '22P02': [400, 'صيغة قيمة غير صحيحة.'],
  };
  if (err?.code && pgMap[err.code]) {
    const [s, m] = pgMap[err.code];
    return res.status(s).json({ error: m, detail: err.detail ?? err.constraint });
  }
  if (err?.code === 'P0001' && String(err.message).startsWith('PLAN_LOCKED')) {
    return res.status(409).json({ error: 'لا يمكن تعديل خطة معتمدة حفاظًا على سجلات الطلبة؛ أنشئ إصدارًا جديدًا منها (نسخ) ثم عدّله.' });
  }
  console.error(err);
  q('INSERT INTO error_logs (level, message, context) VALUES ($1,$2,$3)', ['error', String(err?.message ?? err).slice(0, 2000), JSON.stringify({ url: req.originalUrl, method: req.method, stack: String(err?.stack ?? '').slice(0, 3000) })]).catch(() => {});
  res.status(500).json({ error: 'حدث خطأ غير متوقع في الخادم وتم تسجيله. حاول مرة أخرى لاحقًا.' });
}
