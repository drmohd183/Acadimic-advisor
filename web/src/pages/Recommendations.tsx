import { useState } from 'react';
import { useReport } from '../App';
import { PriorityTag, Code, Section, Empty, Drawer } from '../components/ui';
import type { Recommendation, CourseStatusItem } from '../../../shared/src/types';
import { CATEGORY_LABELS } from '../../../shared/src/labels';
import { CourseDetail } from './Plan';

function RecCard({ x, onCourse }: { x: Recommendation; onCourse: (code: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`rounded-card border p-4 ${x.conditionalOn ? 'border-dashed border-reg/50 bg-reg/[0.03]' : 'border-line bg-surface'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">
            {x.code ? <button className="text-start hover:underline" onClick={() => onCourse(x.code!)}>{x.nameAr}</button> : x.nameAr} {x.code && <Code>{x.code}</Code>}
          </h3>
          <p className="mt-0.5 text-sm text-muted">{CATEGORY_LABELS[x.category]} – <span className="num">{x.credits}</span> ساعات</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {x.conditionalOn ? <span className="tag border border-dashed border-reg/50 text-reg">مشروط بنتيجة الفصل الحالي</span> : <span className="tag bg-pass/10 text-pass">المتطلبات مستوفاة</span>}
          <PriorityTag p={x.priority} />
        </div>
      </div>
      <p className="mt-2 text-[15px]">{x.reasons[0]?.text}</p>
      {x.kind === 'elective_choice' && x.options && (
        <div className="mt-2">
          <p className="text-sm font-medium">خيارات استوفيت متطلباتها:</p>
          <div className="mt-1 flex flex-wrap gap-1.5">{x.options.map((o) => <button key={o.code} onClick={() => onCourse(o.code)} className="tag border border-line bg-paper text-ink hover:bg-olive-soft">{o.nameAr} <span className="code">{o.code}</span></button>)}</div>
        </div>
      )}
      {x.warnings.length > 0 && <ul className="mt-2 space-y-1 text-sm text-avail">{x.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>}
      <button className="mt-2 text-sm font-medium text-olive hover:underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'إخفاء كل الأسباب' : 'لماذا هذا المساق؟'}</button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-line pt-2 text-sm">
          <ul className="space-y-1">{x.reasons.map((r, i) => <li key={i} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-olive" />{r.text}</li>)}</ul>
          {x.prerequisites.length > 0 && <p className="text-muted">المتطلبات السابقة: {x.prerequisites.map((p) => `${p.nameAr} (${p.met ? 'مستوفى' : 'غير مستوفى بعد'})`).join('، ')}</p>}
        </div>
      )}
    </li>
  );
}

export function RecommendationsPage() {
  const { report: r } = useReport();
  const [course, setCourse] = useState<CourseStatusItem | null>(null);
  const onCourse = (code: string) => setCourse(r.courses.find((c) => c.code === code) ?? null);
  const inc = r.recommendations.filter((x) => x.included);
  const rest = r.recommendations.filter((x) => !x.included && !(x.kind === 'elective_choice' && !x.options?.length));
  const total = inc.reduce((s, x) => s + x.credits, 0);
  const condOnly = r.conditional.filter((c) => !r.recommendations.some((x) => x.code === c.code));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-olive-deep">المساقات المقترحة – {r.nextTerm?.nameAr ?? 'الفصل القادم'}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">مرتبة حسب الأولوية الأكاديمية. لا يقترح المرشد مساقًا لم تستوفِ متطلبه السابق؛ والمساقات «المشروطة» تُتاح فقط إذا نجحت في المساق المسجل حاليًا.</p>
      </div>
      <Section title="الحزمة المقترحة" aside={<span className="num">{total} ساعة من عبء مرجعي {r.loadLimit.credits}</span>}>
        <p className="mb-3 rounded-lg bg-olive-soft/60 p-3 text-sm">{r.loadLimit.text}</p>
        {inc.length === 0 ? <Empty>لا توجد مساقات مقترحة للفصل القادم حسب بياناتك الحالية.</Empty> : <ul className="space-y-3">{inc.map((x, i) => <RecCard key={i} x={x} onCourse={onCourse} />)}</ul>}
      </Section>
      {rest.length > 0 && (
        <Section title="خيارات إضافية متاحة" aside="خارج حدود العبء المرجعي أو بأولوية أقل">
          <ul className="space-y-3">{rest.map((x, i) => <RecCard key={i} x={x} onCourse={onCourse} />)}</ul>
        </Section>
      )}
      {condOnly.length > 0 && (
        <Section title="ستُتاح بعد ظهور نتائج الفصل الحالي">
          <ul className="grid gap-2 sm:grid-cols-2">{condOnly.map((c) => <li key={c.code} className="rounded-lg border border-dashed border-reg/40 p-3 text-sm"><button className="font-medium hover:underline" onClick={() => setCourse(c)}>{c.nameAr}</button> <Code>{c.code}</Code><p className="text-muted">{c.blockedReasons.join('؛ ')}</p></li>)}</ul>
        </Section>
      )}
      <Drawer open={!!course} onClose={() => setCourse(null)} title={course?.nameAr ?? ''}>{course && <CourseDetail c={course} all={r.courses} />}</Drawer>
    </div>
  );
}
