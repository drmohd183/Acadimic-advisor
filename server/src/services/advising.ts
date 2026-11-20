// تجميع مدخلات المحرك من قاعدة البيانات وتشغيله
import { q } from '../db/pool';
import { loadPlans } from './plans';
import { runAdvising } from '../../../shared/src/engine';
import { DEFAULT_RULES, type AdvisingRules, type EngineInput, type StudentProfile, type AdvisingReport } from '../../../shared/src/types';

export async function loadRules(): Promise<AdvisingRules> {
  const rows = await q<{ key: string; value: unknown }>('SELECT key, value FROM advising_rules');
  const r: any = JSON.parse(JSON.stringify(DEFAULT_RULES));
  for (const row of rows) if (row.key in r) r[row.key] = row.value;
  r.priorityWeights = { ...DEFAULT_RULES.priorityWeights, ...(r.priorityWeights ?? {}) };
  return r as AdvisingRules;
}

export function mapStudent(s: any): StudentProfile {
  return {
    id: s.id, universityId: s.university_id, nameAr: s.name_ar, trackCode: s.track_code, enrollmentYear: s.enrollment_year,
    academicYearLevel: s.academic_year_level, gpa: s.gpa, recordComplete: s.record_complete, officialStatus: s.official_status,
    isDemo: s.is_demo, dataSource: s.data_source, planVersionId: s.plan_version_id, planAssignmentNote: s.plan_assignment_note,
  };
}

export async function getStudent(id: number) {
  const [s] = await q('SELECT s.*, t.code AS track_code, t.name_ar AS track_name FROM students s JOIN tracks t ON t.id = s.track_id WHERE s.id = $1', [id]);
  return s ?? null;
}

export async function loadEngineInput(studentId: number): Promise<EngineInput | null> {
  const s = await getStudent(studentId);
  if (!s) return null;
  const [plans, records, regs, terms, rules, nonCredit, offerings] = await Promise.all([
    loadPlans({ trackCode: s.track_code }),
    q(`SELECT r.course_code, r.term_code, r.status, r.grade, c.name_ar, c.credits FROM student_course_records r JOIN courses c ON c.code = r.course_code WHERE r.student_id = $1 ORDER BY r.term_code`, [studentId]),
    q(`SELECT course_code, term_code FROM course_registrations WHERE student_id = $1 AND status = 'registered'`, [studentId]),
    q(`SELECT * FROM academic_terms ORDER BY year_start, term_no`),
    loadRules(),
    q(`SELECT requirement_code, status FROM student_requirement_status WHERE student_id = $1`, [studentId]),
    q(`SELECT o.term_code, o.course_code FROM course_offerings o JOIN academic_terms t ON t.code = o.term_code WHERE t.year_start >= (SELECT year_start FROM academic_terms WHERE is_current LIMIT 1)`),
  ]);
  // إذا كانت الخطة المسندة من مسار آخر (حالة غير متوقعة) نحمّلها أيضًا
  if (s.plan_version_id && !plans.some((p) => p.id === s.plan_version_id)) plans.push(...(await loadPlans({ ids: [s.plan_version_id] })));
  return {
    student: mapStudent(s),
    plans,
    records: records.map((r) => ({ courseCode: r.course_code, termCode: r.term_code, status: r.status, grade: r.grade, courseNameAr: r.name_ar, credits: r.credits })),
    registrations: regs.map((r) => ({ courseCode: r.course_code, termCode: r.term_code })),
    terms: terms.map((t) => ({ code: t.code, yearStart: t.year_start, termNo: t.term_no, nameAr: t.name_ar, isCurrent: t.is_current })),
    rules,
    nonCreditStatus: nonCredit.map((n) => ({ code: n.requirement_code, status: n.status })),
    offerings: offerings.map((o) => ({ termCode: o.term_code, courseCode: o.course_code })),
  };
}

export async function getReport(studentId: number, opts: { snapshot?: boolean } = {}): Promise<AdvisingReport | null> {
  const input = await loadEngineInput(studentId);
  if (!input) return null;
  const report = runAdvising(input);
  if (opts.snapshot) await saveSnapshot(report);
  return report;
}

/** حفظ لقطة مختصرة مرة واحدة يوميًا أو عند تغيّر المحتوى */
async function saveSnapshot(r: AdvisingReport) {
  const summary = {
    credits: r.credits,
    recommended: r.recommendations.filter((x) => x.included).map((x) => ({ code: x.code, name: x.nameAr, credits: x.credits, priority: x.priority, conditional: !!x.conditionalOn })),
    graduation: r.graduation.state,
    behind: r.delay.isBehind,
    alerts: r.alerts.map((a) => a.code),
  };
  const [last] = await q('SELECT summary, generated_at FROM advising_recommendations WHERE student_id = $1 ORDER BY generated_at DESC LIMIT 1', [r.student.id]);
  const same = last && JSON.stringify(last.summary) === JSON.stringify(summary) && Date.now() - new Date(last.generated_at).getTime() < 86400000;
  if (same) return;
  await q('INSERT INTO advising_recommendations (student_id, term_code, plan_version_id, engine_version, reliability, summary) VALUES ($1,$2,$3,$4,$5,$6)',
    [r.student.id, r.nextTerm && (await q('SELECT 1 FROM academic_terms WHERE code=$1', [r.nextTerm.code])).length ? r.nextTerm.code : null, r.plan?.id ?? null, r.engineVersion, r.reliability, JSON.stringify(summary)]);
}
