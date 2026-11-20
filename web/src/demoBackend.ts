/**
 * محاكي الخادم داخل المتصفح – يُستخدم فقط في نسخة العرض المستقلة (ملف HTML واحد).
 * يشغّل نفس محرك الإرشاد والمساعد والبيانات التجريبية، والتعديلات تبقى في الذاكرة حتى إعادة تحميل الصفحة.
 */
import { buildPlans, buildStudents, buildTerms, DEMO_ADMIN, DEMO_STUDENT_PASSWORD, type DemoStudent } from '../../shared/src/seedData';
import { runAdvising, validatePlan } from '../../shared/src/engine';
import { answerQuestion } from '../../shared/src/assistant';
import { DEFAULT_RULES, type AdvisingRules, type PlanVersion, type Category, type AcademicTerm } from '../../shared/src/types';
import { RULE_DESCRIPTIONS } from '../../shared/src/ruleDescriptions';
import { TRACKS, PROGRAM } from '../../shared/src/seedData';

class E extends Error { constructor(public status: number, m: string) { super(m); } }

const plans: PlanVersion[] = buildPlans();
const terms: AcademicTerm[] = buildTerms();
const students: (DemoStudent & { recIds: number[]; regIds: number[] })[] = buildStudents(plans).map((s) => ({ ...s, recIds: s.records.map((_, i) => i + 1), regIds: s.registrations.map((_, i) => i + 1) }));
const rules: AdvisingRules = JSON.parse(JSON.stringify(DEFAULT_RULES));
const offerings: { termCode: string; courseCode: string }[] = [];
const audit: any[] = [];
const extraCourses = new Map<string, { code: string; nameAr: string; credits: number }>();
let session: { role: 'student' | 'admin'; studentId: number | null; username: string; displayName: string } | null = null;
let seq = 1000;

const log = (action: string, entity?: string, entity_id?: unknown, details?: unknown) =>
  audit.unshift({ id: ++seq, at: new Date().toISOString(), action, entity, entity_id: entity_id != null ? String(entity_id) : null, details, username: session?.username ?? null, ip: 'متصفح' });

const allCourses = () => {
  const m = new Map<string, { code: string; nameAr: string; credits: number }>();
  plans.forEach((p) => p.courses.forEach((c) => m.set(c.code, { code: c.code, nameAr: c.nameAr, credits: c.credits })));
  extraCourses.forEach((c) => m.set(c.code, c));
  return m;
};
const stu = (id: number) => { const s = students.find((x) => x.profile.id === id); if (!s) throw new E(404, 'الطالب غير موجود'); return s; };
const plan = (id: number) => { const p = plans.find((x) => x.id === id); if (!p) throw new E(404, 'الخطة غير موجودة'); return p; };
const lockCheck = (p: PlanVersion) => { if (p.status === 'approved') throw new E(409, 'لا يمكن تعديل خطة معتمدة حفاظًا على سجلات الطلبة؛ أنشئ إصدارًا جديدًا منها (نسخ) ثم عدّله.'); };
const report = (s: DemoStudent) => runAdvising({ student: s.profile, plans: plans.filter((p) => p.trackCode === s.profile.trackCode || p.id === s.profile.planVersionId), records: s.records, registrations: s.registrations, terms, rules, nonCreditStatus: s.nonCredit, offerings });
const trackName = (c: string) => TRACKS.find((t) => t.code === c)!.nameAr;
const row = (s: DemoStudent) => ({ id: s.profile.id, university_id: s.profile.universityId, name_ar: s.profile.nameAr, track_code: s.profile.trackCode, track_name: trackName(s.profile.trackCode), enrollment_year: s.profile.enrollmentYear, academic_year_level: s.profile.academicYearLevel, gpa: s.profile.gpa, is_demo: true, record_complete: s.profile.recordComplete, official_status: s.profile.officialStatus, scenario_note: s.scenario, plan_version_id: s.profile.planVersionId, plan_assignment_note: s.profile.planAssignmentNote });
const user = () => session && { id: session.studentId ?? 0, username: session.username, role: session.role, studentId: session.studentId, displayName: session.displayName, csrf: 'demo' };
const need = (role: 'student' | 'admin') => { if (!session) throw new E(401, 'انتهت الجلسة أو لم تسجل الدخول.'); if (session.role !== role) throw new E(403, 'لا تملك صلاحية الوصول إلى هذا المورد.'); };
const codeOk = (c: unknown) => { if (typeof c !== 'string' || !/^\d{8}$/.test(c)) throw new E(400, 'رمز المساق يجب أن يتكون من 8 أرقام'); return c; };

type H = (m: RegExpMatchArray, body: any, query: URLSearchParams) => any;
const routes: [string, RegExp, H][] = [];
const on = (method: string, pattern: string, h: H) => routes.push([method, new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), h]);

