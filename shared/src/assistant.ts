/**
 * المساعد الأكاديمي المقيَّد بالبيانات (Grounded)
 * يجيب فقط من تقرير المحرك والخطة المحمّلة، ويصرّح عند عدم كفاية المعلومات.
 * يعمل محليًا دون إرسال أي بيانات إلى خدمات خارجية.
 */
import type { AdvisingReport, CourseStatusItem } from './types';
import { CATEGORY_LABELS, STATE_LABELS, PRIORITY_LABELS, normalizeAr, slotLabel } from './labels';

export type Intent =
  | 'why_not' | 'prereq' | 'remaining_hours' | 'when_graduate' | 'graduation' | 'delay' | 'retake'
  | 'recommend' | 'gpa' | 'electives' | 'course_info' | 'plan' | 'greeting' | 'unknown';

export interface AssistantAnswer {
  intent: Intent;
  answer: string; // نص بسيط مع أسطر «•»
  courses: string[]; // رموز المساقات المذكورة
  confidence: 'high' | 'limited' | 'none';
  sources: string[];
  engine: 'rules' | 'llm';
}

const STOP = new Set(['في', 'و', 'من', 'الى', 'على', 'عن', 'مقدمه', 'مبادي', 'اساسيات', 'اسس', 'عامه', 'نظم', '1', '2', '3']);
const strip = (t: string) => (t.startsWith('ال') && t.length > 3 ? t.slice(2) : t);

export function findCourses(q: string, courses: CourseStatusItem[]): CourseStatusItem[] {
  const nq = normalizeAr(q);
  const qTokens = new Set(nq.split(' ').map(strip));
  const found: { c: CourseStatusItem; s: number }[] = [];
  for (const c of courses) {
    if (nq.includes(c.code)) { found.push({ c, s: 1000 }); continue; }
    const name = normalizeAr(c.nameAr);
    if (nq.includes(name)) { found.push({ c, s: 100 + name.length }); continue; }
    const toks = name.split(' ').filter((t) => !STOP.has(t)).map(strip);
    if (!toks.length) continue;
    const hit = toks.filter((t) => qTokens.has(t)).length;
    if ((toks.length === 1 && hit === 1 && toks[0].length >= 4) || (hit >= 2 && hit / toks.length >= 0.6)) found.push({ c, s: hit * 10 + name.length / 10 });
  }
  found.sort((a, b) => b.s - a.s);
  if (!found.length) return [];
  // إذا تطابق الاسم كاملًا نستبعد المطابقات الجزئية الأضعف
  const best = found[0].s;
  return found.filter((f) => f.s >= Math.min(best, 100) || f.s >= best * 0.9).slice(0, 3).map((f) => f.c);
}

const has = (nq: string, words: string[]) => words.some((w) => nq.includes(normalizeAr(w)));

export function detectIntent(q: string, mentioned: CourseStatusItem[]): Intent {
  const nq = normalizeAr(q);
  const course = mentioned.length > 0;
  if (course && has(nq, ['لماذا لا', 'ليش ما', 'ليش لا', 'لا استطيع', 'لا أستطيع', 'مش قادر', 'لا يمكنني', 'ما بقدر', 'غير متاح', 'ممنوع', 'لماذا محجوب', 'ليش مسكر'])) return 'why_not';
  if (course && has(nq, ['متطلب', 'متطلبات', 'قبل', 'شرط', 'شروط', 'احتاج', 'يلزم', 'لازم'])) return 'prereq';
  if (has(nq, ['كم ساعه', 'كم ساعة', 'عدد الساعات', 'الساعات المتبقيه', 'الساعات المتبقية', 'ساعات متبقيه', 'كم باقي', 'كم بقي'])) return 'remaining_hours';
  if (has(nq, ['كم فصل', 'متى اتخرج', 'متى أتخرج', 'موعد التخرج', 'كم سنه', 'كم سنة'])) return 'when_graduate';
  if (has(nq, ['تخرج', 'اتخرج', 'أتخرج', 'خريج'])) return 'graduation';
  if (has(nq, ['تاخر', 'تأخر', 'متاخر', 'متأخر', 'وفق الخطه', 'حسب الخطه', 'على الخطه', 'ماشي صح'])) return 'delay';
  if (has(nq, ['اعيد', 'أعيد', 'اعاده', 'إعادة', 'رسبت', 'راسب', 'متعثر', 'المتعثره'])) return 'retake';
  if (has(nq, ['انصح', 'تنصح', 'تنصحني', 'اسجل', 'أسجل', 'تسجيل', 'الفصل القادم', 'الفصل الجاي', 'اقترح', 'المقترحه', 'شو اخذ', 'ماذا ادرس', 'ماذا أدرس'])) return course ? 'course_info' : 'recommend';
  if (has(nq, ['معدل', 'المعدل'])) return 'gpa';
  if (has(nq, ['اختياري', 'اختياريه', 'الاختيارات'])) return 'electives';
  if (course) return 'course_info';
  if (has(nq, ['خطتي', 'الخطه', 'الخطة', 'المسار'])) return 'plan';
  if (has(nq, ['مرحبا', 'السلام', 'اهلا', 'أهلا', 'هاي', 'شكرا'])) return 'greeting';
  return 'unknown';
}

