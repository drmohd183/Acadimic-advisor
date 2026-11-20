import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { requireAuth, audit, hashPassword } from '../auth';
import { parseCsv } from '../services/csv';
import { q, tx } from '../db/pool';
import { ah, HttpError } from '../util';
import { loadPlans, insertPlan, clonePlan } from '../services/plans';
import { getReport, loadRules } from '../services/advising';
import { validatePlan } from '../../../shared/src/engine';
import { DEFAULT_RULES, CATEGORIES } from '../../../shared/src/types';
import { sis, INTEGRATION_REQUIREMENTS } from '../services/sis';
import { config } from '../config';
import { llmAvailable } from '../services/llm';

export const adminRouter = Router();
adminRouter.use(requireAuth('admin'));

const Code = z.string().regex(/^\d{8}$/, 'رمز المساق يجب أن يتكون من 8 أرقام');
const TermCode = z.string().regex(/^\d{4}-[123]$/, 'رمز الفصل بصيغة YYYY-N');
const Cat = z.enum(CATEGORIES as [string, ...string[]]);
const id = (v: string) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'معرّف غير صالح'); return n; };

// ===================== نظرة عامة وفحص البيانات =====================
adminRouter.get('/overview', ah(async (_req, res) => {
  const [counts] = await q(`SELECT
    (SELECT count(*) FROM students)::int AS students, (SELECT count(*) FROM students WHERE is_demo)::int AS demo_students,
    (SELECT count(*) FROM plan_versions)::int AS plans, (SELECT count(*) FROM plan_versions WHERE status='approved')::int AS approved_plans,
    (SELECT count(*) FROM courses)::int AS courses, (SELECT count(*) FROM error_logs WHERE at > now() - interval '7 days')::int AS errors_7d,
    (SELECT code FROM academic_terms WHERE is_current) AS current_term`);
  const plans = await loadPlans();
  const issues: { level: string; text: string; plan?: string }[] = [];
  for (const p of plans) validatePlan(p).forEach((v) => issues.push({ ...v, plan: p.label }));
  // اختلاف المتطلبات السابقة لنفس المساق بين الخطط الفعلية
  const real = plans.filter((p) => !p.isDemo);
  const byCourse = new Map<string, Map<number, string>>();
  for (const p of real) for (const c of p.courses) {
    const pre = p.prerequisites.filter((x) => x.course === c.code).map((x) => x.requires).sort().join(',');
    if (!byCourse.has(c.code)) byCourse.set(c.code, new Map());
    byCourse.get(c.code)!.set(p.id, pre);
  }
  for (const [code, m] of byCourse) {
    const vals = new Set(m.values());
    if (m.size > 1 && vals.size > 1) {
      const name = real.flatMap((p) => p.courses).find((c) => c.code === code)?.nameAr;
      issues.push({ level: 'warning', text: `المساق ${name} (${code}) له متطلبات سابقة مختلفة بين الخطط: ${[...m.entries()].map(([pid, v]) => `${real.find((p) => p.id === pid)!.trackNameAr}: ${v || 'لا يوجد'}`).join(' | ')}. حُفظ كما ورد في كل وثيقة؛ يُرجى تأكيده.` });
    }
  }
  const rules = await loadRules();
  const undocumented = (['repeatPolicy', 'minPassingGrade', 'maxTermCredits'] as const).filter((k) => rules[k] == null);
  if (undocumented.length) issues.push({ level: 'info', text: `قواعد غير مضبوطة بعد (غير موثقة في الوثائق المحمّلة): ${undocumented.join('، ')}.` });
  res.json({ counts, issues, appMode: config.appMode, llm: { enabledByRule: rules.llmEnabled, available: llmAvailable(rules.llmEnabled), configured: !!config.llm.apiKey } });
}));

// ===================== البرامج والمسارات =====================
adminRouter.get('/tracks', ah(async (_req, res) => {
  res.json(await q(`SELECT t.*, p.name_ar AS program_name, p.code AS program_code, (SELECT count(*) FROM students s WHERE s.track_id = t.id)::int AS students FROM tracks t JOIN programs p ON p.id = t.program_id ORDER BY t.id`));
}));
adminRouter.put('/tracks/:id', ah(async (req, res) => {
  const b = z.object({ nameAr: z.string().min(3).max(120), nameEn: z.string().max(120).nullable().optional() }).parse(req.body);
  await q('UPDATE tracks SET name_ar = $2, name_en = $3 WHERE id = $1', [id((req.params as Record<string, string>).id), b.nameAr, b.nameEn ?? null]);
  await audit(req, 'TRACK_UPDATE', 'track', (req.params as Record<string, string>).id, b);
  res.json({ ok: true });
}));

