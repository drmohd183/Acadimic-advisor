import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useReport } from '../App';
import { Ribbon } from '../components/Ribbon';
import { AlertItem, PriorityTag, Section, Code, Empty } from '../components/ui';
import { YEAR_LABELS } from '../../../shared/src/labels';

export function DashboardPage() {
  const { report: r } = useReport();
  const [allAlerts, setAll] = useState(false);
  if (!r.plan) return <div className="space-y-3">{r.alerts.map((a, i) => <AlertItem key={i} a={a} />)}</div>;
  const included = r.recommendations.filter((x) => x.included);
  const order = { danger: 0, warning: 1, success: 2, info: 3 } as const;
  const alerts = [...r.alerts].sort((a, b) => order[a.level] - order[b.level]);
  const shown = allAlerts ? alerts : alerts.slice(0, 3);
  const g = r.graduation;

  return (
    <div className="space-y-5">
      <section className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">{r.plan.label}</p>
            <h1 className="mt-1 text-2xl font-bold text-olive-deep sm:text-3xl">
              أنجزت <span className="num">{r.credits.earned}</span> من <span className="num">{r.credits.required}</span> ساعة معتمدة
            </h1>
          </div>
          <p className="font-display text-4xl font-semibold text-olive num" aria-label="نسبة الإنجاز">{r.credits.percent}٪</p>
        </div>
        <div className="mt-5"><Ribbon report={r} /></div>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5 sm:grid-cols-4">
          <div><dt className="text-xs text-muted">الرقم الجامعي</dt><dd className="code mt-0.5 text-base font-semibold" style={{ textAlign: 'right' }}>{r.student.universityId}</dd></div>
          <div><dt className="text-xs text-muted">السنة الدراسية</dt><dd className="mt-0.5 font-semibold">{YEAR_LABELS[r.student.academicYearLevel]}</dd></div>
          <div><dt className="text-xs text-muted">المعدل التراكمي</dt><dd className="num mt-0.5 font-semibold">{r.student.gpa ?? 'غير متوفر'}</dd></div>
          <div><dt className="text-xs text-muted">الساعات المتبقية</dt><dd className="num mt-0.5 font-semibold">{r.credits.remaining}{r.credits.remedialRequired > r.credits.remedialEarned && <span className="text-xs font-normal text-muted"> + استدراكي</span>}</dd></div>
        </dl>
      </section>

      {alerts.length > 0 && (
        <div className="space-y-2" aria-label="تنبيهات أكاديمية">
          {shown.map((a, i) => <AlertItem key={i} a={a} />)}
          {alerts.length > 3 && <button className="text-sm font-medium text-olive underline-offset-4 hover:underline" onClick={() => setAll((x) => !x)}>{allAlerts ? 'عرض أقل' : `عرض كل التنبيهات (${alerts.length})`}</button>}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <Section title={`توصيات ${r.nextTerm?.nameAr ?? 'الفصل القادم'}`} aside={<Link className="font-medium text-olive hover:underline" to="/recommendations">التفاصيل والأسباب</Link>}>
          {included.length === 0 ? (
            <Empty>{g.state === 'graduated' || g.state === 'requirements_met' ? 'لا تتبقى عليك مساقات للتسجيل حسب البيانات المتاحة.' : r.conditional.length ? 'لا توجد مساقات متاحة الآن؛ ستتاح مساقات جديدة بعد ظهور نتائج الفصل الحالي.' : 'لا توجد مساقات مقترحة حاليًا.'}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {included.map((x, i) => (
                <li key={i} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-medium">{x.nameAr} {x.code && <Code>{x.code}</Code>}</p>
                    <p className="mt-0.5 text-sm text-muted">{x.conditionalOn ? `مشروط باجتياز ${x.conditionalOn.map((c) => c.nameAr).join(' و')}` : x.reasons[0]?.text}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="num text-sm text-muted">{x.credits} س</span>
                    {x.conditionalOn ? <span className="tag border border-dashed border-reg/40 text-reg">مشروط</span> : <PriorityTag p={x.priority} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">{r.loadLimit.text}</p>
        </Section>

        <div className="space-y-5">
          <Section title={r.yearGuidance.title}>
            <ul className="space-y-2 text-[15px]">
              {r.yearGuidance.items.map((t, i) => <li key={i} className="flex gap-2"><span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-olive" aria-hidden />{t}</li>)}
            </ul>
          </Section>
          <Section title="الوضع حتى التخرج" aside={<Link className="font-medium text-olive hover:underline" to="/progress">التقدم الأكاديمي</Link>}>
            <p className={`font-semibold ${g.state === 'graduated' || g.state === 'requirements_met' ? 'text-pass' : g.state === 'expected' ? 'text-reg' : 'text-ink'}`}>{g.stateLabel}</p>
            <p className="mt-2 text-sm text-muted">{r.delay.text}</p>
            {r.projection.termsNeeded != null && r.projection.termsNeeded > 0 && <p className="mt-2 text-sm">تقدير مشروط: نحو <span className="num font-semibold">{r.projection.termsNeeded}</span> فصل عادي متبقٍ.</p>}
          </Section>
        </div>
      </div>
    </div>
  );
}
