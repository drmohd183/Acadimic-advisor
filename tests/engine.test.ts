// اختبارات محرك الإرشاد على السيناريوهات العشرة المطلوبة (وأكثر)
import { describe, it, expect } from 'vitest';
import { buildPlans, buildStudents, buildTerms } from '../shared/src/seedData';
import { runAdvising, validatePlan } from '../shared/src/engine';
import { answerQuestion } from '../shared/src/assistant';
import { DEFAULT_RULES, type AdvisingReport, type AdvisingRules, ELECTIVE_CATEGORIES } from '../shared/src/types';

const plans = buildPlans();
const terms = buildTerms();
const students = buildStudents(plans);
const run = (uid: string, rules: Partial<AdvisingRules> = {}, mutate?: (s: (typeof students)[number]) => void): AdvisingReport => {
  const s0 = students.find((x) => x.profile.universityId === uid)!;
  const s = JSON.parse(JSON.stringify(s0));
  mutate?.(s);
  return runAdvising({ student: s.profile, plans: plans.filter((p) => p.trackCode === s.profile.trackCode || p.id === s.profile.planVersionId), records: s.records, registrations: s.registrations, terms, rules: { ...DEFAULT_RULES, ...rules }, nonCreditStatus: s.nonCredit, now: '2026-10-19T00:00:00Z' });
};
const ALL = students.map((s) => s.profile.universityId);

/** ثوابت يجب أن تتحقق لكل طالب */
function invariants(r: AdvisingReport) {
  const byCode = new Map(r.courses.map((c) => [c.code, c]));
  for (const rec of r.recommendations) {
    const codes = rec.kind === 'course' ? [rec.code!] : (rec.options ?? []).map((o) => o.code);
    for (const code of codes) {
      const c = byCode.get(code)!;
      // لا يُقترح مساق مجتاز أو مسجل
      expect(['passed', 'registered']).not.toContain(c.state);
      // كل متطلب سابق إما مجتاز، أو (للمشروط فقط) مسجل حاليًا
      for (const p of c.prerequisites) {
        if (rec.conditionalOn) expect(p.met || p.registered).toBe(true);
        else expect(p.met).toBe(true);
      }
      expect(c.state).not.toBe('blocked');
    }
    expect(rec.reasons.length).toBeGreaterThan(0); // لكل توصية سبب
  }
  // الحزمة ضمن حد العبء
  expect(r.recommendations.filter((x) => x.included).reduce((s, x) => s + x.credits, 0)).toBeLessThanOrEqual(r.loadLimit.credits);
  // لا ازدواجية: الساعات المجتازة المحتسبة = مجموع ساعات المساقات المجتازة الفريدة (مع سقف الفئات)
  const sumCat = r.categories.filter((c) => c.countsTowardTotal).reduce((s, c) => s + c.earned, 0);
  expect(r.credits.earned).toBe(sumCat);
  for (const c of r.categories) expect(c.earned).toBeLessThanOrEqual(c.required);
  expect(r.credits.earned + r.credits.remaining).toBe(r.credits.required);
  // الساعات المسجلة منفصلة عن المجتازة
  const passedCodes = r.courses.filter((c) => c.state === 'passed').map((c) => c.code);
  expect(new Set(passedCodes).size).toBe(passedCodes.length);
}

describe('ثوابت عامة لكل الطلبة التجريبيين', () => {
  it.each(ALL)('الطالب %s', (uid) => invariants(run(uid)));
});

describe('سلامة الخطط المستوردة', () => {
  it('الخطتان المستوردتان بلا أخطاء حرجة وإجماليهما 133', () => {
    for (const p of plans.filter((x) => !x.isDemo)) {
      expect(p.totalCredits).toBe(133);
      expect(validatePlan(p).filter((v) => v.level === 'danger')).toEqual([]);
    }
  });
  it('الاختلاف في متطلب الإنجليزية (2) محفوظ كما ورد في كل وثيقة', () => {
    const sec = plans.find((p) => p.trackCode === 'SEC' && !p.isDemo)!;
    const itm = plans.find((p) => p.trackCode === 'ITM')!;
    expect(sec.prerequisites.some((x) => x.course === '15200112' && x.requires === '15200106')).toBe(true);
    expect(itm.prerequisites.some((x) => x.course === '15200112')).toBe(false);
  });
});

