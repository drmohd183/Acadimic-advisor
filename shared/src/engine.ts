/**
 * محرك الإرشاد الأكاديمي المؤتمت
 * دالة نقية: تأخذ بيانات الطالب والخطة والقواعد وتعيد تقريرًا إرشاديًا قابلًا للتفسير.
 * لا يصل المحرك إلى قاعدة البيانات ولا إلى أي خدمة خارجية.
 */
import {
  AcademicTerm, AdvisingReport, Alert, Category, CategoryProgress, CourseRecord, CourseState, CourseStatusItem,
  EngineInput, GraduationAudit, PlanCourse, PlanVersion, Priority, Reason, Recommendation, TermPlan, isElective,
} from './types';
import { CATEGORY_LABELS, slotLabel, YEAR_LABELS, TERM_LABELS, GRAD_STATE_LABELS } from './labels';

export const ENGINE_VERSION = '1.0.0';
const MAX_PROJECTION_TERMS = 16;

// ---------- أدوات الفصول ----------
export function parseTerm(code: string): { y: number; t: number } {
  const [y, t] = code.split('-').map(Number);
  return { y, t };
}
const termOrder = (code: string) => {
  const { y, t } = parseTerm(code);
  return y * 10 + t;
};
export const slotIndex = (year: number, term: number) => (year - 1) * 2 + (term - 1);
export const slotFromIndex = (i: number) => ({ year: Math.floor(i / 2) + 1, term: (i % 2) + 1 });

function termName(y: number, t: number) {
  const tn = t === 1 ? 'الفصل الأول' : t === 2 ? 'الفصل الثاني' : 'الفصل الصيفي';
  return `${tn} ${y}/${y + 1}`;
}

function nextRegularTerm(cur: { y: number; t: number }) {
  if (cur.t === 1) return { y: cur.y, t: 2 };
  return { y: cur.y + 1, t: 1 }; // بعد الثاني أو الصيفي
}

// ---------- اختيار الخطة ----------
export function selectPlan(input: EngineInput): { plan: PlanVersion | null; reason: string; alerts: Alert[] } {
  const { student, plans } = input;
  const alerts: Alert[] = [];
  if (student.planVersionId != null) {
    const p = plans.find((x) => x.id === student.planVersionId);
    if (p) {
      return {
        plan: p,
        reason: `خطة مُسندة للطالب صراحةً${student.planAssignmentNote ? ` (${student.planAssignmentNote})` : ''}`,
        alerts,
      };
    }
    alerts.push({ level: 'danger', code: 'PLAN_ASSIGNED_MISSING', text: 'الخطة المسندة للطالب غير موجودة في النظام. يرجى مراجعة الإدارة.' });
  }
  const cands = plans.filter(
    (p) =>
      p.trackCode === student.trackCode &&
      p.status !== 'archived' &&
      p.status !== 'draft' &&
      (student.isDemo || !p.isDemo) &&
      p.effectiveFromYear <= student.enrollmentYear &&
      (p.effectiveToYear == null || p.effectiveToYear >= student.enrollmentYear),
  );
  if (cands.length === 0) {
    alerts.push({ level: 'danger', code: 'NO_PLAN', text: `لا توجد خطة دراسية مفعّلة تنطبق على سنة التحاقك (${student.enrollmentYear}) في مسارك. لا يمكن إصدار توصيات قبل استيراد الخطة المعتمدة.` });
    return { plan: null, reason: '', alerts };
  }
  const rank = (p: PlanVersion) => (p.status === 'approved' ? 3 : p.status === 'imported' ? 2 : 1);
  cands.sort((a, b) => rank(b) - rank(a) || b.effectiveFromYear - a.effectiveFromYear);
  if (cands.length > 1) {
    alerts.push({ level: 'warning', code: 'MULTI_PLAN', text: `تنطبق أكثر من خطة على سنة الالتحاق؛ اعتُمدت «${cands[0].label}». يُنصح بأن تحدد الإدارة نطاقات سنوات غير متداخلة.` });
  }
  const p = cands[0];
  return {
    plan: p,
    reason: `حُددت تلقائيًا وفق سنة الالتحاق ${student.enrollmentYear} (نطاق تطبيق الخطة ${p.effectiveFromYear}–${p.effectiveToYear ?? 'حتى الآن'})`,
    alerts,
  };
}

// ---------- تحليل المحاولات ----------
interface Resolved {
  passed: boolean;
  failedEver: boolean;
  attempts: CourseRecord[];
  unknownOutcome: boolean;
  countedAs?: string | null;
}

function outcome(r: CourseRecord, minPass: number | null): 'pass' | 'fail' | 'none' | 'unknown' {
  if (r.status === 'passed' || r.status === 'exempt' || r.status === 'transfer') return 'pass';
  if (r.status === 'failed') return 'fail';
  if (r.status === 'withdrawn' || r.status === 'incomplete') return 'none';
  if (r.status == null && r.grade != null && minPass != null) return r.grade >= minPass ? 'pass' : 'fail';
  return 'unknown';
}

function resolveRecords(input: EngineInput, plan: PlanVersion | null, alerts: Alert[]) {
  const { rules } = input;
  const eq = new Map<string, string>();
  plan?.equivalences.forEach((e) => eq.set(e.fromCode, e.toCode));
  const groups = new Map<string, { recs: CourseRecord[]; via?: string }>();
  for (const r of input.records) {
    const target = eq.get(r.courseCode) ?? r.courseCode;
    const g = groups.get(target) ?? { recs: [] };
    g.recs.push(r);
    if (target !== r.courseCode) g.via = r.courseCode;
    groups.set(target, g);
  }
  const resolved = new Map<string, Resolved>();
  let repeatedWithoutPolicy = false;
  let unknownCount = 0;
  for (const [code, g] of groups) {
    const recs = [...g.recs].sort((a, b) => termOrder(a.termCode) - termOrder(b.termCode));
    const outs = recs.map((r) => outcome(r, rules.minPassingGrade));
    const completed = recs.map((r, i) => ({ r, o: outs[i] })).filter((x) => x.o === 'pass' || x.o === 'fail');
    let passed = false;
    if (completed.length > 1 && rules.repeatPolicy == null) repeatedWithoutPolicy = true;
    if (rules.repeatPolicy === 'latest' && completed.length) {
      passed = completed[completed.length - 1].o === 'pass';
    } else if (rules.repeatPolicy === 'highest' && completed.length) {
      const graded = completed.filter((x) => x.r.grade != null);
      if (graded.length === completed.length) {
        const best = graded.reduce((a, b) => ((b.r.grade ?? 0) > (a.r.grade ?? 0) ? b : a));
        passed = best.o === 'pass';
      } else passed = completed.some((x) => x.o === 'pass');
    } else {
      passed = completed.some((x) => x.o === 'pass');
    }
    const unknown = outs.includes('unknown');
    if (unknown) unknownCount++;
    resolved.set(code, {
      passed,
      failedEver: outs.includes('fail'),
      attempts: recs,
      unknownOutcome: unknown && !passed,
      countedAs: g.via ? `معادَل من المساق ${g.via}` : null,
    });
  }
  if (repeatedWithoutPolicy) {
    alerts.push({ level: 'warning', code: 'REPEAT_POLICY', text: 'يوجد مساق بأكثر من محاولة، وسياسة الإعادة المعتمدة غير مضبوطة في النظام؛ اعتُبر المساق مجتازًا إذا نجحت فيه في أي محاولة، ولم يُحتسب أكثر من مرة.' });
  }
  if (unknownCount > 0) {
    alerts.push({ level: 'warning', code: 'UNKNOWN_OUTCOME', text: `يوجد ${unknownCount} سجل بلا حالة نجاح/رسوب واضحة، ولم تُضبط علامة النجاح في النظام؛ لم تُحتسب هذه المساقات مجتازة.` });
  }
  return resolved;
}

