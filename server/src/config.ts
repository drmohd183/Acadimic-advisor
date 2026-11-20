// إعدادات التشغيل من متغيرات البيئة (انظر .env.example)
import fs from 'node:fs';
import path from 'node:path';

// تحميل .env بسيط دون مكتبات إضافية
const envFile = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://advisor:advisor@localhost:5432/advisor',
  port: Number(process.env.PORT ?? 4000),
  isProd: process.env.NODE_ENV === 'production',
  sessionHours: Number(process.env.SESSION_HOURS ?? 8),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  appMode: (process.env.APP_MODE ?? 'demo') as 'demo' | 'production', // demo = نموذج تجريبي مستقل
  llm: {
    provider: process.env.LLM_PROVIDER ?? '', // anthropic | '' (معطل)
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? '',
    baseUrl: process.env.LLM_BASE_URL ?? 'https://api.anthropic.com',
  },
  sis: {
    baseUrl: process.env.SIS_BASE_URL ?? '',
    apiKey: process.env.SIS_API_KEY ?? '',
  },
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD ?? '',
  // حدود الطلبات لكل عنوان IP. طلبة الحرم قد يظهرون بعنوان واحد خلف شبكة الجامعة، لذا الحدود مرتفعة،
  // والحماية الأساسية من التخمين هي قفل الحساب بعد 5 محاولات خاطئة.
  loginRateLimit: Number(process.env.LOGIN_RATE_LIMIT ?? 300), // محاولة دخول لكل 10 دقائق
  apiRateLimit: Number(process.env.API_RATE_LIMIT ?? 3000), // طلب في الدقيقة
  trustProxy: process.env.TRUST_PROXY ?? '1', // عدد الوكلاء العكسيين أمام التطبيق (Nginx = 1)
  publicUrl: process.env.PUBLIC_URL ?? '',
};
