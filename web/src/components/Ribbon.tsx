// شريط الساعات المعتمدة: خلية لكل ساعة من ساعات الخطة، مجمّعة حسب فئة المتطلب
import type { AdvisingReport } from '../../../shared/src/types';
import { CATEGORY_LABELS } from '../../../shared/src/labels';

const SHORT: Record<string, string> = { UNI_REQ: 'جامعة إجباري', UNI_ELEC: 'جامعة اختياري', COL_REQ: 'كلية إجباري', COL_ELEC: 'كلية اختياري', MAJ_REQ: 'تخصص إجباري', MAJ_ELEC: 'تخصص اختياري' };

export function Ribbon({ report, compact = false }: { report: AdvisingReport; compact?: boolean }) {
  const cats = report.categories.filter((c) => c.countsTowardTotal);
  let i = 0;
  return (
    <div>
      <div className="flex flex-wrap gap-x-[6px] gap-y-3" aria-label={`أنجزت ${report.credits.earned} من ${report.credits.required} ساعة`}>
        {cats.map((c) => {
          const reg = Math.min(c.registered, c.remaining);
          const cells = Array.from({ length: c.required }, (_, k) => (k < c.earned ? 'e' : k < c.earned + reg ? 'r' : 'n'));
          return (
            <div key={c.category} className="min-w-0" title={`${CATEGORY_LABELS[c.category]}: ${c.earned}/${c.required}`}>
              <div className="flex gap-[2px]" aria-hidden>
                {cells.map((s, k) => (
                  <span key={k} className={`ribbon-cell block rounded-[2px] ${compact ? 'h-5 w-[5px]' : 'h-8 w-[6px] sm:w-[7px]'} ${s === 'e' ? 'bg-pass' : s === 'r' ? 'bg-reg/70' : 'bg-line'}`} style={{ animationDelay: `${(i++) * 4}ms` }} />
                ))}
              </div>
              {!compact && <p className="mt-1 text-[11px] leading-tight text-muted">{SHORT[c.category]} <span className="num">{c.earned}/{c.required}</span></p>}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5"><span className="h-3 w-2 rounded-[2px] bg-pass" />مجتازة {report.credits.earned}</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-2 rounded-[2px] bg-reg/70" />مسجلة {report.credits.registered}</span>
        <span className="flex items-center gap-1.5"><span className="h-3 w-2 rounded-[2px] bg-line" />متبقية {report.credits.remaining}</span>
      </div>
    </div>
  );
}
