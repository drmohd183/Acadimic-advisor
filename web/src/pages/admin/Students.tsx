import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../App';
import { useLoad } from '../../components/useLoad';
import { Loading, ErrorBox, Section, Code, Empty, PriorityTag, AlertItem } from '../../components/ui';
import { YEAR_LABELS, RECORD_STATUS_LABELS, GRAD_STATE_LABELS } from '../../../../shared/src/labels';

const OFFICIAL: Record<string, string> = { active: 'منتظم', expected_graduate: 'متوقع التخرج (من السجل)', graduated: 'خريج (من السجل)' };

export function AdminStudents() {
  const [q, setQ] = useState('');
  const [show, setShow] = useState(false);
  const { data, err, reload } = useLoad(() => api.admin.students(q), [q]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-olive-deep">الطلبة والسجلات الأكاديمية</h1>
          <p className="mt-1 text-sm text-muted">كل عملية عرض أو تعديل تُسجَّل في سجل العمليات.</p>
        </div>
        <button className="btn-primary" onClick={() => setShow((s) => !s)}>{show ? 'إلغاء' : 'إضافة طالب'}</button>
      </div>
      {show && <NewStudent onDone={() => { setShow(false); reload(); }} />}
      <input className="input max-w-sm" placeholder="ابحث بالرقم الجامعي أو الاسم" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
      {err ? <ErrorBox error={err} onRetry={reload} /> : !data ? <Loading /> : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="border-b border-line"><tr><th className="th">الرقم الجامعي</th><th className="th">الاسم</th><th className="th">المسار</th><th className="th">السنة</th><th className="th">الالتحاق</th><th className="th">السجل</th><th className="th">السيناريو</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.map((s: any) => (
                <tr key={s.id} className="hover:bg-paper">
                  <td className="td"><Link className="code font-medium text-olive hover:underline" to={`/admin/students/${s.id}`}>{s.university_id}</Link></td>
                  <td className="td">{s.name_ar} {s.is_demo && <span className="tag bg-avail/10 text-avail">تجريبي</span>}</td>
                  <td className="td text-muted">{s.track_name}</td>
                  <td className="td">{YEAR_LABELS[s.academic_year_level]}</td>
                  <td className="td num">{s.enrollment_year}</td>
                  <td className="td">{s.record_complete ? <span className="text-pass">مكتمل</span> : <span className="text-fail">ناقص</span>}</td>
                  <td className="td text-xs text-muted">{s.scenario_note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.length === 0 && <Empty>لا يوجد طلبة مطابقون.</Empty>}
        </div>
      )}
    </div>
  );
}

function NewStudent({ onDone }: { onDone: () => void }) {
  const { notify } = useAuth();
  const [f, setF] = useState({ universityId: '', nameAr: '', trackCode: 'SEC', enrollmentYear: new Date().getFullYear(), academicYearLevel: 1, password: '' });
  const [err, setErr] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr('');
    try { await api.admin.createStudent({ ...f, enrollmentYear: +f.enrollmentYear, academicYearLevel: +f.academicYearLevel }); notify('أُضيف الطالب'); onDone(); } catch (e: any) { setErr(e.message); }
  };
  return (
    <form onSubmit={submit} className="panel grid gap-3 p-4 sm:grid-cols-3">
      <div><label className="label">الرقم الجامعي</label><input className="input code" value={f.universityId} onChange={(e) => setF({ ...f, universityId: e.target.value })} required /></div>
      <div><label className="label">الاسم</label><input className="input" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} required /></div>
      <div><label className="label">المسار</label><select className="input" value={f.trackCode} onChange={(e) => setF({ ...f, trackCode: e.target.value })}><option value="SEC">أمن المعلومات</option><option value="ITM">إدارة تكنولوجيا المعلومات</option></select></div>
      <div><label className="label">سنة الالتحاق</label><input className="input num" type="number" value={f.enrollmentYear} onChange={(e) => setF({ ...f, enrollmentYear: +e.target.value })} /></div>
      <div><label className="label">السنة الدراسية</label><select className="input" value={f.academicYearLevel} onChange={(e) => setF({ ...f, academicYearLevel: +e.target.value })}>{[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{YEAR_LABELS[y]}</option>)}</select></div>
      <div><label className="label">كلمة مرور أولية</label><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="8 أحرف وأرقام" /></div>
      {err && <p className="text-sm text-fail sm:col-span-3" role="alert">{err}</p>}
      <div className="sm:col-span-3"><button className="btn-primary">حفظ الطالب</button></div>
    </form>
  );
}