// ---------- المحرك الرئيسي ----------
export function runAdvising(input: EngineInput): AdvisingReport {
  const alerts: Alert[] = [];
  const { student, rules } = input;
  const generatedAt = input.now ?? new Date().toISOString();

  // الفصل الحالي والقادم
  const sortedTerms = [...input.terms].sort((a, b) => a.yearStart * 10 + a.termNo - (b.yearStart * 10 + b.termNo));
  const currentTerm = sortedTerms.find((t) => t.isCurrent) ?? null;
  let nextTerm: AcademicTerm | null = null;
  let termsCompleted = 0;
  let nextSlot = 0;
  let currentSlot = 0;
  if (currentTerm) {
    const n = nextRegularTerm({ y: currentTerm.yearStart, t: currentTerm.termNo });
    nextTerm = sortedTerms.find((t) => t.yearStart === n.y && t.termNo === n.t) ?? {
      code: `${n.y}-${n.t}`, yearStart: n.y, termNo: n.t, nameAr: termName(n.y, n.t), isCurrent: false,
    };
    if (currentTerm.termNo === 3) {
      termsCompleted = (currentTerm.yearStart - student.enrollmentYear) * 2 + 2;
      currentSlot = termsCompleted - 1;
      nextSlot = termsCompleted;
    } else {
      termsCompleted = (currentTerm.yearStart - student.enrollmentYear) * 2 + (currentTerm.termNo - 1);
      currentSlot = termsCompleted;
      nextSlot = termsCompleted + 1;
    }
    termsCompleted = Math.max(0, termsCompleted);
    currentSlot = Math.max(0, currentSlot);
    nextSlot = Math.max(0, nextSlot);
  } else {
    alerts.push({ level: 'warning', code: 'NO_CURRENT_TERM', text: 'لم يُحدَّد الفصل الأكاديمي الحالي في النظام؛ لا يمكن حساب التأخر بدقة.' });
  }

  const sel = selectPlan(input);
  alerts.push(...sel.alerts);
  const plan = sel.plan;

  if (student.isDemo) {
    alerts.unshift({ level: 'info', code: 'DEMO', text: 'هذا حساب تجريبي ببيانات افتراضية لأغراض العرض والاختبار، وليس سجلًا حقيقيًا من نظام الجامعة.' });
  }
  if (!student.recordComplete) {
    alerts.push({ level: 'danger', code: 'INCOMPLETE_RECORD', text: 'سجلك الأكاديمي في النظام غير مكتمل؛ لذلك التوصيات مبدئية وقد تقترح مساقات اجتزتها أو تحجب مساقات متاحة لك. راجع دائرة القبول والتسجيل لاستكمال السجل.' });
  }

  const resolved = resolveRecords(input, plan, alerts);
  const registeredSet = new Set(
    input.registrations.filter((r) => !currentTerm || r.termCode === currentTerm.code).map((r) => r.courseCode),
  );

  if (!plan) {
    return emptyReport(input, alerts, generatedAt, currentTerm, nextTerm, termsCompleted);
  }

  const courseMap = new Map(plan.courses.map((c) => [c.code, c]));
  const passed = (code: string) => resolved.get(code)?.passed === true;
  const prereqsOf = (code: string) => plan.prerequisites.filter((p) => p.course === code).map((p) => p.requires);
  const coreqsOf = (code: string) => plan.corequisites.filter((p) => p.course === code).map((p) => p.requires);
  const nameOf = (code: string) => courseMap.get(code)?.nameAr ?? code;

  // المساقات التي تعتمد على كل مساق (مباشرة وغير مباشرة)
  const dependents = new Map<string, Set<string>>();
  plan.prerequisites.forEach((p) => {
    if (!dependents.has(p.requires)) dependents.set(p.requires, new Set());
    dependents.get(p.requires)!.add(p.course);
  });
  const unlockMemo = new Map<string, Set<string>>();
  const unlocks = (code: string, seen = new Set<string>()): Set<string> => {
    if (unlockMemo.has(code)) return unlockMemo.get(code)!;
    const out = new Set<string>();
    if (seen.has(code)) return out;
    seen.add(code);
    for (const d of dependents.get(code) ?? []) {
      out.add(d);
      unlocks(d, seen).forEach((x) => out.add(x));
    }
    unlockMemo.set(code, out);
    return out;
  };

  // ---------- حالة كل مساق ----------
  const courses: CourseStatusItem[] = plan.courses.map((c) => {
    const res = resolved.get(c.code);
    const pre = prereqsOf(c.code).map((p) => ({ code: p, nameAr: nameOf(p), met: passed(p), registered: registeredSet.has(p) }));
    const co = coreqsOf(c.code).map((p) => ({ code: p, nameAr: nameOf(p), met: passed(p), registered: registeredSet.has(p) }));
    let state: CourseState;
    const blockedReasons: string[] = [];
    if (res?.passed) state = 'passed';
    else if (registeredSet.has(c.code)) state = 'registered';
    else {
      const unmet = pre.filter((p) => !p.met);
      if (unmet.length === 0) state = res?.failedEver ? 'failed_retake' : 'available';
      else if (unmet.every((p) => p.registered)) {
        state = 'conditional';
        unmet.forEach((p) => blockedReasons.push(`يتطلب اجتياز ${p.nameAr} (${p.code}) المسجل حاليًا`));
      } else {
        state = 'blocked';
        unmet.forEach((p) => {
          const pr = resolved.get(p.code);
          const why = pr?.failedEver ? 'رسبت فيه ولم تجتزه بعد' : p.registered ? 'مسجل حاليًا ولم تظهر نتيجته' : 'لم تجتزه بعد';
          blockedReasons.push(`المتطلب السابق ${p.nameAr} (${p.code}) غير مستوفى: ${why}`);
        });
      }
    }
    return {
      code: c.code, nameAr: c.nameAr, credits: c.credits, category: c.category,
      suggestedYear: c.suggestedYear ?? null, suggestedTerm: c.suggestedTerm ?? null,
      state, prerequisites: pre, corequisites: co,
      attempts: (res?.attempts ?? []).map((a) => ({ termCode: a.termCode, status: a.status, grade: a.grade })),
      blockedReasons, unlocksCount: unlocks(c.code).size, countedAs: res?.countedAs ?? null,
    };
  });
  const cs = new Map(courses.map((c) => [c.code, c]));

  // ---------- الساعات والفئات ----------
  const guidingCatCreditsUpTo = (cat: Category, slotExclusive: number) => {
    let s = 0;
    plan.guidingSlots.forEach((g) => { if (g.category === cat && slotIndex(g.year, g.term) < slotExclusive) s += g.credits; });
    plan.courses.forEach((c) => { if (c.category === cat && c.suggestedYear && c.suggestedTerm && slotIndex(c.suggestedYear, c.suggestedTerm) < slotExclusive) s += c.credits; });
    return s;
  };
  const categories: CategoryProgress[] = plan.categories.map((cr) => {
    const inCat = courses.filter((c) => c.category === cr.category);
    const earnedRaw = inCat.filter((c) => c.state === 'passed').reduce((s, c) => s + c.credits, 0);
    const registered = inCat.filter((c) => c.state === 'registered').reduce((s, c) => s + c.credits, 0);
    const earned = Math.min(earnedRaw, cr.requiredCredits);
    return {
      category: cr.category,
      required: cr.requiredCredits,
      earned,
      surplus: Math.max(0, earnedRaw - cr.requiredCredits),
      registered,
      remaining: Math.max(0, cr.requiredCredits - earned),
      countsTowardTotal: cr.countsTowardTotal,
      remainingMandatory: isElective(cr.category) ? [] : inCat.filter((c) => c.state !== 'passed').map((c) => ({ code: c.code, nameAr: c.nameAr, credits: c.credits })),
      expectedByNow: Math.min(cr.requiredCredits, guidingCatCreditsUpTo(cr.category, currentSlot)),
    };
  });
  const catMap = new Map(categories.map((c) => [c.category, c]));
  const counted = categories.filter((c) => c.countsTowardTotal);
  const earned = counted.reduce((s, c) => s + c.earned, 0);
  const registeredCredits = courses.filter((c) => c.state === 'registered' && catMap.get(c.category)?.countsTowardTotal).reduce((s, c) => s + c.credits, 0);
  const required = plan.totalCredits;
  const sumRequired = counted.reduce((s, c) => s + c.required, 0);
  if (sumRequired !== required) {
    alerts.push({ level: 'warning', code: 'PLAN_TOTAL_MISMATCH', text: `مجموع ساعات فئات الخطة المحتسبة (${sumRequired}) لا يساوي إجمالي الخطة (${required}). يرجى من الإدارة مراجعة الخطة.` });
  }
  const remedial = categories.filter((c) => !c.countsTowardTotal);
  const remedialRequired = remedial.reduce((s, c) => s + c.required, 0);
  const remedialEarned = remedial.reduce((s, c) => s + c.earned, 0);

  // مساقات خارج الخطة
  const outOfPlanCourses: { code: string; nameAr: string; credits: number }[] = [];
  for (const [code, r] of resolved) {
    if (!courseMap.has(code) && r.passed) {
      const rec = r.attempts[r.attempts.length - 1];
      outOfPlanCourses.push({ code, nameAr: rec.courseNameAr ?? code, credits: rec.credits ?? 0 });
    }
  }
  const outOfPlan = outOfPlanCourses.reduce((s, c) => s + c.credits, 0);
  if (outOfPlanCourses.length) {
    alerts.push({ level: 'info', code: 'OUT_OF_PLAN', text: `يوجد ${outOfPlanCourses.length} مساق مجتاز خارج خطتك ولا يُحتسب ضمن ساعات التخرج ما لم تُعتمد له معادلة: ${outOfPlanCourses.map((c) => c.code).join('، ')}.` });
  }
  const earnedAll = [...resolved.entries()].filter(([, r]) => r.passed).reduce((s, [code, r]) => s + (courseMap.get(code)?.credits ?? r.attempts[0].credits ?? 0), 0);

  // ---------- حد العبء ----------
  const guidingLoad = (slot: number) => {
    const { year, term } = slotFromIndex(slot);
    let s = 0, found = false;
    plan.courses.forEach((c) => { if (c.suggestedYear === year && c.suggestedTerm === term) { s += c.credits; found = true; } });
    plan.guidingSlots.forEach((g) => { if (g.year === year && g.term === term) { s += g.credits; found = true; } });
    return found ? s : null;
  };
  const maxGuidingLoad = Math.max(...Array.from({ length: 8 }, (_, i) => guidingLoad(i) ?? 0));
  const loadFor = (slot: number) => {
    if (rules.maxTermCredits != null) return { credits: rules.maxTermCredits, source: 'rule' as const, text: `الحد الأقصى للعبء الفصلي المعتمد في النظام: ${rules.maxTermCredits} ساعة.` };
    const g = guidingLoad(slot);
    if (g != null) {
      const { year, term } = slotFromIndex(slot);
      return { credits: g, source: 'guiding_plan' as const, text: `عبء مرجعي ${g} ساعة مأخوذ من الخطة الاسترشادية (${slotLabel(year, term)})؛ الحد الأقصى الرسمي للعبء غير مضبوط في النظام، فراجع تعليمات التسجيل.` };
    }
    return { credits: maxGuidingLoad || 18, source: 'fallback' as const, text: `عبء مرجعي ${maxGuidingLoad || 18} ساعة (أعلى عبء فصلي في الخطة الاسترشادية) لأنك تجاوزت فصول الخطة الثمانية؛ الحد الأقصى الرسمي غير مضبوط.` };
  };
  const loadLimit = loadFor(nextSlot);
  if (rules.maxTermCredits == null) {
    alerts.push({ level: 'info', code: 'NO_MAX_LOAD', text: 'الحد الأقصى الرسمي للساعات في الفصل غير مضبوط في النظام؛ الحزمة المقترحة مبنية على العبء المرجعي في الخطة الاسترشادية.' });
  }

  // ---------- طرح المساقات ----------
  const offered = nextTerm ? (input.offerings ?? []).filter((o) => o.termCode === nextTerm!.code) : [];
  const hasOfferings = offered.length > 0;
  const offeredSet = new Set(offered.map((o) => o.courseCode));
  if (!hasOfferings) {
    alerts.push({ level: 'info', code: 'NO_OFFERINGS', text: 'لا تتوفر في النظام بيانات المساقات المطروحة للفصل القادم؛ تأكد من طرح المساق في جدول الفصل قبل التسجيل.' });
  }

  // ---------- التوصيات ----------
  const W = rules.priorityWeights;
  const nextSlotLbl = slotFromIndex(nextSlot);
  const recs: Recommendation[] = [];
  const eligibleStates: CourseState[] = ['available', 'failed_retake'];
  const levelOf = (s: number): Priority => (s >= 80 ? 'high' : s >= 40 ? 'medium' : 'normal');
  const lastSlotReached = nextSlot >= 7;

  // المساقات الإجبارية المرنة (بلا فصل محدد، مثل متطلبات الجامعة): نرفع أولوية ما يغطي العجز المتوقع فقط
  const boostedFlexible = new Set<string>();
  const flexDue = new Map<Category, { expected: number; deficit: number }>();
  for (const cat of categories.filter((c) => !isElective(c.category))) {
    const expectedNext = Math.min(cat.required, guidingCatCreditsUpTo(cat.category, nextSlot + 1));
    let deficit = lastSlotReached ? cat.remaining - cat.registered : expectedNext - cat.earned - cat.registered;
    flexDue.set(cat.category, { expected: lastSlotReached ? cat.required : expectedNext, deficit });
    const flex = courses
      .filter((c) => c.category === cat.category && !c.suggestedYear && eligibleStates.includes(c.state))
      .sort((a, b) => b.unlocksCount - a.unlocksCount || b.credits - a.credits || a.code.localeCompare(b.code));
    for (const f of flex) {
      if (deficit <= 0) break;
      boostedFlexible.add(f.code);
      deficit -= f.credits;
    }
  }

  for (const c of courses) {
    const isCond = c.state === 'conditional';
    if ((!eligibleStates.includes(c.state) && !isCond) || isElective(c.category)) continue;
    const reasons: Reason[] = [];
    const warnings: string[] = [];
    let score = isCond ? -5 : 0;
    const pendingOn = c.prerequisites.filter((p) => !p.met && p.registered);
    if (isCond) {
      reasons.push({ code: 'PENDING', text: `مشروط: يُتاح فقط بعد ظهور نجاحك في ${pendingOn.map((p) => `«${p.nameAr}»`).join(' و')} المسجل حاليًا.` });
      warnings.push(`لا تسجّله قبل التأكد من اجتياز ${pendingOn.map((p) => p.nameAr).join(' و')}؛ إن لم تنجح فيه فلن يكون هذا المساق متاحًا.`);
    }
    const res = resolved.get(c.code);
    if (c.category === 'REMEDIAL') { score += W.remedial; reasons.push({ code: 'REMEDIAL', text: 'متطلب استدراكي إجباري ومتطلب سابق لمساقات أخرى، فيُنصح بإنهائه أولًا (لا تُحتسب ساعاته ضمن ساعات الخطة).' }); }
    if (c.state === 'failed_retake') {
      score += W.retakeFailed;
      reasons.push({ code: 'RETAKE', text: 'رسبت في هذا المساق سابقًا، وهو إجباري؛ إعادة تسجيله ضرورية للتخرج.' });
    }
    if (c.suggestedYear && c.suggestedTerm) {
      const s = slotIndex(c.suggestedYear, c.suggestedTerm);
      if (s < nextSlot) { score += W.overdue; reasons.push({ code: 'OVERDUE', text: `مقرر في الخطة الاسترشادية في ${slotLabel(c.suggestedYear, c.suggestedTerm)}، أي قبل موقعك الحالي، فهو متأخر.` }); }
      else if (s === nextSlot) { score += W.currentSlot + (lastSlotReached ? W.overdue : 0); reasons.push({ code: 'ON_SLOT', text: `مقرر في الخطة الاسترشادية للفصل القادم بحسب موقعك (${slotLabel(c.suggestedYear, c.suggestedTerm)}).` }); }
      else { score -= (s - nextSlot) * 5; reasons.push({ code: 'EARLY', text: `مقرر لاحقًا في الخطة (${slotLabel(c.suggestedYear, c.suggestedTerm)})، ويمكنك تقديمه لأنك استوفيت متطلباته.` }); }
    } else {
      const cat = catMap.get(c.category);
      const due = flexDue.get(c.category);
      if (cat && due && boostedFlexible.has(c.code)) {
        score += Math.round(W.currentSlot * 0.75) + (lastSlotReached ? W.overdue : 0);
        reasons.push({ code: 'CAT_DUE', text: lastSlotReached
          ? `وصلت إلى نهاية الخطة الاسترشادية وما زال عليك ${cat.remaining} ساعة من «${CATEGORY_LABELS[c.category]}»؛ هذا المساق من المتبقي المطلوب للتخرج.`
          : `الخطة الاسترشادية تتوقع إنجاز ${due.expected} ساعة من «${CATEGORY_LABELS[c.category]}» حتى نهاية الفصل القادم، وأنجزت ${cat.earned} ساعة${cat.registered ? ` وتسجل ${cat.registered}` : ''}.` });
      } else {
        score += 10;
        reasons.push({ code: 'FLEX', text: `من «${CATEGORY_LABELS[c.category]}» دون فصل محدد في الخطة؛ يمكن تسجيله عند توفر مكان في جدولك.` });
      }
    }
    if (c.unlocksCount > 0) {
      score += W.blocking * Math.min(c.unlocksCount, 10);
      reasons.push({ code: 'UNLOCKS', text: `متطلب سابق يفتح ${c.unlocksCount} مساق لاحق، وتأخيره قد يؤخر تخرجك.` });
    }
    score += W.mandatory;
    reasons.push({ code: 'MANDATORY', text: `مساق إجباري (${CATEGORY_LABELS[c.category]}) مطلوب للتخرج.` });
    if (!isCond) reasons.push({ code: 'PREREQ_MET', text: c.prerequisites.length ? `استوفيت متطلباته السابقة: ${c.prerequisites.map((p) => p.nameAr).join('، ')}.` : 'لا يتطلب متطلبًا سابقًا.' });
    if (hasOfferings && !offeredSet.has(c.code)) warnings.push('غير مطروح في الفصل القادم حسب بيانات الطرح.');
    const unmetCo = c.corequisites.filter((x) => !x.met && !x.registered);
    if (unmetCo.length) warnings.push(`له متطلب متزامن يجب تسجيله معه: ${unmetCo.map((x) => x.nameAr).join('، ')}.`);
    if (res?.unknownOutcome) warnings.push('نتيجة محاولة سابقة غير واضحة في السجل.');
    recs.push({
      kind: 'course', code: c.code, nameAr: c.nameAr, credits: c.credits, category: c.category, priority: levelOf(score), score, reasons,
      prerequisites: c.prerequisites.map((p) => ({ code: p.code, nameAr: p.nameAr, met: p.met })), warnings, included: false,
      conditionalOn: isCond ? pendingOn.map((p) => ({ code: p.code, nameAr: p.nameAr })) : undefined,
    });
  }

  // خانات الاختياري
  for (const cat of categories.filter((c) => isElective(c.category) && c.remaining > 0)) {
    const regInCat = cat.registered;
    const remainingAfterReg = Math.max(0, cat.remaining - regInCat);
    if (remainingAfterReg <= 0) continue;
    const options = courses.filter((c) => c.category === cat.category && eligibleStates.includes(c.state) && (!hasOfferings || offeredSet.has(c.code)));
    const due = lastSlotReached ? remainingAfterReg : Math.max(0, Math.min(cat.required, guidingCatCreditsUpTo(cat.category, nextSlot + 1)) - cat.earned - regInCat);
    const typical = options.length ? Math.round(options.reduce((s, o) => s + o.credits, 0) / options.length) : 3;
    const slotsNeeded = Math.max(1, Math.ceil(Math.min(remainingAfterReg, Math.max(due, typical)) / Math.max(1, typical)));
    for (let i = 0; i < slotsNeeded; i++) {
      const reasons: Reason[] = [];
      let score = W.elective;
      if (due > 0) {
        score += W.currentSlot - 5 * i + (lastSlotReached ? W.overdue : 0);
        reasons.push({ code: 'CAT_DUE', text: lastSlotReached
          ? `بقي عليك ${remainingAfterReg} ساعة من «${CATEGORY_LABELS[cat.category]}» وأنت في نهاية الخطة؛ هذه الساعات مطلوبة للتخرج.`
          : `الخطة الاسترشادية تتوقع إنجاز ${Math.min(cat.required, guidingCatCreditsUpTo(cat.category, nextSlot + 1))} ساعة من «${CATEGORY_LABELS[cat.category]}» حتى نهاية الفصل القادم، وأنجزت ${cat.earned}.` });
      } else {
        score += 5;
        reasons.push({ code: 'FLEX', text: `بقي عليك ${remainingAfterReg} ساعة من «${CATEGORY_LABELS[cat.category]}»؛ يمكنك تسجيل أحدها عند توفر مكان.` });
      }
      const warnings: string[] = [];
      if (options.length === 0) warnings.push('لا يوجد حاليًا مساق اختياري في هذه الفئة استوفيت متطلباته.');
      reasons.push({ code: 'CHOICE', text: `اختر مساقًا واحدًا من الخيارات التي استوفيت متطلباتها (${options.length} خيار).` });
      recs.push({
        kind: 'elective_choice', code: null, nameAr: `${CATEGORY_LABELS[cat.category]}${slotsNeeded > 1 ? ` (${i + 1} من ${slotsNeeded})` : ''}`,
        credits: Math.min(typical, remainingAfterReg - i * typical > 0 ? typical : remainingAfterReg), category: cat.category,
        priority: levelOf(score), score, reasons, prerequisites: [],
        options: options.sort((a, b) => b.unlocksCount - a.unlocksCount || a.code.localeCompare(b.code)).map((o) => ({ code: o.code, nameAr: o.nameAr, credits: o.credits })),
        warnings, included: false,
      });
    }
  }

  recs.sort((a, b) => b.score - a.score || (a.code ?? 'z').localeCompare(b.code ?? 'z'));

  const conditional = courses.filter((c) => c.state === 'conditional');
  // حزمة الفصل القادم ضمن حد العبء
  let used = 0;
  for (const r of recs) {
    if (r.kind === 'elective_choice' && (r.options?.length ?? 0) === 0) continue;
    if (r.warnings.some((w) => w.startsWith('غير مطروح'))) continue;
    if (used + r.credits <= loadLimit.credits) { r.included = true; used += r.credits; }
  }

  // ---------- المساقات المتعثرة ----------
  const failedCourses = [...resolved.entries()].filter(([, r]) => r.failedEver).map(([code, r]) => {
    const last = r.attempts[r.attempts.length - 1];
    const failIdx = r.attempts.findIndex((a) => outcome(a, rules.minPassingGrade) === 'fail');
    return { code, nameAr: nameOf(code) !== code ? nameOf(code) : last.courseNameAr ?? code, lastTerm: last.termCode, retaken: r.attempts.length > failIdx + 1 || registeredSet.has(code), nowPassed: r.passed };
  });
  const openFails = failedCourses.filter((f) => !f.nowPassed);
  if (openFails.length) {
    alerts.push({ level: 'danger', code: 'FAILED', text: `لديك ${openFails.length} مساق راسب لم تجتزه بعد: ${openFails.map((f) => f.nameAr).join('، ')}. أعد تسجيله في أقرب فصل.` });
  }

  // ---------- التأخر الأكاديمي ----------
  let expectedCredits = 0;
  for (let s = 0; s < currentSlot && s < 8; s++) {
    const { year, term } = slotFromIndex(s);
    plan.courses.forEach((c) => { if (c.suggestedYear === year && c.suggestedTerm === term && catMap.get(c.category)?.countsTowardTotal) expectedCredits += c.credits; });
    plan.guidingSlots.forEach((g) => { if (g.year === year && g.term === term && g.category && catMap.get(g.category)?.countsTowardTotal) expectedCredits += g.credits; });
  }
  const overdueCourses = courses
    .filter((c) => c.state !== 'passed' && c.suggestedYear && c.suggestedTerm && slotIndex(c.suggestedYear, c.suggestedTerm) < currentSlot)
    .map((c) => ({ code: c.code, nameAr: c.nameAr, slot: slotLabel(c.suggestedYear!, c.suggestedTerm!) }));
  if (currentSlot >= 8) expectedCredits = required; // بعد ثمانية فصول يُتوقع إنهاء الخطة كاملة
  const gap = Math.max(0, expectedCredits - earned);
  const isBehind = overdueCourses.length > 0 || gap > 0;
  const overdueRegistered = overdueCourses.filter((o) => registeredSet.has(o.code)).length;
  let delayText: string;
  if (!currentTerm) delayText = 'لا يمكن تقدير التأخر لعدم تحديد الفصل الحالي.';
  else if (termsCompleted === 0) delayText = 'أنت في فصلك الأول؛ لا يوجد تأخر حتى الآن.';
  else if (!isBehind) delayText = `أنت تسير وفق الخطة الاسترشادية: أنجزت ${earned} ساعة من ${expectedCredits} ساعة متوقعة حتى نهاية الفصول المنقضية (${termsCompleted} فصل).`;
  else delayText = `يوجد تأخر عن الخطة الاسترشادية: أنجزت ${earned} ساعة من ${expectedCredits} ساعة متوقعة حتى نهاية ${termsCompleted} فصل${gap ? ` (فارق ${gap} ساعة)` : ''}، و${overdueCourses.length} مساق مقرر في فصول سابقة لم يُجتز بعد${overdueRegistered ? ` (منها ${overdueRegistered} مسجل حاليًا)` : ''}.`;
  if (!student.recordComplete) delayText += ' (التقدير غير موثوق لأن السجل غير مكتمل.)';
  if (isBehind && termsCompleted > 0) alerts.push({ level: 'warning', code: 'BEHIND', text: delayText });

  // ---------- عنق الزجاجة ----------
  const bottlenecks = courses
    .filter((c) => c.state !== 'passed' && !isElective(c.category) && c.unlocksCount >= 3 && (c.state === 'blocked' || c.state === 'failed_retake' || overdueCourses.some((o) => o.code === c.code)))
    .sort((a, b) => b.unlocksCount - a.unlocksCount)
    .map((c) => ({ code: c.code, nameAr: c.nameAr, unlocksCount: c.unlocksCount, text: `عدم اجتياز «${c.nameAr}» يحجب ${c.unlocksCount} مساقًا لاحقًا وقد يؤخر تخرجك.` }));

  // ---------- تدقيق التخرج ----------
  const graduation = auditGraduation(input, plan, categories, courses, remedialRequired, remedialEarned);

  // ---------- تقدير الفصول المتبقية ----------
  const projection = project(plan, courses, categories, prereqsOf, nextSlot, loadFor, nextTerm, input, graduation);

  // ---------- التوجيه حسب السنة ----------
  const yearGuidance = guidanceForYear(student.academicYearLevel, plan, courses, recs, categories, failedCourses, projection, graduation, earned);

  // ---------- الموثوقية ----------
  let reliability: AdvisingReport['reliability'];
  let reliabilityText: string;
  if (student.isDemo || plan.isDemo) {
    reliability = 'demo';
    reliabilityText = 'توصيات على بيانات تجريبية؛ للعرض والاختبار فقط.';
  } else if (plan.status === 'approved' && student.recordComplete) {
    reliability = 'final';
    reliabilityText = 'توصيات مبنية على خطة معتمدة وسجل أكاديمي مكتمل.';
  } else {
    reliability = 'preliminary';
    const why = [plan.status !== 'approved' ? 'الخطة الدراسية لم تُعتمد رسميًا في النظام بعد' : '', !student.recordComplete ? 'السجل الأكاديمي غير مكتمل' : ''].filter(Boolean).join('، و');
    reliabilityText = `توصيات مبدئية لأن ${why}.`;
  }
  if (plan.status !== 'approved') {
    alerts.push({ level: 'warning', code: 'PLAN_NOT_APPROVED', text: `الخطة «${plan.label}» حالتها «${plan.status === 'demo' ? 'تجريبية' : 'مستوردة بانتظار اعتماد القسم'}»؛ التوصيات النهائية للطلبة الحقيقيين تتطلب اعتماد الخطة الرسمية من لوحة الإدارة.` });
  }

  // توافق السنة المسجلة مع الإنجاز
  const nonCreditDue = plan.nonCreditRequirements.filter((n) => n.suggestedYear && n.suggestedTerm && slotIndex(n.suggestedYear, n.suggestedTerm) <= nextSlot);
  for (const n of nonCreditDue) {
    const st = input.nonCreditStatus.find((x) => x.code === n.code)?.status;
    if (st !== 'met') alerts.push({ level: 'info', code: 'NONCREDIT_' + n.code, text: `«${n.nameAr}» متطلب تخرج غير ساعيّ مقرر في ${slotLabel(n.suggestedYear!, n.suggestedTerm!)}؛ حالته: ${st === 'in_progress' ? 'قيد الإنجاز' : 'غير مستوفى'}. تواصل مع الجهة المسؤولة عنه في القسم.` });
  }

  return {
    engineVersion: ENGINE_VERSION,
    generatedAt,
    student,
    plan: { id: plan.id, label: plan.label, trackNameAr: plan.trackNameAr, programNameAr: plan.programNameAr, status: plan.status, isDemo: plan.isDemo, totalCredits: plan.totalCredits, selectionReason: sel.reason },
    currentTerm, nextTerm, termsCompleted,
    planPosition: nextSlot < 8 ? slotFromIndex(nextSlot) : null,
    reliability, reliabilityText,
    credits: {
      required, earned, earnedAll, registered: registeredCredits, remaining: Math.max(0, required - earned),
      remedialRequired, remedialEarned, outOfPlan, percent: required ? Math.round((earned / required) * 1000) / 10 : 0,
    },
    categories, courses, recommendations: recs, conditional, loadLimit, failedCourses,
    delay: { isBehind: isBehind && termsCompleted > 0, expectedCredits, earnedCredits: earned, gap, overdueCourses, text: delayText },
    bottlenecks, graduation, projection, yearGuidance, alerts, outOfPlanCourses,
  };
  // ملاحظة: nextSlotLbl للاستخدام المستقبلي في الواجهة
  void nextSlotLbl;
}

