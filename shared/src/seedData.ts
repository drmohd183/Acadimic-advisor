/**
 * بيانات أولية:
 *  - الخطط الدراسية للمسارين مستوردة من الوثائق المرفقة (حالة «مستوردة» بانتظار اعتماد القسم).
 *  - خطة سابقة وطلبة: بيانات تجريبية افتراضية بالكامل، معلّمة بوضوح ولا تمثل أشخاصًا حقيقيين.
 */
import SEC from '../seed/plan-SEC.json';
import ITM from '../seed/plan-ITM.json';
import type {
  AcademicTerm, Category, CourseRecord, GuidingSlot, PlanCourse, PlanVersion, Registration, StudentProfile, RecordStatus,
} from './types';

interface RawPlan {
  track: string; totalCredits: number; categories: Record<string, number>;
  courses: { code: string; nameAr: string; credits: number; category: string; suggestedYear?: number; suggestedTerm?: number }[];
  prerequisites: { course: string; requires: string }[];
  guidingSlots: { year: number; term: number; label: string; credits: number; category: string | null; kind: string }[];
}

export const PROGRAM = { code: 'BIS', nameAr: 'بكالوريوس نظم المعلومات', nameEn: 'B.Sc. Information Systems', departmentAr: 'قسم نظم المعلومات' };
export const TRACKS = [
  { code: 'SEC', nameAr: 'مسار أمن المعلومات', nameEn: 'Information Security Track' },
  { code: 'ITM', nameAr: 'مسار إدارة تكنولوجيا المعلومات', nameEn: 'IT Management Track' },
];

const SOURCE_NOTE = 'مستوردة آليًا من ملفات «الخطة الدراسية» و«الخطة الاسترشادية» المرفقة. سنة بدء التطبيق (2021) افتراض مؤقت غير مذكور في الوثيقة ويجب تأكيده، ولا تُعد الخطة معتمدة رسميًا في النظام حتى يعتمدها القسم من لوحة الإدارة.';

function fromRaw(id: number, raw: RawPlan, label: string): PlanVersion {
  const track = TRACKS.find((t) => t.code === raw.track)!;
  return {
    id, trackCode: raw.track, trackNameAr: track.nameAr, programNameAr: PROGRAM.nameAr, label,
    effectiveFromYear: 2021, effectiveToYear: null, totalCredits: raw.totalCredits, status: 'imported', isDemo: false, sourceNote: SOURCE_NOTE,
    courses: raw.courses.map((c) => ({ code: c.code, nameAr: c.nameAr, credits: c.credits, category: c.category as Category, suggestedYear: c.suggestedYear ?? null, suggestedTerm: c.suggestedTerm ?? null })),
    prerequisites: raw.prerequisites,
    corequisites: [],
    categories: Object.entries(raw.categories).map(([k, v]) => ({ category: k as Category, requiredCredits: v, countsTowardTotal: k !== 'REMEDIAL' })),
    guidingSlots: raw.guidingSlots.filter((g) => g.kind === 'category').map((g) => ({ year: g.year, term: g.term, category: g.category as Category, credits: g.credits, label: g.label, kind: 'category' })) as GuidingSlot[],
    nonCreditRequirements: raw.guidingSlots.filter((g) => g.kind === 'non_credit').map((g, i) => ({
      id: i + 1, code: g.label.includes('التدريب') ? 'FIELD_TRAINING' : `NC_${i + 1}`, nameAr: g.label,
      description: 'متطلب تخرج بلا ساعات معتمدة ورد في الخطة الاسترشادية؛ يُوثَّق إنجازه في سجل الطالب من قبل القسم. تفاصيله (المدة والشروط) غير مذكورة في الوثائق المحمّلة.',
      suggestedYear: g.year, suggestedTerm: g.term,
    })),
    equivalences: [],
    minGpaForGraduation: null,
  };
}