// ===================== الخطط وإصداراتها =====================
adminRouter.get('/plans', ah(async (_req, res) => {
  const plans = await loadPlans();
  const used = await q(`SELECT pv.id, (SELECT count(*) FROM students s WHERE s.plan_version_id = pv.id)::int AS assigned FROM plan_versions pv`);
  res.json(plans.map((p) => ({ ...p, courses: undefined, courseCount: p.courses.length, assignedStudents: used.find((u) => u.id === p.id)?.assigned ?? 0, validation: validatePlan(p) })));
}));
adminRouter.get('/plans/:id', ah(async (req, res) => {
  const [p] = await loadPlans({ ids: [id((req.params as Record<string, string>).id)] });
  if (!p) throw new HttpError(404, 'الخطة غير موجودة');
  res.json({ ...p, validation: validatePlan(p) });
}));
const PlanPatch = z.object({
  label: z.string().min(3).max(200).optional(),
  effectiveFromYear: z.number().int().min(1990).max(2100).optional(),
  effectiveToYear: z.number().int().min(1990).max(2100).nullable().optional(),
  totalCredits: z.number().int().min(1).max(250).optional(),
  status: z.enum(['draft', 'imported', 'approved', 'archived']).optional(),
  minGpaForGraduation: z.number().min(0).max(100).nullable().optional(),
  sourceNote: z.string().max(2000).nullable().optional(),
});
adminRouter.patch('/plans/:id', ah(async (req, res) => {
  const pid = id((req.params as Record<string, string>).id);
  const b = PlanPatch.parse(req.body);
  const [cur] = await q('SELECT * FROM plan_versions WHERE id = $1', [pid]);
  if (!cur) throw new HttpError(404, 'الخطة غير موجودة');
  if (cur.is_demo && b.status && b.status !== 'archived') throw new HttpError(400, 'الخطط التجريبية لا يمكن اعتمادها كخطط رسمية.');
  const structural = b.totalCredits !== undefined;
  if (cur.status === 'approved' && structural) throw new HttpError(409, 'لا يمكن تعديل إجمالي ساعات خطة معتمدة؛ أنشئ إصدارًا جديدًا.');
  if (b.status === 'approved') {
    const [p] = await loadPlans({ ids: [pid] });
    const danger = validatePlan({ ...p, totalCredits: b.totalCredits ?? p.totalCredits }).filter((v) => v.level === 'danger');
    if (danger.length) throw new HttpError(400, 'لا يمكن اعتماد الخطة قبل إصلاح: ' + danger.map((d) => d.text).join('؛ '));
  }
  const map: Record<string, string> = { label: 'label', effectiveFromYear: 'effective_from_year', effectiveToYear: 'effective_to_year', totalCredits: 'total_credits', status: 'status', minGpaForGraduation: 'min_gpa_for_graduation', sourceNote: 'source_note' };
  const sets: string[] = []; const vals: unknown[] = [pid];
  for (const [k, v] of Object.entries(b)) { if (v === undefined) continue; vals.push(v); sets.push(`${map[k]} = $${vals.length}`); }
  if (b.status === 'approved') { vals.push(req.user!.id); sets.push(`approved_at = now(), approved_by = $${vals.length}`); }
  if (sets.length) await q(`UPDATE plan_versions SET ${sets.join(', ')} WHERE id = $1`, vals);
  await audit(req, b.status ? `PLAN_STATUS_${b.status.toUpperCase()}` : 'PLAN_UPDATE', 'plan_version', pid, b);
  res.json({ ok: true });
}));
adminRouter.post('/plans/:id/clone', ah(async (req, res) => {
  const b = z.object({ label: z.string().min(3).max(200), effectiveFromYear: z.number().int(), effectiveToYear: z.number().int().nullable() }).parse(req.body);
  const nid = await clonePlan(id((req.params as Record<string, string>).id), b.label, b.effectiveFromYear, b.effectiveToYear);
  await audit(req, 'PLAN_CLONE', 'plan_version', nid, { from: (req.params as Record<string, string>).id, ...b });
  res.json({ id: nid });
}));
adminRouter.delete('/plans/:id', ah(async (req, res) => {
  const pid = id((req.params as Record<string, string>).id);
  const [p] = await q(`SELECT status, (SELECT count(*) FROM students WHERE plan_version_id = $1)::int AS n FROM plan_versions WHERE id = $1`, [pid]);
  if (!p) throw new HttpError(404, 'الخطة غير موجودة');
  if (p.status !== 'draft' || p.n > 0) throw new HttpError(409, 'يمكن حذف المسودات غير المرتبطة بطلبة فقط؛ استخدم الأرشفة لغيرها.');
  await q('DELETE FROM plan_versions WHERE id = $1', [pid]);
  await audit(req, 'PLAN_DELETE', 'plan_version', pid);
  res.json({ ok: true });
}));

// استيراد خطة من JSON (الصيغة الناتجة عن tools/import_docx_plans.py أو صيغة PlanVersion)
const ImportPlan = z.object({
  trackCode: z.enum(['SEC', 'ITM']),
  label: z.string().min(3),
  effectiveFromYear: z.number().int(),
  effectiveToYear: z.number().int().nullable().default(null),
  totalCredits: z.number().int().positive(),
  categories: z.record(z.string(), z.number().int().min(0)).or(z.array(z.object({ category: Cat, requiredCredits: z.number().int(), countsTowardTotal: z.boolean() }))),
  courses: z.array(z.object({ code: Code, nameAr: z.string().min(2), credits: z.number().int().min(0).max(12), category: Cat, suggestedYear: z.number().int().nullable().optional(), suggestedTerm: z.number().int().nullable().optional() })).min(1),
  prerequisites: z.array(z.object({ course: Code, requires: Code })).default([]),
  corequisites: z.array(z.object({ course: Code, requires: Code })).default([]),
  guidingSlots: z.array(z.object({ year: z.number().int(), term: z.number().int(), label: z.string(), credits: z.number().int(), category: Cat.nullable(), kind: z.string().optional() })).default([]),
  sourceNote: z.string().optional(),
});
adminRouter.post('/plans/import', ah(async (req, res) => {
  const b = ImportPlan.parse(req.body);
  const [track] = await q('SELECT name_ar FROM tracks WHERE code = $1', [b.trackCode]);
  const cats = Array.isArray(b.categories) ? b.categories : Object.entries(b.categories).map(([k, v]) => ({ category: Cat.parse(k), requiredCredits: v, countsTowardTotal: k !== 'REMEDIAL' }));
  const nid = await tx((c) => insertPlan(c, {
    trackCode: b.trackCode, trackNameAr: track.name_ar, programNameAr: '', label: b.label, effectiveFromYear: b.effectiveFromYear, effectiveToYear: b.effectiveToYear,
    totalCredits: b.totalCredits, status: 'draft', isDemo: false, sourceNote: b.sourceNote ?? 'مستوردة من ملف JSON عبر لوحة الإدارة',
    courses: b.courses.map((x) => ({ ...x, category: x.category as any })), prerequisites: b.prerequisites, corequisites: b.corequisites,
    categories: cats as any,
    guidingSlots: b.guidingSlots.filter((g) => g.category && g.kind !== 'non_credit').map((g) => ({ year: g.year, term: g.term, label: g.label, credits: g.credits, category: g.category as any, kind: 'category' as const })),
    nonCreditRequirements: b.guidingSlots.filter((g) => g.kind === 'non_credit' || !g.category).map((g, i) => ({ id: i, code: g.label.includes('التدريب') ? 'FIELD_TRAINING' : `NC_${i + 1}`, nameAr: g.label, suggestedYear: g.year, suggestedTerm: g.term })),
    equivalences: [], minGpaForGraduation: null,
  }));
  await audit(req, 'PLAN_IMPORT', 'plan_version', nid, { label: b.label, courses: b.courses.length });
  res.json({ id: nid, status: 'draft' });
}));

