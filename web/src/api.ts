// عميل الواجهة البرمجية. في نسخة العرض المستقلة (__DEMO__) يُستبدل الخادم بمحاكٍ داخل المتصفح
import type { AdvisingReport } from '../../shared/src/types';
import type { AssistantAnswer } from '../../shared/src/assistant';

declare const __DEMO__: boolean;
export const IS_DEMO_BUILD = typeof __DEMO__ !== 'undefined' && __DEMO__;

export interface User { id: number; username: string; role: 'student' | 'admin'; studentId: number | null; displayName: string | null; csrf: string; mustChangePassword?: boolean }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

let csrf = '';
export const setCsrf = (t: string) => { csrf = t; };

async function serverCall(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(method !== 'GET' ? { 'x-csrf-token': csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* لا محتوى */ }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `خطأ ${res.status}`);
  return data;
}

export const call = async (method: string, path: string, body?: unknown) => {
  if (IS_DEMO_BUILD) { const m = await import('./demoBackend'); return m.demoCall(method, path, body); }
  return serverCall(method, path, body);
};
const G = (p: string) => call('GET', p);
const P = (p: string, b?: unknown) => call('POST', p, b ?? {});
const U = (p: string, b?: unknown) => call('PUT', p, b ?? {});
const PA = (p: string, b?: unknown) => call('PATCH', p, b ?? {});
const D = (p: string) => call('DELETE', p);

export const api = {
  me: async (): Promise<User | null> => { try { const r = await G('/auth/me'); setCsrf(r.user.csrf); return r.user; } catch { return null; } },
  login: async (username: string, password: string): Promise<User> => { const r = await P('/auth/login', { username, password }); setCsrf(r.user.csrf); return r.user; },
  logout: () => P('/auth/logout'),
  changePassword: async (currentPassword: string, newPassword: string): Promise<User> => { const r = await P('/auth/change-password', { currentPassword, newPassword }); return r.user; },
  info: () => G('/public/info'),
  student: {
    report: (): Promise<AdvisingReport> => G('/student/report'),
    records: () => G('/student/records'),
    ask: (question: string): Promise<AssistantAnswer> => P('/student/assistant', { question }),
  },
  admin: {
    overview: () => G('/admin/overview'),
    tracks: () => G('/admin/tracks'),
    updateTrack: (id: number, b: unknown) => U(`/admin/tracks/${id}`, b),
    plans: () => G('/admin/plans'),
    plan: (id: number) => G(`/admin/plans/${id}`),
    patchPlan: (id: number, b: unknown) => PA(`/admin/plans/${id}`, b),
    clonePlan: (id: number, b: unknown) => P(`/admin/plans/${id}/clone`, b),
    deletePlan: (id: number) => D(`/admin/plans/${id}`),
    importPlan: (b: unknown) => P('/admin/plans/import', b),
    addPlanCourse: (id: number, b: unknown) => P(`/admin/plans/${id}/courses`, b),
    patchPlanCourse: (id: number, code: string, b: unknown) => PA(`/admin/plans/${id}/courses/${code}`, b),
    removePlanCourse: (id: number, code: string) => D(`/admin/plans/${id}/courses/${code}`),
    addRequisite: (id: number, b: { course: string; requires: string; type: 'pre' | 'co' }) => P(`/admin/plans/${id}/requisites`, b),
    removeRequisite: (id: number, b: { course: string; requires: string; type: 'pre' | 'co' }) => D(`/admin/plans/${id}/requisites?course=${b.course}&requires=${b.requires}&type=${b.type}`),
    putCategory: (id: number, cat: string, b: unknown) => U(`/admin/plans/${id}/categories/${cat}`, b),
    addRequirement: (id: number, b: unknown) => P(`/admin/plans/${id}/requirements`, b),
    removeRequirement: (id: number, rid: number | string) => D(`/admin/plans/${id}/requirements/${rid}`),
    courses: (q = '') => G(`/admin/courses?q=${encodeURIComponent(q)}`),
    createCourse: (b: unknown) => P('/admin/courses', b),
    patchCourse: (code: string, b: unknown) => PA(`/admin/courses/${code}`, b),
    terms: () => G('/admin/terms'),
    createTerm: (b: unknown) => P('/admin/terms', b),
    setCurrentTerm: (code: string) => P(`/admin/terms/${code}/current`),
    offerings: (code: string) => G(`/admin/terms/${code}/offerings`),
    setOfferings: (code: string, codes: string[]) => U(`/admin/terms/${code}/offerings`, { codes }),
    rules: () => G('/admin/rules'),
    putRule: (key: string, value: unknown) => U(`/admin/rules/${key}`, { value }),
    students: (q = '') => G(`/admin/students?q=${encodeURIComponent(q)}`),
    student: (id: number) => G(`/admin/students/${id}`),
    createStudent: (b: unknown) => P('/admin/students', b),
    patchStudent: (id: number, b: unknown) => PA(`/admin/students/${id}`, b),
    resetPassword: (id: number, password: string) => P(`/admin/students/${id}/password`, { password }),
    addRecord: (id: number, b: unknown) => P(`/admin/students/${id}/records`, b),
    deleteRecord: (id: number, rid: number) => D(`/admin/students/${id}/records/${rid}`),
    addRegistration: (id: number, b: unknown) => P(`/admin/students/${id}/registrations`, b),
    deleteRegistration: (id: number, rid: number) => D(`/admin/students/${id}/registrations/${rid}`),
    setRequirement: (id: number, code: string, status: string) => U(`/admin/students/${id}/requirements/${code}`, { status }),
    importRecords: (csv: string, dryRun: boolean) => P('/admin/import/records', { csv, dryRun }),
    importStudents: (csv: string, dryRun: boolean) => P('/admin/import/students', { csv, dryRun }),
    importRegistrations: (csv: string, dryRun: boolean) => P('/admin/import/registrations', { csv, dryRun }),
    reports: () => G('/admin/reports'),
    audit: () => G('/admin/audit'),
    errors: () => G('/admin/errors'),
    integration: () => G('/admin/integration'),
    sync: (id: number) => P(`/admin/integration/sync/${id}`),
  },
};
