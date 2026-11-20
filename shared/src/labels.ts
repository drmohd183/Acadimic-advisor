import type { Category, CourseState, Priority, PlanStatus, RecordStatus, GraduationState } from './types';

export const CATEGORY_LABELS: Record<Category, string> = {
  REMEDIAL: 'متطلب استدراكي إجباري',
  UNI_REQ: 'متطلب جامعة إجباري',
  UNI_ELEC: 'متطلب جامعة اختياري',
  COL_REQ: 'متطلب كلية إجباري',
  COL_ELEC: 'متطلب كلية اختياري',
  MAJ_REQ: 'متطلب تخصص إجباري',
  MAJ_ELEC: 'متطلب تخصص اختياري',
};

export const STATE_LABELS: Record<CourseState, string> = {
  passed: 'مجتاز',
  registered: 'مسجل حاليًا',
  available: 'متاح للتسجيل',
  conditional: 'متاح بشرط',
  blocked: 'غير متاح',
  failed_retake: 'متعثر – متاح للإعادة',
};

export const PRIORITY_LABELS: Record<Priority, string> = { high: 'أولوية عالية', medium: 'أولوية متوسطة', normal: 'أولوية عادية' };

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  draft: 'مسودة',
  imported: 'مستوردة – بانتظار الاعتماد',
  approved: 'معتمدة',
  archived: 'مؤرشفة',
  demo: 'تجريبية',
};

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  passed: 'ناجح',
  failed: 'راسب',
  withdrawn: 'منسحب',
  incomplete: 'غير مكتمل',
  exempt: 'معفى',
  transfer: 'معادلة/تحويل',
};

export const GRAD_STATE_LABELS: Record<GraduationState, string> = {
  not_eligible: 'غير مستوفٍ لمتطلبات التخرج بعد',
  expected: 'متوقع التخرج',
  requirements_met: 'مستوفٍ لمتطلبات التخرج (حسب البيانات المتاحة)',
  graduated: 'خريج (مثبت في سجل الجامعة)',
};

export const YEAR_LABELS: Record<number, string> = { 1: 'السنة الأولى', 2: 'السنة الثانية', 3: 'السنة الثالثة', 4: 'السنة الرابعة', 5: 'مرحلة التخرج' };
export const TERM_LABELS: Record<number, string> = { 1: 'الفصل الأول', 2: 'الفصل الثاني', 3: 'الفصل الصيفي' };

export const slotLabel = (year: number, term: number) => `${YEAR_LABELS[year] ?? 'السنة ' + year} – ${TERM_LABELS[term] ?? term}`;

/** تطبيع النص العربي للبحث والمطابقة */
export function normalizeAr(s: string): string {
  return s
    .replace(/[ً-ْٰـ]/g, '') // تشكيل وتطويل
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[()\[\]{}«»"'،,.؟?!:؛\-_/]/g, ' ')
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
