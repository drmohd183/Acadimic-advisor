import { describe, it, expect } from 'vitest';
import { buildPlans, buildStudents, buildTerms } from '../shared/src/seedData';
import { runAdvising } from '../shared/src/engine';
import { checkCourse, retakePlan, findCourseByQuery } from '../shared/src/courseCheck';
import { DEFAULT_RULES } from '../shared/src/types';

const plans = buildPlans(); const terms = buildTerms(); const students = buildStudents(plans);
const rep = (uid: string) => { const s = students.find((x) => x.profile.universityId === uid)!; return runAdvising({ student: s.profile, plans: plans.filter((p) => p.trackCode === s.profile.trackCode || p.id === s.profile.planVersionId), records: s.records, registrations: s.registrations, terms, rules: DEFAULT_RULES, nonCreditStatus: s.nonCredit }); };

describe('فحص تسجيل مساق', () => {
  const r = rep('202490003');
  it('مساق محجوب: يذكر المتطلب الراسب ويقترح البدء به', () => {
    const c = checkCourse(r, '19011304');
    expect(c.verdict).toBe('cannot');
    expect(c.reasons.join(' ')).toContain('19011202');
    expect(c.reasons.join(' ')).toContain('رسبت');
    expect(c.steps[0]).toContain('تركيب البيانات');
    expect(c.chain.map((x) => x.code)).toContain('19011202');
  });
  it('سلسلة طويلة: هندسة البرمجيات تقترح البدء بأول متاح في السلسلة', () => {
    const c = checkCourse(r, '19011407');
    expect(c.verdict).toBe('cannot');
    expect(c.steps.join(' ')).toContain('19011202');
  });
  it('مساق راسب متاح للإعادة', () => {
    const c = checkCourse(r, '19011202');
    expect(c.verdict).toBe('can');
    expect(c.inPackage).toBe(true);
  });
  it('مساق مجتاز ومساق مسجل', () => {
    expect(checkCourse(r, '19040112').verdict).toBe('done');
    expect(checkCourse(r, '19041224').verdict).toBe('registered');
  });
  it('مساق من خارج الخطة أو من المسار الآخر', () => {
    expect(checkCourse(r, '19011501').verdict).toBe('not_in_plan');
  });
  it('مساق مشروط بنتيجة الفصل الحالي', () => {
    const c = checkCourse(rep('202590002'), '19011202');
    expect(c.verdict).toBe('conditional');
    expect(c.reasons[0]).toContain('19011200');
  });
  it('اختياري من فئة مكتملة: يُسمح مع تنبيه بأنه لا يُحتسب', () => {
    const c = checkCourse(rep('202290005'), '19011518');
    expect(c.verdict).toBe('can');
    expect(c.title).toContain('لن يُحتسب');
  });
  it('البحث بالاسم أو الرقم وبتطبيع الهمزات', () => {
    expect(findCourseByQuery(r, '19011304')[0].code).toBe('19011304');
    expect(findCourseByQuery(r, 'قواعد البيانات')[0].code).toBe('19011304');
    expect(findCourseByQuery(r, 'امن الشبكات')[0].code).toBe('19011515');
  });
});

describe('خطة إعادة المساقات الراسبة', () => {
  it('متاح للإعادة في الفصل القادم', () => {
    const p = retakePlan(rep('202490003'));
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ code: '19011202', tone: 'now', failedIn: '2025-2' });
    expect(p[0].when).toContain('الفصل الثاني 2026/2027');
  });
  it('يعيده حاليًا', () => {
    expect(retakePlan(rep('202590002'))[0].tone).toBe('registered');
  });
  it('مساق راسب ثم اجتيز لا يظهر', () => {
    expect(retakePlan(rep('202490010'))).toHaveLength(0);
  });
});