describe('1) سنة أولى لم يجتز أي مساق', () => {
  const r = run('202690001');
  it('صفر ساعات مجتازة ولا تأخر', () => {
    expect(r.credits.earned).toBe(0);
    expect(r.delay.isBehind).toBe(false);
    expect(r.credits.registered).toBe(15);
  });
  it('الاستدراكي أولًا بأولوية عالية، ومساقات الفصل الثاني المعتمدة على المسجل مشروطة', () => {
    const top = r.recommendations[0];
    expect(top.code).toBe('15200099');
    expect(top.priority).toBe('high');
    const prog2 = r.recommendations.find((x) => x.code === '19040113')!;
    expect(prog2.conditionalOn?.map((c) => c.code)).toEqual(['19040112']);
  });
  it('لا يقترح مساقات متقدمة غير مستوفاة', () => {
    expect(r.recommendations.some((x) => x.code === '19011202')).toBe(false);
    expect(r.yearGuidance.title).toContain('السنة الأولى');
  });
});

describe('2) سنة ثانية اجتاز بعض المساقات الأساسية', () => {
  const r = run('202590002');
  it('يحسب الساعات المجتازة ويكشف الرسوب في تفاضل وتكامل (2)', () => {
    expect(r.credits.earned).toBe(24);
    expect(r.failedCourses.find((f) => f.code === '15010102')).toMatchObject({ nowPassed: false, retaken: true });
  });
  it('تركيب البيانات مشروط باجتياز البرمجة الكينونية المسجلة حاليًا', () => {
    expect(r.courses.find((c) => c.code === '19011202')!.state).toBe('conditional');
  });
});

describe('3) سنة ثالثة لديه مساق راسب يمنع تسجيل مساق متقدم', () => {
  const r = run('202490003');
  it('تركيب البيانات متعثر ومتاح للإعادة وبأعلى أولوية', () => {
    expect(r.courses.find((c) => c.code === '19011202')!.state).toBe('failed_retake');
    expect(r.recommendations[0].code).toBe('19011202');
    expect(r.recommendations[0].priority).toBe('high');
  });
  it('المساقات المتقدمة محجوبة مع ذكر السبب ولا تُعرض متاحة', () => {
    for (const code of ['19011300', '19011303', '19011304', '19011305', '19011401']) {
      const c = r.courses.find((x) => x.code === code)!;
      expect(c.state).toBe('blocked');
      expect(c.blockedReasons.join(' ')).toContain('19011202');
      expect(r.recommendations.some((x) => x.code === code || x.options?.some((o) => o.code === code))).toBe(false);
    }
    expect(r.bottlenecks.some((b) => b.code === '19011202')).toBe(true);
    expect(r.delay.isBehind).toBe(true);
  });
  it('المساعد يشرح سبب عدم إتاحة نظم قواعد البيانات', () => {
    const a = answerQuestion(r, 'لماذا لا أستطيع تسجيل نظم قواعد البيانات؟');
    expect(a.intent).toBe('why_not');
    expect(a.answer).toContain('19011202');
  });
});

describe('4) سنة رابعة لديه متطلبات تخرج متبقية', () => {
  const r = run('202390004');
  it('يسرد المتبقي: إجباري تخصص واختياري وتدريب ميداني', () => {
    expect(r.graduation.state).toBe('not_eligible');
    const codes = r.graduation.missing.map((m) => m.code);
    expect(codes).toEqual(expect.arrayContaining(['MAJ_REQ', 'MAJ_ELEC', 'UNI_REQ', 'FIELD_TRAINING']));
    expect(r.projection.termsNeeded).toBeGreaterThan(0);
  });
  it('مشروع تخرج (2) مشروط باجتياز مشروع تخرج (1) المسجل', () => {
    const gp2 = r.recommendations.find((x) => x.code === '19011405');
    expect(gp2?.conditionalOn?.[0].code).toBe('19011404');
  });
});

describe('5) اجتاز جميع المساقات لكن متطلبًا آخر غير مستوفى', () => {
  const r = run('202290005');
  it('133/133 لكنه غير مستوفٍ بسبب التدريب الميداني فقط', () => {
    expect(r.credits.earned).toBe(133);
    expect(r.graduation.state).toBe('not_eligible');
    expect(r.graduation.missing.map((m) => m.code)).toEqual(['FIELD_TRAINING']);
    expect(r.recommendations).toHaveLength(0);
  });
  it('يصبح «مستوفيًا» (وليس خريجًا) عند استيفاء التدريب', () => {
    const r2 = run('202290005', {}, (s) => { s.nonCredit = [{ code: 'FIELD_TRAINING', status: 'met' }]; });
    expect(r2.graduation.state).toBe('requirements_met');
  });
});