function auditGraduation(input: EngineInput, plan: PlanVersion, categories: CategoryProgress[], courses: CourseStatusItem[], remReq: number, remEarned: number): GraduationAudit {
  const missing: GraduationAudit['missing'] = [];
  const notes: string[] = [];
  let allCoveredByRegistration = true;
  for (const c of categories) {
    if (c.remaining <= 0) continue;
    if (c.registered < c.remaining) allCoveredByRegistration = false;
    if (isElective(c.category)) {
      missing.push({ code: c.category, text: `${CATEGORY_LABELS[c.category]}: بقي ${c.remaining} ساعة من ${c.required}.`, steps: c.registered ? `مسجل حاليًا ${c.registered} ساعة في هذه الفئة؛ أكمل الباقي من المساقات الاختيارية المتاحة.` : 'سجّل مساقات اختيارية من هذه الفئة استوفيت متطلباتها.' });
    } else {
      const list = c.remainingMandatory.map((m) => {
        const st = courses.find((x) => x.code === m.code);
        const tag = st?.state === 'registered' ? ' – مسجل حاليًا' : st?.state === 'blocked' ? ' – غير متاح بعد' : st?.state === 'failed_retake' ? ' – راسب، أعد تسجيله' : '';
        return `${m.nameAr} (${m.code})${tag}`;
      });
      missing.push({ code: c.category, text: `${CATEGORY_LABELS[c.category]}: بقي ${c.remaining} ساعة.`, steps: `المساقات المتبقية: ${list.join('، ')}.` });
    }
  }
  const nonCredit = plan.nonCreditRequirements.map((n) => {
    const st = input.nonCreditStatus.find((x) => x.code === n.code)?.status ?? 'unknown';
    if (st !== 'met') {
      if (st !== 'in_progress') allCoveredByRegistration = false;
      missing.push({ code: n.code, text: `${n.nameAr}: ${st === 'in_progress' ? 'قيد الإنجاز' : st === 'unknown' ? 'لا توجد بيانات عن حالته' : 'غير مستوفى'}.`, steps: n.description ?? 'تواصل مع القسم لاستكمال هذا المتطلب وتوثيقه في سجلك.' });
    }
    return { code: n.code, nameAr: n.nameAr, status: st as 'met' | 'not_met' | 'in_progress' | 'unknown' };
  });
  if (plan.minGpaForGraduation == null) notes.push('الحد الأدنى للمعدل التراكمي اللازم للتخرج غير موثق في الخطة المحمّلة؛ لم يُتحقق منه.');
  else if (input.student.gpa != null && input.student.gpa < plan.minGpaForGraduation) {
    missing.push({ code: 'GPA', text: `المعدل التراكمي (${input.student.gpa}) أقل من الحد المطلوب للتخرج (${plan.minGpaForGraduation}).`, steps: 'راجع المرشد الأكاديمي حول خيارات رفع المعدل وفق أنظمة الجامعة.' });
    allCoveredByRegistration = false;
  }
  void remReq; void remEarned;
  let state: GraduationAudit['state'];
  if (input.student.officialStatus === 'graduated') {
    state = 'graduated';
    if (missing.length) notes.push('سجل الجامعة يثبت التخرج، لكن تدقيق النظام وجد متطلبات ناقصة؛ قد تكون بيانات الخطة أو السجل في النظام غير محدّثة.');
  } else if (!input.student.recordComplete) {
    state = 'not_eligible';
    notes.push('لا يمكن الحكم باستيفاء متطلبات التخرج لأن السجل الأكاديمي غير مكتمل.');
  } else if (missing.length === 0) {
    state = 'requirements_met';
    notes.push('الحالة مبنية على البيانات المتاحة في النظام، ولا تُعد قرارًا رسميًا بالتخرج؛ يصدر القرار الرسمي عن الجهات المختصة في الجامعة.');
  } else if (allCoveredByRegistration) {
    state = 'expected';
    notes.push('متوقع التخرج بشرط اجتياز جميع المساقات المسجلة حاليًا واستكمال المتطلبات قيد الإنجاز.');
  } else state = 'not_eligible';
  return { state, stateLabel: GRAD_STATE_LABELS[state], missing, nonCredit, notes };
}

