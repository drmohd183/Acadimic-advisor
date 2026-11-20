import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api';
import { useAuth } from '../../App';
import { useLoad } from '../../components/useLoad';
import { Loading, ErrorBox, Section, Code, AlertItem, Empty } from '../../components/ui';
import { CATEGORY_LABELS, PLAN_STATUS_LABELS, YEAR_LABELS, TERM_LABELS } from '../../../../shared/src/labels';
import { CATEGORIES, type PlanVersion } from '../../../../shared/src/types';

const STATUS_CLS: Record<string, string> = { approved: 'bg-pass/10 text-pass', imported: 'bg-avail/10 text-avail', draft: 'bg-reg/10 text-reg', demo: 'bg-block/15 text-muted', archived: 'bg-line text-muted' };

export function AdminPlans() {
  const { notify } = useAuth();
  const nav = useNavigate();
  const { data, err, reload } = useLoad(() => api.admin.plans());
  const [json, setJson] = useState('');
  const run = async (fn: () => Promise<any>, ok: string) => { try { const r = await fn(); notify(ok); reload(); return r; } catch (e: any) { notify(e.message, 'err'); } };
  const importPlan = async () => {
    let parsed: any;
    try { parsed = JSON.parse(json); } catch { notify('صيغة JSON غير صحيحة', 'err'); return; }
    if (!parsed.label) parsed.label = `خطة مستوردة – ${parsed.track ?? parsed.trackCode}`;
    if (!parsed.trackCode && parsed.track) parsed.trackCode = parsed.track;
    if (!parsed.effectiveFromYear) parsed.effectiveFromYear = new Date().getFullYear();
    const r = await run(() => api.admin.importPlan(parsed), 'استُوردت الخطة كمسودة');
    if (r?.id) nav(`/admin/plans/${r.id}`);
  };
  if (err) return <ErrorBox error={err} onRetry={reload} />;
  if (!data) return <Loading />;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-olive-deep">الخطط الدراسية وإصداراتها</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">لكل مسار إصدارات بنطاقات سنوات التحاق. الخطة المعتمدة مقفلة للتعديل حفاظًا على سجلات الطلبة؛ لتحديثها أنشئ نسخة جديدة بنطاق سنوات جديد. التوصيات النهائية للطلبة الحقيقيين تتطلب خطة «معتمدة».</p>
      </div>
      <div className="grid gap-3">
        {data.map((p: any) => {
          const danger = p.validation.filter((v: any) => v.level === 'danger').length;
          return (
            <div key={p.id} className="panel flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <Link to={`/admin/plans/${p.id}`} className="font-semibold text-olive-deep hover:underline">#{p.id} {p.label}</Link>
                <p className="mt-0.5 text-sm text-muted">{p.trackNameAr} – سنوات الالتحاق {p.effectiveFromYear}–{p.effectiveToYear ?? 'الآن'} – <span className="num">{p.totalCredits}</span> ساعة – <span className="num">{p.courseCount}</span> مساقًا – مسندة صراحة لـ <span className="num">{p.assignedStudents}</span> طالب</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`tag ${STATUS_CLS[p.status]}`}>{PLAN_STATUS_LABELS[p.status as keyof typeof PLAN_STATUS_LABELS]}</span>
                {danger > 0 && <span className="tag bg-fail/10 text-fail">{danger} ملاحظة حرجة</span>}
                {!p.isDemo && p.status !== 'approved' && p.status !== 'archived' && <button className="btn-primary px-3 py-1.5" onClick={() => confirm('اعتماد الخطة يقفل تعديل محتواها. هل تأكدت من مطابقتها للخطة الرسمية؟') && run(() => api.admin.patchPlan(p.id, { status: 'approved' }), 'اعتُمدت الخطة')}>اعتماد</button>}
                {p.status !== 'archived' && <button className="btn-ghost px-3 py-1.5" onClick={() => run(() => api.admin.patchPlan(p.id, { status: 'archived' }), 'أُرشفت الخطة')}>أرشفة</button>}
                <button className="btn-ghost px-3 py-1.5" onClick={async () => { const y = prompt('سنة بدء تطبيق الإصدار الجديد:', String(new Date().getFullYear())); if (!y) return; const r = await run(() => api.admin.clonePlan(p.id, { label: `${p.label} – إصدار ${y}`, effectiveFromYear: +y, effectiveToYear: null }), 'أُنشئت نسخة كمسودة'); if (r?.id) nav(`/admin/plans/${r.id}`); }}>نسخ كإصدار جديد</button>
                {p.status === 'draft' && <button className="btn-danger px-3 py-1.5" onClick={() => confirm('حذف المسودة نهائيًا؟') && run(() => api.admin.deletePlan(p.id), 'حُذفت المسودة')}>حذف</button>}
              </div>
            </div>
          );
        })}
      </div>
      <Section title="استيراد خطة رسمية (JSON)">
        <p className="mb-2 text-sm text-muted">الصيغة الناتجة عن أداة <Code>tools/import_docx_plans.py</Code> التي تقرأ ملفات Word للخطة الدراسية والاسترشادية، أو صيغة مماثلة تحتوي trackCode و courses و categories و prerequisites. تُستورد الخطة كمسودة للمراجعة قبل اعتمادها.</p>
        <textarea className="input code h-40 text-start text-xs" dir="ltr" value={json} onChange={(e) => setJson(e.target.value)} placeholder='{"trackCode":"SEC","label":"...","effectiveFromYear":2027,"totalCredits":133,"categories":{...},"courses":[...],"prerequisites":[...]}' />
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="btn-ghost cursor-pointer">اختيار ملف<input type="file" accept=".json,application/json" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setJson(await f.text()); }} /></label>
          <button className="btn-primary" disabled={!json.trim()} onClick={importPlan}>استيراد كمسودة</button>
        </div>
      </Section>
    </div>
  );
}