// مساقات الخطة
const PlanCourseBody = z.object({ code: Code, category: Cat, suggestedYear: z.number().int().min(1).max(6).nullable().optional(), suggestedTerm: z.number().int().min(1).max(3).nullable().optional(), nameAr: z.string().min(2).optional(), credits: z.number().int().min(0).max(12).optional() });
adminRouter.post('/plans/:id/courses', ah(async (req, res) => {
  const pid = id((req.params as Record<string, string>).id);
  const b = PlanCourseBody.parse(req.body);
  await tx(async (c) => {
    const ex = await c.query('SELECT 1 FROM courses WHERE code = $1', [b.code]);
    if (!ex.rows.length) {
      if (!b.nameAr || b.credits == null) throw new HttpError(400, 'المساق غير موجود في الدليل؛ أدخل اسمه وعدد ساعاته لإنشائه.');
      await c.query('INSERT INTO courses (code, name_ar, credits) VALUES ($1,$2,$3)', [b.code, b.nameAr, b.credits]);
    }
    await c.query('INSERT INTO plan_courses VALUES ($1,$2,$3,$4,$5)', [pid, b.code, b.category, b.suggestedYear ?? null, b.suggestedTerm ?? null]);
  });
  await audit(req, 'PLAN_COURSE_ADD', 'plan_version', pid, b);
  res.json({ ok: true });
}));
adminRouter.patch('/plans/:id/courses/:code', ah(async (req, res) => {
  const pid = id((req.params as Record<string, string>).id); const code = Code.parse((req.params as Record<string, string>).code);
  const b = z.object({ category: Cat.optional(), suggestedYear: z.number().int().min(1).max(6).nullable().optional(), suggestedTerm: z.number().int().min(1).max(3).nullable().optional() }).parse(req.body);
  await q(`UPDATE plan_courses SET category = COALESCE($3, category), suggested_year = $4, suggested_term = $5 WHERE plan_version_id = $1 AND course_code = $2`, [pid, code, b.category ?? null, b.suggestedYear ?? null, b.suggestedTerm ?? null]);
  await audit(req, 'PLAN_COURSE_UPDATE', 'plan_version', pid, { code, ...b });
  res.json({ ok: true });
}));
adminRouter.delete('/plans/:id/courses/:code', ah(async (req, res) => {
  const pid = id((req.params as Record<string, string>).id); const code = Code.parse((req.params as Record<string, string>).code);
  await q('DELETE FROM plan_courses WHERE plan_version_id = $1 AND course_code = $2', [pid, code]);
  await audit(req, 'PLAN_COURSE_REMOVE', 'plan_version', pid, { code });
  res.json({ ok: true });
}));
// المتطلبات السابقة والمتزامنة
const Req = z.object({ course: Code, requires: Code, type: z.enum(['pre', 'co']) });
adminRouter.post('/plans/:id/requisites', ah(async (req, res) => {
  const pid = id((req.params as Record<string, string>).id); const b = Req.parse(req.body);
  if (b.course === b.requires) throw new HttpError(400, 'لا يمكن أن يكون المساق متطلبًا لنفسه.');
  await q(`INSERT INTO ${b.type === 'pre' ? 'course_prerequisites' : 'course_corequisites'} VALUES ($1,$2,$3)`, [pid, b.course, b.requires]);
  const [p] = await loadPlans({ ids: [pid] });
  if (validatePlan(p).some((v) => v.text.includes('حلقة'))) {
    await q(`DELETE FROM ${b.type === 'pre' ? 'course_prerequisites WHERE plan_version_id=$1 AND course_code=$2 AND prereq_code=$3' : 'course_corequisites WHERE plan_version_id=$1 AND course_code=$2 AND coreq_code=$3'}`, [pid, b.course, b.requires]);
    throw new HttpError(400, 'رُفض المتطلب لأنه يُنشئ حلقة في سلسلة المتطلبات السابقة.');
  }
  await audit(req, 'REQUISITE_ADD', 'plan_version', pid, b);
  res.json({ ok: true });
}));
adminRouter.delete('/plans/:id/requisites', ah(async (req, res) => {
  const pid = id((req.params as Record<string, string>).id); const b = Req.parse(req.query);
  await q(b.type === 'pre' ? 'DELETE FROM course_prerequisites WHERE plan_version_id=$1 AND course_code=$2 AND prereq_code=$3' : 'DELETE FROM course_corequisites WHERE plan_version_id=$1 AND course_code=$2 AND coreq_code=$3', [pid, b.course, b.requires]);
  await audit(req, 'REQUISITE_REMOVE', 'plan_version', pid, b);
  res.json({ ok: true });
}));
adminRouter.put('/plans/:id/categories/:cat', ah(async (req, res) => {
  const pid = id((req.params as Record<string, string>).id); const cat = Cat.parse((req.params as Record<string, string>).cat);
  const b = z.object({ requiredCredits: z.number().int().min(0).max(200), countsTowardTotal: z.boolean() }).parse(req.body);
  await q(`INSERT INTO plan_categories VALUES ($1,$2,$3,$4) ON CONFLICT (plan_version_id, category) DO UPDATE SET required_credits = $3, counts_toward_total = $4`, [pid, cat, b.requiredCredits, b.countsTowardTotal]);
  await audit(req, 'CATEGORY_UPDATE', 'plan_version', pid, { cat, ...b });
  res.json({ ok: true });
}));
adminRouter.post('/plans/:id/requirements', ah(async (req, res) => {
  const pid = id((req.params as Record<string, string>).id);
  const b = z.object({ code: z.string().regex(/^[A-Z0-9_]{2,32}$/), nameAr: z.string().min(2), description: z.string().max(1000).nullable().optional(), suggestedYear: z.number().int().nullable().optional(), suggestedTerm: z.number().int().nullable().optional() }).parse(req.body);
  await q(`INSERT INTO graduation_requirements (plan_version_id, code, name_ar, kind, description, suggested_year, suggested_term) VALUES ($1,$2,$3,'non_credit',$4,$5,$6)`, [pid, b.code, b.nameAr, b.description ?? null, b.suggestedYear ?? null, b.suggestedTerm ?? null]);
  await audit(req, 'GRAD_REQ_ADD', 'plan_version', pid, b);
  res.json({ ok: true });
}));
adminRouter.delete('/plans/:id/requirements/:rid', ah(async (req, res) => {
  await q('DELETE FROM graduation_requirements WHERE plan_version_id = $1 AND id = $2', [id((req.params as Record<string, string>).id), id((req.params as Record<string, string>).rid)]);
  await audit(req, 'GRAD_REQ_REMOVE', 'plan_version', (req.params as Record<string, string>).id, { rid: (req.params as Record<string, string>).rid });
  res.json({ ok: true });
}));
adminRouter.post('/plans/:id/equivalences', ah(async (req, res) => {
  const b = z.object({ fromCode: Code, toCode: Code, note: z.string().max(300).nullable().optional() }).parse(req.body);
  await q('INSERT INTO course_equivalences VALUES ($1,$2,$3,$4)', [id((req.params as Record<string, string>).id), b.fromCode, b.toCode, b.note ?? null]);
  await audit(req, 'EQUIVALENCE_ADD', 'plan_version', (req.params as Record<string, string>).id, b);
  res.json({ ok: true });
}));

