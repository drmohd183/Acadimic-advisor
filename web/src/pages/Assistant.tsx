import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { AssistantAnswer } from '../../../shared/src/assistant';

const SUGGESTED = [
  'ما المواد التي تنصحني بتسجيلها في الفصل القادم؟',
  'لماذا لا أستطيع تسجيل نظم قواعد البيانات؟',
  'ما المواد التي يجب أن أجتازها قبل دراسة أمن الشبكات؟',
  'كم ساعة بقيت لي حتى التخرج؟',
  'هل يوجد تأخر في خطتي الدراسية؟',
  'ما المواد التي يجب أن أعيد دراستها؟',
  'ما المتطلبات المتبقية عليّ للتخرج؟',
];

type Msg = { role: 'user' | 'bot'; text: string; meta?: AssistantAnswer };

export function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'bot', text: 'أهلًا بك. أجيب عن أسئلتك اعتمادًا على خطتك الدراسية وسجلك الأكاديمي فقط، وأخبرك صراحة إذا لم تكفِ البيانات للإجابة.' }]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs]);

  const ask = async (text: string) => {
    const t = text.trim();
    if (t.length < 2 || busy) return;
    setMsgs((m) => [...m, { role: 'user', text: t }]);
    setQ('');
    setBusy(true);
    try {
      const a = await api.student.ask(t);
      setMsgs((m) => [...m, { role: 'bot', text: a.answer, meta: a }]);
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'bot', text: `تعذر الحصول على إجابة: ${e.message}` }]);
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); ask(q); };

  return (
    <div className="flex h-[calc(100vh-11rem)] min-h-[480px] flex-col">
      <h1 className="text-2xl font-bold text-olive-deep">المساعد الذكي</h1>
      <p className="mt-1 text-sm text-muted">يعمل محليًا ولا يرسل بياناتك إلى خدمات خارجية ما لم تفعّل الإدارة ذلك بضوابط خصوصية.</p>
      <div className="panel mt-4 flex-1 overflow-y-auto p-4" aria-live="polite">
        <div className="space-y-4">
          {msgs.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-[15px] ${m.role === 'user' ? 'rounded-ss-md bg-olive text-white' : 'rounded-se-md border border-line bg-paper'}`}>
                <p className="whitespace-pre-line leading-7">{m.text}</p>
                {m.meta && (
                  <p className="mt-2 border-t border-line pt-1.5 text-xs text-muted">
                    {m.meta.confidence === 'none' ? 'لم تتوفر بيانات كافية للإجابة بثقة' : m.meta.confidence === 'limited' ? 'إجابة محدودة الثقة – راجع الافتراضات' : 'مستندة إلى بياناتك'}
                    {m.meta.sources.length > 0 && ` – ${m.meta.sources[0]}`}
                    {m.meta.engine === 'llm' && ' – صياغة بالنموذج اللغوي'}
                  </p>
                )}
              </div>
            </div>
          ))}
          {busy && <p className="text-end text-sm text-muted">يبحث المرشد في خطتك…</p>}
          <div ref={end} />
        </div>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
        {SUGGESTED.map((s) => <button key={s} onClick={() => ask(s)} disabled={busy} className="tag shrink-0 border border-line bg-surface px-3 py-1.5 text-sm text-ink hover:bg-olive-soft">{s}</button>)}
      </div>
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <label htmlFor="q" className="sr-only">سؤالك</label>
        <input id="q" className="input flex-1 py-2.5" maxLength={500} placeholder="اكتب سؤالك، مثل: ما متطلبات مشروع تخرج (2)؟" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-primary px-6" disabled={busy || q.trim().length < 2}>إرسال</button>
      </form>
    </div>
  );
}