function chain(code: string, r: AdvisingReport, depth = 0, seen = new Set<string>()): string[] {
  const c = r.courses.find((x) => x.code === code);
  if (!c || seen.has(code)) return [];
  seen.add(code);
  const lines: string[] = [];
  for (const p of c.prerequisites) {
    const pc = r.courses.find((x) => x.code === p.code);
    lines.push(`${'  '.repeat(depth)}• ${p.nameAr} (${p.code}) – ${pc ? STATE_LABELS[pc.state] : p.met ? 'مجتاز' : 'غير مجتاز'}`);
    lines.push(...chain(p.code, r, depth + 1, seen));
  }
  return lines;
}

export function answerQuestion(report: AdvisingReport, question: string): AssistantAnswer {
  const q = (question ?? '').slice(0, 500);
  const src = report.plan ? [`الخطة: ${report.plan.label}`, `تقرير المحرك ${report.engineVersion} بتاريخ ${report.generatedAt.slice(0, 10)}`] : [];
  const mk = (intent: Intent, lines: string[], courses: string[] = [], confidence: AssistantAnswer['confidence'] = 'high'): AssistantAnswer => {
    const tail: string[] = [];
    if (report.reliability !== 'final' && confidence !== 'none') tail.push(`ملاحظة: ${report.reliabilityText}`);
    return { intent, answer: [...lines, ...(tail.length ? ['', ...tail] : [])].join('\n'), courses, confidence, sources: src, engine: 'rules' };
  };

  if (!report.plan) {
    return mk('unknown', ['لا أستطيع الإجابة بدقة لأن النظام لا يحتوي على خطة دراسية منطبقة عليك. يرجى مراجعة إدارة النظام لاستيراد الخطة المعتمدة.'], [], 'none');
  }
  const mentioned = findCourses(q, report.courses);
  const intent = detectIntent(q, mentioned);
  const c0 = mentioned[0];

  switch (intent) {
    case 'why_not': {
      const c = c0;
      if (c.state === 'passed') return mk(intent, [`لقد اجتزت «${c.nameAr}» (${c.code}) سابقًا، فلا حاجة لتسجيله.`], [c.code]);
      if (c.state === 'registered') return mk(intent, [`أنت مسجل حاليًا في «${c.nameAr}» (${c.code}) في الفصل ${report.currentTerm?.nameAr ?? 'الحالي'}.`], [c.code]);
      if (c.state === 'available' || c.state === 'failed_retake') {
        return mk(intent, [`يمكنك تسجيل «${c.nameAr}» (${c.code}) لأنك استوفيت متطلباته السابقة${c.prerequisites.length ? ` (${c.prerequisites.map((p) => p.nameAr).join('، ')})` : ''}.`, 'إن واجهت منعًا في نظام التسجيل فقد يكون السبب غير أكاديمي (عدم طرح المساق، أو امتلاء الشعب، أو قيود مالية أو إدارية)، وهذه بيانات لا يملكها المرشد؛ راجع دائرة القبول والتسجيل.'], [c.code], 'limited');
      }
      return mk(intent, [`لا يمكنك تسجيل «${c.nameAr}» (${c.code}) حاليًا للأسباب الآتية:`, ...c.blockedReasons.map((b) => `• ${b}`), '', 'سلسلة المتطلبات:', ...chain(c.code, report)], [c.code, ...c.prerequisites.map((p) => p.code)]);
    }
    case 'prereq': {
      const c = c0;
      if (!c.prerequisites.length) return mk(intent, [`«${c.nameAr}» (${c.code}) لا يتطلب أي متطلب سابق في خطتك. حالته لديك: ${STATE_LABELS[c.state]}.`], [c.code]);
      return mk(intent, [`لدراسة «${c.nameAr}» (${c.code}) يجب اجتياز ما يلي (بالتسلسل):`, ...chain(c.code, report), '', `حالة المساق لديك الآن: ${STATE_LABELS[c.state]}.`, ...(c.blockedReasons.length ? c.blockedReasons.map((b) => `• ${b}`) : [])], [c.code]);
    }
    case 'remaining_hours': {
      const cr = report.credits;
      const lines = [
        `مطلوب للتخرج ${cr.required} ساعة معتمدة محتسبة، أنجزت منها ${cr.earned} ساعة (${cr.percent}%)، وبقي عليك ${cr.remaining} ساعة.`,
        `مسجل حاليًا: ${cr.registered} ساعة (لا تُحتسب قبل اجتيازها).`,
      ];
      if (cr.remedialRequired) lines.push(`المتطلب الاستدراكي (${cr.remedialRequired} ساعة غير محتسبة): ${cr.remedialEarned >= cr.remedialRequired ? 'مستوفى' : 'غير مستوفى'}.`);
      lines.push('توزيع المتبقي حسب الفئات:');
      report.categories.filter((c) => c.remaining > 0).forEach((c) => lines.push(`• ${CATEGORY_LABELS[c.category]}: ${c.remaining} ساعة`));
      const nc = report.graduation.nonCredit.filter((n) => n.status !== 'met');
      if (nc.length) lines.push(`إضافة إلى متطلبات غير ساعية: ${nc.map((n) => n.nameAr).join('، ')}.`);
      return mk(intent, lines);
    }
    case 'when_graduate': {
      const p = report.projection;
      const lines = [p.text];
      if (p.terms.length) p.terms.forEach((t) => lines.push(`• ${t.termLabel}: ${t.credits} ساعة`));
      lines.push('الافتراضات:', ...p.assumptions.map((a) => `• ${a}`));
      return mk(intent, lines, [], 'limited');
    }
    case 'graduation': {
      const g = report.graduation;
      const lines = [`حالتك: ${g.stateLabel}.`];
      if (g.missing.length) { lines.push('المتطلبات المتبقية للتخرج:'); g.missing.forEach((m) => lines.push(`• ${m.text} ${m.steps}`)); }
      else lines.push('لم يجد النظام متطلبات ناقصة حسب البيانات المتاحة.');
      g.notes.forEach((n) => lines.push(`ملاحظة: ${n}`));
      return mk(intent, lines);
    }
    case 'delay': {
      const d = report.delay;
      const lines = [d.text];
      if (d.overdueCourses.length) { lines.push('مساقات مقررة في فصول سابقة ولم تُجتز:'); d.overdueCourses.forEach((o) => lines.push(`• ${o.nameAr} (${o.code}) – ${o.slot}`)); }
      report.bottlenecks.forEach((b) => lines.push(`⚠ ${b.text}`));
      return mk(intent, lines, d.overdueCourses.map((o) => o.code));
    }
    case 'retake': {
      const open = report.failedCourses.filter((f) => !f.nowPassed);
      const closed = report.failedCourses.filter((f) => f.nowPassed);
      if (!report.failedCourses.length) return mk(intent, ['لا يوجد في سجلك مساق راسب، فلا توجد مساقات يلزمك إعادتها.']);
      const lines: string[] = [];
      if (open.length) { lines.push('مساقات رسبت فيها ولم تجتزها بعد ويجب إعادتها:'); open.forEach((f) => { const c = report.courses.find((x) => x.code === f.code); lines.push(`• ${f.nameAr} (${f.code})${c?.state === 'registered' ? ' – مسجل حاليًا للإعادة' : c?.state === 'blocked' ? ' – لا يمكن إعادته قبل استيفاء متطلبه السابق' : ' – متاح لإعادة التسجيل'}${c && c.unlocksCount ? `، ويحجب ${c.unlocksCount} مساقًا لاحقًا` : ''}`); }); }
      if (closed.length) { lines.push('مساقات رسبت فيها ثم اجتزتها (احتُسبت مرة واحدة):'); closed.forEach((f) => lines.push(`• ${f.nameAr} (${f.code})`)); }
      lines.push('إعادة دراسة مساق ناجح لتحسين العلامة تخضع لسياسة الجامعة المعتمدة؛ راجع تعليمات التسجيل.');
      return mk(intent, lines, report.failedCourses.map((f) => f.code));
    }
    case 'recommend': {
      const inc = report.recommendations.filter((r) => r.included);
      if (!inc.length) return mk(intent, ['لا توجد حاليًا مساقات استوفيت متطلباتها للفصل القادم.', ...(report.conditional.length ? [`مساقات ستتاح بعد اجتياز المسجل حاليًا: ${report.conditional.map((c) => c.nameAr).join('، ')}.`] : [])]);
      const lines = [`الحزمة المقترحة للفصل ${report.nextTerm?.nameAr ?? 'القادم'} (${inc.reduce((s, r) => s + r.credits, 0)} ساعة ضمن عبء مرجعي ${report.loadLimit.credits} ساعة):`];
      inc.forEach((r) => {
        lines.push(`• ${r.code ? `${r.nameAr} (${r.code})` : r.nameAr} – ${r.credits} س – ${PRIORITY_LABELS[r.priority]}: ${r.reasons[0]?.text ?? ''}`);
        if (r.kind === 'elective_choice' && r.options?.length) lines.push(`   الخيارات: ${r.options.slice(0, 6).map((o) => o.nameAr).join('، ')}`);
      });
      lines.push(report.loadLimit.text);
      return mk(intent, lines, inc.map((r) => r.code!).filter(Boolean));
    }
    case 'gpa': {
      const g = report.student.gpa;
      return mk(intent, [g == null ? 'المعدل التراكمي غير متوفر في سجلك لدى النظام.' : `معدلك التراكمي المسجل: ${g}.`, 'لا يحسب المرشد المعدل بنفسه؛ القيمة كما وردت من سجل الطالب.', report.graduation.notes.find((n) => n.includes('المعدل')) ?? ''].filter(Boolean), [], g == null ? 'none' : 'high');
    }
    case 'electives': {
      const lines: string[] = [];
      report.categories.filter((c) => ['UNI_ELEC', 'COL_ELEC', 'MAJ_ELEC'].includes(c.category)).forEach((c) => {
        const opts = report.courses.filter((x) => x.category === c.category && (x.state === 'available' || x.state === 'failed_retake'));
        lines.push(`• ${CATEGORY_LABELS[c.category]}: أنجزت ${c.earned} من ${c.required}${c.remaining ? `؛ المتاح لك الآن: ${opts.slice(0, 8).map((o) => o.nameAr).join('، ') || 'لا يوجد'}` : ' (مستوفى)'}`);
      });
      return mk(intent, lines);
    }
    case 'course_info': {
      const c = c0;
      const rec = report.recommendations.find((r) => r.code === c.code);
      const lines = [
        `«${c.nameAr}» (${c.code}): ${c.credits} ساعات معتمدة – ${CATEGORY_LABELS[c.category]}${c.suggestedYear ? ` – مقرر في ${slotLabel(c.suggestedYear, c.suggestedTerm ?? 1)}` : ''}.`,
        `حالته لديك: ${STATE_LABELS[c.state]}.`,
        c.prerequisites.length ? `متطلباته السابقة: ${c.prerequisites.map((p) => `${p.nameAr} (${p.met ? 'مستوفى' : 'غير مستوفى'})`).join('، ')}.` : 'لا يتطلب متطلبًا سابقًا.',
      ];
      if (c.blockedReasons.length) lines.push(...c.blockedReasons.map((b) => `• ${b}`));
      if (rec) lines.push(`مقترح لك للفصل القادم (${PRIORITY_LABELS[rec.priority]})${rec.included ? ' وضمن الحزمة المقترحة' : ''}: ${rec.reasons.map((x) => x.text).join(' ')}`);
      if (c.unlocksCount) lines.push(`يعتمد عليه ${c.unlocksCount} مساقًا لاحقًا في خطتك.`);
      return mk(intent, lines, [c.code]);
    }
    case 'plan': {
      const p = report.plan;
      return mk(intent, [`خطتك: ${p.label} – ${p.programNameAr} / ${p.trackNameAr}.`, `إجمالي الساعات المحتسبة: ${p.totalCredits}.`, `سبب اختيار الخطة: ${p.selectionReason}.`, 'يمكنك مراجعة صفحة «الخطة الدراسية» لعرض المساقات حسب الفصول وحالة كل منها.']);
    }
    case 'greeting':
      return mk(intent, ['أهلًا بك! أنا المرشد الأكاديمي الآلي. يمكنك سؤالي مثلًا: «ما المواد التي تنصحني بتسجيلها؟» أو «ما متطلبات أمن الشبكات؟» أو «كم ساعة بقيت لي؟».'], [], 'high');
    default: {
      const ans: AssistantAnswer = {
        intent: 'unknown',
        answer: ['لم أتمكن من فهم السؤال بما يكفي للإجابة بثقة من بيانات خطتك وسجلك، ولن أخمّن إجابة غير موثقة.', 'جرّب صياغة مثل:', '• ما المواد التي تنصحني بتسجيلها في الفصل القادم؟', '• لماذا لا أستطيع تسجيل نظم قواعد البيانات؟', '• ما المواد التي يجب أن أجتازها قبل أمن الشبكات؟', '• كم ساعة بقيت لي حتى التخرج؟', '• هل يوجد تأخر في خطتي؟', '• ما المواد التي يجب أن أعيد دراستها؟', '• ما المتطلبات المتبقية عليّ للتخرج؟', 'وإذا ذكرت مساقًا، تأكد من أنه ضمن خطتك (يمكنك كتابة رمزه المكوّن من 8 أرقام).'].join('\n'),
        courses: [], confidence: 'none', sources: src, engine: 'rules',
      };
      return ans;
    }
  }
}