export function AdminPlanDetail() {
  const pid = Number(useParams().id);
  const { notify } = useAuth();
  const { data, err, reload } = useLoad<PlanVersion & { validation: any[] }>(() => api.admin.plan(pid), [pid]);
  const [nc, setNc] = useState({ code: '', category: 'MAJ_ELEC', suggestedYear: '', suggestedTerm: '', nameAr: '', credits: '' });
  const [rq, setRq] = useState({ course: '', requires: '', type: 'pre' as 'pre' | 'co' });
  const [filter, setFilter] = useState('');
  if (err) return <ErrorBox error={err} onRetry={reload} />;
  if (!data) return <Loading />;
  const p = data;
  const locked = p.status === 'approved';
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); notify(ok); reload(); } catch (e: any) { notify(e.message, 'err'); } };
  const name = (c: string) => p.courses.find((x) => x.code === c)?.nameAr ?? c;
  const shown = p.courses.filter((c) => !filter || c.code.includes(filter) || c.nameAr.includes(filter) || c.category === filter);

  return (
    <div className="space-y-5">
      <div>
        <Link to="/admin/plans" className="text-sm text-olive hover:underline">الخطط</Link>
        <h1 className="mt-1 text-2xl font-bold text-olive-deep">#{p.id} {p.label}</h1>
        <p className="mt-1 text-sm text-muted">{p.trackNameAr} – {PLAN_STATUS_LABELS[p.status]}{locked && ' – مقفلة للتعديل'}</p>
        {p.sourceNote && <p className="mt-2 max-w-3xl rounded-lg bg-olive-soft/60 p-3 text-sm">{p.sourceNote}</p>}
      </div>

      <Section title="بيانات الإصدار">
        <div className="grid gap-3 sm:grid-cols-4">
          <label><span className="label">من سنة التحاق</span><input className="input num" type="number" defaultValue={p.effectiveFromYear} onBlur={(e) => +e.target.value !== p.effectiveFromYear && run(() => api.admin.patchPlan(pid, { effectiveFromYear: +e.target.value }), 'حُفظ')} /></label>
          <label><span className="label">حتى سنة التحاق</span><input className="input num" type="number" defaultValue={p.effectiveToYear ?? ''} placeholder="مفتوح" onBlur={(e) => run(() => api.admin.patchPlan(pid, { effectiveToYear: e.target.value ? +e.target.value : null }), 'حُفظ')} /></label>
          <label><span className="label">إجمالي الساعات المحتسبة</span><input className="input num" type="number" disabled={locked} defaultValue={p.totalCredits} onBlur={(e) => +e.target.value !== p.totalCredits && run(() => api.admin.patchPlan(pid, { totalCredits: +e.target.value }), 'حُفظ')} /></label>
          <label><span className="label">حد معدل التخرج (اختياري)</span><input className="input num" type="number" step="0.1" defaultValue={p.minGpaForGraduation ?? ''} placeholder="غير موثق" onBlur={(e) => run(() => api.admin.patchPlan(pid, { minGpaForGraduation: e.target.value ? +e.target.value : null }), 'حُفظ')} /></label>
        </div>
      </Section>

      {data.validation.length > 0 && <Section title="فحص الخطة"><div className="space-y-2">{data.validation.map((v, i) => <AlertItem key={i} a={v} />)}</div></Section>}

      <Section title="فئات المتطلبات">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px]">
            <thead className="border-b border-line"><tr><th className="th">الفئة</th><th className="th">الساعات المطلوبة</th><th className="th">تُحتسب في الإجمالي</th><th className="th">ساعات المساقات المدرجة</th></tr></thead>
            <tbody className="divide-y divide-line">
              {p.categories.map((c) => (
                <tr key={c.category}>
                  <td className="td font-medium">{CATEGORY_LABELS[c.category]}</td>
                  <td className="td"><input className="input num w-24" type="number" disabled={locked} defaultValue={c.requiredCredits} onBlur={(e) => +e.target.value !== c.requiredCredits && run(() => api.admin.putCategory(pid, c.category, { requiredCredits: +e.target.value, countsTowardTotal: c.countsTowardTotal }), 'حُفظ')} /></td>
                  <td className="td"><input type="checkbox" disabled={locked} defaultChecked={c.countsTowardTotal} onChange={(e) => run(() => api.admin.putCategory(pid, c.category, { requiredCredits: c.requiredCredits, countsTowardTotal: e.target.checked }), 'حُفظ')} aria-label="تُحتسب" /></td>
                  <td className="td num text-muted">{p.courses.filter((x) => x.category === c.category).reduce((s, x) => s + x.credits, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="مساقات الخطة" aside={<span className="num">{p.courses.length} مساقًا</span>}>
        {!locked && (
          <form className="mb-4 grid gap-2 sm:grid-cols-6" onSubmit={(e) => { e.preventDefault(); run(() => api.admin.addPlanCourse(pid, { code: nc.code, category: nc.category, suggestedYear: nc.suggestedYear ? +nc.suggestedYear : null, suggestedTerm: nc.suggestedTerm ? +nc.suggestedTerm : null, nameAr: nc.nameAr || undefined, credits: nc.credits ? +nc.credits : undefined }), 'أُضيف المساق'); }}>
            <input className="input code" placeholder="الرمز (8 أرقام)" value={nc.code} onChange={(e) => setNc({ ...nc, code: e.target.value })} />
            <select className="input" value={nc.category} onChange={(e) => setNc({ ...nc, category: e.target.value })}>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}</select>
            <select className="input" value={nc.suggestedYear + '-' + nc.suggestedTerm} onChange={(e) => { const [y, t] = e.target.value.split('-'); setNc({ ...nc, suggestedYear: y, suggestedTerm: t }); }}>
              <option value="-">بلا فصل محدد</option>
              {[1, 2, 3, 4].flatMap((y) => [1, 2].map((t) => <option key={`${y}-${t}`} value={`${y}-${t}`}>{YEAR_LABELS[y]} – {TERM_LABELS[t]}</option>))}
            </select>
            <input className="input" placeholder="الاسم (لمساق جديد)" value={nc.nameAr} onChange={(e) => setNc({ ...nc, nameAr: e.target.value })} />
            <input className="input num" placeholder="الساعات (لمساق جديد)" value={nc.credits} onChange={(e) => setNc({ ...nc, credits: e.target.value })} />
            <button className="btn-primary">إضافة</button>
          </form>
        )}
        <input className="input mb-3 max-w-xs" placeholder="تصفية بالرمز أو الاسم" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="تصفية" />
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full min-w-[760px]">
            <thead className="sticky top-0 border-b border-line bg-surface"><tr><th className="th">المساق</th><th className="th">س</th><th className="th">الفئة</th><th className="th">الفصل المقترح</th><th className="th">المتطلبات السابقة</th><th className="th"></th></tr></thead>
            <tbody className="divide-y divide-line">
              {shown.map((c) => {
                const pre = p.prerequisites.filter((x) => x.course === c.code);
                const co = p.corequisites.filter((x) => x.course === c.code);
                return (
                  <tr key={c.code}>
                    <td className="td">{c.nameAr} <Code>{c.code}</Code></td>
                    <td className="td num">{c.credits}</td>
                    <td className="td text-xs">{CATEGORY_LABELS[c.category]}</td>
                    <td className="td">
                      <select className="input w-44 py-1 text-xs" disabled={locked} value={`${c.suggestedYear ?? ''}-${c.suggestedTerm ?? ''}`} onChange={(e) => { const [y, t] = e.target.value.split('-'); run(() => api.admin.patchPlanCourse(pid, c.code, { suggestedYear: y ? +y : null, suggestedTerm: t ? +t : null }), 'حُفظ'); }}>
                        <option value="-">بلا فصل</option>
                        {[1, 2, 3, 4].flatMap((y) => [1, 2].map((t) => <option key={`${y}-${t}`} value={`${y}-${t}`}>{YEAR_LABELS[y]} – {TERM_LABELS[t]}</option>))}
                      </select>
                    </td>
                    <td className="td text-xs">
                      {pre.length === 0 && co.length === 0 && <span className="text-muted">لا يوجد</span>}
                      {[...pre.map((x) => ({ ...x, type: 'pre' as const })), ...co.map((x) => ({ ...x, type: 'co' as const }))].map((x) => (
                        <span key={x.type + x.requires} className="tag mb-1 me-1 border border-line bg-paper text-ink">
                          {x.type === 'co' && 'متزامن: '}{name(x.requires)}
                          {!locked && <button aria-label="حذف المتطلب" className="text-fail" onClick={() => run(() => api.admin.removeRequisite(pid, { course: c.code, requires: x.requires, type: x.type }), 'حُذف المتطلب')}>✕</button>}
                        </span>
                      ))}
                    </td>
                    <td className="td">{!locked && <button className="btn-danger px-2 py-1 text-xs" onClick={() => confirm(`إزالة ${c.nameAr} من الخطة؟`) && run(() => api.admin.removePlanCourse(pid, c.code), 'أُزيل المساق')}>إزالة</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!locked && (
          <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); run(() => api.admin.addRequisite(pid, rq), 'أُضيف المتطلب'); }}>
            <label><span className="label">المساق</span><select className="input w-56" value={rq.course} onChange={(e) => setRq({ ...rq, course: e.target.value })}><option value="">اختر</option>{p.courses.map((c) => <option key={c.code} value={c.code}>{c.nameAr}</option>)}</select></label>
            <label><span className="label">يتطلب</span><select className="input w-56" value={rq.requires} onChange={(e) => setRq({ ...rq, requires: e.target.value })}><option value="">اختر</option>{p.courses.map((c) => <option key={c.code} value={c.code}>{c.nameAr}</option>)}</select></label>
            <label><span className="label">النوع</span><select className="input w-36" value={rq.type} onChange={(e) => setRq({ ...rq, type: e.target.value as 'pre' | 'co' })}><option value="pre">متطلب سابق</option><option value="co">متطلب متزامن</option></select></label>
            <button className="btn-primary" disabled={!rq.course || !rq.requires}>إضافة متطلب</button>
          </form>
        )}
      </Section>

      <Section title="متطلبات تخرج غير ساعية">
        {p.nonCreditRequirements.length === 0 ? <Empty>لا يوجد.</Empty> : (
          <ul className="space-y-2">{p.nonCreditRequirements.map((n) => <li key={n.id} className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-line p-3 text-sm"><div><p className="font-medium">{n.nameAr} <Code>{n.code}</Code></p><p className="text-muted">{n.description}</p>{n.suggestedYear && <p className="text-xs text-muted">{YEAR_LABELS[n.suggestedYear]} – {TERM_LABELS[n.suggestedTerm ?? 1]}</p>}</div><button className="btn-danger px-2 py-1 text-xs" onClick={() => run(() => api.admin.removeRequirement(pid, n.id), 'حُذف')}>حذف</button></li>)}</ul>
        )}
        <button className="btn-ghost mt-3" onClick={() => { const code = prompt('رمز المتطلب (أحرف إنجليزية كبيرة، مثل FIELD_TRAINING):'); const nameAr = code && prompt('اسم المتطلب بالعربية:'); if (code && nameAr) run(() => api.admin.addRequirement(pid, { code, nameAr }), 'أُضيف المتطلب'); }}>إضافة متطلب غير ساعي</button>
      </Section>

      {p.equivalences.length > 0 && (
        <Section title="معادلات المساقات من خطط سابقة">
          <ul className="text-sm">{p.equivalences.map((e) => <li key={e.fromCode}><Code>{e.fromCode}</Code> ← {name(e.toCode)} <Code>{e.toCode}</Code> <span className="text-muted">{e.note}</span></li>)}</ul>
        </Section>
      )}
    </div>
  );
}
