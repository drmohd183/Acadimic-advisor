// اختبارات تكامل الواجهة البرمجية على قاعدة بيانات اختبار (TEST_DATABASE_URL)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://advisor:advisor@localhost:5432/advisor_test';

let app: any, pool: any;
beforeAll(async () => {
  ({ pool } = await import('../server/src/db/pool'));
  const { migrate } = await import('../server/src/db/migrate');
  const { seed } = await import('../server/src/db/seed');
  await migrate(true);
  await seed();
  ({ createApp: app } = await import('../server/src/index'));
  app = app();
}, 60000);
afterAll(async () => { await pool.end(); });

async function login(u: string, p: string) {
  const agent = request.agent(app);
  const r = await agent.post('/api/auth/login').send({ username: u, password: p });
  return { agent, res: r, csrf: r.body?.user?.csrf as string };
}

describe('المصادقة والجلسات', () => {
  it('يرفض بيانات خاطئة برسالة واضحة', async () => {
    const r = await request(app).post('/api/auth/login').send({ username: '202490003', password: 'wrong' });
    expect(r.status).toBe(401);
    expect(r.body.error).toContain('غير صحيحة');
  });
  it('يقفل الحساب بعد 5 محاولات', async () => {
    for (let i = 0; i < 5; i++) await request(app).post('/api/auth/login').send({ username: '202590002', password: 'bad' + i });
    const r = await request(app).post('/api/auth/login').send({ username: '202590002', password: 'Demo@2026' });
    expect(r.status).toBe(423);
    await pool.query("UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE username = '202590002'");
  });
  it('الكوكي httpOnly ولا يُخزّن الرمز نفسه في القاعدة', async () => {
    const { res } = await login('202490003', 'Demo@2026');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const token = cookie.match(/sa_session=([^;]+)/)![1];
    const s = await pool.query('SELECT id FROM sessions WHERE id = $1', [token]);
    expect(s.rowCount).toBe(0);
  });
  it('كلمات المرور مخزنة بتجزئة bcrypt', async () => {
    const r = await pool.query("SELECT password_hash FROM users WHERE username = 'admin'");
    expect(r.rows[0].password_hash).toMatch(/^\$2[aby]\$12\$/);
  });
});

describe('صلاحيات الطالب وخصوصيته', () => {
  it('يحصل على تقريره فقط', async () => {
    const { agent } = await login('202490003', 'Demo@2026');
    const r = await agent.get('/api/student/report');
    expect(r.status).toBe(200);
    expect(r.body.student.universityId).toBe('202490003');
    expect(r.body.recommendations[0].code).toBe('19011202');
  });
  it('لا يستطيع الوصول إلى الإدارة أو بيانات طالب آخر', async () => {
    const { agent } = await login('202490003', 'Demo@2026');
    expect((await agent.get('/api/admin/students/6')).status).toBe(403);
    expect((await agent.get('/api/admin/students')).status).toBe(403);
    // لا يوجد أي مسار يقبل رقم طالب من الطالب
    expect((await agent.get('/api/student/report?studentId=6')).body.student.universityId).toBe('202490003');
  });
  it('غير المسجل يُرفض', async () => {
    expect((await request(app).get('/api/student/report')).status).toBe(401);
  });
  it('الطلبات المعدِّلة تتطلب رمز CSRF', async () => {
    const { agent, csrf } = await login('202490003', 'Demo@2026');
    expect((await agent.post('/api/student/assistant').send({ question: 'كم ساعة بقيت لي؟' })).status).toBe(403);
    const ok = await agent.post('/api/student/assistant').set('x-csrf-token', csrf).send({ question: 'كم ساعة بقيت لي؟' });
    expect(ok.status).toBe(200);
    expect(ok.body.intent).toBe('remaining_hours');
  });
  it('يتحقق من المدخلات', async () => {
    const { agent, csrf } = await login('202490003', 'Demo@2026');
    const r = await agent.post('/api/student/assistant').set('x-csrf-token', csrf).send({ question: 'x'.repeat(600) });
    expect(r.status).toBe(400);
  });
});

