import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../App';

export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const { user, setUser, logout, notify } = useAuth();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const rules = [
    { ok: next.length >= 8, t: '8 أحرف على الأقل' },
    { ok: /[A-Za-z]/.test(next) && /[0-9]/.test(next), t: 'تحتوي حروفًا إنجليزية وأرقامًا' },
    { ok: !!next && !!user && !next.includes(user.username), t: 'لا تحتوي الرقم الجامعي' },
    { ok: !!next && next === again, t: 'التأكيد مطابق' },
  ];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!rules.every((r) => r.ok)) { setErr('كلمة المرور الجديدة لا تستوفي الشروط.'); return; }
    setBusy(true);
    try {
      const u = await api.changePassword(cur, next);
      setUser({ ...user!, ...u });
      notify('تم تغيير كلمة المرور');
      setCur(''); setNext(''); setAgain('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const body = (
    <form onSubmit={submit} className="panel w-full max-w-md space-y-4 p-6" noValidate>
      <div>
        <h1 className="text-2xl font-bold text-olive-deep">{forced ? 'اختر كلمة مرور جديدة' : 'تغيير كلمة المرور'}</h1>
        {forced && <p className="mt-1 text-sm text-muted">هذه أول مرة تدخل فيها، أو أعادت الإدارة تعيين كلمة مرورك. اختر كلمة مرور خاصة بك للمتابعة.</p>}
      </div>
      <div><label className="label" htmlFor="cp">كلمة المرور الحالية{forced && ' (الأولية)'}</label><input id="cp" className="input" type="password" autoComplete="current-password" dir="ltr" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
      <div><label className="label" htmlFor="np">كلمة المرور الجديدة</label><input id="np" className="input" type="password" autoComplete="new-password" dir="ltr" value={next} onChange={(e) => setNext(e.target.value)} /></div>
      <div><label className="label" htmlFor="np2">تأكيد كلمة المرور الجديدة</label><input id="np2" className="input" type="password" autoComplete="new-password" dir="ltr" value={again} onChange={(e) => setAgain(e.target.value)} /></div>
      <ul className="space-y-1 text-sm">{rules.map((r) => <li key={r.t} className={r.ok ? 'text-pass' : 'text-muted'}>{r.ok ? '✓' : '○'} {r.t}</li>)}</ul>
      {err && <p className="rounded-lg border border-fail/40 bg-fail/[0.06] p-3 text-sm text-fail" role="alert">{err}</p>}
      <button className="btn-primary w-full py-2.5" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}</button>
      {forced && <button type="button" className="btn-ghost w-full" onClick={logout}>تسجيل الخروج</button>}
    </form>
  );
  return forced ? <div className="flex min-h-screen items-center justify-center p-4">{body}</div> : body;
}