// ---------- المصادقة ----------
on('GET', '/auth/me', () => { if (!session) throw new E(401, 'غير مسجل الدخول'); return { user: user() }; });
on('POST', '/auth/login', (_m, b) => {
  const u = String(b?.username ?? '').trim(); const p = String(b?.password ?? '');
  if (u === DEMO_ADMIN.username && p === DEMO_ADMIN.password) session = { role: 'admin', studentId: null, username: u, displayName: 'مدير النظام' };
  else {
    const s = students.find((x) => x.profile.universityId === u);
    if (!s || p !== DEMO_STUDENT_PASSWORD) { log('LOGIN_FAILED', 'user', null, { username: u }); throw new E(401, 'الرقم الجامعي أو كلمة المرور غير صحيحة.'); }
    session = { role: 'student', studentId: s.profile.id, username: u, displayName: s.profile.nameAr };
  }
  log('LOGIN', 'user', u);
  return { user: user() };
});
on('POST', '/auth/logout', () => { log('LOGOUT'); session = null; return { ok: true }; });
on('POST', '/auth/change-password', () => { if (!session) throw new E(401, 'غير مسجل الدخول'); throw new E(400, 'في نسخة العرض كلمات المرور ثابتة ولا يمكن تغييرها.'); });
on('GET', '/public/info', () => { const t = terms.find((x) => x.isCurrent); return { mode: 'demo', currentTerm: t ? { code: t.code, name_ar: t.nameAr } : null }; });

// ---------- الطالب ----------
on('GET', '/student/report', () => { need('student'); return report(stu(session!.studentId!)); });
on('GET', '/student/records', () => {
  need('student'); const s = stu(session!.studentId!); const cm = allCourses();
  return s.records.map((r) => ({ course_code: r.courseCode, name_ar: cm.get(r.courseCode)?.nameAr ?? r.courseNameAr, credits: cm.get(r.courseCode)?.credits ?? r.credits, term_code: r.termCode, term_name: terms.find((t) => t.code === r.termCode)?.nameAr, status: r.status, grade: r.grade })).sort((a, b) => a.term_code.localeCompare(b.term_code));
});
on('POST', '/student/assistant', (_m, b) => {
  need('student'); const q = String(b?.question ?? '').trim();
  if (q.length < 2) throw new E(400, 'اكتب سؤالًا أطول.');
  const a = answerQuestion(report(stu(session!.studentId!)), q.slice(0, 500));
  log('ASSISTANT_QUERY', 'student', session!.studentId, { intent: a.intent });
  return a;
});

// ---------- الإدارة ----------
const A = (method: string, pattern: string, h: H) => on(method, '/admin' + pattern, (m, b, q) => { need('admin'); return h(m, b, q); });