export function buildPlans(): PlanVersion[] {
  const sec = fromRaw(1, SEC as RawPlan, 'الخطة الدراسية – مسار أمن المعلومات (133 ساعة)');
  const itm = fromRaw(2, ITM as RawPlan, 'الخطة الدراسية – مسار إدارة تكنولوجيا المعلومات (133 ساعة)');
  // التعديل الوحيد: ملاحظة اختلاف متطلب اللغة الإنجليزية (2) محفوظ كما ورد (يوجد في أمن المعلومات فقط)

  // خطة سابقة تجريبية (افتراضية بالكامل) لاختبار الانتقال بين الخطط
  const legacy: PlanVersion = JSON.parse(JSON.stringify(sec));
  legacy.id = 3;
  legacy.label = 'خطة سابقة تجريبية – أمن المعلومات (بيانات افتراضية)';
  legacy.status = 'demo';
  legacy.isDemo = true;
  legacy.effectiveFromYear = 2017;
  legacy.effectiveToYear = 2020;
  legacy.sourceNote = 'خطة افتراضية لأغراض الاختبار فقط، لا تمثل خطة حقيقية لجامعة خضوري.';
  legacy.courses = legacy.courses.map((c) => (c.code === '19011300' ? { ...c, code: '99011300', nameAr: 'برمجة الويب (مساق تجريبي من خطة سابقة)' } : c));
  legacy.courses.push({ code: '99011299', nameAr: 'مهارات مكتبية متقدمة (مساق تجريبي من خطة سابقة)', credits: 3, category: 'MAJ_ELEC', suggestedYear: null, suggestedTerm: null });
  legacy.prerequisites = legacy.prerequisites.map((p) => (p.course === '19011300' ? { ...p, course: '99011300' } : p));
  legacy.nonCreditRequirements = legacy.nonCreditRequirements.map((n) => ({ ...n, id: 100 + Number(n.id) }));
  sec.equivalences = [{ fromCode: '99011300', toCode: '19011300', note: 'معادلة تجريبية: برمجة الويب (الخطة السابقة) ← تطوير تطبيقات الإنترنت' }];
  return [sec, itm, legacy];
}

// ---------- الفصول الأكاديمية ----------
export const CURRENT_TERM = '2026-1';
export function buildTerms(): AcademicTerm[] {
  const out: AcademicTerm[] = [];
  for (let y = 2017; y <= 2027; y++) {
    for (const t of [1, 2, 3]) {
      const tn = t === 1 ? 'الفصل الأول' : t === 2 ? 'الفصل الثاني' : 'الفصل الصيفي';
      out.push({ code: `${y}-${t}`, yearStart: y, termNo: t, nameAr: `${tn} ${y}/${y + 1}`, isCurrent: `${y}-${t}` === CURRENT_TERM });
    }
  }
  return out;
}

// ---------- الطلبة التجريبيون ----------
// خانات الخطة الاسترشادية العامة تُملأ بمساقات محددة لكل مسار (اختيارات افتراضية للطالب التجريبي)
const FILL_COMMON: Record<number, string[]> = {
  1: ['15200102', '19040115'],
  2: ['15200106', '13020026'],
  3: ['13010006', '15200101', '13020035', '19041213'],
  4: ['13010007'],
  5: ['15200104', '15200107', '13020036'],
};
const FILL_TRACK: Record<string, Record<number, string[]>> = {
  SEC: { 3: ['19011514'], 5: ['19011516'], 6: ['19011519'], 7: ['19011517'] },
  ITM: { 3: ['19011501'], 5: ['19011500'], 6: ['19011509'], 7: ['19011511'] },
};
/** ما لا توزعه الخطة الاسترشادية (9 ساعات): الإنجليزية (2) واختياريّا تخصص */
const EXTRA: Record<string, string[]> = { SEC: ['15200112', '19011515', '19011520'], ITM: ['15200112', '19011512', '19011502'] };

export function slotCourses(plan: PlanVersion, slot: number): string[] {
  const year = Math.floor(slot / 2) + 1, term = (slot % 2) + 1;
  const placed = plan.courses.filter((c) => c.suggestedYear === year && c.suggestedTerm === term).map((c) => c.code);
  return [...placed, ...(FILL_COMMON[slot] ?? []), ...(FILL_TRACK[plan.trackCode]?.[slot] ?? [])];
}
const termOf = (enroll: number, slot: number) => `${enroll + Math.floor(slot / 2)}-${(slot % 2) + 1}`;

