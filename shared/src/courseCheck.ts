/**
 * فحص إمكانية تسجيل مساق بعينه، وتوقيت إعادة المساقات الراسبة.
 * يعتمد فقط على تقرير المحرك؛ لا يضيف قواعد جديدة.
 */
import type { AdvisingReport, CourseStatusItem } from './types';
import { isElective } from './types';
import { CATEGORY_LABELS, RECORD_STATUS_LABELS, normalizeAr } from './labels';

export type Verdict = 'can' | 'cannot' | 'conditional' | 'done' | 'registered' | 'not_in_plan';

export interface CourseCheck {
  verdict: Verdict;
  code: string;
  nameAr: string;
  credits: number | null;
  title: string; // الجملة الرئيسية في النافذة
  reasons: string[]; // لماذا
  steps: string[]; // ماذا تفعل
  chain: { code: string; nameAr: string; state: string; depth: number }[]; // سلسلة المتطلبات
  inPackage: boolean; // ضمن الحزمة المقترحة للفصل القادم
}

const STATE_SHORT: Record<string, string> = {
  passed: 'مجتاز', registered: 'مسجل حاليًا', available: 'متاح', failed_retake: 'راسب – متاح للإعادة', conditional: 'مشروط', blocked: 'غير متاح',
};

function prereqChain(r: AdvisingReport, code: string, depth = 0, seen = new Set<string>()): CourseCheck['chain'] {
  const c = r.courses.find((x) => x.code === code);
  if (!c || seen.has(code)) return [];
  seen.add(code);
  return c.prerequisites.flatMap((p) => {
    const pc = r.courses.find((x) => x.code === p.code);
    return [{ code: p.code, nameAr: p.nameAr, state: pc ? STATE_SHORT[pc.state] : p.met ? 'مجتاز' : 'غير مجتاز', depth }, ...prereqChain(r, p.code, depth + 1, seen)];
  });
}

/** أقرب مساقات في سلسلة المتطلبات يستطيع الطالب تسجيلها الآن */
function firstSteps(r: AdvisingReport, c: CourseStatusItem): CourseStatusItem[] {
  const out = new Map<string, CourseStatusItem>();
  const walk = (code: string, seen: Set<string>) => {
    if (seen.has(code)) return;
    seen.add(code);
    const x = r.courses.find((y) => y.code === code);
    if (!x) return;
    for (const p of x.prerequisites) {
      if (p.met) continue;
      const pc = r.courses.find((y) => y.code === p.code);
      if (!pc) continue;
      if (pc.state === 'available' || pc.state === 'failed_retake' || pc.state === 'registered') out.set(pc.code, pc);
      else walk(pc.code, seen);
    }
  };
  walk(c.code, new Set());
  return [...out.values()];
}