A('GET', '/overview', () => {
  const issues: any[] = [];
  plans.forEach((p) => validatePlan(p).forEach((v) => issues.push({ ...v, plan: p.label })));
  const real = plans.filter((p) => !p.isDemo);
  const codes = new Set(real.flatMap((p) => p.courses.map((c) => c.code)));
  for (const code of codes) {
    const vals = real.filter((p) => p.courses.some((c) => c.code === code)).map((p) => ({ p, v: p.prerequisites.filter((x) => x.course === code).map((x) => x.requires).sort().join(',') }));
    if (vals.length > 1 && new Set(vals.map((x) => x.v)).size > 1) {
      const name = real.flatMap((p) => p.courses).find((c) => c.code === code)?.nameAr;
      issues.push({ level: 'warning', text: `المساق ${name} (${code}) له متطلبات سابقة مختلفة بين الخطط: ${vals.map((x) => `${x.p.trackNameAr}: ${x.v || 'لا يوجد'}`).join(' | ')}. حُفظ كما ورد في كل وثيقة؛ يُرجى تأكيده.` });
    }
  }
  const und = (['repeatPolicy', 'minPassingGrade', 'maxTermCredits'] as const).filter((k) => rules[k] == null);
  if (und.length) issues.push({ level: 'info', text: `قواعد غير مضبوطة بعد (غير موثقة في الوثائق المحمّلة): ${und.join('، ')}.` });
  return { counts: { students: students.length, demo_students: students.length, plans: plans.length, approved_plans: plans.filter((p) => p.status === 'approved').length, courses: allCourses().size, errors_7d: 0, current_term: terms.find((t) => t.isCurrent)?.code }, issues, appMode: 'demo', llm: { enabledByRule: rules.llmEnabled, available: false, configured: false } };
});
A('GET', '/tracks', () => TRACKS.map((t, i) => ({ id: i + 1, code: t.code, name_ar: t.nameAr, name_en: t.nameEn, program_name: PROGRAM.nameAr, program_code: PROGRAM.code, students: students.filter((s) => s.profile.trackCode === t.code).length })));
A('GET', '/plans', () => plans.map((p) => ({ ...p, courses: undefined, courseCount: p.courses.length, assignedStudents: students.filter((s) => s.profile.planVersionId === p.id).length, validation: validatePlan(p) })));
A('GET', '/plans/:id', (m) => { const p = plan(+m[1]); return { ...p, validation: validatePlan(p) }; });
A('PATCH', '/plans/:id', (m, b) => {
  const p = plan(+m[1]);
  if (p.isDemo && b.status && b.status !== 'archived') throw new E(400, 'الخطط التجريبية لا يمكن اعتمادها كخطط رسمية.');
  if (b.status === 'approved') { const d = validatePlan(p).filter((v) => v.level === 'danger'); if (d.length) throw new E(400, 'لا يمكن اعتماد الخطة قبل إصلاح: ' + d.map((x) => x.text).join('؛ ')); }
  if (p.status === 'approved' && b.totalCredits !== undefined) throw new E(409, 'لا يمكن تعديل إجمالي ساعات خطة معتمدة؛ أنشئ إصدارًا جديدًا.');
  for (const k of ['label', 'effectiveFromYear', 'effectiveToYear', 'totalCredits', 'status', 'minGpaForGraduation', 'sourceNote'] as const) if (b[k] !== undefined) (p as any)[k] = b[k];
  log(b.status ? `PLAN_STATUS_${String(b.status).toUpperCase()}` : 'PLAN_UPDATE', 'plan_version', p.id, b);
  return { ok: true };
});
A('POST', '/plans/:id/clone', (m, b) => {
  const src = plan(+m[1]); const c: PlanVersion = JSON.parse(JSON.stringify(src));
  c.id = Math.max(...plans.map((p) => p.id)) + 1; c.label = b.label; c.effectiveFromYear = b.effectiveFromYear; c.effectiveToYear = b.effectiveToYear; c.status = src.isDemo ? 'demo' : 'draft';
  c.sourceNote = `نسخة من الإصدار #${src.id}. ${src.sourceNote ?? ''}`;
  plans.push(c); log('PLAN_CLONE', 'plan_version', c.id, b); return { id: c.id };
});
A('DELETE', '/plans/:id', (m) => { const p = plan(+m[1]); if (p.status !== 'draft' || students.some((s) => s.profile.planVersionId === p.id)) throw new E(409, 'يمكن حذف المسودات غير المرتبطة بطلبة فقط؛ استخدم الأرشفة لغيرها.'); plans.splice(plans.indexOf(p), 1); log('PLAN_DELETE', 'plan_version', p.id); return { ok: true }; });
A('POST', '/plans/import', (_m, b) => {
  if (!b?.courses?.length || !['SEC', 'ITM'].includes(b.trackCode)) throw new E(400, 'ملف الخطة غير صالح: يلزم trackCode و courses.');
  const cats = Array.isArray(b.categories) ? b.categories : Object.entries(b.categories ?? {}).map(([k, v]) => ({ category: k as Category, requiredCredits: v as number, countsTowardTotal: k !== 'REMEDIAL' }));
  const p: PlanVersion = { id: Math.max(...plans.map((x) => x.id)) + 1, trackCode: b.trackCode, trackNameAr: trackName(b.trackCode), programNameAr: PROGRAM.nameAr, label: b.label ?? 'خطة مستوردة', effectiveFromYear: b.effectiveFromYear ?? 2026, effectiveToYear: b.effectiveToYear ?? null, totalCredits: b.totalCredits, status: 'draft', isDemo: false, sourceNote: 'مستوردة من ملف JSON (نسخة العرض)', courses: b.courses, prerequisites: b.prerequisites ?? [], corequisites: b.corequisites ?? [], categories: cats, guidingSlots: (b.guidingSlots ?? []).filter((g: any) => g.category), nonCreditRequirements: [], equivalences: [], minGpaForGraduation: null };
  plans.push(p); log('PLAN_IMPORT', 'plan_version', p.id); return { id: p.id, status: 'draft' };
});
A('POST', '/plans/:id/courses', (m, b) => {
  const p = plan(+m[1]); lockCheck(p); const code = codeOk(b.code); const cm = allCourses();
  if (p.courses.some((c) => c.code === code)) throw new E(409, 'السجل موجود مسبقًا (تكرار غير مسموح).');
  let c = cm.get(code);
  if (!c) { if (!b.nameAr || b.credits == null) throw new E(400, 'المساق غير موجود في الدليل؛ أدخل اسمه وعدد ساعاته لإنشائه.'); c = { code, nameAr: b.nameAr, credits: +b.credits }; extraCourses.set(code, c); }
  if (!p.categories.some((x) => x.category === b.category)) throw new E(409, 'الفئة غير معرفة في هذه الخطة.');
  p.courses.push({ ...c, category: b.category, suggestedYear: b.suggestedYear ?? null, suggestedTerm: b.suggestedTerm ?? null });
  log('PLAN_COURSE_ADD', 'plan_version', p.id, b); return { ok: true };
});
A('PATCH', '/plans/:id/courses/:code', (m, b) => { const p = plan(+m[1]); lockCheck(p); const c = p.courses.find((x) => x.code === m[2]); if (!c) throw new E(404, 'المساق ليس في الخطة'); if (b.category) c.category = b.category; c.suggestedYear = b.suggestedYear ?? null; c.suggestedTerm = b.suggestedTerm ?? null; log('PLAN_COURSE_UPDATE', 'plan_version', p.id, { code: m[2], ...b }); return { ok: true }; });
A('DELETE', '/plans/:id/courses/:code', (m) => { const p = plan(+m[1]); lockCheck(p); p.courses = p.courses.filter((c) => c.code !== m[2]); p.prerequisites = p.prerequisites.filter((x) => x.course !== m[2] && x.requires !== m[2]); log('PLAN_COURSE_REMOVE', 'plan_version', p.id, { code: m[2] }); return { ok: true }; });
A('POST', '/plans/:id/requisites', (m, b) => {
  const p = plan(+m[1]); lockCheck(p); codeOk(b.course); codeOk(b.requires);
  if (b.course === b.requires) throw new E(400, 'لا يمكن أن يكون المساق متطلبًا لنفسه.');
  if (!p.courses.some((c) => c.code === b.course) || !p.courses.some((c) => c.code === b.requires)) throw new E(409, 'كلا المساقين يجب أن يكونا ضمن الخطة.');
  const list = b.type === 'co' ? p.corequisites : p.prerequisites;
  if (list.some((x) => x.course === b.course && x.requires === b.requires)) throw new E(409, 'السجل موجود مسبقًا (تكرار غير مسموح).');
  list.push({ course: b.course, requires: b.requires });
  if (validatePlan(p).some((v) => v.text.includes('حلقة'))) { list.pop(); throw new E(400, 'رُفض المتطلب لأنه يُنشئ حلقة في سلسلة المتطلبات السابقة.'); }
  log('REQUISITE_ADD', 'plan_version', p.id, b); return { ok: true };
});
A('DELETE', '/plans/:id/requisites', (m, _b, q) => { const p = plan(+m[1]); lockCheck(p); const key = q.get('type') === 'co' ? 'corequisites' : 'prerequisites'; p[key] = p[key].filter((x) => !(x.course === q.get('course') && x.requires === q.get('requires'))); log('REQUISITE_REMOVE', 'plan_version', p.id, Object.fromEntries(q)); return { ok: true }; });
A('PUT', '/plans/:id/categories/:cat', (m, b) => { const p = plan(+m[1]); lockCheck(p); const c = p.categories.find((x) => x.category === m[2]); if (c) { c.requiredCredits = +b.requiredCredits; c.countsTowardTotal = !!b.countsTowardTotal; } else p.categories.push({ category: m[2] as Category, requiredCredits: +b.requiredCredits, countsTowardTotal: !!b.countsTowardTotal }); log('CATEGORY_UPDATE', 'plan_version', p.id, { cat: m[2], ...b }); return { ok: true }; });
A('POST', '/plans/:id/requirements', (m, b) => { const p = plan(+m[1]); if (!/^[A-Z0-9_]{2,32}$/.test(b.code ?? '')) throw new E(400, 'رمز المتطلب بأحرف إنجليزية كبيرة وأرقام'); p.nonCreditRequirements.push({ id: ++seq, code: b.code, nameAr: b.nameAr, description: b.description ?? null, suggestedYear: b.suggestedYear ?? null, suggestedTerm: b.suggestedTerm ?? null }); log('GRAD_REQ_ADD', 'plan_version', p.id, b); return { ok: true }; });
A('DELETE', '/plans/:id/requirements/:rid', (m) => { const p = plan(+m[1]); p.nonCreditRequirements = p.nonCreditRequirements.filter((r) => String(r.id) !== m[2]); log('GRAD_REQ_REMOVE', 'plan_version', p.id); return { ok: true }; });

