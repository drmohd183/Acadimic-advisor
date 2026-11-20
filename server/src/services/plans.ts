// تحميل الخطط من قاعدة البيانات إلى بنية المحرك، وحفظ خطة مستوردة
import type pg from 'pg';
import { pool, q } from '../db/pool';
import type { PlanVersion, Category, PlanStatus } from '../../../shared/src/types';

type Exec = Pick<pg.PoolClient, 'query'>;

export async function loadPlans(where: { trackCode?: string; ids?: number[] } = {}): Promise<PlanVersion[]> {
  const params: unknown[] = [];
  let cond = 'TRUE';
  if (where.trackCode) { params.push(where.trackCode); cond += ` AND t.code = $${params.length}`; }
  if (where.ids) { params.push(where.ids); cond += ` AND pv.id = ANY($${params.length})`; }
  const versions = await q(
    `SELECT pv.*, t.code AS track_code, t.name_ar AS track_name, p.name_ar AS program_name
       FROM plan_versions pv JOIN study_plans sp ON sp.id = pv.study_plan_id
       JOIN tracks t ON t.id = sp.track_id JOIN programs p ON p.id = t.program_id
      WHERE ${cond} ORDER BY pv.id`, params);
  if (!versions.length) return [];
  const ids = versions.map((v) => v.id);
  const [courses, pre, co, cats, slots, reqs, eqs] = await Promise.all([
    q(`SELECT pc.*, c.name_ar, c.name_en, c.credits FROM plan_courses pc JOIN courses c ON c.code = pc.course_code WHERE plan_version_id = ANY($1) ORDER BY suggested_year NULLS LAST, suggested_term, course_code`, [ids]),
    q(`SELECT * FROM course_prerequisites WHERE plan_version_id = ANY($1)`, [ids]),
    q(`SELECT * FROM course_corequisites WHERE plan_version_id = ANY($1)`, [ids]),
    q(`SELECT * FROM plan_categories WHERE plan_version_id = ANY($1)`, [ids]),
    q(`SELECT * FROM guiding_slots WHERE plan_version_id = ANY($1) ORDER BY year, term, id`, [ids]),
    q(`SELECT * FROM graduation_requirements WHERE plan_version_id = ANY($1) ORDER BY id`, [ids]),
    q(`SELECT * FROM course_equivalences WHERE plan_version_id = ANY($1)`, [ids]),
  ]);
  return versions.map((v) => ({
    id: v.id,
    trackCode: v.track_code,
    trackNameAr: v.track_name,
    programNameAr: v.program_name,
    label: v.label,
    effectiveFromYear: v.effective_from_year,
    effectiveToYear: v.effective_to_year,
    totalCredits: v.total_credits,
    status: v.status as PlanStatus,
    isDemo: v.is_demo,
    sourceNote: v.source_note,
    minGpaForGraduation: v.min_gpa_for_graduation,
    courses: courses.filter((c) => c.plan_version_id === v.id).map((c) => ({
      code: c.course_code, nameAr: c.name_ar, nameEn: c.name_en, credits: c.credits, category: c.category as Category,
      suggestedYear: c.suggested_year, suggestedTerm: c.suggested_term,
    })),
    prerequisites: pre.filter((p) => p.plan_version_id === v.id).map((p) => ({ course: p.course_code, requires: p.prereq_code })),
    corequisites: co.filter((p) => p.plan_version_id === v.id).map((p) => ({ course: p.course_code, requires: p.coreq_code })),
    categories: cats.filter((c) => c.plan_version_id === v.id).map((c) => ({ category: c.category, requiredCredits: c.required_credits, countsTowardTotal: c.counts_toward_total })),
    guidingSlots: slots.filter((s) => s.plan_version_id === v.id).map((s) => ({ year: s.year, term: s.term, category: s.category, credits: s.credits, label: s.label_ar, kind: 'category' as const })),
    nonCreditRequirements: reqs.filter((r) => r.plan_version_id === v.id).map((r) => ({ id: r.id, code: r.code, nameAr: r.name_ar, description: r.description, suggestedYear: r.suggested_year, suggestedTerm: r.suggested_term })),
    equivalences: eqs.filter((e) => e.plan_version_id === v.id).map((e) => ({ fromCode: e.from_code, toCode: e.to_code, note: e.note })),
  }));
}