// ===================== دليل المساقات =====================
adminRouter.get('/courses', ah(async (req, res) => {
  const s = String(req.query.q ?? '').trim();
  res.json(await q(`SELECT c.*, (SELECT array_agg(DISTINCT plan_version_id) FROM plan_courses pc WHERE pc.course_code = c.code) AS plans FROM courses c
     WHERE $1 = '' OR c.code LIKE $1 || '%' OR c.name_ar ILIKE '%' || $1 || '%' ORDER BY c.code LIMIT 300`, [s]));
}));
const CourseBody = z.object({ code: Code, nameAr: z.string().min(2).max(150), nameEn: z.string().max(150).nullable().optional(), credits: z.number().int().min(0).max(12), isActive: z.boolean().optional() });
adminRouter.post('/courses', ah(async (req, res) => {
  const b = CourseBody.parse(req.body);
  await q('INSERT INTO courses (code, name_ar, name_en, credits, is_active) VALUES ($1,$2,$3,$4,$5)', [b.code, b.nameAr, b.nameEn ?? null, b.credits, b.isActive ?? true]);
  await audit(req, 'COURSE_CREATE', 'course', b.code, b);
  res.json({ ok: true });
}));
adminRouter.patch('/courses/:code', ah(async (req, res) => {
  const code = Code.parse((req.params as Record<string, string>).code);
  const b = CourseBody.partial().omit({ code: true }).parse(req.body);
  if (b.credits !== undefined) {
    const locked = await q(`SELECT 1 FROM plan_courses pc JOIN plan_versions pv ON pv.id = pc.plan_version_id WHERE pc.course_code = $1 AND pv.status = 'approved'`, [code]);
    const [cur] = await q('SELECT credits FROM courses WHERE code = $1', [code]);
    if (locked.length && cur && cur.credits !== b.credits) throw new HttpError(409, 'لا يمكن تغيير ساعات مساق مستخدم في خطة معتمدة؛ أنشئ مساقًا برمز جديد.');
  }
  await q(`UPDATE courses SET name_ar = COALESCE($2, name_ar), name_en = COALESCE($3, name_en), credits = COALESCE($4, credits), is_active = COALESCE($5, is_active) WHERE code = $1`, [code, b.nameAr ?? null, b.nameEn ?? null, b.credits ?? null, b.isActive ?? null]);
  await audit(req, 'COURSE_UPDATE', 'course', code, b);
  res.json({ ok: true });
}));

// ===================== الفصول الأكاديمية والطرح =====================
adminRouter.get('/terms', ah(async (_req, res) => {
  res.json(await q(`SELECT t.*, (SELECT count(*) FROM course_offerings o WHERE o.term_code = t.code)::int AS offerings FROM academic_terms t ORDER BY year_start DESC, term_no DESC`));
}));
adminRouter.post('/terms', ah(async (req, res) => {
  const b = z.object({ yearStart: z.number().int().min(1990).max(2100), termNo: z.number().int().min(1).max(3), nameAr: z.string().min(3).max(80) }).parse(req.body);
  await q('INSERT INTO academic_terms (code, year_start, term_no, name_ar) VALUES ($1,$2,$3,$4)', [`${b.yearStart}-${b.termNo}`, b.yearStart, b.termNo, b.nameAr]);
  await audit(req, 'TERM_CREATE', 'term', `${b.yearStart}-${b.termNo}`, b);
  res.json({ ok: true });
}));
adminRouter.post('/terms/:code/current', ah(async (req, res) => {
  const code = TermCode.parse((req.params as Record<string, string>).code);
  await tx(async (c) => {
    await c.query('UPDATE academic_terms SET is_current = FALSE WHERE is_current');
    const r = await c.query('UPDATE academic_terms SET is_current = TRUE WHERE code = $1', [code]);
    if (!r.rowCount) throw new HttpError(404, 'الفصل غير موجود');
  });
  await audit(req, 'TERM_SET_CURRENT', 'term', code);
  res.json({ ok: true });
}));
adminRouter.get('/terms/:code/offerings', ah(async (req, res) => {
  res.json((await q('SELECT course_code FROM course_offerings WHERE term_code = $1 ORDER BY course_code', [TermCode.parse((req.params as Record<string, string>).code)])).map((r) => r.course_code));
}));
adminRouter.put('/terms/:code/offerings', ah(async (req, res) => {
  const code = TermCode.parse((req.params as Record<string, string>).code);
  const b = z.object({ codes: z.array(Code).max(500) }).parse(req.body);
  await tx(async (c) => {
    await c.query('DELETE FROM course_offerings WHERE term_code = $1', [code]);
    for (const cc of new Set(b.codes)) await c.query('INSERT INTO course_offerings VALUES ($1,$2)', [code, cc]);
  });
  await audit(req, 'OFFERINGS_SET', 'term', code, { count: b.codes.length });
  res.json({ ok: true });
}));

