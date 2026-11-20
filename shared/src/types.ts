// الأنواع المشتركة بين الخادم والواجهة ومحرك الإرشاد

export type Category =
  | 'UNI_REQ' // متطلب جامعة إجباري
  | 'UNI_ELEC' // متطلب جامعة اختياري
  | 'COL_REQ' // متطلب كلية إجباري
  | 'COL_ELEC' // متطلب كلية اختياري
  | 'MAJ_REQ' // متطلب تخصص إجباري
  | 'MAJ_ELEC' // متطلب تخصص اختياري
  | 'REMEDIAL'; // متطلب استدراكي إجباري

export const CATEGORIES: Category[] = ['REMEDIAL', 'UNI_REQ', 'UNI_ELEC', 'COL_REQ', 'COL_ELEC', 'MAJ_REQ', 'MAJ_ELEC'];
export const ELECTIVE_CATEGORIES: Category[] = ['UNI_ELEC', 'COL_ELEC', 'MAJ_ELEC'];
export const isElective = (c: Category) => ELECTIVE_CATEGORIES.includes(c);

export type PlanStatus = 'draft' | 'imported' | 'approved' | 'archived' | 'demo';

export interface Course {
  code: string;
  nameAr: string;
  nameEn?: string | null;
  credits: number;
}

export interface PlanCourse extends Course {
  category: Category;
  suggestedYear?: number | null;
  suggestedTerm?: number | null;
}

export interface CategoryRequirement {
  category: Category;
  requiredCredits: number;
  countsTowardTotal: boolean;
}

export interface GuidingSlot {
  year: number;
  term: number;
  category: Category | null;
  credits: number;
  label: string;
  kind: 'category' | 'non_credit';
}

export interface NonCreditRequirement {
  id: number | string;
  code: string; // مثل FIELD_TRAINING
  nameAr: string;
  description?: string | null;
  suggestedYear?: number | null;
  suggestedTerm?: number | null;
}

export interface Equivalence {
  fromCode: string; // مساق من خطة سابقة
  toCode: string; // المساق المقابل في هذه الخطة
  note?: string | null;
}

export interface PlanVersion {
  id: number;
  trackCode: string;
  trackNameAr: string;
  programNameAr: string;
  label: string;
  effectiveFromYear: number;
  effectiveToYear: number | null;
  totalCredits: number;
  status: PlanStatus;
  isDemo: boolean;
  sourceNote?: string | null;
  courses: PlanCourse[];
  prerequisites: { course: string; requires: string }[];
  corequisites: { course: string; requires: string }[];
  categories: CategoryRequirement[];
  guidingSlots: GuidingSlot[];
  nonCreditRequirements: NonCreditRequirement[];
  equivalences: Equivalence[];
  minGpaForGraduation: number | null; // غير موثق ← null
}

export type RecordStatus = 'passed' | 'failed' | 'withdrawn' | 'incomplete' | 'exempt' | 'transfer';

export interface CourseRecord {
  courseCode: string;
  courseNameAr?: string;
  credits?: number;
  termCode: string;
  status: RecordStatus | null; // null = الحالة غير مسجلة (تُشتق من العلامة إن أمكن)
  grade: number | null;
}

export interface Registration {
  courseCode: string;
  termCode: string;
}

export interface AcademicTerm {
  code: string; // مثل 2026-1
  yearStart: number;
  termNo: number; // 1 أول، 2 ثانٍ، 3 صيفي
  nameAr: string;
  isCurrent: boolean;
}

export type OfficialStatus = 'active' | 'expected_graduate' | 'graduated';

export interface StudentProfile {
  id: number;
  universityId: string;
  nameAr: string;
  trackCode: string;
  enrollmentYear: number;
  academicYearLevel: number; // 1..4، 5 = مرحلة التخرج/خريج
  gpa: number | null;
  recordComplete: boolean;
  officialStatus: OfficialStatus;
  isDemo: boolean;
  dataSource: 'demo' | 'sis' | 'manual';
  planVersionId: number | null; // إسناد صريح (مثل الانتقال بين الخطط)
  planAssignmentNote?: string | null;
}

export interface AdvisingRules {
  repeatPolicy: 'latest' | 'highest' | null; // null = غير موثقة
  minPassingGrade: number | null;
  maxTermCredits: number | null;
  minTermCredits: number | null;
  summerMaxCredits: number | null;
  gpaScale: number | null;
  requireApprovedPlanForFinal: boolean;
  countWithdrawnAsAttempt: boolean;
  priorityWeights: {
    remedial: number;
    retakeFailed: number;
    overdue: number;
    currentSlot: number;
    blocking: number;
    mandatory: number;
    elective: number;
  };
  llmEnabled: boolean;
}

export const DEFAULT_RULES: AdvisingRules = {
  repeatPolicy: null,
  minPassingGrade: null,
  maxTermCredits: null,
  minTermCredits: null,
  summerMaxCredits: null,
  gpaScale: null,
  requireApprovedPlanForFinal: true,
  countWithdrawnAsAttempt: false,
  priorityWeights: { remedial: 100, retakeFailed: 80, overdue: 60, currentSlot: 40, blocking: 6, mandatory: 20, elective: 0 },
  llmEnabled: false,
};