function project(
  plan: PlanVersion, courses: CourseStatusItem[], categories: CategoryProgress[], prereqsOf: (c: string) => string[],
  nextSlot: number, loadFor: (slot: number) => { credits: number }, nextTerm: AcademicTerm | null, input: EngineInput, grad: GraduationAudit,
): AdvisingReport['projection'] {
  const done = new Set(courses.filter((c) => c.state === 'passed' || c.state === 'registered').map((c) => c.code));
  const catEarned = new Map(categories.map((c) => [c.category, c.earned + c.registered]));
  const catReq = new Map(categories.map((c) => [c.category, c.required]));
  const byCode = new Map(plan.courses.map((c) => [c.code, c]));
  const terms: TermPlan[] = [];
  const catDone = () => categories.every((c) => (catEarned.get(c.category) ?? 0) >= c.required);
  let slot = nextSlot;
  let t = nextTerm ? { y: nextTerm.yearStart, t: nextTerm.termNo } : null;
  const unl = new Map(courses.map((c) => [c.code, c.unlocksCount]));
  while (!catDone() && terms.length < MAX_PROJECTION_TERMS) {
    const limit = loadFor(slot).credits;
    const eligible = plan.courses.filter((c) => !done.has(c.code) && prereqsOf(c.code).every((p) => done.has(p)));
    const score = (c: PlanCourse) => {
      let s = 0;
      if (c.category === 'REMEDIAL') s += 1000;
      if (!isElective(c.category)) s += 100;
      s += (unl.get(c.code) ?? 0) * 10;
      if (c.suggestedYear && c.suggestedTerm) s -= slotIndex(c.suggestedYear, c.suggestedTerm) * 3;
      return s;
    };
    eligible.sort((a, b) => score(b) - score(a));
    const picked: PlanCourse[] = [];
    let used = 0;
    for (const c of eligible) {
      if (isElective(c.category) && (catEarned.get(c.category) ?? 0) >= (catReq.get(c.category) ?? 0)) continue;
      if (used + c.credits > limit) continue;
      picked.push(c);
      used += c.credits;
      if (isElective(c.category)) catEarned.set(c.category, (catEarned.get(c.category) ?? 0) + c.credits);
    }
    if (picked.length === 0) break;
    picked.forEach((c) => {
      done.add(c.code);
      if (!isElective(c.category)) catEarned.set(c.category, Math.min((catReq.get(c.category) ?? 0) + 100, (catEarned.get(c.category) ?? 0) + c.credits));
    });
    const label = t ? termName(t.y, t.t) : `الفصل ${terms.length + 1}`;
    terms.push({ termLabel: label, credits: used, courses: picked.map((c) => ({ code: c.code, nameAr: isElective(c.category) ? `${c.nameAr} (مثال اختياري)` : c.nameAr, credits: c.credits, category: c.category })) });
    slot++;
    if (t) t = nextRegularTerm(t);
  }
  const complete = catDone();
  const assumptions = [
    'اجتياز جميع المساقات المسجلة حاليًا وجميع المساقات المقترحة في كل فصل.',
    'طرح كل مساق في كل فصل عادي (لا تتوفر بيانات طرح مؤكدة).',
    input.rules.maxTermCredits != null ? `الالتزام بالحد الأقصى المعتمد (${input.rules.maxTermCredits} ساعة).` : 'العبء الفصلي وفق الخطة الاسترشادية لأن الحد الأقصى الرسمي غير مضبوط.',
    'عدم احتساب الفصول الصيفية.',
    'المساقات الاختيارية في الجدول أمثلة، ويمكن استبدالها بأي اختياري متاح من الفئة نفسها.',
  ];
  const pending = grad.nonCredit.filter((n) => n.status !== 'met');
  if (pending.length) assumptions.push(`استكمال المتطلبات غير الساعية (${pending.map((n) => n.nameAr).join('، ')}) خلال هذه الفصول.`);
  let text: string;
  if (catDone() && terms.length === 0) text = courses.some((c) => c.state === 'registered') ? 'أنهيت أو سجلت جميع المساقات المطلوبة؛ يتبقى اجتياز المسجل حاليًا وأي متطلبات غير ساعية.' : 'لا تتبقى عليك مساقات ساعية حسب البيانات المتاحة.';
  else if (!complete) text = 'تعذر تقدير الفصول المتبقية بالكامل لوجود متطلبات لا يمكن استيفاؤها بالبيانات الحالية.';
  else text = `تقدير مشروط: تحتاج نحو ${terms.length} فصل عادي بعد الفصل الحالي لإكمال الساعات المطلوبة، وفق الافتراضات المذكورة. هذا توقع وليس موعد تخرج مؤكدًا.`;
  return { termsNeeded: complete ? terms.length : null, terms, assumptions, text };
}

