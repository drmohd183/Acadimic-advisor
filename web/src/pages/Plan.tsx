import { useMemo, useState } from 'react';
import { useReport } from '../App';
import { StateTag, STATE_STYLE, Drawer, Code, Section } from '../components/ui';
import type { CourseState, CourseStatusItem } from '../../../shared/src/types';
import { CATEGORY_LABELS, STATE_LABELS, YEAR_LABELS, TERM_LABELS, RECORD_STATUS_LABELS, slotLabel } from '../../../shared/src/labels';

const FILTERS: (CourseState | 'all')[] = ['all', 'passed', 'registered', 'available', 'failed_retake', 'conditional', 'blocked'];

export function CourseDetail({ c, all }: { c: CourseStatusItem; all: CourseStatusItem[] }) {
  const dependents = all.filter((x) => x.prerequisites.some((p) => p.code === c.code));
  return (
    <div className="space-y-4 text-[15px]">
      <div className="flex flex-wrap items-center gap-2"><Code>{c.code}</Code><StateTag state={c.state} /></div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-muted">الساعات المعتمدة</dt><dd className="num font-semibold">{c.credits}</dd></div>
        <div><dt className="text-muted">الفئة</dt><dd className="font-semibold">{CATEGORY_LABELS[c.category]}</dd></div>
        <div className="col-span-2"><dt className="text-muted">موقعه في الخطة الاسترشادية</dt><dd className="font-semibold">{c.suggestedYear ? slotLabel(c.suggestedYear, c.suggestedTerm ?? 1) : 'غير محدد بفصل (يُسجَّل حسب توفر المكان)'}</dd></div>
      </dl>
      <div>
        <h3 className="mb-1 text-sm font-semibold">المتطلبات السابقة</h3>
        {c.prerequisites.length === 0 ? <p className="text-sm text-muted">لا يوجد متطلب سابق.</p> : (
          <ul className="space-y-1 text-sm">
            {c.prerequisites.map((p) => <li key={p.code} className="flex items-center justify-between gap-2"><span>{p.nameAr} <Code>{p.code}</Code></span><span className={p.met ? 'text-pass' : p.registered ? 'text-reg' : 'text-fail'}>{p.met ? 'مستوفى' : p.registered ? 'مسجل حاليًا' : 'غير مستوفى'}</span></li>)}
          </ul>
        )}
      </div>
      {c.corequisites.length > 0 && <div><h3 className="mb-1 text-sm font-semibold">المتطلبات المتزامنة</h3><p className="text-sm">{c.corequisites.map((p) => p.nameAr).join('، ')}</p></div>}
      {c.blockedReasons.length > 0 && (
        <div className="rounded-lg border border-fail/30 bg-fail/[0.05] p-3">
          <h3 className="mb-1 text-sm font-semibold text-fail">سبب عدم الإتاحة</h3>
          <ul className="list-inside list-disc text-sm">{c.blockedReasons.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      {c.attempts.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">محاولاتك في هذا المساق</h3>
          <ul className="text-sm">{c.attempts.map((a, i) => <li key={i} className="flex justify-between border-b border-line py-1"><span className="code">{a.termCode}</span><span>{a.status ? RECORD_STATUS_LABELS[a.status] : 'بلا حالة'}{a.grade != null && <span className="num text-muted"> – {a.grade}</span>}</span></li>)}</ul>
          {c.attempts.length > 1 && <p className="mt-1 text-xs text-muted">تُحتسب ساعات المساق مرة واحدة فقط مهما تعددت المحاولات.</p>}
          {c.countedAs && <p className="mt-1 text-xs text-muted">{c.countedAs}</p>}
        </div>
      )}
      {dependents.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">مساقات تعتمد عليه مباشرة</h3>
          <p className="text-sm">{dependents.map((d) => d.nameAr).join('، ')}</p>
          <p className="mt-1 text-xs text-muted">يعتمد عليه إجمالًا (مباشرة وغير مباشرة) {c.unlocksCount} مساقًا.</p>
        </div>
      )}
    </div>
  );
}

function Chip({ c, onOpen }: { c: CourseStatusItem; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className={`w-full rounded-lg border px-3 py-2 text-start transition-colors hover:shadow-sm ${STATE_STYLE[c.state].cls}`}>
      <span className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-ink">{c.nameAr}</span>
        <span className="num shrink-0 text-xs text-muted">{c.credits} س</span>
      </span>
      <span className="mt-0.5 flex items-center justify-between gap-2 text-xs">
        <Code>{c.code}</Code>
        <span>{STATE_LABELS[c.state]}</span>
      </span>
    </button>
  );
}

export function PlanPage() {
  const { report: r } = useReport();
  const [filter, setFilter] = useState<CourseState | 'all'>('all');
  const [open, setOpen] = useState<CourseStatusItem | null>(null);
  const match = (c: CourseStatusItem) => filter === 'all' || c.state === filter;
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f, f === 'all' ? r.courses.length : r.courses.filter((c) => c.state === f).length])), [r]);
  const slots = [1, 2, 3, 4].map((y) => ({ y, terms: [1, 2].map((t) => ({ t, list: r.courses.filter((c) => c.suggestedYear === y && c.suggestedTerm === t) })) }));
  const flexible = (['UNI_REQ', 'UNI_ELEC', 'COL_ELEC', 'MAJ_ELEC'] as const).map((cat) => ({ cat, list: r.courses.filter((c) => c.category === cat && !c.suggestedYear), prog: r.categories.find((x) => x.category === cat) }));
  const nextPos = r.planPosition;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-olive-deep">الخطة الدراسية</h1>
        <p className="mt-1 text-sm text-muted">{r.plan?.label} – {r.plan?.selectionReason}. اضغط على أي مساق لعرض متطلباته وسبب حالته.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="تصفية حسب الحالة">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
            className={`tag border px-3 py-1 text-sm ${filter === f ? 'border-olive bg-olive text-white' : 'border-line bg-surface text-ink hover:bg-olive-soft'}`}>
            {f === 'all' ? 'الكل' : STATE_LABELS[f]} <span className="num opacity-75">{counts[f]}</span>
          </button>
        ))}
      </div>

      {slots.map(({ y, terms }) => (
        <section key={y}>
          <h2 className="mb-2 text-lg font-semibold">{YEAR_LABELS[y]}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {terms.map(({ t, list }) => {
              const isNext = nextPos && nextPos.year === y && nextPos.term === t;
              const shown = list.filter(match);
              return (
                <div key={t} className={`panel p-3 ${isNext ? 'ring-2 ring-olive/50' : ''}`}>
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-semibold">{TERM_LABELS[t]} {isNext && <span className="tag mr-1 bg-olive-soft text-olive">الفصل القادم حسب موقعك</span>}</span>
                    <span className="num text-muted">{list.reduce((s, c) => s + c.credits, 0)} س محددة</span>
                  </div>
                  <div className="grid gap-2">
                    {shown.map((c) => <Chip key={c.code} c={c} onOpen={() => setOpen(c)} />)}
                    {shown.length === 0 && <p className="py-2 text-center text-xs text-muted">لا توجد مساقات بهذه الحالة</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <Section title="متطلبات تُسجَّل دون فصل محدد" aside="الخطة الاسترشادية تذكر لها خانات عامة فقط">
        <div className="space-y-5">
          {flexible.map(({ cat, list, prog }) => {
            const shown = list.filter(match);
            if (!list.length) return null;
            return (
              <div key={cat}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{CATEGORY_LABELS[cat]}</h3>
                  {prog && <span className="num text-sm text-muted">أنجزت {prog.earned} من {prog.required} ساعة{prog.surplus ? ` (+${prog.surplus} زائدة لا تُحتسب)` : ''}</span>}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {shown.map((c) => <Chip key={c.code} c={c} onOpen={() => setOpen(c)} />)}
                </div>
                {shown.length === 0 && <p className="text-xs text-muted">لا توجد مساقات بهذه الحالة</p>}
              </div>
            );
          })}
        </div>
      </Section>

      {r.outOfPlanCourses.length > 0 && (
        <Section title="مساقات مجتازة خارج الخطة">
          <ul className="text-sm">{r.outOfPlanCourses.map((c) => <li key={c.code}>{c.nameAr} <Code>{c.code}</Code> – لا تُحتسب ضمن ساعات التخرج ما لم تُعتمد لها معادلة.</li>)}</ul>
        </Section>
      )}

      <Drawer open={!!open} onClose={() => setOpen(null)} title={open?.nameAr ?? ''}>
        {open && <CourseDetail c={open} all={r.courses} />}
      </Drawer>
    </div>
  );
}