/** إدراج خطة كاملة (من seed أو من ملف استيراد JSON). يعيد رقم الإصدار الجديد. */
export async function insertPlan(c: Exec, plan: Omit<PlanVersion, 'id'> & { id?: number }, opts: { courseIsDemo?: (code: string) => boolean } = {}): Promise<number> {
  const tr = await c.query('SELECT id FROM tracks WHERE code = $1', [plan.trackCode]);
  if (!tr.rows.length) throw new Error(`المسار ${plan.trackCode} غير موجود`);
  const spName = `خطة ${plan.trackNameAr}`;
  const sp = await c.query(
    `INSERT INTO study_plans (track_id, name_ar) VALUES ($1,$2) ON CONFLICT (track_id, name_ar) DO UPDATE SET name_ar = EXCLUDED.name_ar RETURNING id`,
    [tr.rows[0].id, spName]);
  const cols = ['study_plan_id', 'label', 'effective_from_year', 'effective_to_year', 'total_credits', 'status', 'is_demo', 'source_note', 'min_gpa_for_graduation'];
  const vals: unknown[] = [sp.rows[0].id, plan.label, plan.effectiveFromYear, plan.effectiveToYear, plan.totalCredits, plan.status, plan.isDemo, plan.sourceNote ?? null, plan.minGpaForGraduation];
  if (plan.id) { cols.push('id'); vals.push(plan.id); }
  const pv = await c.query(`INSERT INTO plan_versions (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING id`, vals);
  const id: number = pv.rows[0].id;
  for (const cat of plan.categories) {
    await c.query('INSERT INTO plan_categories VALUES ($1,$2,$3,$4)', [id, cat.category, cat.requiredCredits, cat.countsTowardTotal]);
  }
  for (const co of plan.courses) {
    await c.query(
      `INSERT INTO courses (code, name_ar, name_en, credits, is_demo) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (code) DO NOTHING`, [co.code, co.nameAr, co.nameEn ?? null, co.credits, opts.courseIsDemo?.(co.code) ?? false]);
    const ex = await c.query('SELECT credits, name_ar FROM courses WHERE code = $1', [co.code]);
    if (ex.rows[0].credits !== co.credits) throw new Error(`تعارض: ساعات المساق ${co.code} في الخطة (${co.credits}) تختلف عن الساعات المسجلة (${ex.rows[0].credits})`);
    await c.query('INSERT INTO plan_courses VALUES ($1,$2,$3,$4,$5)', [id, co.code, co.category, co.suggestedYear ?? null, co.suggestedTerm ?? null]);
  }
  for (const p of plan.prerequisites) await c.query('INSERT INTO course_prerequisites VALUES ($1,$2,$3)', [id, p.course, p.requires]);
  for (const p of plan.corequisites) await c.query('INSERT INTO course_corequisites VALUES ($1,$2,$3)', [id, p.course, p.requires]);
  for (const s of plan.guidingSlots) {
    if (!s.category) continue;
    await c.query('INSERT INTO guiding_slots (plan_version_id, year, term, category, credits, label_ar) VALUES ($1,$2,$3,$4,$5,$6)', [id, s.year, s.term, s.category, s.credits, s.label]);
  }
  for (const r of plan.nonCreditRequirements) {
    await c.query('INSERT INTO graduation_requirements (plan_version_id, code, name_ar, kind, description, suggested_year, suggested_term) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, r.code, r.nameAr, 'non_credit', r.description ?? null, r.suggestedYear ?? null, r.suggestedTerm ?? null]);
  }
  return id;
}

export async function insertEquivalences(c: Exec, planId: number, eqs: PlanVersion['equivalences']) {
  for (const e of eqs) await c.query('INSERT INTO course_equivalences VALUES ($1,$2,$3,$4)', [planId, e.fromCode, e.toCode, e.note ?? null]);
}

export async function clonePlan(sourceId: number, label: string, from: number, to: number | null): Promise<number> {
  const [src] = await loadPlans({ ids: [sourceId] });
  if (!src) throw new Error('الخطة غير موجودة');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const id = await insertPlan(c, { ...src, id: undefined, label, effectiveFromYear: from, effectiveToYear: to, status: 'draft', isDemo: src.isDemo, sourceNote: `نسخة من الإصدار #${sourceId}. ${src.sourceNote ?? ''}` });
    await insertEquivalences(c, id, src.equivalences);
    await c.query('COMMIT');
    return id;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