function guidanceForYear(level: number, plan: PlanVersion, courses: CourseStatusItem[], recs: Recommendation[], cats: CategoryProgress[], failed: AdvisingReport['failedCourses'], proj: AdvisingReport['projection'], grad: GraduationAudit, earned: number): { title: string; items: string[] } {
  const yearCourses = (y: number) => courses.filter((c) => c.suggestedYear === y);
  const top = recs.filter((r) => r.included).slice(0, 4).map((r) => r.nameAr);
  const items: string[] = [];
  switch (level) {
    case 1: {
      const y1 = yearCourses(1);
      items.push(`مساقات السنة الأولى في خطتك ${y1.length} مساقًا (${y1.reduce((s, c) => s + c.credits, 0)} ساعة)، منها: ${y1.slice(0, 6).map((c) => c.nameAr).join('، ')}.`);
      items.push('تتوزع متطلبات خطتك على: متطلبات الجامعة (إجبارية واختيارية)، ومتطلبات الكلية، ومتطلبات التخصص، إضافة إلى المتطلب الاستدراكي إن لم تُعفَ منه.');
      items.push('الساعة المعتمدة وحدة قياس لعبء المساق الأسبوعي؛ يُحتسب المساق في ساعات تخرجك مرة واحدة فقط عند اجتيازه.');
      items.push('المتطلب السابق مساق يجب اجتيازه قبل تسجيل مساق آخر؛ مثلًا «برمجة الحاسوب (2)» يتطلب «برمجة الحاسوب (1)». الرسوب في متطلب سابق يؤخر سلسلة المساقات المعتمدة عليه.');
      if (top.length) items.push(`ابدأ في الفصل القادم بـ: ${top.join('، ')}.`);
      return { title: 'إرشاد السنة الأولى', items };
    }
    case 2: {
      const y1 = yearCourses(1).filter((c) => c.state !== 'passed');
      items.push(y1.length ? `مساقات من السنة الأولى لم تجتزها بعد: ${y1.map((c) => c.nameAr).join('، ')}.` : 'اجتزت جميع المساقات المحددة للسنة الأولى في الخطة الاسترشادية.');
      const blocking = failed.filter((f) => !f.nowPassed).map((f) => {
        const c = courses.find((x) => x.code === f.code);
        return c && c.unlocksCount ? `${f.nameAr} (يحجب ${c.unlocksCount} مساقًا لاحقًا)` : f.nameAr;
      });
      if (blocking.length) items.push(`مساقات متعثرة تؤثر في تسجيل مساقات لاحقة: ${blocking.join('، ')}.`);
      const key = courses.filter((c) => c.unlocksCount >= 5 && c.category === 'MAJ_REQ').sort((a, b) => b.unlocksCount - a.unlocksCount).slice(0, 3);
      key.forEach((k) => items.push(`«${k.nameAr}» مساق أساسي محوري: تعتمد عليه ${k.unlocksCount} مساقات متقدمة في خطتك.`));
      if (top.length) items.push(`المساقات التي استوفيت متطلباتها ويُنصح بها: ${top.join('، ')}.`);
      return { title: 'إرشاد السنة الثانية', items };
    }
    case 3: {
      items.push(`أنجزت ${earned} ساعة من ${plan.totalCredits} ساعة.`);
      const adv = courses.filter((c) => (c.suggestedYear ?? 0) >= 3 && (c.state === 'available' || c.state === 'failed_retake'));
      items.push(adv.length ? `مساقات متقدمة متاحة لك الآن: ${adv.map((c) => c.nameAr).join('، ')}.` : 'لا تتوفر لك حاليًا مساقات متقدمة؛ راجع المتطلبات السابقة غير المستوفاة.');
      const blocked = courses.filter((c) => c.suggestedYear != null && c.suggestedYear <= 3 && !isElective(c.category) && c.state === 'blocked');
      if (blocked.length) items.push(`مساقات من سنتك أو ما قبلها محجوبة بسبب المتطلبات السابقة: ${blocked.map((c) => c.nameAr).join('، ')}.`);
      items.push(proj.text);
      return { title: 'إرشاد السنة الثالثة', items };
    }
    case 4: {
      const mand = cats.filter((c) => !isElective(c.category)).flatMap((c) => c.remainingMandatory);
      items.push(mand.length ? `المساقات الإجبارية المتبقية (${mand.length}): ${mand.map((m) => m.nameAr).join('، ')}.` : 'لا تتبقى عليك مساقات إجبارية.');
      cats.filter((c) => isElective(c.category) && c.remaining > 0).forEach((c) => items.push(`بقي ${c.remaining} ساعة من ${CATEGORY_LABELS[c.category]}.`));
      const gp = courses.filter((c) => /مشروع تخرج/.test(c.nameAr));
      gp.forEach((g) => items.push(`${g.nameAr}: ${g.state === 'passed' ? 'مجتاز' : g.state === 'registered' ? 'مسجل حاليًا' : g.state === 'blocked' ? 'غير متاح بعد – ' + g.blockedReasons.join('؛ ') : 'لم يُنجز بعد'}.`));
      grad.nonCredit.forEach((n) => items.push(`${n.nameAr}: ${n.status === 'met' ? 'مستوفى' : n.status === 'in_progress' ? 'قيد الإنجاز' : 'غير مستوفى'}.`));
      items.push(proj.text);
      return { title: 'إرشاد السنة الرابعة – خطة الإكمال', items };
    }
    default: {
      items.push(`الحالة: ${grad.stateLabel}.`);
      if (grad.missing.length) grad.missing.forEach((m) => items.push(`${m.text} ${m.steps}`));
      else items.push('لم يجد النظام متطلبات ناقصة في البيانات المتاحة.');
      grad.notes.forEach((n) => items.push(n));
      return { title: 'مرحلة التخرج – التحقق من المتطلبات', items };
    }
  }
}