export function AdminStudentDetail() {
  const sid = Number(useParams().id);
  const { notify } = useAuth();
  const { data, err, reload } = useLoad(() => api.admin.student(sid), [sid]);
  const plans = useLoad(() => api.admin.plans());
  const [rec, setRec] = useState({ courseCode: '', termCode: '', status: 'passed', grade: '' });
  const [reg, setReg] = useState({ courseCode: '' });
  if (err) return <ErrorBox error={err} onRetry={reload} />;
  if (!data) return <Loading />;
  const s = data.student, r = data.report;
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); notify(ok); reload(); } catch (e: any) { notify(e.message, 'err'); } };
  const patch = (b: unknown) => run(() => api.admin.patchStudent(sid, b), 'حُفظ التعديل وأُعيد حساب التوصيات');
  const cur = r?.currentTerm?.code ?? '';
  const reqCodes: { code: string; nameAr: string }[] = r?.graduation?.nonCredit ?? [];

  return (
    <div className="space-y-5">
      <div>
        <Link to="/admin/students" className="text-sm text-olive hover:underline">الطلبة</Link>
        <h1 className="mt-1 text-2xl font-bold text-olive-deep">{s.name_ar} <Code>{s.university_id}</Code></h1>
        <p className="text-sm text-muted">{s.scenario_note}</p>
      </div>

      <Section title="البيانات الأكاديمية">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="المسار"><select className="input" defaultValue={s.track_code} onChange={(e) => patch({ trackCode: e.target.value })}><option value="SEC">أمن المعلومات</option><option value="ITM">إدارة تكنولوجيا المعلومات</option></select></Field>
          <Field label="سنة الالتحاق"><input className="input num" type="number" defaultValue={s.enrollment_year} onBlur={(e) => +e.target.value !== s.enrollment_year && patch({ enrollmentYear: +e.target.value })} /></Field>
          <Field label="السنة الدراسية"><select className="input" defaultValue={s.academic_year_level} onChange={(e) => patch({ academicYearLevel: +e.target.value })}>{[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{YEAR_LABELS[y]}</option>)}</select></Field>
          <Field label="المعدل التراكمي"><input className="input num" type="number" step="0.1" defaultValue={s.gpa ?? ''} onBlur={(e) => patch({ gpa: e.target.value === '' ? null : +e.target.value })} /></Field>
          <Field label="اكتمال السجل"><select className="input" defaultValue={String(s.record_complete)} onChange={(e) => patch({ recordComplete: e.target.value === 'true' })}><option value="true">مكتمل</option><option value="false">ناقص</option></select></Field>
          <Field label="الحالة الرسمية (من السجل)"><select className="input" defaultValue={s.official_status} onChange={(e) => patch({ officialStatus: e.target.value })}>{Object.entries(OFFICIAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="الخطة المسندة"><select className="input" defaultValue={s.plan_version_id ?? ''} onChange={(e) => patch({ planVersionId: e.target.value ? +e.target.value : null })}>
            <option value="">تلقائي حسب سنة الالتحاق</option>
            {(plans.data ?? []).map((p: any) => <option key={p.id} value={p.id}>#{p.id} {p.label}</option>)}
          </select></Field>
          <Field label="ملاحظة الإسناد"><input className="input" defaultValue={s.plan_assignment_note ?? ''} onBlur={(e) => e.target.value !== (s.plan_assignment_note ?? '') && patch({ planAssignmentNote: e.target.value || null })} /></Field>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => { const p = prompt('كلمة المرور الجديدة (8 أحرف على الأقل، حروف وأرقام):'); if (p) run(() => api.admin.resetPassword(sid, p), 'غُيّرت كلمة المرور وأُنهيت جلسات الطالب'); }}>إعادة تعيين كلمة المرور</button>
          <button className="btn-ghost" onClick={() => run(() => api.admin.sync(sid), 'تمت المزامنة')}>مزامنة من نظام معلومات الطلبة</button>
        </div>
      </Section>

      {r && (
        <Section title="ملخص الإرشاد الآلي" aside={r.reliabilityText}>
          <p className="text-sm">الخطة: {r.plan?.label ?? 'لا توجد'} – {r.plan?.selectionReason}</p>
          <p className="mt-1 text-sm">الساعات: <span className="num">{r.credits.earned}/{r.credits.required}</span> – مسجلة <span className="num">{r.credits.registered}</span> – {GRAD_STATE_LABELS[r.graduation.state as keyof typeof GRAD_STATE_LABELS]}</p>
          <ul className="mt-3 flex flex-wrap gap-2">{r.recommendations.filter((x: any) => x.included).map((x: any, i: number) => <li key={i} className="tag border border-line bg-paper text-ink">{x.nameAr} {x.conditionalOn ? '(مشروط)' : <PriorityTag p={x.priority} />}</li>)}</ul>
          <div className="mt-3 space-y-2">{r.alerts.filter((a: any) => a.level !== 'info').map((a: any, i: number) => <AlertItem key={i} a={a} />)}</div>
        </Section>
      )}

      <Section title="المتطلبات غير الساعية">
        {reqCodes.length === 0 ? <Empty>لا توجد متطلبات غير ساعية في الخطة.</Empty> : reqCodes.map((n) => {
          const st = data.requirements.find((x: any) => x.requirement_code === n.code)?.status ?? '';
          return (
            <div key={n.code} className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{n.nameAr}</span>
              <select className="input w-auto" value={st} onChange={(e) => run(() => api.admin.setRequirement(sid, n.code, e.target.value), 'حُدثت حالة المتطلب')}>
                <option value="" disabled>لا توجد بيانات</option><option value="not_met">غير مستوفى</option><option value="in_progress">قيد الإنجاز</option><option value="met">مستوفى</option>
              </select>
            </div>
          );
        })}
      </Section>

      <Section title="المسجل في الفصل الحالي" aside={cur}>
        <ul className="divide-y divide-line text-sm">{data.registrations.map((g: any) => <li key={g.id} className="flex items-center justify-between py-1.5"><span>{g.name_ar} <Code>{g.course_code}</Code> <span className="text-muted">({g.term_code})</span></span><button className="btn-danger px-2 py-1 text-xs" onClick={() => run(() => api.admin.deleteRegistration(sid, g.id), 'حُذف التسجيل')}>حذف</button></li>)}</ul>
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api.admin.addRegistration(sid, { courseCode: reg.courseCode, termCode: cur }), 'أُضيف التسجيل'); }}>
          <input className="input code w-40" placeholder="رمز المساق" value={reg.courseCode} onChange={(e) => setReg({ courseCode: e.target.value })} />
          <button className="btn-ghost" disabled={!cur}>تسجيل في الفصل الحالي</button>
        </form>
      </Section>

      <Section title="السجل الأكاديمي" aside={`${data.records.length} سجل`}>
        <form className="mb-4 grid gap-2 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); run(() => api.admin.addRecord(sid, { courseCode: rec.courseCode, termCode: rec.termCode, status: rec.status || null, grade: rec.grade === '' ? null : +rec.grade }), 'أُضيف السجل'); }}>
          <input className="input code" placeholder="رمز المساق" value={rec.courseCode} onChange={(e) => setRec({ ...rec, courseCode: e.target.value })} />
          <input className="input code" placeholder="الفصل مثل 2025-2" value={rec.termCode} onChange={(e) => setRec({ ...rec, termCode: e.target.value })} />
          <select className="input" value={rec.status} onChange={(e) => setRec({ ...rec, status: e.target.value })}><option value="">بلا حالة (علامة فقط)</option>{Object.entries(RECORD_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <input className="input num" placeholder="العلامة (اختياري)" value={rec.grade} onChange={(e) => setRec({ ...rec, grade: e.target.value })} />
          <button className="btn-primary">إضافة سجل</button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px]">
            <thead className="border-b border-line"><tr><th className="th">الفصل</th><th className="th">المساق</th><th className="th">الساعات</th><th className="th">الحالة</th><th className="th">العلامة</th><th className="th"></th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.records.map((x: any) => (
                <tr key={x.id}>
                  <td className="td code">{x.term_code}</td>
                  <td className="td">{x.name_ar} <Code>{x.course_code}</Code></td>
                  <td className="td num">{x.credits}</td>
                  <td className={`td ${x.status === 'failed' ? 'text-fail' : x.status === 'passed' ? 'text-pass' : 'text-muted'}`}>{x.status ? RECORD_STATUS_LABELS[x.status as keyof typeof RECORD_STATUS_LABELS] : 'بلا حالة'}</td>
                  <td className="td num">{x.grade ?? '–'}</td>
                  <td className="td"><button className="btn-danger px-2 py-1 text-xs" onClick={() => confirm('حذف هذا السجل؟') && run(() => api.admin.deleteRecord(sid, x.id), 'حُذف السجل')}>حذف</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.records.length === 0 && <Empty>لا توجد سجلات.</Empty>}
        </div>
      </Section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block"><span className="label">{label}</span>{children}</label>;
}