export interface EngineInput {
  student: StudentProfile;
  plans: PlanVersion[]; // كل إصدارات خطط مسار الطالب (لاختيار الصحيح)
  records: CourseRecord[];
  registrations: Registration[];
  terms: AcademicTerm[];
  rules: AdvisingRules;
  nonCreditStatus: { code: string; status: 'met' | 'not_met' | 'in_progress' }[];
  offerings?: { termCode: string; courseCode: string }[]; // اختياري: طرح المساقات للفصل القادم
  now?: string;
}

// ---------- مخرجات المحرك ----------

export type CourseState =
  | 'passed'
  | 'registered'
  | 'available'
  | 'conditional' // متاح بشرط اجتياز مساق مسجّل حاليًا
  | 'blocked'
  | 'failed_retake'; // رسب سابقًا ومتاح لإعادة التسجيل

export interface Reason {
  code: string;
  text: string;
}

export interface CourseStatusItem {
  code: string;
  nameAr: string;
  credits: number;
  category: Category;
  suggestedYear: number | null;
  suggestedTerm: number | null;
  state: CourseState;
  prerequisites: { code: string; nameAr: string; met: boolean; registered: boolean }[];
  corequisites: { code: string; nameAr: string; met: boolean; registered: boolean }[];
  attempts: { termCode: string; status: RecordStatus | null; grade: number | null }[];
  blockedReasons: string[];
  unlocksCount: number; // عدد المساقات التي تعتمد عليه (مباشرة وغير مباشرة)
  countedAs?: string | null; // معادلة
}

export type Priority = 'high' | 'medium' | 'normal';

export interface Recommendation {
  kind: 'course' | 'elective_choice';
  code: string | null; // null لخانة اختياري
  nameAr: string;
  credits: number;
  category: Category;
  priority: Priority;
  score: number;
  reasons: Reason[];
  prerequisites: { code: string; nameAr: string; met: boolean }[];
  options?: { code: string; nameAr: string; credits: number }[]; // لخانات الاختياري
  warnings: string[];
  conditionalOn?: { code: string; nameAr: string }[]; // مشروط باجتياز مساقات مسجلة حاليًا
  included: boolean; // ضمن الحزمة المقترحة للفصل القادم ضمن العبء المرجعي
}

export interface Alert {
  level: 'info' | 'warning' | 'danger' | 'success';
  code: string;
  text: string;
}

export interface CategoryProgress {
  category: Category;
  required: number;
  earned: number; // المحتسب ضمن المطلوب (لا يتجاوز المطلوب)
  surplus: number; // ساعات زائدة عن المطلوب لا تُحتسب
  registered: number;
  remaining: number;
  countsTowardTotal: boolean;
  remainingMandatory: { code: string; nameAr: string; credits: number }[];
  expectedByNow: number; // حسب الخطة الاسترشادية حتى الفصل الحالي
}

export type GraduationState = 'not_eligible' | 'expected' | 'requirements_met' | 'graduated';

export interface GraduationAudit {
  state: GraduationState;
  stateLabel: string;
  missing: { code: string; text: string; steps: string }[];
  nonCredit: { code: string; nameAr: string; status: 'met' | 'not_met' | 'in_progress' | 'unknown' }[];
  notes: string[];
}

export interface TermPlan {
  termLabel: string;
  courses: { code: string | null; nameAr: string; credits: number; category: Category }[];
  credits: number;
}

export interface AdvisingReport {
  engineVersion: string;
  generatedAt: string;
  student: StudentProfile;
  plan: { id: number; label: string; trackNameAr: string; programNameAr: string; status: PlanStatus; isDemo: boolean; totalCredits: number; selectionReason: string } | null;
  currentTerm: AcademicTerm | null;
  nextTerm: AcademicTerm | null;
  termsCompleted: number; // عدد الفصول العادية المنقضية منذ الالتحاق
  planPosition: { year: number; term: number } | null; // موقع الفصل القادم في الخطة الاسترشادية
  reliability: 'final' | 'preliminary' | 'demo' | 'unavailable';
  reliabilityText: string;
  credits: {
    required: number;
    earned: number; // المجتازة المحتسبة في الخطة
    earnedAll: number; // كل الساعات المجتازة من السجل (للعرض)
    registered: number;
    remaining: number;
    remedialRequired: number;
    remedialEarned: number;
    outOfPlan: number;
    percent: number;
  };
  categories: CategoryProgress[];
  courses: CourseStatusItem[];
  recommendations: Recommendation[];
  conditional: CourseStatusItem[];
  loadLimit: { credits: number; source: 'rule' | 'guiding_plan' | 'fallback'; text: string };
  failedCourses: { code: string; nameAr: string; lastTerm: string; retaken: boolean; nowPassed: boolean }[];
  delay: { isBehind: boolean; expectedCredits: number; earnedCredits: number; gap: number; overdueCourses: { code: string; nameAr: string; slot: string }[]; text: string };
  bottlenecks: { code: string; nameAr: string; unlocksCount: number; text: string }[];
  graduation: GraduationAudit;
  projection: { termsNeeded: number | null; terms: TermPlan[]; assumptions: string[]; text: string };
  yearGuidance: { title: string; items: string[] };
  alerts: Alert[];
  outOfPlanCourses: { code: string; nameAr: string; credits: number }[];
}