function emptyReport(input: EngineInput, alerts: Alert[], generatedAt: string, currentTerm: AcademicTerm | null, nextTerm: AcademicTerm | null, termsCompleted: number): AdvisingReport {
  return {
    engineVersion: ENGINE_VERSION, generatedAt, student: input.student, plan: null, currentTerm, nextTerm, termsCompleted, planPosition: null,
    reliability: 'unavailable', reliabilityText: 'لا يمكن إصدار توصيات لعدم توفر خطة دراسية منطبقة.',
    credits: { required: 0, earned: 0, earnedAll: 0, registered: 0, remaining: 0, remedialRequired: 0, remedialEarned: 0, outOfPlan: 0, percent: 0 },
    categories: [], courses: [], recommendations: [], conditional: [], loadLimit: { credits: 0, source: 'fallback', text: '' }, failedCourses: [],
    delay: { isBehind: false, expectedCredits: 0, earnedCredits: 0, gap: 0, overdueCourses: [], text: 'غير متاح' }, bottlenecks: [],
    graduation: { state: 'not_eligible', stateLabel: GRAD_STATE_LABELS.not_eligible, missing: [], nonCredit: [], notes: ['لا توجد خطة لتدقيق متطلبات التخرج.'] },
    projection: { termsNeeded: null, terms: [], assumptions: [], text: 'غير متاح' }, yearGuidance: { title: '', items: [] }, alerts, outOfPlanCourses: [],
  };
}

