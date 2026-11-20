import { useEffect, useRef, type ReactNode } from 'react';
import type { Alert, CourseState, Priority } from '../../../shared/src/types';
import { STATE_LABELS, PRIORITY_LABELS } from '../../../shared/src/labels';

export const STATE_STYLE: Record<CourseState, { cls: string; dot: string }> = {
  passed: { cls: 'bg-pass/10 text-pass border-pass/30', dot: 'bg-pass' },
  registered: { cls: 'bg-reg/10 text-reg border-reg/30', dot: 'bg-reg' },
  available: { cls: 'bg-avail/10 text-avail border-avail/40', dot: 'bg-avail' },
  failed_retake: { cls: 'bg-fail/10 text-fail border-fail/40', dot: 'bg-fail' },
  conditional: { cls: 'bg-reg/5 text-reg border-reg/40 border-dashed', dot: 'bg-reg/50' },
  blocked: { cls: 'bg-block/10 text-muted border-block/30', dot: 'bg-block' },
};

export function StateTag({ state }: { state: CourseState }) {
  const s = STATE_STYLE[state];
  return <span className={`tag border ${s.cls}`}><span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden />{STATE_LABELS[state]}</span>;
}

export function PriorityTag({ p }: { p: Priority }) {
  const cls = p === 'high' ? 'bg-fail/10 text-fail' : p === 'medium' ? 'bg-avail/10 text-avail' : 'bg-olive-soft text-olive';
  return <span className={`tag ${cls}`}>{PRIORITY_LABELS[p]}</span>;
}

export function Code({ children }: { children: ReactNode }) {
  return <span className="code text-xs text-muted">{children}</span>;
}

const ALERT_STYLE = {
  danger: 'border-fail/40 bg-fail/[0.06] text-ink',
  warning: 'border-avail/40 bg-avail/[0.07] text-ink',
  info: 'border-line bg-surface text-ink',
  success: 'border-pass/40 bg-pass/[0.07] text-ink',
};
const ALERT_ICON = { danger: '!', warning: '!', info: 'i', success: '✓' };
const ALERT_ICON_CLS = { danger: 'bg-fail text-white', warning: 'bg-avail text-white', info: 'bg-muted/70 text-white', success: 'bg-pass text-white' };

export function AlertItem({ a }: { a: Pick<Alert, 'level' | 'text'> }) {
  return (
    <div role={a.level === 'danger' ? 'alert' : undefined} className={`flex gap-3 rounded-lg border p-3 text-sm ${ALERT_STYLE[a.level]}`}>
      <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-bold ${ALERT_ICON_CLS[a.level]}`} aria-hidden>{ALERT_ICON[a.level]}</span>
      <p>{a.text}</p>
    </div>
  );
}

export function Section({ title, aside, children, className = '' }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel p-4 sm:p-5 ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-olive-deep">{title}</h2>
        {aside && <div className="text-sm text-muted">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Loading({ text = 'جارٍ التحميل…' }: { text?: string }) {
  return <div className="flex items-center gap-3 p-8 text-muted" role="status"><span className="h-4 w-4 animate-spin rounded-full border-2 border-olive border-t-transparent" />{text}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="panel m-4 border-fail/40 p-5" role="alert">
      <p className="font-semibold text-fail">تعذّر تحميل البيانات</p>
      <p className="mt-1 text-sm">{error}</p>
      {onRetry && <button className="btn-ghost mt-3" onClick={onRetry}>إعادة المحاولة</button>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-muted">{children}</p>;
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => { window.removeEventListener('keydown', k); prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-start" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <button className="absolute inset-0 bg-ink/30" aria-label="إغلاق" onClick={onClose} tabIndex={-1} />
      <div ref={ref} tabIndex={-1} className="relative ms-auto h-full w-full max-w-lg overflow-y-auto bg-surface p-5 shadow-xl outline-none">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-olive-deep">{title}</h2>
          <button className="btn-ghost px-2 py-1" onClick={onClose} aria-label="إغلاق">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Meter({ value, max, cls = 'bg-olive', label }: { value: number; max: number; cls?: string; label?: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-line/70" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <div className={`h-full rounded-full ${cls}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Toast({ msg, kind, onDone }: { msg: string; kind: 'ok' | 'err'; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3800); return () => clearTimeout(t); }, [onDone]);
  return <div role="status" className={`fixed bottom-4 left-4 z-[60] max-w-sm rounded-lg px-4 py-3 text-sm shadow-lg ${kind === 'ok' ? 'bg-olive text-white' : 'bg-fail text-white'}`}>{msg}</div>;
}