// ===================== قواعد الإرشاد =====================
adminRouter.get('/rules', ah(async (_req, res) => {
  res.json(await q('SELECT key, value, description_ar, updated_at FROM advising_rules ORDER BY key'));
}));
const RuleSchemas: Record<string, z.ZodTypeAny> = {
  repeatPolicy: z.enum(['latest', 'highest']).nullable(),
  minPassingGrade: z.number().min(0).max(100).nullable(),
  maxTermCredits: z.number().int().min(1).max(30).nullable(),
  minTermCredits: z.number().int().min(0).max(30).nullable(),
  summerMaxCredits: z.number().int().min(0).max(15).nullable(),
  gpaScale: z.number().positive().max(100).nullable(),
  requireApprovedPlanForFinal: z.boolean(),
  countWithdrawnAsAttempt: z.boolean(),
  priorityWeights: z.object(Object.fromEntries(Object.keys(DEFAULT_RULES.priorityWeights).map((k) => [k, z.number().min(-100).max(500)]))),
  llmEnabled: z.boolean(),
};
adminRouter.put('/rules/:key', ah(async (req, res) => {
  const key = (req.params as Record<string, string>).key;
  if (!RuleSchemas[key]) throw new HttpError(404, 'قاعدة غير معروفة');
  const value = RuleSchemas[key].parse(req.body?.value);
  await q('UPDATE advising_rules SET value = $2, updated_at = now(), updated_by = $3 WHERE key = $1', [key, JSON.stringify(value), req.user!.id]);
  await audit(req, 'RULE_UPDATE', 'rule', key, { value });
  res.json({ ok: true });
}));

// ===================== الطلبة والسجلات =====================
adminRouter.get('/students', ah(async (req, res) => {
  const s = String(req.query.q ?? '').trim();
  const rows = await q(`SELECT s.id, s.university_id, s.name_ar, t.code AS track_code, t.name_ar AS track_name, s.enrollment_year, s.academic_year_level, s.gpa, s.is_demo, s.record_complete, s.official_status, s.scenario_note, s.plan_version_id
      FROM students s JOIN tracks t ON t.id = s.track_id WHERE $1 = '' OR s.university_id LIKE $1 || '%' OR s.name_ar ILIKE '%' || $1 || '%' ORDER BY s.id LIMIT 500`, [s]);
  res.json(rows);
}));
adminRouter.get('/students/:id', ah(async (req, res) => {
  const sid = id((req.params as Record<string, string>).id);
  const [s] = await q(`SELECT s.*, t.code AS track_code FROM students s JOIN tracks t ON t.id = s.track_id WHERE s.id = $1`, [sid]);
  if (!s) throw new HttpError(404, 'الطالب غير موجود');
  const [records, regs, reqs, report] = await Promise.all([
    q(`SELECT r.id, r.course_code, c.name_ar, c.credits, r.term_code, r.status, r.grade, r.source FROM student_course_records r JOIN courses c ON c.code = r.course_code WHERE student_id = $1 ORDER BY term_code, course_code`, [sid]),
    q(`SELECT r.id, r.course_code, c.name_ar, c.credits, r.term_code, r.status FROM course_registrations r JOIN courses c ON c.code = r.course_code WHERE student_id = $1 ORDER BY term_code DESC`, [sid]),
    q(`SELECT * FROM student_requirement_status WHERE student_id = $1`, [sid]),
    getReport(sid),
  ]);
  await audit(req, 'STUDENT_VIEW', 'student', sid);
  res.json({ student: s, records, registrations: regs, requirements: reqs, report });
}));
const StudentBody = z.object({
  universityId: z.string().regex(/^[0-9A-Za-z]{4,20}$/),
  nameAr: z.string().min(3).max(120),
  trackCode: z.enum(['SEC', 'ITM']),
  enrollmentYear: z.number().int().min(1990).max(2100),
  academicYearLevel: z.number().int().min(1).max(5),
  gpa: z.number().min(0).max(100).nullable().optional(),
  recordComplete: z.boolean().default(true),
  officialStatus: z.enum(['active', 'expected_graduate', 'graduated']).default('active'),
  planVersionId: z.number().int().nullable().optional(),
  planAssignmentNote: z.string().max(300).nullable().optional(),
  password: z.string().optional(),
});
adminRouter.post('/students', ah(async (req, res) => {
  const b = StudentBody.parse(req.body);
  if (!b.password) throw new HttpError(400, 'أدخل كلمة مرور أولية للطالب.');
  const hash = await hashPassword(b.password);
  const sid = await tx(async (c) => {
    const r = await c.query(`INSERT INTO students (university_id, name_ar, track_id, enrollment_year, academic_year_level, gpa, record_complete, official_status, data_source, plan_version_id, plan_assignment_note)
       VALUES ($1,$2,(SELECT id FROM tracks WHERE code=$3),$4,$5,$6,$7,$8,'manual',$9,$10) RETURNING id`,
      [b.universityId, b.nameAr, b.trackCode, b.enrollmentYear, b.academicYearLevel, b.gpa ?? null, b.recordComplete, b.officialStatus, b.planVersionId ?? null, b.planAssignmentNote ?? null]);
    await c.query(`INSERT INTO users (username, password_hash, role, student_id, display_name, must_change_password) VALUES ($1,$2,'student',$3,$4,TRUE)`, [b.universityId, hash, r.rows[0].id, b.nameAr]);
    return r.rows[0].id;
  });
  await audit(req, 'STUDENT_CREATE', 'student', sid, { universityId: b.universityId });
  res.json({ id: sid });
}));
adminRouter.patch('/students/:id', ah(async (req, res) => {
  const sid = id((req.params as Record<string, string>).id);
  const b = StudentBody.partial().omit({ universityId: true, password: true }).parse(req.body);
  const [cur] = await q('SELECT is_demo FROM students WHERE id = $1', [sid]);
  if (!cur) throw new HttpError(404, 'الطالب غير موجود');
  if (b.officialStatus === 'graduated' && !cur.is_demo && config.appMode === 'production') {
    throw new HttpError(400, 'حالة «خريج» تُثبت من نظام معلومات الطلبة فقط في الوضع الفعلي.');
  }
  const map: Record<string, string> = { nameAr: 'name_ar', enrollmentYear: 'enrollment_year', academicYearLevel: 'academic_year_level', gpa: 'gpa', recordComplete: 'record_complete', officialStatus: 'official_status', planVersionId: 'plan_version_id', planAssignmentNote: 'plan_assignment_note' };
  const sets: string[] = []; const vals: unknown[] = [sid];
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    if (k === 'trackCode') { vals.push(v); sets.push(`track_id = (SELECT id FROM tracks WHERE code = $${vals.length})`); continue; }
    vals.push(v); sets.push(`${map[k]} = $${vals.length}`);
  }
  if (sets.length) await q(`UPDATE students SET ${sets.join(', ')} WHERE id = $1`, vals);
  await audit(req, 'STUDENT_UPDATE', 'student', sid, b);
  res.json({ ok: true });
}));
adminRouter.post('/students/:id/password', ah(async (req, res) => {
  const sid = id((req.params as Record<string, string>).id);
  const b = z.object({ password: z.string() }).parse(req.body);
  const hash = await hashPassword(b.password);
  await q('UPDATE users SET password_hash = $2, failed_attempts = 0, locked_until = NULL, must_change_password = TRUE WHERE student_id = $1', [sid, hash]);
  await q('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE student_id = $1)', [sid]);
  await audit(req, 'PASSWORD_RESET', 'student', sid);
  res.json({ ok: true });
}));
const RecordBody = z.object({ courseCode: Code, termCode: TermCode, status: z.enum(['passed', 'failed', 'withdrawn', 'incomplete', 'exempt', 'transfer']).nullable(), grade: z.number().min(0).max(100).nullable().optional() });
adminRouter.post('/students/:id/records', ah(async (req, res) => {
  const sid = id((req.params as Record<string, string>).id);
  const b = RecordBody.parse(req.body);
  if (b.status == null && b.grade == null) throw new HttpError(400, 'أدخل الحالة أو العلامة على الأقل.');
  await q('INSERT INTO student_course_records (student_id, course_code, term_code, status, grade, source) VALUES ($1,$2,$3,$4,$5,$6)', [sid, b.courseCode, b.termCode, b.status, b.grade ?? null, 'manual']);
  await audit(req, 'RECORD_ADD', 'student', sid, b);
  res.json({ ok: true });
}));
adminRouter.delete('/students/:id/records/:rid', ah(async (req, res) => {
  const sid = id((req.params as Record<string, string>).id);
  const [r] = await q('DELETE FROM student_course_records WHERE id = $2 AND student_id = $1 RETURNING course_code, term_code, status, grade', [sid, id((req.params as Record<string, string>).rid)]);
  await audit(req, 'RECORD_DELETE', 'student', sid, r);
  res.json({ ok: true });
}));
adminRouter.post('/students/:id/registrations', ah(async (req, res) => {
  const sid = id((req.params as Record<string, string>).id);
  const b = z.object({ courseCode: Code, termCode: TermCode }).parse(req.body);
  await q('INSERT INTO course_registrations (student_id, course_code, term_code) VALUES ($1,$2,$3)', [sid, b.courseCode, b.termCode]);
  await audit(req, 'REGISTRATION_ADD', 'student', sid, b);
  res.json({ ok: true });
}));
adminRouter.delete('/students/:id/registrations/:rid', ah(async (req, res) => {
  const sid = id((req.params as Record<string, string>).id);
  await q('DELETE FROM course_registrations WHERE id = $2 AND student_id = $1', [sid, id((req.params as Record<string, string>).rid)]);
  await audit(req, 'REGISTRATION_DELETE', 'student', sid, { rid: (req.params as Record<string, string>).rid });
  res.json({ ok: true });
}));
adminRouter.put('/students/:id/requirements/:code', ah(async (req, res) => {
  const sid = id((req.params as Record<string, string>).id);
  const code = z.string().regex(/^[A-Z0-9_]{2,32}$/).parse((req.params as Record<string, string>).code);
  const b = z.object({ status: z.enum(['met', 'not_met', 'in_progress']), note: z.string().max(300).nullable().optional() }).parse(req.body);
  await q(`INSERT INTO student_requirement_status (student_id, requirement_code, status, note) VALUES ($1,$2,$3,$4)
           ON CONFLICT (student_id, requirement_code) DO UPDATE SET status = $3, note = $4, updated_at = now()`, [sid, code, b.status, b.note ?? null]);
  await audit(req, 'REQUIREMENT_STATUS', 'student', sid, { code, ...b });
  res.json({ ok: true });
}));

