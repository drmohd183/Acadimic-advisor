import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { HashRouter, BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import { api, IS_DEMO_BUILD, type User } from './api';
import type { AdvisingReport } from '../../shared/src/types';
import { Loading, ErrorBox, Toast } from './components/ui';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { SimpleHomePage } from './pages/SimpleHome';
import { PlanPage } from './pages/Plan';
import { RecommendationsPage } from './pages/Recommendations';
import { ProgressPage } from './pages/Progress';
import { AssistantPage } from './pages/Assistant';
import { ChangePasswordPage } from './pages/ChangePassword';
import { AdminOverview } from './pages/admin/Overview';
import { AdminStudents, AdminStudentDetail } from './pages/admin/Students';
import { AdminPlans, AdminPlanDetail } from './pages/admin/Plans';
import { AdminCourses, AdminTerms, AdminRules, AdminReports, AdminLogs, AdminIntegration } from './pages/admin/Misc';
import { YEAR_LABELS } from '../../shared/src/labels';

// ---------- سياق المصادقة ----------
interface AuthCtx { user: User | null; setUser: (u: User | null) => void; logout: () => Promise<void>; notify: (msg: string, kind?: 'ok' | 'err') => void }
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

// ---------- سياق تقرير الطالب ----------
interface ReportCtx { report: AdvisingReport; reload: () => void }
const RCtx = createContext<ReportCtx>(null!);
export const useReport = () => useContext(RCtx);

function ReportProvider({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<AdvisingReport | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { setErr(''); api.student.report().then(setReport).catch((e) => setErr(e.message)); }, []);
  useEffect(load, [load]);
  if (err) return <ErrorBox error={err} onRetry={load} />;
  if (!report) return <Loading text="يحلل المرشد سجلك الأكاديمي…" />;
  return <RCtx.Provider value={{ report, reload: load }}>{children}</RCtx.Provider>;
}

const STUDENT_NAV = [
  { to: '/', label: 'الرئيسية', end: true },
  { to: '/overview', label: 'لوحة الإنجاز' },
  { to: '/plan', label: 'الخطة الدراسية' },
  { to: '/recommendations', label: 'المساقات المقترحة' },
  { to: '/progress', label: 'التقدم الأكاديمي' },
  { to: '/assistant', label: 'المساعد الذكي' },
];
const ADMIN_NAV = [
  { to: '/admin', label: 'نظرة عامة', end: true },
  { to: '/admin/students', label: 'الطلبة والسجلات' },
  { to: '/admin/plans', label: 'الخطط الدراسية' },
  { to: '/admin/courses', label: 'دليل المساقات' },
  { to: '/admin/terms', label: 'الفصول والطرح' },
  { to: '/admin/rules', label: 'قواعد الإرشاد' },
  { to: '/admin/reports', label: 'التقارير' },
  { to: '/admin/logs', label: 'السجلات' },
  { to: '/admin/integration', label: 'التكامل' },
];

function Mark() {
  // علامة بسيطة غير رسمية (لا تستخدم شعار الجامعة)
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9 shrink-0" aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-olive" />
      <path d="M8 21.5h16M10 21.5V13m4 8.5V11m4 10.5v-7m4 7V9" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function Shell({ nav, children, subtitle }: { nav: { to: string; label: string; end?: boolean }[]; children: ReactNode; subtitle?: ReactNode }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className={`${open ? 'block' : 'hidden'} border-b border-line bg-surface lg:block lg:min-h-screen lg:border-b-0 lg:border-e`}>
        <div className="sticky top-0 p-4">
          <div className="hidden items-center gap-3 lg:flex">
            <Mark />
            <div className="leading-tight">
              <p className="font-display text-[15px] font-semibold text-olive-deep">المرشد الأكاديمي</p>
              <p className="text-xs text-muted">قسم نظم المعلومات</p>
            </div>
          </div>
          <nav className="mt-2 flex flex-col gap-0.5 lg:mt-6" aria-label="القائمة الرئيسية">
            {nav.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
                className={({ isActive }) => `rounded-lg px-3 py-2 text-[15px] ${isActive ? 'bg-olive-soft font-semibold text-olive-deep' : 'text-ink hover:bg-paper'}`}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-6 border-t border-line pt-4 text-sm">
            <p className="truncate font-medium">{user?.displayName ?? user?.username}</p>
            <p className="code text-xs text-muted" style={{ direction: 'ltr', textAlign: 'right' }}>{user?.username}</p>
            <NavLink to={user?.role === 'admin' ? '/admin/password' : '/password'} onClick={() => setOpen(false)} className="mt-3 block text-sm text-olive hover:underline">تغيير كلمة المرور</NavLink>
            <button className="btn-ghost mt-3 w-full" onClick={logout}>تسجيل الخروج</button>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2"><Mark /><span className="font-display font-semibold text-olive-deep">المرشد الأكاديمي</span></div>
          <button className="btn-ghost px-3" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'إغلاق' : 'القائمة'}</button>
        </header>
        {IS_DEMO_BUILD && (
          <div className="border-b border-avail/30 bg-avail/10 px-4 py-2 text-center text-xs text-ink">
            نسخة عرض مستقلة تعمل داخل المتصفح ببيانات تجريبية افتراضية؛ التعديلات لا تُحفظ بعد إعادة التحميل، ولا يوجد اتصال بأنظمة الجامعة.
          </div>
        )}
        {subtitle}
        <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}

function StudentHeader() {
  const { report } = useReport();
  const s = report.student;
  return (
    <div className="border-b border-line bg-surface px-4 py-3 sm:px-6">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-1 text-sm">
        <p><span className="font-semibold">{s.nameAr}</span> <span className="text-muted">– {report.plan?.trackNameAr ?? 'لا توجد خطة'} – {YEAR_LABELS[s.academicYearLevel]}</span></p>
        <p className={`tag ${report.reliability === 'final' ? 'bg-pass/10 text-pass' : report.reliability === 'unavailable' ? 'bg-fail/10 text-fail' : 'bg-avail/10 text-avail'}`}>{report.reliabilityText}</p>
      </div>
    </div>
  );
}

function StudentApp() {
  return (
    <ReportProvider>
      <Shell nav={STUDENT_NAV} subtitle={<StudentHeader />}>
        <Routes>
          <Route path="/" element={<SimpleHomePage />} />
          <Route path="/overview" element={<DashboardPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="/recommendations" element={<RecommendationsPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/password" element={<ChangePasswordPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Shell>
    </ReportProvider>
  );
}

function AdminApp() {
  return (
    <Shell nav={ADMIN_NAV}>
      <Routes>
        <Route path="/admin" element={<AdminOverview />} />
        <Route path="/admin/students" element={<AdminStudents />} />
        <Route path="/admin/students/:id" element={<AdminStudentDetail />} />
        <Route path="/admin/plans" element={<AdminPlans />} />
        <Route path="/admin/plans/:id" element={<AdminPlanDetail />} />
        <Route path="/admin/courses" element={<AdminCourses />} />
        <Route path="/admin/terms" element={<AdminTerms />} />
        <Route path="/admin/rules" element={<AdminRules />} />
        <Route path="/admin/reports" element={<AdminReports />} />
        <Route path="/admin/logs" element={<AdminLogs />} />
        <Route path="/admin/integration" element={<AdminIntegration />} />
        <Route path="/admin/password" element={<ChangePasswordPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </Shell>
  );
}

function Root() {
  const { user } = useAuth();
  if (!user) return <Routes><Route path="*" element={<LoginPage />} /></Routes>;
  if (user.mustChangePassword) return <ChangePasswordPage forced />;
  return user.role === 'admin' ? <AdminApp /> : <StudentApp />;
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [toast, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  useEffect(() => { api.me().then(setUser); }, []);
  const logout = async () => { try { await api.logout(); } finally { setUser(null); } };
  if (user === undefined) return <Loading />;
  return (
    <Ctx.Provider value={{ user, setUser, logout, notify: (msg, kind = 'ok') => setToast({ msg, kind }) }}>
      {children}
      {toast && <Toast msg={toast.msg} kind={toast.kind} onDone={() => setToast(null)} />}
    </Ctx.Provider>
  );
}

export function RedirectHome() {
  const nav = useNavigate();
  const { user } = useAuth();
  useEffect(() => { nav(user?.role === 'admin' ? '/admin' : '/', { replace: true }); }, [user, nav]);
  return null;
}

export default function App() {
  const Router = IS_DEMO_BUILD ? HashRouter : BrowserRouter;
  return (
    <Router>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </Router>
  );
}