/** سياق مختصر ومجهّل (بلا اسم أو رقم جامعي) لاستخدامه مع نموذج لغوي خارجي إذا فُعّل */
export function buildGroundedContext(r: AdvisingReport) {
  return {
    plan: r.plan && { label: r.plan.label, track: r.plan.trackNameAr, totalCredits: r.plan.totalCredits, status: r.plan.status },
    reliability: r.reliabilityText,
    year: r.student.academicYearLevel,
    gpa: r.student.gpa,
    credits: r.credits,
    nextTerm: r.nextTerm?.nameAr,
    categories: r.categories.map((c) => ({ c: CATEGORY_LABELS[c.category], required: c.required, earned: c.earned, remaining: c.remaining, remainingMandatory: c.remainingMandatory.map((m) => m.code) })),
    courses: r.courses.map((c) => ({ code: c.code, name: c.nameAr, credits: c.credits, cat: c.category, state: c.state, prereqs: c.prerequisites.map((p) => p.code), blocked: c.blockedReasons })),
    recommendations: r.recommendations.filter((x) => x.included).map((x) => ({ code: x.code, name: x.nameAr, credits: x.credits, priority: x.priority, reasons: x.reasons.map((y) => y.text), options: x.options?.map((o) => o.code) })),
    loadLimit: r.loadLimit,
    delay: r.delay,
    failed: r.failedCourses,
    graduation: r.graduation,
    projection: { text: r.projection.text, assumptions: r.projection.assumptions },
  };
}