// استيراد سجلات من CSV: university_id,course_code,term_code,status,grade
adminRouter.post('/import/records', ah(async (req, res) => {
  const b = z.object({ csv: z.string().min(10).max(2_000_000), dryRun: z.boolean().default(true) }).parse(req.body);
  const parsed = parseCsv(b.csv);
  const header = parsed.header;
  const need = ['university_id', 'course_code', 'term_code', 'status', 'grade'];
  if (need.some((n) => !header.includes(n))) throw new HttpError(400, `ترويسة الملف يجب أن تحتوي: ${need.join(',')}`);
  const idx = (n: string) => header.indexOf(n);
  const errors: string[] = []; const rows: any[] = [];
  const students = new Map((await q('SELECT id, university_id FROM students')).map((s) => [s.university_id, s.id]));
  const courses = new Set((await q('SELECT code FROM courses')).map((c) => c.code));
  const terms = new Set((await q('SELECT code FROM academic_terms')).map((t) => t.code));
  parsed.rows.forEach((c, i) => {
    const row = { uid: c[idx('university_id')], code: c[idx('course_code')], term: c[idx('term_code')], status: c[idx('status')] || null, grade: c[idx('grade')] ? Number(c[idx('grade')]) : null };
    const n = i + 2;
    if (!students.has(row.uid)) errors.push(`سطر ${n}: رقم جامعي غير موجود ${row.uid}`);
    else if (!courses.has(row.code)) errors.push(`سطر ${n}: مساق غير موجود ${row.code}`);
    else if (!terms.has(row.term)) errors.push(`سطر ${n}: فصل غير موجود ${row.term}`);
    else if (row.status && !['passed', 'failed', 'withdrawn', 'incomplete', 'exempt', 'transfer'].includes(row.status)) errors.push(`سطر ${n}: حالة غير صالحة ${row.status}`);
    else if (row.grade != null && (Number.isNaN(row.grade) || row.grade < 0 || row.grade > 100)) errors.push(`سطر ${n}: علامة غير صالحة`);
    else if (!row.status && row.grade == null) errors.push(`سطر ${n}: لا حالة ولا علامة`);
    else rows.push({ ...row, sid: students.get(row.uid) });
  });
  if (!b.dryRun && errors.length === 0) {
    await tx(async (c) => {
      for (const r of rows) await c.query(`INSERT INTO student_course_records (student_id, course_code, term_code, status, grade, source) VALUES ($1,$2,$3,$4,$5,'import')
        ON CONFLICT (student_id, course_code, term_code) DO UPDATE SET status = EXCLUDED.status, grade = EXCLUDED.grade, source = 'import'`, [r.sid, r.code, r.term, r.status, r.grade]);
    });
    await audit(req, 'RECORDS_IMPORT', 'student_course_records', null, { rows: rows.length });
  }
  res.json({ valid: rows.length, errors, imported: !b.dryRun && errors.length === 0 ? rows.length : 0 });
}));