describe('6 و 7) طالب من كل مسار', () => {
  it('أمن المعلومات: خطة المسار الصحيحة واختيارياته', () => {
    const r = run('202490006');
    expect(r.plan!.id).toBe(1);
    expect(r.delay.isBehind).toBe(false);
    const elec = r.recommendations.find((x) => x.category === 'MAJ_ELEC');
    expect(elec?.options?.every((o) => +o.code >= 19011514 && +o.code <= 19011521)).toBe(true);
  });
  it('إدارة تكنولوجيا المعلومات: خطة المسار الصحيحة', () => {
    const r = run('202490007');
    expect(r.plan!.id).toBe(2);
    expect(r.courses.some((c) => c.code === '19011500')).toBe(true);
    expect(r.courses.some((c) => c.code === '19011514')).toBe(false);
  });
});

describe('8) سجل أكاديمي ناقص', () => {
  const r = run('202490008');
  it('ينبّه بوضوح ولا يحكم باستيفاء التخرج', () => {
    expect(r.alerts.map((a) => a.code)).toEqual(expect.arrayContaining(['INCOMPLETE_RECORD', 'UNKNOWN_OUTCOME']));
    expect(r.delay.text).toContain('غير موثوق');
    expect(r.graduation.notes.join(' ')).toContain('غير مكتمل');
  });
  it('سجل بعلامة دون حالة لا يُحتسب ما لم تُضبط علامة النجاح', () => {
    expect(r.courses.find((c) => c.code === '19040113')!.state).not.toBe('passed');
    const r2 = run('202490008', { minPassingGrade: 60 });
    expect(r2.courses.find((c) => c.code === '19040113')!.state).toBe('passed');
  });
  it('التوصيات مبدئية للطالب الحقيقي ذي السجل الناقص', () => {
    const r3 = run('202490008', {}, (s) => { s.profile.isDemo = false; });
    expect(r3.reliability).toBe('preliminary');
  });
});

describe('9) انتقل إلى خطة مختلفة وفق سنة التحاقه', () => {
  it('دون إسناد صريح يُطبَّق عليه إصدار 2017–2020 التجريبي', () => {
    const r = run('202090009', {}, (s) => { s.profile.planVersionId = null; });
    expect(r.plan!.id).toBe(3);
  });
  const r = run('202090009');
  it('الإسناد الصريح يطبق الخطة الحالية مع المعادلة', () => {
    expect(r.plan!.id).toBe(1);
    expect(r.plan!.selectionReason).toContain('صراحة');
    const web = r.courses.find((c) => c.code === '19011300')!;
    expect(web.state).toBe('passed');
    expect(web.countedAs).toContain('99011300');
  });
  it('المساق غير المعادَل خارج الخطة ولا يُحتسب', () => {
    expect(r.outOfPlanCourses.map((c) => c.code)).toEqual(['99011299']);
    expect(r.credits.outOfPlan).toBe(3);
    expect(r.credits.earnedAll - r.credits.earned).toBeGreaterThanOrEqual(3);
  });
});

describe('10) أعاد دراسة مساق رسب فيه', () => {
  const r = run('202490010');
  it('يُحتسب المساق مرة واحدة فقط', () => {
    const c = r.courses.find((x) => x.code === '19011200')!;
    expect(c.state).toBe('passed');
    expect(c.attempts).toHaveLength(2);
    const maj = r.categories.find((x) => x.category === 'MAJ_REQ')!;
    const passedMaj = r.courses.filter((x) => x.category === 'MAJ_REQ' && x.state === 'passed').reduce((s, x) => s + x.credits, 0);
    expect(maj.earned).toBe(passedMaj);
    expect(r.failedCourses.find((f) => f.code === '19011200')!.nowPassed).toBe(true);
  });
  it('ينبّه لغياب سياسة الإعادة، ويطبّقها عند ضبطها', () => {
    expect(r.alerts.some((a) => a.code === 'REPEAT_POLICY')).toBe(true);
    const r2 = run('202490010', { repeatPolicy: 'latest' });
    expect(r2.alerts.some((a) => a.code === 'REPEAT_POLICY')).toBe(false);
    expect(r2.courses.find((x) => x.code === '19011200')!.state).toBe('passed');
  });
});

