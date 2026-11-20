import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';
import { buildPlans, buildStudents, DEMO_ADMIN, DEMO_STUDENT_PASSWORD } from '../../../shared/src/seedData';

const DEMO_ACCOUNTS = buildStudents(buildPlans()).map((s) => ({ id: s.profile.universityId, scenario: s.scenario }));

export function LoginPage() {
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'demo' | 'production' | null>(null);
  const [term, setTerm] = useState<string | null>(null);

  useEffect(() => { api.info().then((i) => { setMode(i.mode); setTerm(i.currentTerm?.name_ar ?? null); }).catch(() => setMode(null)); }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!username.trim() || !password) { setErr('أدخل الرقم الجامعي وكلمة المرور.'); return; }
    setBusy(true);
    try {
      const u = await api.login(username.trim(), password);
      setUser(u);
      nav(u.role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const fill = (u: string, p: string) => { setU(u); setP(p); setErr(''); };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm">
          <svg viewBox="0 0 32 32" className="h-12 w-12" aria-hidden><rect width="32" height="32" rx="9" className="fill-olive" /><path d="M8 21.5h16M10 21.5V13m4 8.5V11m4 10.5v-7m4 7V9" stroke="white" strokeWidth="2.2" strokeLinecap="round" /></svg>
          <h1 className="mt-5 text-3xl font-bold text-olive-deep">المرشد الأكاديمي الذكي</h1>
          <p className="mt-1 text-muted">قسم نظم المعلومات – جامعة فلسطين التقنية خضوري</p>
          <p className="mt-1 text-xs text-muted">مشروع تطبيقي غير رسمي، ولا يمثل نظامًا معتمدًا من الجامعة.</p>
          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <div>
              <label className="label" htmlFor="u">الرقم الجامعي</label>
              <input id="u" className="input code text-start" inputMode="numeric" autoComplete="username" value={username} onChange={(e) => setU(e.target.value)} dir="ltr" />
            </div>
            <div>
              <label className="label" htmlFor="p">كلمة المرور</label>
              <input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} dir="ltr" />
            </div>
            {err && <p className="rounded-lg border border-fail/40 bg-fail/[0.06] p-3 text-sm text-fail" role="alert">{err}</p>}
            <button className="btn-primary w-full py-2.5 text-base" disabled={busy}>{busy ? 'جارٍ التحقق…' : 'تسجيل الدخول'}</button>
          </form>
          {term && <p className="mt-6 text-xs text-muted">الفصل الحالي في النظام: {term}</p>}
        </div>
      </div>
      <div className="border-t border-line bg-olive-soft/60 p-6 sm:p-10 lg:border-e lg:border-t-0">
        <div className="mx-auto max-w-xl">
          <h2 className="text-xl font-semibold text-olive-deep">ماذا يفعل المرشد؟</h2>
          <p className="mt-2 text-[15px] leading-8">
            يقرأ سجلك الأكاديمي ويقارنه بخطتك الدراسية، فيقترح مساقات الفصل القادم التي استوفيت متطلباتها، ويشرح سبب كل اقتراح، ويحسب ما تبقى عليك حتى التخرج.
            لا يقترح مساقًا لم تستوفِ متطلبه السابق، ويخبرك صراحة عندما تكون البيانات غير كافية.
          </p>
          {mode === 'demo' && (
            <div className="mt-8">
              <h3 className="text-base font-semibold">حسابات تجريبية</h3>
              <p className="mt-1 text-sm text-muted">بيانات افتراضية بالكامل لاختبار السيناريوهات. كلمة مرور الطلبة: <span className="code">{DEMO_STUDENT_PASSWORD}</span></p>
              <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                {DEMO_ACCOUNTS.map((a) => (
                  <li key={a.id}>
                    <button type="button" onClick={() => fill(a.id, DEMO_STUDENT_PASSWORD)} className="flex w-full items-start gap-3 px-3 py-2 text-start text-sm hover:bg-paper">
                      <span className="code mt-0.5 shrink-0 text-xs text-olive">{a.id}</span>
                      <span>{a.scenario}</span>
                    </button>
                  </li>
                ))}
                <li>
                  <button type="button" onClick={() => fill(DEMO_ADMIN.username, DEMO_ADMIN.password)} className="flex w-full items-start gap-3 px-3 py-2 text-start text-sm hover:bg-paper">
                    <span className="code mt-0.5 shrink-0 text-xs text-olive">{DEMO_ADMIN.username}</span>
                    <span>لوحة إدارة النظام (كلمة المرور: <span className="code">{DEMO_ADMIN.password}</span>)</span>
                  </button>
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