A('GET', '/courses', (_m, _b, q) => { const s = (q.get('q') ?? '').trim(); return [...allCourses().values()].filter((c) => !s || c.code.startsWith(s) || c.nameAr.includes(s)).sort((a, b) => a.code.localeCompare(b.code)).map((c) => ({ code: c.code, name_ar: c.nameAr, name_en: null, credits: c.credits, is_active: true, is_demo: c.code.startsWith('99'), plans: plans.filter((p) => p.courses.some((x) => x.code === c.code)).map((p) => p.id) })); });
A('POST', '/courses', (_m, b) => { const code = codeOk(b.code); if (allCourses().has(code)) throw new E(409, 'السجل موجود مسبقًا (تكرار غير مسموح).'); extraCourses.set(code, { code, nameAr: b.nameAr, credits: +b.credits }); log('COURSE_CREATE', 'course', code, b); return { ok: true }; });
A('PATCH', '/courses/:code', (m, b) => {
  const code = m[1];
  if (b.credits !== undefined && plans.some((p) => p.status === 'approved' && p.courses.some((c) => c.code === code && c.credits !== +b.credits))) throw new E(409, 'لا يمكن تغيير ساعات مساق مستخدم في خطة معتمدة؛ أنشئ مساقًا برمز جديد.');
  plans.forEach((p) => p.courses.forEach((c) => { if (c.code === code) { if (b.nameAr) c.nameAr = b.nameAr; if (b.credits !== undefined) c.credits = +b.credits; } }));
  const ex = extraCourses.get(code); if (ex) { if (b.nameAr) ex.nameAr = b.nameAr; if (b.credits !== undefined) ex.credits = +b.credits; }
  log('COURSE_UPDATE', 'course', code, b); return { ok: true };
});