// استيراد الطلبة من CSV: university_id,name_ar,track,enrollment_year,academic_year_level,gpa,status,field_training
// الطالب الجديد يُنشأ له حساب بكلمة مرور أولية عشوائية يُلزم بتغييرها عند أول دخول.
const TRACK_ALIASES = (v: string): 'SEC' | 'ITM' | null => {
  const t = v.trim().toUpperCase();
  if (t === 'SEC' || /أمن|امن|SECUR/i.test(v)) return 'SEC';
  if (t === 'ITM' || /إدارة|ادارة|MANAG/i.test(v)) return 'ITM';
  return null;
};
const genPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  let p = '';
  for (const b of bytes) p += chars[b % chars.length];
  return p.slice(0, 7) + String(2 + (bytes[0] % 8)) + 'a';
};
adminRouter.post('/import/students', ah(async (req, res) => {
  const b = z.object({ csv: z.string().min(10).max(5_000_000), dryRun: z.boolean().default(true) }).parse(req.body);
  const { header, rows } = parseCsv(b.csv);
  const need = ['university_id', 'name_ar', 'track', 'enrollment_year', 'academic_year_level'];
  const missing = need.filter((n) => !header.includes(n));
  if (missing.length) throw new HttpError(400, `ترويسة الملف ينقصها: ${missing.join(', ')}`);
  const col = (r: string[], n: string) => (header.indexOf(n) >= 0 ? (r[header.indexOf(n)] ?? '').trim() : '');
  const errors: string[] = []; const valid: any[] = []; const seen = new Set<string>();
  rows.forEach((r, i) => {
    const n = i + 2;
    const uid = col(r, 'university_id'), name = col(r, 'name_ar'), track = TRACK_ALIASES(col(r, 'track'));
    const ey = Number(col(r, 'enrollment_year')), lvl = Number(col(r, 'academic_year_level'));
    const gpaS = col(r, 'gpa'), st = col(r, 'status') || 'active', ft = col(r, 'field_training');
    if (!/^[0-9A-Za-z]{4,20}$/.test(uid)) return errors.push(`سطر ${n}: رقم جامعي غير صالح «${uid}»`);
    if (seen.has(uid)) return errors.push(`سطر ${n}: الرقم الجامعي ${uid} مكرر في الملف`);
    if (name.length < 3) return errors.push(`سطر ${n}: الاسم مفقود`);
    if (!track) return errors.push(`سطر ${n}: مسار غير معروف «${col(r, 'track')}» (استخدم SEC أو ITM)`);
    if (!(ey >= 1990 && ey <= 2100)) return errors.push(`سطر ${n}: سنة التحاق غير صالحة`);
    if (!(lvl >= 1 && lvl <= 5)) return errors.push(`سطر ${n}: السنة الدراسية يجب أن تكون من 1 إلى 5`);
    if (gpaS && !(Number(gpaS) >= 0 && Number(gpaS) <= 100)) return errors.push(`سطر ${n}: معدل غير صالح`);
    if (!['active', 'expected_graduate', 'graduated'].includes(st)) return errors.push(`سطر ${n}: حالة غير صالحة «${st}»`);
    if (ft && !['met', 'not_met', 'in_progress'].includes(ft)) return errors.push(`سطر ${n}: حالة تدريب غير صالحة «${ft}»`);
    seen.add(uid);
    valid.push({ uid, name, track, ey, lvl, gpa: gpaS ? Number(gpaS) : null, st, ft: ft || null });
  });
  const existing = new Set((await q('SELECT university_id FROM students')).map((x) => x.university_id));
  const toCreate = valid.filter((v) => !existing.has(v.uid)).length;
  const credentials: { university_id: string; name_ar: string; initial_password: string }[] = [];
  if (!b.dryRun && errors.length === 0) {
    const prepared = valid.map((v) => ({ ...v, pw: existing.has(v.uid) ? null : genPassword() }));
    for (const v of prepared) if (v.pw) v.hash = await bcrypt.hash(v.pw, 10);
    await tx(async (c) => {
      for (const v of prepared) {
        const r = await c.query(`INSERT INTO students (university_id, name_ar, track_id, enrollment_year, academic_year_level, gpa, official_status, data_source)
            VALUES ($1,$2,(SELECT id FROM tracks WHERE code=$3),$4,$5,$6,$7,'sis')
            ON CONFLICT (university_id) DO UPDATE SET name_ar=EXCLUDED.name_ar, track_id=EXCLUDED.track_id, enrollment_year=EXCLUDED.enrollment_year,
              academic_year_level=EXCLUDED.academic_year_level, gpa=EXCLUDED.gpa, official_status=EXCLUDED.official_status
            RETURNING id`, [v.uid, v.name, v.track, v.ey, v.lvl, v.gpa, v.st]);
        const sid = r.rows[0].id;
        if (v.hash) {
          await c.query(`INSERT INTO users (username, password_hash, role, student_id, display_name, must_change_password) VALUES ($1,$2,'student',$3,$4,TRUE)`, [v.uid, v.hash, sid, v.name]);
          credentials.push({ university_id: v.uid, name_ar: v.name, initial_password: v.pw });
        }
        if (v.ft) await c.query(`INSERT INTO student_requirement_status (student_id, requirement_code, status) VALUES ($1,'FIELD_TRAINING',$2)
            ON CONFLICT (student_id, requirement_code) DO UPDATE SET status=EXCLUDED.status, updated_at=now()`, [sid, v.ft]);
      }
    });
    await audit(req, 'STUDENTS_IMPORT', 'students', null, { rows: valid.length, created: credentials.length });
  }
  res.json({ valid: valid.length, toCreate, toUpdate: valid.length - toCreate, errors, imported: !b.dryRun && errors.length === 0 ? valid.length : 0, credentials });
}));