describe('حالات التخرج الثلاث مميزة', () => {
  it('متوقع التخرج', () => expect(run('202290011').graduation.state).toBe('expected'));
  it('خريج فعلي فقط من سجل الجامعة', () => {
    expect(run('202190012').graduation.state).toBe('graduated');
    const notOfficial = run('202190012', {}, (s) => { s.profile.officialStatus = 'active'; });
    expect(notOfficial.graduation.state).toBe('requirements_met');
  });
});

describe('القواعد القابلة للتعديل', () => {
  it('الحد الأقصى للعبء يُحترم عند ضبطه', () => {
    const r = run('202490006', { maxTermCredits: 12 });
    expect(r.loadLimit.source).toBe('rule');
    expect(r.recommendations.filter((x) => x.included).reduce((s, x) => s + x.credits, 0)).toBeLessThanOrEqual(12);
  });
  it('بيانات الطرح تستبعد غير المطروح من الحزمة', () => {
    const s = students.find((x) => x.profile.universityId === '202490003')!;
    const r = runAdvising({ student: s.profile, plans: plans.filter((p) => p.trackCode === 'SEC'), records: s.records, registrations: s.registrations, terms, rules: DEFAULT_RULES, nonCreditStatus: [], offerings: [{ termCode: '2026-2', courseCode: '15060101' }] });
    expect(r.recommendations.find((x) => x.code === '19011202')!.included).toBe(false);
  });
  it('غياب خطة منطبقة يمنع التوصيات بدل إصدار توصية مضللة', () => {
    const s = students[0];
    const r = runAdvising({ student: { ...s.profile, isDemo: false }, plans: [], records: [], registrations: [], terms, rules: DEFAULT_RULES, nonCreditStatus: [] });
    expect(r.reliability).toBe('unavailable');
    expect(r.recommendations).toHaveLength(0);
  });
  it('الطالب الحقيقي لا تُطبَّق عليه خطة تجريبية', () => {
    const r = run('202090009', {}, (s) => { s.profile.planVersionId = null; s.profile.isDemo = false; });
    expect(r.plan).toBeNull();
  });
});

describe('المساعد الذكي', () => {
  const r = run('202490006');
  it.each([
    ['ما المواد التي تنصحني بتسجيلها في الفصل القادم؟', 'recommend'],
    ['ما المواد التي يجب أن أجتازها قبل دراسة أمن الشبكات؟', 'prereq'],
    ['كم ساعة بقيت لي حتى التخرج؟', 'remaining_hours'],
    ['هل يوجد تأخر في خطتي الدراسية؟', 'delay'],
    ['ما المواد التي يجب أن أعيد دراستها؟', 'retake'],
    ['ما المتطلبات المتبقية عليّ للتخرج؟', 'graduation'],
  ])('%s', (q, intent) => {
    const a = answerQuestion(r, q);
    expect(a.intent).toBe(intent);
    expect(a.answer.length).toBeGreaterThan(20);
    // لا يذكر رموزًا غير موجودة في الخطة
    const codes = a.answer.match(/\b\d{8}\b/g) ?? [];
    for (const c of codes) expect(r.courses.some((x) => x.code === c)).toBe(true);
  });
  it('سلسلة متطلبات أمن الشبكات صحيحة', () => {
    const a = answerQuestion(r, 'ما المواد التي يجب أن أجتازها قبل دراسة أمن الشبكات؟');
    for (const c of ['19011305', '19011202', '19011200', '19040113', '19040112']) expect(a.answer).toContain(c);
  });
  it('يصرّح بعدم كفاية المعلومات بدل التخمين', () => {
    const a = answerQuestion(r, 'ما رأيك بالطقس اليوم؟');
    expect(a.confidence).toBe('none');
  });
  it('لا يعطي مساقات من المسار الآخر', () => {
    const a = answerQuestion(r, 'ما متطلبات الحوسبة السحابية؟');
    expect(a.answer).not.toContain('19011501');
  });
});

it('الاختياريات الزائدة لا تُحتسب فوق المطلوب', () => {
  const r = run('202490006', {}, (s) => {
    ['13020001', '13020002', '13020003', '13020004'].forEach((c, i) => s.records.push({ courseCode: c, termCode: '2025-3', status: 'passed', grade: 80 + i }));
  });
  const ue = r.categories.find((c) => c.category === 'UNI_ELEC')!;
  expect(ue.earned).toBe(6);
  expect(ue.surplus).toBeGreaterThan(0);
  expect(ELECTIVE_CATEGORIES).toContain('UNI_ELEC');
});