export function findCourseByQuery(r: AdvisingReport, q: string): CourseStatusItem[] {
  const nq = normalizeAr(q);
  if (!nq) return [];
  return r.courses
    .map((c) => {
      const name = normalizeAr(c.nameAr);
      let s = 0;
      if (c.code === nq) s = 100;
      else if (c.code.startsWith(nq)) s = 80;
      else if (name === nq) s = 90;
      else if (name.startsWith(nq)) s = 70;
      else if (name.includes(nq)) s = 50;
      else if (nq.split(' ').every((t) => name.includes(t))) s = 30;
      return { c, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.c.nameAr.localeCompare(b.c.nameAr, 'ar'))
    .map((x) => x.c);
}

export function checkCourse(r: AdvisingReport, code: string): CourseCheck {
  const c = r.courses.find((x) => x.code === code);
  const next = r.nextTerm?.nameAr ?? 'الفصل القادم';
  if (!c) {
    return {
      verdict: 'not_in_plan', code, nameAr: code, credits: null, title: 'هذا المساق ليس ضمن خطتك الدراسية.',
      reasons: ['المرشد يقترح ويفحص مساقات خطتك فقط. المساق من خارج الخطة لا يُحتسب ضمن ساعات تخرجك ما لم تُعتمد له معادلة.'],
      steps: ['تأكد من رمز المساق، أو راجع القسم إن كنت تريد تسجيله كمساق إضافي.'], chain: [], inPackage: false,
    };
  }
  const rec = r.recommendations.find((x) => x.code === c.code || x.options?.some((o) => o.code === c.code));
  const inPackage = !!rec?.included;
  const chain = prereqChain(r, c.code);
  const base = { code: c.code, nameAr: c.nameAr, credits: c.credits, chain, inPackage };
  const cat = r.categories.find((x) => x.category === c.category);

  switch (c.state) {
    case 'passed': {
      const last = [...c.attempts].reverse().find((a) => a.status === 'passed' || a.status === 'exempt' || a.status === 'transfer');
      return { ...base, verdict: 'done', title: 'اجتزت هذا المساق، فلا حاجة لتسجيله.',
        reasons: [last ? `النتيجة: ${last.status ? RECORD_STATUS_LABELS[last.status] : ''}${last.grade != null ? ` بعلامة ${last.grade}` : ''} في الفصل ${last.termCode}.` : 'المساق مجتاز في سجلك.'],
        steps: ['إعادة دراسة مساق ناجح لتحسين العلامة تخضع لتعليمات الجامعة؛ راجع القبول والتسجيل.'] };
    }
    case 'registered':
      return { ...base, verdict: 'registered', title: `أنت مسجل في هذا المساق في ${r.currentTerm?.nameAr ?? 'الفصل الحالي'}.`, reasons: ['لا يمكن تسجيل المساق مرتين في الوقت نفسه.'], steps: [] };
    case 'conditional': {
      const pend = c.prerequisites.filter((p) => !p.met && p.registered);
      return { ...base, verdict: 'conditional', title: 'لا يمكنك تسجيله الآن، لكنه سيُتاح لك إن نجحت في المساق الذي تدرسه حاليًا.',
        reasons: pend.map((p) => `يتطلب اجتياز «${p.nameAr}» (${p.code})، وأنت مسجل فيه هذا الفصل ولم تظهر نتيجته بعد.`),
        steps: ['انتظر صدور نتيجة الفصل الحالي. إن نجحت، يصبح المساق متاحًا لك في ' + next + '.', 'إن لم تنجح، فعليك إعادة المتطلب أولًا.'] };
    }
    case 'blocked': {
      const unmet = c.prerequisites.filter((p) => !p.met);
      const reasons = unmet.map((p) => {
        const pc = r.courses.find((x) => x.code === p.code);
        const why = pc?.state === 'failed_retake' ? 'رسبت فيه ولم تجتزه بعد' : pc?.state === 'blocked' ? 'لم تجتزه، وهو نفسه غير متاح لك بعد' : pc?.state === 'conditional' ? 'لم تجتزه، وهو مشروط بنتيجة الفصل الحالي' : 'لم تجتزه بعد';
        return `المتطلب السابق «${p.nameAr}» (${p.code}) غير مستوفى: ${why}.`;
      });
      const first = firstSteps(r, c);
      const steps = first.length
        ? first.map((f) => (f.state === 'registered' ? `أنت تدرس «${f.nameAr}» الآن؛ اجتيازه يقرّبك من هذا المساق.` : `ابدأ بتسجيل «${f.nameAr}» (${f.code}) في ${next}، فهو متاح لك الآن.`))
        : ['راجع سلسلة المتطلبات أدناه لمعرفة ما يجب اجتيازه أولًا.'];
      if (chain.length > 1) steps.push(`تحتاج إلى إنهاء السلسلة بالترتيب قبل أن يصبح «${c.nameAr}» متاحًا.`);
      return { ...base, verdict: 'cannot', title: 'لا يمكنك تسجيل هذا المساق حاليًا.', reasons, steps };
    }
    default: {
      // available | failed_retake
      const reasons: string[] = [];
      const steps: string[] = [];
      reasons.push(c.prerequisites.length ? `استوفيت متطلباته السابقة: ${c.prerequisites.map((p) => `«${p.nameAr}»`).join(' و')}.` : 'لا يتطلب متطلبًا سابقًا.');
      if (c.state === 'failed_retake') reasons.push('رسبت فيه سابقًا، وهو متاح لك للإعادة.');
      const notOffered = rec?.warnings.some((w) => w.startsWith('غير مطروح'));
      if (notOffered) {
        return { ...base, verdict: 'cannot', title: `المساق غير مطروح في ${next} حسب بيانات الطرح.`, reasons: [...reasons, 'متطلباته مستوفاة، لكنه لا يُطرح في الفصل القادم.'], steps: ['سجّله في أول فصل يُطرح فيه، واختر بدله من المساقات المقترحة.'] };
      }
      if (isElective(c.category) && cat && cat.remaining <= 0) {
        return { ...base, verdict: 'can', title: 'يمكنك تسجيله، لكنه لن يُحتسب ضمن ساعات تخرجك.',
          reasons: [...reasons, `أكملت ساعات «${CATEGORY_LABELS[c.category]}» المطلوبة (${cat.required} ساعة)؛ أي مساق إضافي من هذه الفئة زائد عن الخطة.`],
          steps: ['الأفضل أن تسجّل بدلًا منه مساقًا مما تبقى عليك؛ انظر المساقات المقترحة.'] };
      }
      if (inPackage) reasons.push(`وهو ضمن المساقات المقترحة لك في ${next}.`);
      else if (rec) { reasons.push('وهو متاح، لكنه ليس ضمن الحزمة المقترحة لأن لديك مساقات أعلى أولوية ضمن حد الساعات.'); steps.push('سجّل المساقات المقترحة أولًا، ثم هذا المساق إن بقي لك مجال في عدد الساعات.'); }
      const unmetCo = c.corequisites.filter((x) => !x.met && !x.registered);
      if (unmetCo.length) steps.push(`يجب أن تسجّل معه في الفصل نفسه: ${unmetCo.map((x) => `«${x.nameAr}»`).join(' و')}.`);
      if (rec?.warnings.length) rec.warnings.filter((w) => !w.startsWith('غير مطروح')).forEach((w) => steps.push(w));
      steps.push('تأكد من مواعيد الشعب في نظام التسجيل الجامعي.');
      return { ...base, verdict: 'can', title: c.state === 'failed_retake' ? 'يمكنك إعادة تسجيل هذا المساق.' : 'يمكنك تسجيل هذا المساق.', reasons, steps };
    }
  }
}

/** متى يمكن إعادة كل مساق راسب */
export function retakePlan(r: AdvisingReport) {
  const next = r.nextTerm?.nameAr ?? 'الفصل القادم';
  return r.failedCourses.filter((f) => !f.nowPassed).map((f) => {
    const c = r.courses.find((x) => x.code === f.code);
    const attempt = c?.attempts.filter((a) => a.status === 'failed').slice(-1)[0];
    let when: string; let tone: 'now' | 'registered' | 'later' | 'none';
    if (!c) { when = 'المساق ليس ضمن خطتك الحالية؛ راجع القسم.'; tone = 'none'; }
    else if (c.state === 'registered') { when = `تعيده الآن في ${r.currentTerm?.nameAr ?? 'الفصل الحالي'}.`; tone = 'registered'; }
    else if (c.state === 'failed_retake') {
      const rec = r.recommendations.find((x) => x.code === c.code);
      when = rec?.warnings.some((w) => w.startsWith('غير مطروح')) ? `متطلباته مستوفاة، لكنه غير مطروح في ${next}؛ أعده في أول فصل يُطرح فيه.` : `يمكنك إعادته في ${next}.`;
      tone = 'now';
    } else {
      const first = firstSteps(r, c);
      when = `لا يمكن إعادته قبل اجتياز ${c.prerequisites.filter((p) => !p.met).map((p) => `«${p.nameAr}»`).join(' و')}${first.length ? `؛ ابدأ بـ«${first[0].nameAr}»` : ''}.`;
      tone = 'later';
    }
    return { code: f.code, nameAr: f.nameAr, credits: c?.credits ?? null, failedIn: attempt?.termCode ?? f.lastTerm, grade: attempt?.grade ?? null, unlocks: c?.unlocksCount ?? 0, when, tone };
  });
}