// استيراد التسجيل الحالي: university_id,course_code,term_code — يستبدل تسجيل الطلبة الواردين في الملف لذلك الفصل
adminRouter.post('/import/registrations', ah(async (req, res) => {
  const b = z.object({ csv: z.string().min(10).max(5_000_000), dryRun: z.boolean().default(true) }).parse(req.body);
  const { header, rows } = parseCsv(b.csv);
  const need = ['university_id', 'course_code', 'term_code'];
  const missing = need.filter((n) => !header.includes(n));
  if (missing.length) throw new HttpError(400, `ترويسة الملف ينقصها: ${missing.join(', ')}`);
  const ix = (n: string) => header.indexOf(n);
  const students = new Map((await q('SELECT id, university_id FROM students')).map((s) => [s.university_id, s.id]));
  const courses = new Set((await q('SELECT code FROM courses')).map((c) => c.code));
  const terms = new Set((await q('SELECT code FROM academic_terms')).map((t) => t.code));
  const errors: string[] = []; const valid: { sid: number; code: string; term: string }[] = [];
  rows.forEach((r, i) => {
    const uid = (r[ix('university_id')] ?? '').trim(), code = (r[ix('course_code')] ?? '').trim(), term = (r[ix('term_code')] ?? '').trim();
    if (!students.has(uid)) errors.push(`سطر ${i + 2}: رقم جامعي غير موجود ${uid}`);
    else if (!courses.has(code)) errors.push(`سطر ${i + 2}: مساق غير موجود ${code}`);
    else if (!terms.has(term)) errors.push(`سطر ${i + 2}: فصل غير موجود ${term}`);
    else valid.push({ sid: students.get(uid)!, code, term });
  });
  if (!b.dryRun && errors.length === 0) {
    await tx(async (c) => {
      const pairs = new Set(valid.map((v) => `${v.sid}|${v.term}`));
      for (const p of pairs) { const [sid, term] = p.split('|'); await c.query('DELETE FROM course_registrations WHERE student_id = $1 AND term_code = $2', [Number(sid), term]); }
      for (const v of valid) await c.query('INSERT INTO course_registrations (student_id, course_code, term_code) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [v.sid, v.code, v.term]);
    });
    await audit(req, 'REGISTRATIONS_IMPORT', 'course_registrations', null, { rows: valid.length });
  }
  res.json({ valid: valid.length, errors, imported: !b.dryRun && errors.length === 0 ? valid.length : 0 });
}));

// ===================== التقارير =====================
adminRouter.get('/reports', ah(async (_req, res) => {
  const students = await q('SELECT id FROM students ORDER BY id');
  const rows: any[] = [];
  const demand = new Map<string, { code: string; name: string; count: number; conditional: number }>();
  for (const s of students) {
    const r = await getReport(s.id);
    if (!r) continue;
    rows.push({
      id: r.student.id, universityId: r.student.universityId, name: r.student.nameAr, track: r.plan?.trackNameAr, year: r.student.academicYearLevel,
      earned: r.credits.earned, remaining: r.credits.remaining, percent: r.credits.percent, behind: r.delay.isBehind, openFails: r.failedCourses.filter((f) => !f.nowPassed).length,
      graduation: r.graduation.stateLabel, gradState: r.graduation.state, reliability: r.reliability, termsNeeded: r.projection.termsNeeded, isDemo: r.student.isDemo,
    });
    for (const x of r.recommendations.filter((y) => y.included && y.code)) {
      const d = demand.get(x.code!) ?? { code: x.code!, name: x.nameAr, count: 0, conditional: 0 };
      d.count++; if (x.conditionalOn) d.conditional++;
      demand.set(x.code!, d);
    }
  }
  res.json({
    students: rows,
    summary: { total: rows.length, behind: rows.filter((r) => r.behind).length, withOpenFails: rows.filter((r) => r.openFails > 0).length, expected: rows.filter((r) => r.gradState === 'expected').length, met: rows.filter((r) => r.gradState === 'requirements_met').length },
    demand: [...demand.values()].sort((a, b) => b.count - a.count),
  });
}));

// ===================== السجلات =====================
adminRouter.get('/audit', ah(async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit ?? 200) || 200);
  res.json(await q(`SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.details, a.ip, u.username FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.at DESC LIMIT $1`, [limit]));
}));
adminRouter.get('/errors', ah(async (_req, res) => {
  res.json(await q('SELECT * FROM error_logs ORDER BY at DESC LIMIT 200'));
}));

// ===================== التكامل =====================
adminRouter.get('/integration', ah(async (_req, res) => {
  const [s] = await q(`SELECT value FROM integration_settings WHERE key = 'sis'`);
  res.json({ mode: config.appMode, sisConfigured: sis.isConfigured(), settings: s?.value ?? null, requirements: INTEGRATION_REQUIREMENTS, llmConfigured: !!config.llm.apiKey });
}));
adminRouter.post('/integration/sync/:id', ah(async (req, res) => {
  const sid = id((req.params as Record<string, string>).id);
  const [s] = await q('SELECT university_id FROM students WHERE id = $1', [sid]);
  if (!s) throw new HttpError(404, 'الطالب غير موجود');
  // يرمي NotConfiguredError (501) ما لم يُفعَّل تكامل رسمي
  const remote = await sis.fetchStudent(s.university_id);
  await audit(req, 'SIS_SYNC', 'student', sid, { ok: true });
  res.json({ ok: true, remote });
}));
