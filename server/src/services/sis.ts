/**
 * طبقة التكامل مع نظام معلومات الطلبة (SIS)
 * لا يدّعي النظام وجود اتصال بنظام الجامعة. التكامل معطل حتى تتوفر واجهة رسمية مصرح بها.
 * لتفعيله: نفّذ واجهة SisAdapter وفق توثيق الجامعة، واضبط SIS_BASE_URL و SIS_API_KEY.
 */
import { config } from '../config';
import type { CourseRecord, Registration } from '../../../shared/src/types';

export interface SisStudent {
  universityId: string;
  nameAr: string;
  trackCode: 'SEC' | 'ITM';
  enrollmentYear: number;
  academicYearLevel: number;
  gpa: number | null;
  officialStatus: 'active' | 'expected_graduate' | 'graduated';
}

export interface SisAdapter {
  name: string;
  isConfigured(): boolean;
  fetchStudent(universityId: string): Promise<SisStudent>;
  fetchRecords(universityId: string): Promise<CourseRecord[]>;
  fetchRegistrations(universityId: string, termCode: string): Promise<Registration[]>;
}

export class NotConfiguredError extends Error {
  status = 501;
  constructor() { super('التكامل مع نظام معلومات الطلبة غير مفعّل. البيانات الحالية تجريبية أو مُدخلة يدويًا/مستوردة من لوحة الإدارة.'); }
}

/** هيكل جاهز لواجهة REST؛ أسماء المسارات افتراضية ويجب مطابقتها مع توثيق الجامعة الرسمي */
export class RestSisAdapter implements SisAdapter {
  name = 'rest';
  isConfigured() { return !!config.sis.baseUrl && !!config.sis.apiKey; }
  private async get(path: string) {
    if (!this.isConfigured()) throw new NotConfiguredError();
    const r = await fetch(new URL(path, config.sis.baseUrl), { headers: { authorization: `Bearer ${config.sis.apiKey}`, accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Object.assign(new Error(`SIS HTTP ${r.status}`), { status: 502 });
    return r.json();
  }
  async fetchStudent(id: string): Promise<SisStudent> { return this.map(await this.get(`/students/${encodeURIComponent(id)}`)); }
  async fetchRecords(id: string): Promise<CourseRecord[]> { return (await this.get(`/students/${encodeURIComponent(id)}/transcript`)) as CourseRecord[]; }
  async fetchRegistrations(id: string, term: string): Promise<Registration[]> { return (await this.get(`/students/${encodeURIComponent(id)}/registrations?term=${term}`)) as Registration[]; }
  private map(x: any): SisStudent { return x as SisStudent; } // يُستبدل بتحويل فعلي وفق صيغة الجامعة
}

export const sis: SisAdapter = new RestSisAdapter();

export const INTEGRATION_REQUIREMENTS = [
  'موافقة رسمية من الجامعة وتحديد الجهة المالكة للبيانات وسياسة الخصوصية.',
  'واجهة برمجية (API) أو ملف تصدير دوري موثق من نظام معلومات الطلبة يتضمن: بيانات الطالب، كشف العلامات بحالة كل محاولة، التسجيل الحالي، حالة المتطلبات غير الساعية.',
  'آلية مصادقة للخدمة (مفتاح أو OAuth2 Client Credentials) وقناة اتصال مشفرة (HTTPS).',
  'ربط تسجيل دخول الطلبة بنظام الهوية الجامعي (SSO مثل SAML/OIDC) بدل كلمات المرور المحلية.',
  'اعتماد الخطط الدراسية الرسمية لكل مسار مع سنوات تطبيقها، وسياسات: علامة النجاح، احتساب الإعادة، الحد الأقصى للعبء، شروط التخرج.',
  'بيانات طرح المساقات لكل فصل (اختياري لكنه يحسن دقة التوصيات).',
];
