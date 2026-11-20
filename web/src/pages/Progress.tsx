import { useReport } from '../App';
import { Section, Meter, Code, Empty, AlertItem } from '../components/ui';
import { CATEGORY_LABELS } from '../../../shared/src/labels';
import { Ribbon } from '../components/Ribbon';

export function ProgressPage() {
  const { report: r } = useReport();
  const g = r.graduation;
  const cr = r.credits;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-olive-deep">التقدم الأكاديمي</h1>

      <section className="panel grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:p-6">
        <Donut value={cr.earned} reg={cr.registered} max={cr.required} />
        <div className="min-w-0">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[['المطلوبة', cr.required], ['المنجزة', cr.earned], ['المسجلة حاليًا', cr.registered], ['المتبقية', cr.remaining]].map(([k, v]) => (
              <div key={k as string}><dt className="text-xs text-muted">{k}</dt><dd className="num font-display text-2xl font-semibold">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-muted">
            النسبة محسوبة من الساعات المحتسبة في الخطة فقط. المتطلب الاستدراكي ({cr.remedialRequired} ساعات) {cr.remedialEarned >= cr.remedialRequired ? 'مستوفى' : 'غير مستوفى'} ولا يُحتسب ضمن الإجمالي.
            {cr.earnedAll !== cr.earned && ` مجموع كل الساعات المجتازة في سجلك ${cr.earnedAll} ساعة، والفرق ساعات زائدة أو استدراكية أو خارج الخطة.`}
            {' '}بعض متطلبات التخرج لا تعبّر عنها الساعات (مثل التدريب الميداني).
          </p>
          <div className="mt-4"><Ribbon report={r} compact /></div>
        </div>
      </section>

      <Section title="الإنجاز حسب فئات المتطلبات">
        <div className="space-y-3">
          {r.categories.map((c) => (
            <div key={c.category}>
              <div className="mb-1 flex flex-wrap justify-between gap-2 text-sm">
                <span className="font-medium">{CATEGORY_LABELS[c.category]}{!c.countsTowardTotal && <span className="text-muted"> (غير محتسب)</span>}</span>
                <span className="num text-muted">{c.earned}/{c.required}{c.registered ? ` – مسجل ${c.registered}` : ''}{c.expectedByNow ? ` – المتوقع حتى الآن ${c.expectedByNow}` : ''}</span>
              </div>
              <Meter value={c.earned} max={c.required} cls={c.remaining === 0 ? 'bg-pass' : 'bg-olive'} label={CATEGORY_LABELS[c.category]} />
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="السير وفق الخطة">
          <AlertItem a={{ level: r.delay.isBehind ? 'warning' : 'success', text: r.delay.text }} />
          {r.delay.overdueCourses.length > 0 && (
            <ul className="mt-3 divide-y divide-line text-sm">
              {r.delay.overdueCourses.map((o) => <li key={o.code} className="flex justify-between gap-2 py-1.5"><span>{o.nameAr} <Code>{o.code}</Code></span><span className="text-muted">{o.slot}</span></li>)}
            </ul>
          )}
          {r.bottlenecks.length > 0 && <div className="mt-3 space-y-2">{r.bottlenecks.map((b) => <AlertItem key={b.code} a={{ level: 'danger', text: b.text }} />)}</div>}
        </Section>
        <Section title="المساقات المتعثرة">
          {r.failedCourses.length === 0 ? <Empty>لا توجد مساقات راسبة في سجلك.</Empty> : (
            <ul className="divide-y divide-line text-sm">
              {r.failedCourses.map((f) => (
                <li key={f.code} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{f.nameAr} <Code>{f.code}</Code></span>
                  <span className={f.nowPassed ? 'text-pass' : 'text-fail'}>{f.nowPassed ? 'أُعيد واجتيز (يُحتسب مرة واحدة)' : f.retaken ? 'قيد الإعادة' : 'يجب إعادته'}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section title="متطلبات التخرج" aside={<span className={`font-semibold ${g.state === 'graduated' || g.state === 'requirements_met' ? 'text-pass' : g.state === 'expected' ? 'text-reg' : 'text-ink'}`}>{g.stateLabel}</span>}>
        <div className="mb-3 grid gap-2 text-xs text-muted sm:grid-cols-3">
          <p className={`rounded-lg border p-2 ${g.state === 'expected' ? 'border-reg bg-reg/5 text-ink' : 'border-line'}`}><b>متوقع التخرج:</b> كل المتبقي مسجل حاليًا، بشرط النجاح.</p>
          <p className={`rounded-lg border p-2 ${g.state === 'requirements_met' ? 'border-pass bg-pass/5 text-ink' : 'border-line'}`}><b>مستوفٍ للمتطلبات:</b> حسب بيانات النظام، دون قرار رسمي.</p>
          <p className={`rounded-lg border p-2 ${g.state === 'graduated' ? 'border-pass bg-pass/5 text-ink' : 'border-line'}`}><b>خريج:</b> فقط إذا ثبت ذلك في سجل الجامعة.</p>
        </div>
        {g.missing.length === 0 ? <Empty>لا توجد متطلبات ناقصة في البيانات المتاحة.</Empty> : (
          <ul className="space-y-2">
            {g.missing.map((m, i) => <li key={i} className="rounded-lg border border-line p-3 text-sm"><p className="font-medium">{m.text}</p><p className="mt-0.5 text-muted">{m.steps}</p></li>)}
          </ul>
        )}
        {g.notes.length > 0 && <ul className="mt-3 space-y-1 text-xs text-muted">{g.notes.map((n, i) => <li key={i}>• {n}</li>)}</ul>}
      </Section>

      <Section title="تصور الفصول المتبقية" aside={r.projection.termsNeeded != null ? <span className="num">{r.projection.termsNeeded} فصل</span> : undefined}>
        <p className="text-sm">{r.projection.text}</p>
        {r.projection.terms.length > 0 && (
          <ol className="mt-4 grid gap-3 md:grid-cols-2">
            {r.projection.terms.map((t, i) => (
              <li key={i} className="rounded-lg border border-line p-3">
                <p className="flex justify-between text-sm font-semibold"><span>{t.termLabel}</span><span className="num text-muted">{t.credits} س</span></p>
                <ul className="mt-1 text-sm text-muted">{t.courses.map((c, k) => <li key={k}>{c.nameAr}</li>)}</ul>
              </li>
            ))}
          </ol>
        )}
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-olive">الافتراضات التي بُني عليها التقدير</summary>
          <ul className="mt-2 list-inside list-disc text-muted">{r.projection.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </details>
      </Section>
    </div>
  );
}

function Donut({ value, reg, max }: { value: number; reg: number; max: number }) {
  const R = 52, C = 2 * Math.PI * R;
  const e = max ? value / max : 0, rr = max ? Math.min(reg, max - value) / max : 0;
  return (
    <svg viewBox="0 0 130 130" className="mx-auto h-36 w-36" role="img" aria-label={`نسبة الإنجاز ${Math.round(e * 100)}٪`}>
      <circle cx="65" cy="65" r={R} fill="none" strokeWidth="14" className="stroke-line" />
      <circle cx="65" cy="65" r={R} fill="none" strokeWidth="14" className="stroke-reg/60" strokeDasharray={`${(e + rr) * C} ${C}`} transform="rotate(-90 65 65)" />
      <circle cx="65" cy="65" r={R} fill="none" strokeWidth="14" className="stroke-pass" strokeDasharray={`${e * C} ${C}`} transform="rotate(-90 65 65)" />
      <text x="65" y="70" textAnchor="middle" className="fill-ink font-display" style={{ fontSize: 22, fontWeight: 600 }}>{Math.round(e * 100)}٪</text>
    </svg>
  );
}
