// اختبار وضع الإنتاج: تهيئة دون بيانات تجريبية، استيراد جماعي، إلزام تغيير كلمة المرور
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://advisor:advisor@localhost:5432/advisor_test';

let app: any, pool: any, config: any;
const ADMIN_PW = 'Prod-Admin-2026x';

beforeAll(async () => {
  ({ pool } = await import('../server/src/db/pool'));
  ({ config } = await import('../server/src/config'));
  const { migrate } = await import('../server/src/db/migrate');
  const { seed } = await import('../server/src/db/seed');
  await migrate(true);
  config.seedAdminPassword = '';
  await expect(seed({ production: true })).rejects.toThrow('SEED_ADMIN_PASSWORD');
  config.seedAdminPassword = ADMIN_PW;
  await seed({ production: true });
  config.appMode = 'production';
  const { createApp } = await import('../server/src/index');
  app = createApp();
}, 60000);
afterAll(async () => { config.appMode = 'demo'; await pool.end(); });

async function login(u: string, p: string) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ username: u, password: p });
  return { agent, res: r, csrf: r.body?.user?.csrf as string };
}

describe('تهيئة الإنتاج', () => {
  it('لا طلبة تجريبيين ولا خطة تجريبية، والخطتان المستوردتان موجودتان', async () => {
    expect((await pool.query('SELECT count(*)::int n FROM students')).rows[0].n).toBe(0);
    const plans = (await pool.query('SELECT id, is_demo FROM plan_versions')).rows;
    expect(plans).toHaveLength(2);
    expect(plans.every((p: any) => !p.is_demo)).toBe(true);
  });
  it('كلمة مرور الإدارة الافتراضية لا تعمل', async () => {
    expect((await login('admin', 'Admin@2026')).res.status).toBe(401);
    expect((await login('admin', ADMIN_PW)).res.status).toBe(200);
  });
  it('الوضع العام لا يكشف حسابات تجريبية', async () => {
    expect((await request(app).get('/api/public/info')).body.mode).toBe('production');
  });
});

describe('الاستيراد الجماعي وإلزام تغيير كلمة المرور', () => {
  let A: any, csrf: string, creds: any[];
  beforeAll(async () => { const l = await login('admin', ADMIN_PW); A = l.agent; csrf = l.csrf; });
  const post = (p: string, b: unknown) => A.post(p).set('x-csrf-token', csrf).send(b);

  it('يفحص ملف الطلبة ويرفض الأخطاء', async () => {
    const bad = 'university_id,name_ar,track,enrollment_year,academic_year_level\n1,س,XYZ,2024,9';
    const r = await post('/api/admin/import/students', { csv: bad, dryRun: true });
    expect(r.body.errors.length).toBeGreaterThan(0);
  });
  it('ينشئ الطلبة بحسابات وكلمات مرور أولية (مع BOM واسم مسار عربي واسم بين تنصيص)', async () => {
    const csv = '﻿university_id,name_ar,track,enrollment_year,academic_year_level,gpa,status,field_training\n' +
      '202400101,"أحمد، محمد",SEC,2024,3,78.5,active,\n202400102,سارة علي,إدارة تكنولوجيا المعلومات,2025,2,,active,not_met';
    const dry = await post('/api/admin/import/students', { csv, dryRun: true });
    expect(dry.body).toMatchObject({ valid: 2, toCreate: 2, errors: [] });
    const r = await post('/api/admin/import/students', { csv, dryRun: false });
    expect(r.body.imported).toBe(2);
    creds = r.body.credentials;
    expect(creds).toHaveLength(2);
    expect(creds[0].initial_password).toMatch(/^[A-Za-z0-9]{9}$/);
    const s = (await pool.query("SELECT s.name_ar, t.code FROM students s JOIN tracks t ON t.id=s.track_id WHERE university_id='202400102'")).rows[0];
    expect(s.code).toBe('ITM');
    expect((await pool.query("SELECT name_ar FROM students WHERE university_id='202400101'")).rows[0].name_ar).toBe('أحمد، محمد');
    // إعادة الاستيراد تحدّث ولا تنشئ حسابات جديدة
    const again = await post('/api/admin/import/students', { csv, dryRun: false });
    expect(again.body.credentials).toHaveLength(0);
  });
  it('يستورد السجل والتسجيل، والتسجيل يستبدل ما سبق للفصل نفسه', async () => {
    const rec = 'university_id,course_code,term_code,status,grade\n202400101,19040112,2024-1,passed,80\n202400101,19040113,2024-2,passed,75';
    expect((await post('/api/admin/import/records', { csv: rec, dryRun: false })).body.imported).toBe(2);
    const reg1 = 'university_id,course_code,term_code\n202400101,19011200,2026-1\n202400101,19011100,2026-1';
    expect((await post('/api/admin/import/registrations', { csv: reg1, dryRun: false })).body.imported).toBe(2);
    const reg2 = 'university_id,course_code,term_code\n202400101,19011200,2026-1';
    await post('/api/admin/import/registrations', { csv: reg2, dryRun: false });
    const n = (await pool.query("SELECT count(*)::int n FROM course_registrations r JOIN students s ON s.id=r.student_id WHERE s.university_id='202400101'")).rows[0].n;
    expect(n).toBe(1);
  });
  it('الطالب الجديد يُلزم بتغيير كلمة المرور قبل رؤية بياناته', async () => {
    const { agent, res, csrf: c } = await login('202400101', creds[0].initial_password);
    expect(res.body.user.mustChangePassword).toBe(true);
    const blocked = await agent.get('/api/student/report');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await agent.post('/api/auth/change-password').set('x-csrf-token', c).send({ currentPassword: 'wrong', newPassword: 'NewPass123' })).status).toBe(400);
    expect((await agent.post('/api/auth/change-password').set('x-csrf-token', c).send({ currentPassword: creds[0].initial_password, newPassword: 'x202400101y9' })).status).toBe(400);
    const ok = await agent.post('/api/auth/change-password').set('x-csrf-token', c).send({ currentPassword: creds[0].initial_password, newPassword: 'NewPass123' });
    expect(ok.status).toBe(200);
    const rep = await agent.get('/api/student/report');
    expect(rep.status).toBe(200);
    expect(rep.body.student.isDemo).toBe(false);
    expect(rep.body.reliability).toBe('preliminary'); // الخطة لم تُعتمد بعد
    expect(rep.body.credits.earned).toBe(6);
    expect((await login('202400101', 'NewPass123')).res.body.user.mustChangePassword).toBe(false);
  });
  it('في وضع الإنتاج لا تُمنح حالة «خريج» يدويًا', async () => {
    const id = (await pool.query("SELECT id FROM students WHERE university_id='202400102'")).rows[0].id;
    const r = await A.patch(`/api/admin/students/${id}`).set('x-csrf-token', csrf).send({ officialStatus: 'graduated' });
    expect(r.status).toBe(400);
  });
});