A('GET', '/terms', () => [...terms].sort((a, b) => b.yearStart * 10 + b.termNo - (a.yearStart * 10 + a.termNo)).map((t) => ({ code: t.code, year_start: t.yearStart, term_no: t.termNo, name_ar: t.nameAr, is_current: t.isCurrent, offerings: offerings.filter((o) => o.termCode === t.code).length })));
A('POST', '/terms', (_m, b) => { const code = `${b.yearStart}-${b.termNo}`; if (terms.some((t) => t.code === code)) throw new E(409, 'السجل موجود مسبقًا (تكرار غير مسموح).'); terms.push({ code, yearStart: +b.yearStart, termNo: +b.termNo, nameAr: b.nameAr, isCurrent: false }); log('TERM_CREATE', 'term', code); return { ok: true }; });
A('POST', '/terms/:code/current', (m) => { const t = terms.find((x) => x.code === m[1]); if (!t) throw new E(404, 'الفصل غير موجود'); terms.forEach((x) => (x.isCurrent = false)); t.isCurrent = true; log('TERM_SET_CURRENT', 'term', m[1]); return { ok: true }; });
A('GET', '/terms/:code/offerings', (m) => offerings.filter((o) => o.termCode === m[1]).map((o) => o.courseCode));
A('PUT', '/terms/:code/offerings', (m, b) => { for (let i = offerings.length - 1; i >= 0; i--) if (offerings[i].termCode === m[1]) offerings.splice(i, 1); [...new Set<string>(b.codes ?? [])].forEach((c) => offerings.push({ termCode: m[1], courseCode: codeOk(c) })); log('OFFERINGS_SET', 'term', m[1], { count: b.codes?.length }); return { ok: true }; });

A('GET', '/rules', () => Object.keys(DEFAULT_RULES).sort().map((k) => ({ key: k, value: (rules as any)[k], description_ar: RULE_DESCRIPTIONS[k] ?? k, updated_at: null })));
A('PUT', '/rules/:key', (m, b) => {
  const k = m[1]; if (!(k in rules)) throw new E(404, 'قاعدة غير معروفة');
  const v = b?.value;
  const numOrNull = (x: unknown, lo: number, hi: number) => { if (x === null) return null; if (typeof x !== 'number' || Number.isNaN(x) || x < lo || x > hi) throw new E(400, `القيمة يجب أن تكون رقمًا بين ${lo} و ${hi} أو فارغة`); return x; };
  const val = k === 'repeatPolicy' ? (v === null || v === 'latest' || v === 'highest' ? v : (() => { throw new E(400, 'قيمة غير صالحة'); })())
    : k === 'minPassingGrade' ? numOrNull(v, 0, 100) : k === 'maxTermCredits' || k === 'minTermCredits' ? numOrNull(v, 0, 30) : k === 'summerMaxCredits' ? numOrNull(v, 0, 15) : k === 'gpaScale' ? numOrNull(v, 1, 100)
    : k === 'priorityWeights' ? { ...rules.priorityWeights, ...v } : !!v;
  (rules as any)[k] = val; log('RULE_UPDATE', 'rule', k, { value: val }); return { ok: true };
});

