// الواجهة المبسطة للطالب: ما اجتزته، ما رسبت فيه ومتى تعيده، ما يُقترح لك، وفحص أي مساق قبل تسجيله
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useReport } from '../App';
import { StateTag, Code, AlertItem } from '../components/ui';
import { checkCourse, findCourseByQuery, retakePlan, type CourseCheck } from '../../../shared/src/courseCheck';
import { RECORD_STATUS_LABELS } from '../../../shared/src/labels';

const VERDICT_STYLE: Record<CourseCheck['verdict'], { ring: string; icon: string; iconCls: string }> = {
  can: { ring: 'border-t-pass', icon: '✓', iconCls: 'bg-pass text-white' },
  cannot: { ring: 'border-t-fail', icon: '✕', iconCls: 'bg-fail text-white' },
  conditional: { ring: 'border-t-reg', icon: '…', iconCls: 'bg-reg text-white' },
  done: { ring: 'border-t-pass', icon: '✓', iconCls: 'bg-pass/80 text-white' },
  registered: { ring: 'border-t-reg', icon: 'i', iconCls: 'bg-reg text-white' },
  not_in_plan: { ring: 'border-t-avail', icon: '!', iconCls: 'bg-avail text-white' },
};

function CheckDialog({ check, onClose }: { check: CourseCheck; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const k = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); prev?.focus(); };
  }, [onClose]);
  const st = VERDICT_STYLE[check.verdict];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="chk-title">
      <button className="absolute inset-0 bg-ink/40" aria-label="إغلاق" tabIndex={-1} onClick={onClose} />
      <div ref={ref} tabIndex={-1} style={{ outline: 'none' }} className={`relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line border-t-[6px] bg-surface p-5 shadow-2xl sm:rounded-2xl ${st.ring}`}>
        <div className="flex items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-lg font-bold ${st.iconCls}`} aria-hidden>{st.icon}</span>
          <div className="min-w-0">
            <p className="text-sm text-muted">{check.nameAr} <Code>{check.code}</Code>{check.credits != null && <> – {check.credits} ساعات</>}</p>
            <h2 id="chk-title" className="mt-0.5 text-lg font-semibold leading-snug">{check.title}</h2>
          </div>
        </div>
        {check.reasons.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-1 text-sm font-semibold">{check.verdict === 'cannot' ? 'الأسباب' : 'التفاصيل'}</h3>
            <ul className="space-y-1.5 text-[15px]">{check.reasons.map((x, i) => <li key={i} className="flex gap-2"><span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-muted" aria-hidden />{x}</li>)}</ul>
          </div>
        )}
        {check.steps.length > 0 && (
          <div className="mt-4 rounded-lg bg-olive-soft/70 p-3">
            <h3 className="mb-1 text-sm font-semibold text-olive-deep">ماذا تفعل</h3>
            <ul className="space-y-1.5 text-[15px]">{check.steps.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </div>
        )}
        {check.chain.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-1 text-sm font-semibold">سلسلة المتطلبات السابقة</h3>
            <ul className="text-sm">
              {check.chain.map((x, i) => (
                <li key={i} className="flex items-center justify-between gap-2 border-b border-line py-1" style={{ paddingInlineStart: x.depth * 14 }}>
                  <span>{x.depth > 0 && <span className="text-muted">↳ </span>}{x.nameAr} <Code>{x.code}</Code></span>
                  <span className={x.state === 'مجتاز' ? 'text-pass' : x.state.startsWith('راسب') ? 'text-fail' : x.state === 'مسجل حاليًا' ? 'text-reg' : 'text-muted'}>{x.state}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button className="btn-primary mt-5 w-full py-2.5" onClick={onClose}>حسنًا</button>
      </div>
    </div>
  );
}

function CourseSearch({ onPick }: { onPick: (code: string) => void }) {
  const { report: r } = useReport();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => (q.trim().length >= 2 ? findCourseByQuery(r, q).slice(0, 8) : []), [q, r]);
  const pick = (code: string) => { onPick(code); setOpen(false); setQ(''); };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[active]) pick(results[active].code);
      else if (/^\d{8}$/.test(q.trim())) pick(q.trim());
    }
  };
  return (
    <div className="relative">
      <label htmlFor="course-q" className="mb-1.5 block font-display text-lg font-semibold text-olive-deep">هل يمكنني تسجيل مساق؟</label>
      <input id="course-q" role="combobox" aria-expanded={open && results.length > 0} aria-controls="course-q-list" autoComplete="off"
        className="input py-3 text-base" placeholder="اكتب اسم المساق أو رقمه، مثل: قواعد البيانات أو 19011304"
        value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey} />
      {open && q.trim().length >= 2 && (
        <ul id="course-q-list" role="listbox" className="absolute z-30 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-3 text-sm text-muted">{/^\d{8}$/.test(q.trim()) ? 'اضغط Enter لفحص هذا الرقم' : 'لا يوجد مساق بهذا الاسم أو الرقم في خطتك'}</li>
          ) : results.map((c, i) => (
            <li key={c.code} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c.code)} onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-start ${i === active ? 'bg-olive-soft' : ''}`}>
                <span className="min-w-0"><span className="font-medium">{c.nameAr}</span> <Code>{c.code}</Code></span>
                <StateTag state={c.state} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Block({ title, count, aside, children }: { title: string; count?: number; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <h2 className="text-lg font-semibold text-olive-deep">{title}{count != null && <span className="num ms-2 text-base font-normal text-muted">({count})</span>}</h2>
        {aside && <div className="text-sm text-muted">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function SimpleHomePage() {
  const { report: r } = useReport();
  const [check, setCheck] = useState<CourseCheck | null>(null);
  const [showAllPassed, setShowAllPassed] = useState(false);
  const open = (code: string) => setCheck(checkCourse(r, code));

  if (!r.plan) return <div className="space-y-3">{r.alerts.map((a, i) => <AlertItem key={i} a={a} />)}</div>;

  const recs = r.recommendations.filter((x) => x.included);
  const retakes = retakePlan(r);
  const passed = r.courses.filter((c) => c.state === 'passed').map((c) => {
    const a = [...c.attempts].reverse().find((x) => x.status === 'passed' || x.status === 'exempt' || x.status === 'transfer');
    return { c, term: a?.termCode ?? '', status: a?.status ?? 'passed', grade: a?.grade ?? null };
  }).sort((x, y) => y.term.localeCompare(x.term) || x.c.nameAr.localeCompare(y.c.nameAr, 'ar'));
  const passedShown = showAllPassed ? passed : passed.slice(0, 8);
  const passedCredits = passed.reduce((s, p) => s + p.c.credits, 0);
  const critical = r.alerts.filter((a) => a.code === 'INCOMPLETE_RECORD' || a.code === 'NO_PLAN');
  const recTotal = recs.reduce((s, x) => s + x.credits, 0);

  return (
    <div className="space-y-5">
      <section className="panel p-4 sm:p-6">
        <p className="text-muted">أهلًا {r.student.nameAr.split(' ')[0]}،</p>
        <p className="mt-1 text-[15px]">
          أنجزت <b className="num">{r.credits.earned}</b> من <b className="num">{r.credits.required}</b> ساعة، وبقي عليك <b className="num">{r.credits.remaining}</b>.
          {r.nextTerm && <> التوصيات أدناه لتسجيل <b>{r.nextTerm.nameAr}</b>.</>}
        </p>
        <div className="mt-5"><CourseSearch onPick={open} /></div>
        <p className="mt-2 text-xs text-muted">يمكنك أيضًا الضغط على أي مساق في القوائم أدناه لمعرفة إن كان بإمكانك تسجيله.</p>
      </section>

      {critical.map((a, i) => <AlertItem key={i} a={a} />)}

      <Block title={`المساقات المقترحة للتسجيل في ${r.nextTerm?.nameAr ?? 'الفصل القادم'}`} count={recs.length} aside={<><span className="num">{recTotal}</span> ساعة من <span className="num">{r.loadLimit.credits}</span> مسموحة</>}>
        {recs.length === 0 ? <p className="p-5 text-center text-sm text-muted">لا توجد مساقات مقترحة لك حاليًا.</p> : (
          <ul className="divide-y divide-line">
            {recs.map((x, i) => {
              const elective = x.kind === 'elective_choice';
              return (
                <li key={i} className="px-4 py-3 sm:px-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {elective ? <p className="font-medium">{x.nameAr}: اختر مساقًا واحدًا</p>
                        : <button className="text-start font-medium hover:underline" onClick={() => open(x.code!)}>{x.nameAr} <Code>{x.code}</Code></button>}
                      <p className="mt-0.5 text-sm text-muted">{x.conditionalOn ? `بشرط نجاحك في «${x.conditionalOn.map((c) => c.nameAr).join('» و«')}» هذا الفصل` : x.reasons[0]?.text}</p>
                      {elective && x.options && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {x.options.slice(0, 10).map((o) => <button key={o.code} onClick={() => open(o.code)} className="tag border border-line bg-paper px-2.5 py-1 text-ink hover:bg-olive-soft">{o.nameAr}</button>)}
                          {x.options.length > 10 && <span className="tag text-muted">و{x.options.length - 10} خيارًا آخر</span>}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="num text-sm font-semibold">{x.credits} س</span>
                      {x.conditionalOn ? <span className="tag border border-dashed border-reg/50 text-reg">مشروط</span>
                        : x.priority === 'high' ? <span className="tag bg-fail/10 text-fail">مهم جدًا</span> : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="border-t border-line px-4 py-2 text-xs text-muted sm:px-5">{r.loadLimit.text} <Link to="/recommendations" className="text-olive hover:underline">التفاصيل والأسباب الكاملة</Link></p>
      </Block>

      <Block title="مساقات رسبت فيها" count={retakes.length}>
        {retakes.length === 0 ? <p className="p-5 text-center text-sm text-pass">لا توجد مساقات راسبة عليك. أحسنت.</p> : (
          <ul className="divide-y divide-line">
            {retakes.map((x) => (
              <li key={x.code} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <button className="text-start font-medium hover:underline" onClick={() => open(x.code)}>{x.nameAr} <Code>{x.code}</Code></button>
                  <p className="mt-0.5 text-sm text-muted">رسبت فيه في الفصل <span className="code">{x.failedIn}</span>{x.grade != null && <> بعلامة <span className="num">{x.grade}</span></>}{x.unlocks > 0 && <> – يعتمد عليه <span className="num">{x.unlocks}</span> مساقًا لاحقًا</>}</p>
                </div>
                <p className={`rounded-lg px-3 py-1.5 text-sm font-medium ${x.tone === 'now' ? 'bg-pass/10 text-pass' : x.tone === 'registered' ? 'bg-reg/10 text-reg' : 'bg-avail/10 text-avail'}`}>{x.when}</p>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="مساقات اجتزتها" count={passed.length} aside={<><span className="num">{passedCredits}</span> ساعة</>}>
        {passed.length === 0 ? <p className="p-5 text-center text-sm text-muted">لم تجتز أي مساق بعد{r.credits.registered ? '؛ نتائج الفصل الحالي ستظهر هنا بعد صدورها' : ''}.</p> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px]">
                <thead className="border-b border-line bg-paper"><tr><th className="th">المساق</th><th className="th">الساعات</th><th className="th">الفصل</th><th className="th">النتيجة</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {passedShown.map(({ c, term, status, grade }) => (
                    <tr key={c.code}>
                      <td className="td">{c.nameAr} <Code>{c.code}</Code></td>
                      <td className="td num">{c.credits}</td>
                      <td className="td code">{term}</td>
                      <td className="td">{status !== 'passed' ? RECORD_STATUS_LABELS[status as keyof typeof RECORD_STATUS_LABELS] : grade != null ? <span className="num">{grade}</span> : 'ناجح'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {passed.length > 8 && <button className="w-full border-t border-line py-2.5 text-sm font-medium text-olive hover:bg-paper" onClick={() => setShowAllPassed((s) => !s)}>{showAllPassed ? 'عرض أقل' : `عرض كل المساقات المجتازة (${passed.length})`}</button>}
          </>
        )}
      </Block>

      {check && <CheckDialog check={check} onClose={() => setCheck(null)} />}
    </div>
  );
}