// مولد علامات حتمي (للتكرار)
function grade(seed: string, pass = true) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pass ? 65 + (h % 31) : 40 + (h % 15);
}

export interface DemoStudent {
  profile: StudentProfile;
  records: CourseRecord[];
  registrations: Registration[];
  nonCredit: { code: string; status: 'met' | 'not_met' | 'in_progress' }[];
  scenario: string;
}

export function buildStudents(plans: PlanVersion[]): DemoStudent[] {
  const plan = (t: string) => plans.find((p) => p.trackCode === t && !p.isDemo)!;
  const credits = (code: string) => plans.flatMap((p) => p.courses).find((c) => c.code === code)?.credits ?? 3;
  const nameOf = (code: string) => plans.flatMap((p) => p.courses).find((c) => c.code === code)?.nameAr ?? code;
  const rec = (code: string, term: string, status: RecordStatus | null = 'passed', g?: number | null): CourseRecord => ({
    courseCode: code, courseNameAr: nameOf(code), credits: credits(code), termCode: term, status,
    grade: g === undefined ? grade(code + term, status !== 'failed') : g,
  });
  const passSlots = (t: string, enroll: number, upto: number, except: string[] = []) => {
    const out: CourseRecord[] = [];
    for (let s = 0; s < upto; s++) for (const c of slotCourses(plan(t), s)) if (!except.includes(c)) out.push(rec(c, termOf(enroll, s)));
    return out;
  };
  const reg = (codes: string[]) => codes.map((c) => ({ courseCode: c, termCode: CURRENT_TERM }));
  const gpa = (rs: CourseRecord[]) => {
    const g = rs.filter((r) => r.grade != null && r.status !== 'withdrawn');
    if (!g.length) return null;
    const w = g.reduce((s, r) => s + (r.credits ?? 3), 0);
    return Math.round((g.reduce((s, r) => s + (r.grade ?? 0) * (r.credits ?? 3), 0) / w) * 10) / 10;
  };
  const P = (o: Partial<StudentProfile> & Pick<StudentProfile, 'id' | 'universityId' | 'nameAr' | 'trackCode' | 'enrollmentYear' | 'academicYearLevel'>): StudentProfile => ({
    gpa: null, recordComplete: true, officialStatus: 'active', isDemo: true, dataSource: 'demo', planVersionId: null, planAssignmentNote: null, ...o,
  });
  const S: DemoStudent[] = [];

  // 1) سنة أولى لم يجتز أي مساق
  S.push({ scenario: 'سنة أولى – لم يجتز أي مساق بعد (أمن المعلومات)', profile: P({ id: 1, universityId: '202690001', nameAr: 'طالب تجريبي ١ – سنة أولى', trackCode: 'SEC', enrollmentYear: 2026, academicYearLevel: 1 }), records: [], registrations: reg(slotCourses(plan('SEC'), 0)), nonCredit: [] });

  // 2) سنة ثانية اجتاز بعض المساقات الأساسية (إدارة تكنولوجيا المعلومات)
  {
    const r = [...passSlots('ITM', 2025, 1), rec('19040113', '2025-2'), rec('15200099', '2025-2'), rec('15020101', '2025-2'), rec('15200102', '2025-2'), rec('15010102', '2025-2', 'failed')];
    S.push({ scenario: 'سنة ثانية – اجتاز بعض المساقات الأساسية ورسب في تفاضل وتكامل (2)', profile: P({ id: 2, universityId: '202590002', nameAr: 'طالبة تجريبية ٢ – سنة ثانية', trackCode: 'ITM', enrollmentYear: 2025, academicYearLevel: 2, gpa: gpa(r) }), records: r, registrations: reg(['19011200', '19011201', '19011203', '15200106', '15010102']), nonCredit: [] });
  }
  // 3) سنة ثالثة لديه مساق راسب يمنع تسجيل مساقات متقدمة
  {
    const r = [...passSlots('SEC', 2024, 4, ['19011202']), rec('19011202', '2025-2', 'failed')];
    S.push({ scenario: 'سنة ثالثة – رسب في تركيب البيانات فحُجبت المساقات المتقدمة (أمن المعلومات)', profile: P({ id: 3, universityId: '202490003', nameAr: 'طالب تجريبي ٣ – سنة ثالثة متعثر', trackCode: 'SEC', enrollmentYear: 2024, academicYearLevel: 3, gpa: gpa(r) }), records: r, registrations: reg(['19041224', '13010007', '15200112']), nonCredit: [] });
  }
  // 4) سنة رابعة لديه متطلبات تخرج متبقية
  {
    const r = passSlots('ITM', 2023, 6);
    S.push({ scenario: 'سنة رابعة – متطلبات تخرج متبقية (إدارة تكنولوجيا المعلومات)', profile: P({ id: 4, universityId: '202390004', nameAr: 'طالبة تجريبية ٤ – سنة رابعة', trackCode: 'ITM', enrollmentYear: 2023, academicYearLevel: 4, gpa: gpa(r) }), records: r, registrations: reg(slotCourses(plan('ITM'), 6)), nonCredit: [{ code: 'FIELD_TRAINING', status: 'not_met' }] });
  }
  // 5) اجتاز جميع المساقات لكن متطلب آخر غير مستوفى (التدريب الميداني)
  {
    const r = [...passSlots('SEC', 2022, 8), ...EXTRA.SEC.map((c) => rec(c, '2025-3'))];
    S.push({ scenario: 'اجتاز جميع المساقات لكن التدريب الميداني غير مستوفى (أمن المعلومات)', profile: P({ id: 5, universityId: '202290005', nameAr: 'طالب تجريبي ٥ – أنهى المساقات', trackCode: 'SEC', enrollmentYear: 2022, academicYearLevel: 5, gpa: gpa(r) }), records: r, registrations: [], nonCredit: [{ code: 'FIELD_TRAINING', status: 'not_met' }] });
  }
  // 6) مسار أمن المعلومات – منتظم
  {
    const r = passSlots('SEC', 2024, 4);
    S.push({ scenario: 'مسار أمن المعلومات – سنة ثالثة منتظم في الخطة', profile: P({ id: 6, universityId: '202490006', nameAr: 'طالبة تجريبية ٦ – أمن المعلومات', trackCode: 'SEC', enrollmentYear: 2024, academicYearLevel: 3, gpa: gpa(r) }), records: r, registrations: reg(slotCourses(plan('SEC'), 4)), nonCredit: [] });
  }
  // 7) مسار إدارة تكنولوجيا المعلومات – منتظم
  {
    const r = passSlots('ITM', 2024, 4);
    S.push({ scenario: 'مسار إدارة تكنولوجيا المعلومات – سنة ثالثة منتظم في الخطة', profile: P({ id: 7, universityId: '202490007', nameAr: 'طالب تجريبي ٧ – إدارة تكنولوجيا المعلومات', trackCode: 'ITM', enrollmentYear: 2024, academicYearLevel: 3, gpa: gpa(r) }), records: r, registrations: reg(slotCourses(plan('ITM'), 4)), nonCredit: [] });
  }
  // 8) سجل أكاديمي ناقص
  {
    const r = [...passSlots('ITM', 2024, 1), rec('19040113', '2025-2', null, 71)];
    S.push({ scenario: 'سجل أكاديمي ناقص (إدارة تكنولوجيا المعلومات)', profile: P({ id: 8, universityId: '202490008', nameAr: 'طالبة تجريبية ٨ – سجل ناقص', trackCode: 'ITM', enrollmentYear: 2024, academicYearLevel: 3, gpa: null, recordComplete: false }), records: r, registrations: [], nonCredit: [] });
  }
  // 9) انتقل إلى خطة مختلفة (التحق 2020 بخطة سابقة ثم نُقل للخطة الحالية)
  {
    const r: CourseRecord[] = [];
    for (let s = 0; s < 7; s++) for (const c of slotCourses(plan('SEC'), s)) r.push(rec(c === '19011300' ? '99011300' : c, termOf(2020, s)));
    r.push({ courseCode: '99011299', courseNameAr: 'مهارات مكتبية متقدمة (مساق تجريبي من خطة سابقة)', credits: 3, termCode: '2021-2', status: 'passed', grade: 77 });
    r.push(rec('15200112', '2024-1'));
    S.push({ scenario: 'التحق عام 2020 بخطة سابقة ثم نُقل إلى الخطة الحالية مع معادلة مساق', profile: P({ id: 9, universityId: '202090009', nameAr: 'طالب تجريبي ٩ – منقول بين الخطط', trackCode: 'SEC', enrollmentYear: 2020, academicYearLevel: 4, gpa: gpa(r), planVersionId: 1, planAssignmentNote: 'نُقل من الخطة السابقة إلى الخطة الحالية بقرار القسم – بيانات تجريبية' }), records: r, registrations: reg(slotCourses(plan('SEC'), 7)), nonCredit: [{ code: 'FIELD_TRAINING', status: 'met' }] });
  }
  // 10) أعاد دراسة مساق رسب فيه
  {
    const r = [...passSlots('ITM', 2024, 2), ...slotCourses(plan('ITM'), 2).filter((c) => c !== '19011200').map((c) => rec(c, '2025-1')), rec('19011200', '2025-1', 'failed', 52), rec('19011200', '2025-2', 'passed', 71), ...slotCourses(plan('ITM'), 3).filter((c) => c !== '19011202').map((c) => rec(c, '2025-2'))];
    S.push({ scenario: 'أعاد دراسة البرمجة الكينونية بعد الرسوب ونجح (تُحتسب مرة واحدة)', profile: P({ id: 10, universityId: '202490010', nameAr: 'طالبة تجريبية ١٠ – أعادت مساقًا', trackCode: 'ITM', enrollmentYear: 2024, academicYearLevel: 3, gpa: gpa(r) }), records: r, registrations: reg(['19011202', '19041224', '13010007', '15200112']), nonCredit: [] });
  }
  // 11) متوقع التخرج
  {
    const r = [...passSlots('ITM', 2022, 7), ...EXTRA.ITM.map((c) => rec(c, '2025-3'))];
    S.push({ scenario: 'متوقع التخرج – المتبقي مسجل حاليًا (إدارة تكنولوجيا المعلومات)', profile: P({ id: 11, universityId: '202290011', nameAr: 'طالب تجريبي ١١ – متوقع التخرج', trackCode: 'ITM', enrollmentYear: 2022, academicYearLevel: 4, gpa: gpa(r), officialStatus: 'expected_graduate' }), records: r, registrations: reg(slotCourses(plan('ITM'), 7)), nonCredit: [{ code: 'FIELD_TRAINING', status: 'met' }] });
  }
  // 12) خريج فعلي (مثبت في السجل)
  {
    const r = [...passSlots('SEC', 2021, 8), ...EXTRA.SEC.map((c) => rec(c, '2024-3'))];
    S.push({ scenario: 'خريج فعلي مثبت في سجل الجامعة (أمن المعلومات)', profile: P({ id: 12, universityId: '202190012', nameAr: 'طالبة تجريبية ١٢ – خريجة', trackCode: 'SEC', enrollmentYear: 2021, academicYearLevel: 5, gpa: gpa(r), officialStatus: 'graduated' }), records: r, registrations: [], nonCredit: [{ code: 'FIELD_TRAINING', status: 'met' }] });
  }
  return S;
}

export const DEMO_STUDENT_PASSWORD = 'Demo@2026';
export const DEMO_ADMIN = { username: 'admin', password: 'Admin@2026' };

/** للاختبارات: كل مساق في خطة */
export const planCourse = (p: PlanVersion, code: string): PlanCourse | undefined => p.courses.find((c) => c.code === code);