/** فحص سلامة الخطة لعرضه في لوحة الإدارة */
export function validatePlan(plan: PlanVersion): { level: 'warning' | 'danger' | 'info'; text: string }[] {
  const out: { level: 'warning' | 'danger' | 'info'; text: string }[] = [];
  const codes = new Set(plan.courses.map((c) => c.code));
  const counted = plan.categories.filter((c) => c.countsTowardTotal).reduce((s, c) => s + c.requiredCredits, 0);
  if (counted !== plan.totalCredits) out.push({ level: 'danger', text: `مجموع الفئات المحتسبة ${counted} ≠ إجمالي الخطة ${plan.totalCredits}.` });
  for (const cat of plan.categories) {
    const inCat = plan.courses.filter((c) => c.category === cat.category);
    const sum = inCat.reduce((s, c) => s + c.credits, 0);
    if (!isElective(cat.category) && sum !== cat.requiredCredits) out.push({ level: 'warning', text: `${CATEGORY_LABELS[cat.category]}: مجموع ساعات المساقات ${sum} ≠ المطلوب ${cat.requiredCredits}.` });
    if (isElective(cat.category) && sum < cat.requiredCredits) out.push({ level: 'danger', text: `${CATEGORY_LABELS[cat.category]}: الخيارات المتاحة (${sum} ساعة) أقل من المطلوب.` });
  }
  plan.prerequisites.forEach((p) => { if (!codes.has(p.requires)) out.push({ level: 'warning', text: `المتطلب السابق ${p.requires} للمساق ${p.course} ليس ضمن الخطة.` }); });
  // كشف الحلقات
  const adj = new Map<string, string[]>();
  plan.prerequisites.forEach((p) => adj.set(p.course, [...(adj.get(p.course) ?? []), p.requires]));
  const state = new Map<string, number>();
  const dfs = (n: string): boolean => {
    state.set(n, 1);
    for (const m of adj.get(n) ?? []) {
      if (state.get(m) === 1) return true;
      if (!state.get(m) && dfs(m)) return true;
    }
    state.set(n, 2);
    return false;
  };
  for (const c of codes) if (!state.get(c) && dfs(c)) { out.push({ level: 'danger', text: 'توجد حلقة في المتطلبات السابقة.' }); break; }
  // تغطية الخطة الاسترشادية
  const guideByCat = new Map<string, number>();
  plan.courses.forEach((c) => { if (c.suggestedYear) guideByCat.set(c.category, (guideByCat.get(c.category) ?? 0) + c.credits); });
  plan.guidingSlots.forEach((g) => { if (g.category) guideByCat.set(g.category, (guideByCat.get(g.category) ?? 0) + g.credits); });
  let guideTotal = 0;
  for (const cat of plan.categories) {
    const g = guideByCat.get(cat.category) ?? 0;
    if (cat.countsTowardTotal) guideTotal += g;
    if (g !== cat.requiredCredits) out.push({ level: 'info', text: `الخطة الاسترشادية توزّع ${g} ساعة من ${CATEGORY_LABELS[cat.category]} مقابل ${cat.requiredCredits} مطلوبة في الخطة الدراسية؛ يجدول المحرك الفرق تلقائيًا.` });
  }
  if (guideTotal !== plan.totalCredits) out.push({ level: 'warning', text: `الخطة الاسترشادية توزّع ${guideTotal} ساعة محتسبة فقط من ${plan.totalCredits}.` });
  const uncovered = plan.courses.filter((c) => !isElective(c.category) && !c.suggestedYear && c.category !== 'UNI_REQ');
  if (uncovered.length) out.push({ level: 'info', text: `مساقات إجبارية بلا فصل مقترح: ${uncovered.map((c) => c.code).join('، ')}.` });
  if (plan.minGpaForGraduation == null) out.push({ level: 'info', text: 'الحد الأدنى لمعدل التخرج غير مضبوط لهذه الخطة.' });
  return out;
}

export { TERM_LABELS, YEAR_LABELS };