A('GET', '/students', (_m, _b, q) => { const s = (q.get('q') ?? '').trim(); return students.filter((x) => !s || x.profile.universityId.startsWith(s) || x.profile.nameAr.includes(s)).map(row); });
A('GET', '/students/:id', (m) => {
  const s = stu(+m[1]); const cm = allCourses();
  log('STUDENT_VIEW', 'student', s.profile.id);
  return {
    student: row(s),
    records: s.records.map((r, i) => ({ id: s.recIds[i], course_code: r.courseCode, name_ar: cm.get(r.courseCode)?.nameAr ?? r.courseNameAr, credits: cm.get(r.courseCode)?.credits ?? r.credits, term_code: r.termCode, status: r.status, grade: r.grade, source: 'demo' })),
    registrations: s.registrations.map((r, i) => ({ id: s.regIds[i], course_code: r.courseCode, name_ar: cm.get(r.courseCode)?.nameAr, credits: cm.get(r.courseCode)?.credits, term_code: r.termCode, status: 'registered' })),
    requirements: s.nonCredit.map((n) => ({ requirement_code: n.code, status: n.status })),
    report: report(s),
  };
});
A('POST', '/students', (_m, b) => {
  if (!/^[0-9A-Za-z]{4,20}$/.test(b.universityId ?? '')) throw new E(400, 'رقم جامعي غير صالح');
  if (students.some((s) => s.profile.universityId === b.universityId)) throw new E(409, 'السجل موجود مسبقًا (تكرار غير مسموح).');
  const id = Math.max(...students.map((s) => s.profile.id)) + 1;
  students.push({ scenario: 'طالب أضيف من لوحة الإدارة (نسخة العرض – كلمة المرور الموحدة للطلبة)', profile: { id, universityId: b.universityId, nameAr: b.nameAr, trackCode: b.trackCode, enrollmentYear: +b.enrollmentYear, academicYearLevel: +b.academicYearLevel, gpa: b.gpa ?? null, recordComplete: b.recordComplete ?? true, officialStatus: b.officialStatus ?? 'active', isDemo: true, dataSource: 'demo', planVersionId: b.planVersionId ?? null, planAssignmentNote: b.planAssignmentNote ?? null }, records: [], registrations: [], nonCredit: [], recIds: [], regIds: [] });
  log('STUDENT_CREATE', 'student', id); return { id };
});
A('PATCH', '/students/:id', (m, b) => { const s = stu(+m[1]); for (const k of ['nameAr', 'trackCode', 'enrollmentYear', 'academicYearLevel', 'gpa', 'recordComplete', 'officialStatus', 'planVersionId', 'planAssignmentNote'] as const) if (b[k] !== undefined) (s.profile as any)[k] = b[k]; log('STUDENT_UPDATE', 'student', s.profile.id, b); return { ok: true }; });
A('POST', '/students/:id/password', () => { throw new E(400, 'في نسخة العرض كلمة مرور الطلبة موحدة ولا يمكن تغييرها.'); });
A('POST', '/students/:id/records', (m, b) => {
  const s = stu(+m[1]); const code = codeOk(b.courseCode); const cm = allCourses();
  if (!cm.has(code)) throw new E(409, 'لا يمكن تنفيذ العملية لارتباطها ببيانات أخرى (مرجع غير موجود أو مستخدم).');
  if (!terms.some((t) => t.code === b.termCode)) throw new E(409, 'الفصل غير موجود.');
  if (b.status == null && b.grade == null) throw new E(400, 'أدخل الحالة أو العلامة على الأقل.');
  if (s.records.some((r) => r.courseCode === code && r.termCode === b.termCode)) throw new E(409, 'السجل موجود مسبقًا (تكرار غير مسموح).');
  s.records.push({ courseCode: code, termCode: b.termCode, status: b.status, grade: b.grade ?? null, courseNameAr: cm.get(code)!.nameAr, credits: cm.get(code)!.credits }); s.recIds.push(++seq);
  log('RECORD_ADD', 'student', s.profile.id, b); return { ok: true };
});
A('DELETE', '/students/:id/records/:rid', (m) => { const s = stu(+m[1]); const i = s.recIds.indexOf(+m[2]); if (i >= 0) { s.records.splice(i, 1); s.recIds.splice(i, 1); } log('RECORD_DELETE', 'student', s.profile.id); return { ok: true }; });
A('POST', '/students/:id/registrations', (m, b) => { const s = stu(+m[1]); const code = codeOk(b.courseCode); if (!allCourses().has(code)) throw new E(409, 'المساق غير موجود'); if (s.registrations.some((r) => r.courseCode === code && r.termCode === b.termCode)) throw new E(409, 'السجل موجود مسبقًا (تكرار غير مسموح).'); s.registrations.push({ courseCode: code, termCode: b.termCode }); s.regIds.push(++seq); log('REGISTRATION_ADD', 'student', s.profile.id, b); return { ok: true }; });
A('DELETE', '/students/:id/registrations/:rid', (m) => { const s = stu(+m[1]); const i = s.regIds.indexOf(+m[2]); if (i >= 0) { s.registrations.splice(i, 1); s.regIds.splice(i, 1); } log('REGISTRATION_DELETE', 'student', s.profile.id); return { ok: true }; });
A('PUT', '/students/:id/requirements/:code', (m, b) => { const s = stu(+m[1]); const n = s.nonCredit.find((x) => x.code === m[2]); if (n) n.status = b.status; else s.nonCredit.push({ code: m[2], status: b.status }); log('REQUIREMENT_STATUS', 'student', s.profile.id, { code: m[2], ...b }); return { ok: true }; });
A('POST', '/import/records', (_m, b) => {
  const lines = String(b.csv ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new E(400, 'الملف فارغ');
  const h = lines.shift()!.split(',').map((x) => x.trim().toLowerCase()); const ix = (n: string) => h.indexOf(n);
  if (['university_id', 'course_code', 'term_code', 'status', 'grade'].some((n) => ix(n) < 0)) throw new E(400, 'ترويسة الملف يجب أن تحتوي: university_id,course_code,term_code,status,grade');
  const errors: string[] = []; const ok: any[] = []; const cm = allCourses();
  lines.forEach((l, i) => { const c = l.split(',').map((x) => x.trim()); const r = { uid: c[ix('university_id')], code: c[ix('course_code')], term: c[ix('term_code')], status: c[ix('status')] || null, grade: c[ix('grade')] ? +c[ix('grade')] : null }; const s = students.find((x) => x.profile.universityId === r.uid);
    if (!s) errors.push(`سطر ${i + 2}: رقم جامعي غير موجود ${r.uid}`); else if (!cm.has(r.code)) errors.push(`سطر ${i + 2}: مساق غير موجود ${r.code}`); else if (!terms.some((t) => t.code === r.term)) errors.push(`سطر ${i + 2}: فصل غير موجود ${r.term}`); else if (r.status && !['passed', 'failed', 'withdrawn', 'incomplete', 'exempt', 'transfer'].includes(r.status)) errors.push(`سطر ${i + 2}: حالة غير صالحة ${r.status}`); else ok.push({ ...r, s }); });
  if (!b.dryRun && !errors.length) { ok.forEach((r) => { const ex = r.s.records.findIndex((x: any) => x.courseCode === r.code && x.termCode === r.term); const rec = { courseCode: r.code, termCode: r.term, status: r.status, grade: r.grade, courseNameAr: cm.get(r.code)!.nameAr, credits: cm.get(r.code)!.credits }; if (ex >= 0) r.s.records[ex] = rec; else { r.s.records.push(rec); r.s.recIds.push(++seq); } }); log('RECORDS_IMPORT', 'student_course_records', null, { rows: ok.length }); }
  return { valid: ok.length, errors, imported: !b.dryRun && !errors.length ? ok.length : 0 };
});
const csvRows = (text: string) => { const l = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean); const h = (l.shift() ?? '').split(',').map((x) => x.trim().toLowerCase()); return { h, rows: l.map((x) => x.split(',').map((y) => y.trim())) }; };
A('POST', '/import/students', (_m, b) => {
  const { h, rows } = csvRows(b.csv); const g = (r: string[], n: string) => r[h.indexOf(n)] ?? '';
  const need = ['university_id', 'name_ar', 'track', 'enrollment_year', 'academic_year_level'].filter((n) => !h.includes(n));
  if (need.length) throw new E(400, `ترويسة الملف ينقصها: ${need.join(', ')}`);
  const errors: string[] = []; const ok: any[] = [];
  rows.forEach((r, i) => { const t = g(r, 'track').toUpperCase(); if (!/^[0-9A-Za-z]{4,20}$/.test(g(r, 'university_id'))) errors.push(`سطر ${i + 2}: رقم جامعي غير صالح`); else if (!['SEC', 'ITM'].includes(t)) errors.push(`سطر ${i + 2}: مسار غير معروف`); else ok.push({ uid: g(r, 'university_id'), name: g(r, 'name_ar'), t, ey: +g(r, 'enrollment_year'), lvl: +g(r, 'academic_year_level'), gpa: g(r, 'gpa') ? +g(r, 'gpa') : null }); });
  const toCreate = ok.filter((o) => !students.some((s) => s.profile.universityId === o.uid)).length;
  const credentials: any[] = [];
  if (!b.dryRun && !errors.length) ok.forEach((o) => { const ex = students.find((s) => s.profile.universityId === o.uid); if (ex) Object.assign(ex.profile, { nameAr: o.name, trackCode: o.t, enrollmentYear: o.ey, academicYearLevel: o.lvl, gpa: o.gpa }); else { const id = Math.max(...students.map((s) => s.profile.id)) + 1; students.push({ scenario: 'مستورد من ملف (نسخة العرض – كلمة المرور الموحدة)', profile: { id, universityId: o.uid, nameAr: o.name, trackCode: o.t, enrollmentYear: o.ey, academicYearLevel: o.lvl, gpa: o.gpa, recordComplete: true, officialStatus: 'active', isDemo: true, dataSource: 'demo', planVersionId: null }, records: [], registrations: [], nonCredit: [], recIds: [], regIds: [] }); credentials.push({ university_id: o.uid, name_ar: o.name, initial_password: DEMO_STUDENT_PASSWORD }); } });
  return { valid: ok.length, toCreate, toUpdate: ok.length - toCreate, errors, imported: !b.dryRun && !errors.length ? ok.length : 0, credentials };
});
A('POST', '/import/registrations', (_m, b) => {
  const { h, rows } = csvRows(b.csv); const cm = allCourses(); const errors: string[] = []; const ok: any[] = [];
  if (['university_id', 'course_code', 'term_code'].some((n) => !h.includes(n))) throw new E(400, 'ترويسة الملف يجب أن تحتوي: university_id,course_code,term_code');
  rows.forEach((r, i) => { const s = students.find((x) => x.profile.universityId === r[h.indexOf('university_id')]); const code = r[h.indexOf('course_code')], term = r[h.indexOf('term_code')]; if (!s) errors.push(`سطر ${i + 2}: رقم جامعي غير موجود`); else if (!cm.has(code)) errors.push(`سطر ${i + 2}: مساق غير موجود ${code}`); else if (!terms.some((t) => t.code === term)) errors.push(`سطر ${i + 2}: فصل غير موجود`); else ok.push({ s, code, term }); });
  if (!b.dryRun && !errors.length) { const cleared = new Set<string>(); ok.forEach((o) => { const k = o.s.profile.id + o.term; if (!cleared.has(k)) { cleared.add(k); for (let i = o.s.registrations.length - 1; i >= 0; i--) if (o.s.registrations[i].termCode === o.term) { o.s.registrations.splice(i, 1); o.s.regIds.splice(i, 1); } } if (!o.s.registrations.some((r: any) => r.courseCode === o.code && r.termCode === o.term)) { o.s.registrations.push({ courseCode: o.code, termCode: o.term }); o.s.regIds.push(++seq); } }); }
  return { valid: ok.length, errors, imported: !b.dryRun && !errors.length ? ok.length : 0 };
});
A('GET', '/reports', () => {
  const demand = new Map<string, any>();
  const rows = students.map((s) => { const r = report(s);
    r.recommendations.filter((x) => x.included && x.code).forEach((x) => { const d = demand.get(x.code!) ?? { code: x.code, name: x.nameAr, count: 0, conditional: 0 }; d.count++; if (x.conditionalOn) d.conditional++; demand.set(x.code!, d); });
    return { id: s.profile.id, universityId: s.profile.universityId, name: s.profile.nameAr, track: r.plan?.trackNameAr, year: s.profile.academicYearLevel, earned: r.credits.earned, remaining: r.credits.remaining, percent: r.credits.percent, behind: r.delay.isBehind, openFails: r.failedCourses.filter((f) => !f.nowPassed).length, graduation: r.graduation.stateLabel, gradState: r.graduation.state, reliability: r.reliability, termsNeeded: r.projection.termsNeeded, isDemo: true }; });
  return { students: rows, summary: { total: rows.length, behind: rows.filter((r) => r.behind).length, withOpenFails: rows.filter((r) => r.openFails > 0).length, expected: rows.filter((r) => r.gradState === 'expected').length, met: rows.filter((r) => r.gradState === 'requirements_met').length }, demand: [...demand.values()].sort((a, b) => b.count - a.count) };
});
A('GET', '/audit', () => audit.slice(0, 200));
A('GET', '/errors', () => []);
A('GET', '/integration', () => ({ mode: 'demo', sisConfigured: false, settings: { enabled: false, note: 'نسخة عرض مستقلة تعمل بالكامل داخل المتصفح دون أي اتصال بأنظمة الجامعة.' }, requirements: [
  'موافقة رسمية من الجامعة وتحديد الجهة المالكة للبيانات وسياسة الخصوصية.',
  'واجهة برمجية (API) أو ملف تصدير دوري موثق من نظام معلومات الطلبة.',
  'ربط تسجيل الدخول بنظام الهوية الجامعي (SSO).',
  'اعتماد الخطط الرسمية وسياسات النجاح والإعادة والعبء وشروط التخرج.',
], llmConfigured: false }));
A('POST', '/integration/sync/:id', () => { throw new E(501, 'التكامل مع نظام معلومات الطلبة غير مفعّل في نسخة العرض.'); });

export async function demoCall(method: string, path: string, body?: unknown): Promise<any> {
  await new Promise((r) => setTimeout(r, 60));
  const [p, qs] = path.split('?');
  for (const [m, re, h] of routes) {
    if (m !== method) continue;
    const match = p.match(re);
    if (match) {
      try {
        return JSON.parse(JSON.stringify(h(match, body ?? {}, new URLSearchParams(qs ?? '')) ?? null));
      } catch (e: any) {
        const { ApiError } = await import('./api');
        if (e instanceof E) throw new ApiError(e.status, e.message);
        console.error(e);
        throw new ApiError(500, 'حدث خطأ غير متوقع في نسخة العرض.');
      }
    }
  }
  const { ApiError } = await import('./api');
  throw new ApiError(404, 'المسار غير موجود');
}
