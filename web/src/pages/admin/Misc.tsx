import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../App';
import { useLoad } from '../../components/useLoad';
import { Loading, ErrorBox, Section, Code, Empty, Meter } from '../../components/ui';
import { YEAR_LABELS } from '../../../../shared/src/labels';

const useRun = (reload: () => void) => {
  const { notify } = useAuth();
  return async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); notify(ok); reload(); } catch (e: any) { notify(e.message, 'err'); } };
};

// ---------- دليل المساقات ----------
export function AdminCourses() {
  const [q, setQ] = useState('');
  const { data, err, reload } = useLoad(() => api.admin.courses(q), [q]);
  const run = useRun(reload);
  const [f, setF] = useState({ code: '', nameAr: '', credits: '3' });
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-olive-deep">دليل المساقات</h1>
      <p className="text-sm text-muted">المساق معرّف برمزه المكون من 8 أرقام، ويمكن أن يرد في أكثر من خطة. لا يمكن تغيير ساعات مساق مستخدم في خطة معتمدة.</p>
      <form className="panel flex flex-wrap items-end gap-2 p-4" onSubmit={(e) => { e.preventDefault(); run(() => api.admin.createCourse({ code: f.code, nameAr: f.nameAr, credits: +f.credits }), 'أُضيف المساق'); }}>
        <label><span className="label">الرمز</span><input className="input code w-36" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></label>
        <label className="min-w-[200px] flex-1"><span className="label">الاسم</span><input className="input" value={f.nameAr} onChange={(e) => setF({ ...f, nameAr: e.target.value })} /></label>
        <label><span className="label">الساعات</span><input className="input num w-20" type="number" value={f.credits} onChange={(e) => setF({ ...f, credits: e.target.value })} /></label>
        <button className="btn-primary">إضافة مساق</button>
      </form>
      <input className="input max-w-sm" placeholder="بحث بالرمز أو الاسم" value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث" />
      {err ? <ErrorBox error={err} /> : !data ? <Loading /> : (
        <div className="panel max-h-[640px] overflow-auto">
          <table className="w-full min-w-[640px]">
            <thead className="sticky top-0 border-b border-line bg-surface"><tr><th className="th">الرمز</th><th className="th">الاسم</th><th className="th">الساعات</th><th className="th">الخطط</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.map((c: any) => (
                <tr key={c.code}>
                  <td className="td code">{c.code}</td>
                  <td className="td"><input className="input py-1" defaultValue={c.name_ar} onBlur={(e) => e.target.value !== c.name_ar && run(() => api.admin.patchCourse(c.code, { nameAr: e.target.value }), 'حُفظ')} aria-label="الاسم" /> {c.is_demo && <span className="tag bg-avail/10 text-avail">تجريبي</span>}</td>
                  <td className="td"><input className="input num w-20 py-1" type="number" defaultValue={c.credits} onBlur={(e) => +e.target.value !== c.credits && run(() => api.admin.patchCourse(c.code, { credits: +e.target.value }), 'حُفظ')} aria-label="الساعات" /></td>
                  <td className="td text-xs text-muted">{(c.plans ?? []).map((p: number) => `#${p}`).join('، ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- الفصول والطرح ----------
export function AdminTerms() {
  const { data, err, reload } = useLoad(() => api.admin.terms());
  const run = useRun(reload);
  const [sel, setSel] = useState('');
  const [codes, setCodes] = useState('');
  const loadOff = async (c: string) => { setSel(c); setCodes((await api.admin.offerings(c)).join('\n')); };
  if (err) return <ErrorBox error={err} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-olive-deep">الفصول الأكاديمية وطرح المساقات</h1>
      <p className="max-w-3xl text-sm text-muted">يحدد «الفصل الحالي» موقع كل طالب في الخطة الاسترشادية ويُعد أساس حساب التأخر. إدخال المساقات المطروحة للفصل القادم اختياري؛ عند إدخالها يستبعد المرشد غير المطروح من الحزمة المقترحة.</p>
      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="الفصول">
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full">
              <tbody className="divide-y divide-line">
                {data.map((t: any) => (
                  <tr key={t.code} className={t.is_current ? 'bg-olive-soft/60' : ''}>
                    <td className="td code">{t.code}</td>
                    <td className="td">{t.name_ar}</td>
                    <td className="td num text-xs text-muted">{t.offerings ? `${t.offerings} مطروح` : ''}</td>
                    <td className="td text-end">
                      {t.is_current ? <span className="tag bg-olive text-white">الحالي</span> : <button className="btn-ghost px-2 py-1 text-xs" onClick={() => confirm(`تعيين ${t.name_ar} فصلًا حاليًا؟ سيتغير حساب التوصيات لجميع الطلبة.`) && run(() => api.admin.setCurrentTerm(t.code), 'عُيّن الفصل الحالي')}>تعيين حاليًا</button>}
                      <button className="btn-ghost ms-1 px-2 py-1 text-xs" onClick={() => loadOff(t.code)}>الطرح</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
        <Section title={sel ? `المساقات المطروحة – ${sel}` : 'المساقات المطروحة'}>
          {!sel ? <Empty>اختر «الطرح» بجانب فصل لعرض مساقاته المطروحة وتعديلها.</Empty> : (
            <>
              <p className="mb-2 text-sm text-muted">رمز مساق في كل سطر. اترك القائمة فارغة إن لم تتوفر بيانات الطرح.</p>
              <textarea className="input code h-72 text-start" dir="ltr" value={codes} onChange={(e) => setCodes(e.target.value)} />
              <button className="btn-primary mt-2" onClick={() => run(() => api.admin.setOfferings(sel, codes.split(/\s+/).filter(Boolean)), 'حُفظ الطرح')}>حفظ الطرح</button>
            </>
          )}
        </Section>
      </div>
    </div>
  );
}

// ---------- قواعد الإرشاد ----------
const RULE_TITLES: Record<string, string> = {
  repeatPolicy: 'سياسة احتساب المساق المُعاد', minPassingGrade: 'علامة النجاح', maxTermCredits: 'الحد الأقصى للساعات في الفصل', minTermCredits: 'الحد الأدنى للساعات في الفصل',
  summerMaxCredits: 'الحد الأقصى للفصل الصيفي', gpaScale: 'مقياس المعدل', requireApprovedPlanForFinal: 'اشتراط الخطة المعتمدة للتوصيات النهائية', countWithdrawnAsAttempt: 'احتساب الانسحاب محاولة', priorityWeights: 'أوزان الأولوية', llmEnabled: 'تفعيل النموذج اللغوي الخارجي',
};
const WEIGHT_LABELS: Record<string, string> = { remedial: 'المتطلب الاستدراكي', retakeFailed: 'إعادة الإجباري الراسب', overdue: 'المتأخر عن الخطة', currentSlot: 'المقرر للفصل القادم', blocking: 'لكل مساق يفتحه', mandatory: 'الإجباري', elective: 'الاختياري' };

export function AdminRules() {
  const { data, err, reload } = useLoad(() => api.admin.rules());
  const run = useRun(reload);
  if (err) return <ErrorBox error={err} onRetry={reload} />;
  if (!data) return <Loading />;
  const save = (k: string, v: unknown) => run(() => api.admin.putRule(k, v), 'حُفظت القاعدة وتُطبق فورًا على التوصيات');
  const numField = (r: any) => (
    <div className="flex items-center gap-2">
      <input className="input num w-32" type="number" defaultValue={r.value ?? ''} placeholder="غير مضبوط" onBlur={(e) => { const v = e.target.value === '' ? null : +e.target.value; if (v !== r.value) save(r.key, v); }} aria-label={RULE_TITLES[r.key]} />
      {r.value == null && <span className="tag bg-avail/10 text-avail">غير موثق</span>}
    </div>
  );
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-olive-deep">قواعد الإرشاد</h1>
      <p className="max-w-3xl text-sm text-muted">القيم التي لم ترد في الوثائق الرسمية تُترك «غير مضبوطة» عمدًا؛ ويعرض المرشد للطالب تنبيهًا بدل افتراض قيمة. اضبطها فقط وفق التعليمات المعتمدة في الجامعة.</p>
      <div className="grid gap-3">
        {data.map((r: any) => (
          <div key={r.key} className="panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-2xl"><p className="font-semibold">{RULE_TITLES[r.key] ?? r.key} <Code>{r.key}</Code></p><p className="mt-0.5 text-sm text-muted">{r.description_ar}</p></div>
              <div>
                {r.key === 'repeatPolicy' ? (
                  <select className="input w-48" defaultValue={r.value ?? ''} onChange={(e) => save(r.key, e.target.value || null)}><option value="">غير موثقة</option><option value="latest">آخر محاولة</option><option value="highest">أعلى علامة</option></select>
                ) : typeof r.value === 'boolean' ? (
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={r.value} onChange={(e) => save(r.key, e.target.checked)} />مفعّل</label>
                ) : r.key === 'priorityWeights' ? null : numField(r)}
              </div>
            </div>
            {r.key === 'priorityWeights' && (
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                {Object.entries(r.value).map(([k, v]) => (
                  <label key={k} className="text-sm"><span className="label">{WEIGHT_LABELS[k] ?? k}</span><input className="input num" type="number" defaultValue={v as number} onBlur={(e) => +e.target.value !== v && save('priorityWeights', { ...r.value, [k]: +e.target.value })} /></label>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- التقارير ----------
export function AdminReports() {
  const { data, err, reload } = useLoad(() => api.admin.reports());
  if (err) return <ErrorBox error={err} onRetry={reload} />;
  if (!data) return <Loading text="يُحسب الإرشاد لجميع الطلبة…" />;
  const s = data.summary;
  const max = Math.max(1, ...data.demand.map((d: any) => d.count));
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-olive-deep">التقارير</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[['الطلبة', s.total], ['متأخرون عن الخطة', s.behind], ['لديهم مساق راسب', s.withOpenFails], ['متوقعو التخرج', s.expected], ['مستوفو المتطلبات', s.met]].map(([k, v]) => (
          <div key={k} className="panel p-4"><p className="text-xs text-muted">{k}</p><p className="num font-display text-2xl font-semibold text-olive-deep">{v}</p></div>
        ))}
      </div>
      <Section title="الطلب المتوقع على المساقات في الفصل القادم" aside="عدد الطلبة الذين ظهر المساق في حزمتهم المقترحة">
        {data.demand.length === 0 ? <Empty>لا توجد بيانات.</Empty> : (
          <ul className="space-y-2">{data.demand.slice(0, 20).map((d: any) => (
            <li key={d.code} className="grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3 text-sm">
              <span className="truncate">{d.name} <Code>{d.code}</Code></span>
              <Meter value={d.count} max={max} label={d.name} />
              <span className="num text-muted">{d.count}{d.conditional ? ` (${d.conditional} مشروط)` : ''}</span>
            </li>
          ))}</ul>
        )}
      </Section>
      <Section title="حالة الطلبة">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="border-b border-line"><tr><th className="th">الطالب</th><th className="th">المسار</th><th className="th">السنة</th><th className="th">الإنجاز</th><th className="th">متأخر</th><th className="th">راسب مفتوح</th><th className="th">التخرج</th><th className="th">فصول متبقية (تقدير)</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.students.map((r: any) => (
                <tr key={r.id}>
                  <td className="td"><Link to={`/admin/students/${r.id}`} className="text-olive hover:underline">{r.name}</Link> <Code>{r.universityId}</Code></td>
                  <td className="td text-muted">{r.track}</td>
                  <td className="td">{YEAR_LABELS[r.year]}</td>
                  <td className="td num">{r.earned}/{r.earned + r.remaining} ({r.percent}٪)</td>
                  <td className="td">{r.behind ? <span className="text-avail">نعم</span> : 'لا'}</td>
                  <td className="td num">{r.openFails || '–'}</td>
                  <td className="td text-xs">{r.graduation}</td>
                  <td className="td num">{r.termsNeeded ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

// ---------- السجلات ----------
export function AdminLogs() {
  const [tab, setTab] = useState<'audit' | 'errors'>('audit');
  const { data, err, reload } = useLoad(() => (tab === 'audit' ? api.admin.audit() : api.admin.errors()), [tab]);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-olive-deep">السجلات</h1>
      <div className="flex gap-2" role="tablist">
        <button role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('audit')}>سجل العمليات</button>
        <button role="tab" aria-selected={tab === 'errors'} className={tab === 'errors' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('errors')}>أخطاء النظام</button>
        <button className="btn-ghost" onClick={reload}>تحديث</button>
      </div>
      {err ? <ErrorBox error={err} /> : !data ? <Loading /> : data.length === 0 ? <Empty>لا توجد سجلات.</Empty> : (
        <div className="panel max-h-[640px] overflow-auto">
          <table className="w-full min-w-[720px]">
            <thead className="sticky top-0 border-b border-line bg-surface"><tr><th className="th">الوقت</th>{tab === 'audit' ? <><th className="th">المستخدم</th><th className="th">العملية</th><th className="th">الكيان</th></> : <><th className="th">المستوى</th><th className="th">الرسالة</th></>}<th className="th">التفاصيل</th></tr></thead>
            <tbody className="divide-y divide-line">
              {data.map((a: any) => (
                <tr key={a.id}>
                  <td className="td code text-xs">{new Date(a.at).toLocaleString('en-GB')}</td>
                  {tab === 'audit' ? <><td className="td code text-xs">{a.username ?? '–'}</td><td className="td code text-xs">{a.action}</td><td className="td text-xs">{a.entity} {a.entity_id}</td></> : <><td className="td text-xs">{a.level}</td><td className="td text-xs">{a.message}</td></>}
                  <td className="td max-w-xs truncate text-xs text-muted" dir="ltr" title={JSON.stringify(a.details ?? a.context)}>{a.details || a.context ? JSON.stringify(a.details ?? a.context) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- التكامل والاستيراد ----------
const IMPORTS = [
  { key: 'students', title: '1. بيانات الطلبة', header: 'university_id,name_ar,track,enrollment_year,academic_year_level,gpa,status,field_training',
    note: 'يُنشئ الطلبة الجدد مع حساب دخول بكلمة مرور أولية عشوائية، ويحدّث بيانات الموجودين. track: SEC أو ITM. status: active أو expected_graduate أو graduated. field_training: met أو in_progress أو not_met.',
    fn: (csv: string, dry: boolean) => api.admin.importStudents(csv, dry) },
  { key: 'records', title: '2. السجل الأكاديمي', header: 'university_id,course_code,term_code,status,grade',
    note: 'سطر لكل محاولة. الحالات: passed أو failed أو withdrawn أو incomplete أو exempt أو transfer. السطر المكرر لنفس المساق والفصل يُحدَّث.',
    fn: (csv: string, dry: boolean) => api.admin.importRecords(csv, dry) },
  { key: 'registrations', title: '3. التسجيل الحالي', header: 'university_id,course_code,term_code',
    note: 'يستبدل تسجيل كل طالب وارد في الملف لذلك الفصل بما في الملف.',
    fn: (csv: string, dry: boolean) => api.admin.importRegistrations(csv, dry) },
];

function downloadCsv(name: string, rows: Record<string, string>[]) {
  const head = Object.keys(rows[0]);
  const body = [head.join(','), ...rows.map((r) => head.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function ImportCard({ cfg }: { cfg: (typeof IMPORTS)[number] }) {
  const { notify } = useAuth();
  const [csv, setCsv] = useState(cfg.header + '\n');
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const imp = async (dry: boolean) => {
    setBusy(true);
    try {
      const r = await cfg.fn(csv, dry);
      setResult(r);
      if (!dry && r.imported) {
        notify(`استُورد ${r.imported} سطرًا`);
        if (r.credentials?.length) downloadCsv(`initial-passwords-${new Date().toISOString().slice(0, 10)}.csv`, r.credentials);
      }
    } catch (e: any) { notify(e.message, 'err'); } finally { setBusy(false); }
  };
  return (
    <Section title={cfg.title}>
      <p className="mb-1 text-sm text-muted">الترويسة: <Code>{cfg.header}</Code></p>
      <p className="mb-2 text-sm text-muted">{cfg.note}</p>
      <textarea className="input code h-32 text-start text-xs" dir="ltr" value={csv} onChange={(e) => { setCsv(e.target.value); setResult(null); }} aria-label={cfg.title} />
      <div className="mt-2 flex flex-wrap gap-2">
        <label className="btn-ghost cursor-pointer">اختيار ملف CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setCsv(await f.text()); setResult(null); } }} /></label>
        <button className="btn-ghost" disabled={busy} onClick={() => imp(true)}>فحص الملف</button>
        <button className="btn-primary" disabled={busy || !result || result.errors.length > 0 || result.valid === 0 || result.imported > 0} onClick={() => imp(false)}>استيراد</button>
      </div>
      {result && (
        <div className="mt-3 space-y-1 text-sm">
          <p>سطور صالحة: <span className="num">{result.valid}</span>
            {result.toCreate != null && <> – جدد: <span className="num">{result.toCreate}</span> – تحديث: <span className="num">{result.toUpdate}</span></>}
            {result.imported ? ` – استُورد ${result.imported}` : ''}</p>
          {result.errors.length > 0 && <ul className="list-inside list-disc text-fail">{result.errors.slice(0, 25).map((e: string, i: number) => <li key={i}>{e}</li>)}{result.errors.length > 25 && <li>و{result.errors.length - 25} خطأ آخر</li>}</ul>}
          {result.credentials?.length > 0 && (
            <div className="rounded-lg border border-avail/40 bg-avail/[0.07] p-3">
              <p>نُزّل ملف بكلمات المرور الأولية لـ<span className="num"> {result.credentials.length} </span>طالبًا جديدًا. لن يظهر مرة أخرى؛ احفظه في مكان آمن وسلّم كل طالب كلمته، وسيُطلب منه تغييرها عند أول دخول.</p>
              <button className="btn-ghost mt-2" onClick={() => downloadCsv('initial-passwords.csv', result.credentials)}>تنزيل الملف مرة أخرى</button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

export function AdminIntegration() {
  const { data, err, reload } = useLoad(() => api.admin.integration());
  if (err) return <ErrorBox error={err} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-olive-deep">مصادر البيانات والاستيراد</h1>
      <Section title="الوضع الحالي">
        <p className="text-sm">وضع التشغيل: <b>{data.mode === 'demo' ? 'نموذج تجريبي مستقل' : 'النظام الفعلي'}</b>. التكامل المباشر مع نظام معلومات الطلبة: <b className={data.sisConfigured ? 'text-pass' : 'text-avail'}>{data.sisConfigured ? 'مهيأ' : 'غير مفعّل'}</b>.</p>
        <p className="mt-1 text-sm text-muted">{data.settings?.note} البيانات تصل عبر ملفات التصدير أدناه. استورد الملفات بالترتيب: الطلبة أولًا، ثم السجل، ثم التسجيل. كل ملف يُفحص قبل الاستيراد ولا يُستورد إن وُجد فيه خطأ.</p>
      </Section>
      {IMPORTS.map((c) => <ImportCard key={c.key} cfg={c} />)}
      <Section title="ما يلزم للربط المباشر مستقبلًا">
        <ol className="list-inside list-decimal space-y-1 text-sm">{data.requirements.map((r: string, i: number) => <li key={i}>{r}</li>)}</ol>
      </Section>
    </div>
  );
}