describe('لوحة الإدارة', () => {
  let A: any, csrf: string;
  beforeAll(async () => { const l = await login('admin', 'Admin@2026'); A = l.agent; csrf = l.csrf; });
  const put = (p: string, b: unknown) => A.put(p).set('x-csrf-token', csrf).send(b);
  const post = (p: string, b: unknown) => A.post(p).set('x-csrf-token', csrf).send(b);
  const patch = (p: string, b: unknown) => A.patch(p).set('x-csrf-token', csrf).send(b);

  it('النظرة العامة تكشف ملاحظات البيانات', async () => {
    const r = await A.get('/api/admin/overview');
    expect(r.status).toBe(200);
    expect(r.body.issues.some((i: any) => i.text.includes('15200112'))).toBe(true);
  });
  it('تعديل قاعدة ينعكس فورًا على التوصيات', async () => {
    expect((await put('/api/admin/rules/maxTermCredits', { value: 12 })).status).toBe(200);
    const r = await A.get('/api/admin/students/6');
    expect(r.body.report.loadLimit.source).toBe('rule');
    expect((await put('/api/admin/rules/maxTermCredits', { value: 99 })).status).toBe(400);
    await put('/api/admin/rules/maxTermCredits', { value: null });
  });
  it('إضافة سجل نجاح تفتح المساقات المحجوبة', async () => {
    const before = await A.get('/api/admin/students/3');
    expect(before.body.report.courses.find((c: any) => c.code === '19011304').state).toBe('blocked');
    expect((await post('/api/admin/students/3/records', { courseCode: '19011202', termCode: '2026-1', status: 'passed', grade: 75 })).status).toBe(200);
    const after = await A.get('/api/admin/students/3');
    expect(after.body.report.courses.find((c: any) => c.code === '19011304').state).toBe('available');
    // التكرار مرفوض بقيد قاعدة البيانات
    expect((await post('/api/admin/students/3/records', { courseCode: '19011202', termCode: '2026-1', status: 'passed' })).status).toBe(409);
  });
  it('يرفض متطلبًا يُنشئ حلقة', async () => {
    const r = await post('/api/admin/plans/2/requisites', { course: '19040112', requires: '19011202', type: 'pre' });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('حلقة');
  });
  it('اعتماد الخطة يقفل محتواها، والنسخ يُنشئ إصدارًا قابلًا للتعديل', async () => {
    expect((await patch('/api/admin/plans/2', { status: 'approved' })).status).toBe(200);
    const locked = await post('/api/admin/plans/2/requisites', { course: '19011401', requires: '19011203', type: 'pre' });
    expect(locked.status).toBe(409);
    // نطاق سنوات متداخل مع إصدار فعّال آخر مرفوض عند الاعتماد
    const c = await post('/api/admin/plans/2/clone', { label: 'إصدار 2027', effectiveFromYear: 2027, effectiveToYear: null });
    expect(c.status).toBe(200);
    expect((await patch(`/api/admin/plans/${c.body.id}`, { status: 'approved' })).status).toBe(409);
    expect((await patch('/api/admin/plans/2', { effectiveToYear: 2026 })).status).toBe(200);
    expect((await patch(`/api/admin/plans/${c.body.id}`, { status: 'approved' })).status).toBe(200);
    // طالب حقيقي ملتحق 2027 تُطبق عليه الخطة الجديدة بتوصيات نهائية
    const s = await post('/api/admin/students', { universityId: '202799001', nameAr: 'طالب اختبار', trackCode: 'ITM', enrollmentYear: 2027, academicYearLevel: 1, password: 'Test12345' });
    expect(s.status).toBe(200);
    const r = await A.get(`/api/admin/students/${s.body.id}`);
    expect(r.body.report.plan.id).toBe(c.body.id);
    expect(r.body.report.reliability).toBe('final');
  });
  it('الخطة التجريبية لا يمكن اعتمادها', async () => {
    expect((await patch('/api/admin/plans/3', { status: 'approved' })).status).toBe(400);
  });
  it('استيراد CSV يفحص قبل الإدخال', async () => {
    const csv = 'university_id,course_code,term_code,status,grade\n202490008,15200099,2024-2,passed,70\n999,15200099,2024-2,passed,70';
    const r = await post('/api/admin/import/records', { csv, dryRun: true });
    expect(r.body.valid).toBe(1);
    expect(r.body.errors).toHaveLength(1);
  });
  it('التكامل غير المفعّل يعيد 501 بوضوح', async () => {
    const r = await post('/api/admin/integration/sync/3', {});
    expect(r.status).toBe(501);
  });
  it('العمليات الحساسة مسجلة', async () => {
    const r = await A.get('/api/admin/audit');
    const actions = r.body.map((a: any) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['RECORD_ADD', 'RULE_UPDATE', 'PLAN_STATUS_APPROVED', 'LOGIN_FAILED', 'STUDENT_CREATE']));
  });
  it('التقارير تحسب الطلب المتوقع على المساقات', async () => {
    const r = await A.get('/api/admin/reports');
    expect(r.body.students.length).toBeGreaterThanOrEqual(12);
    expect(r.body.demand.length).toBeGreaterThan(0);
  });
});
