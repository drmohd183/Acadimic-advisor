/**
 * طبقة النموذج اللغوي (اختيارية ومعطلة افتراضيًا)
 * - تُرسل سياقًا مجهّلًا فقط (بلا اسم ولا رقم جامعي).
 * - تُقيَّد الإجابة ببيانات السياق؛ وأي رمز مساق غير موجود في الخطة يؤدي لرفض الإجابة والرجوع للمحرك المحلي.
 */
import { config } from '../config';
import { buildGroundedContext, answerQuestion, type AssistantAnswer } from '../../../shared/src/assistant';
import type { AdvisingReport } from '../../../shared/src/types';
import { q } from '../db/pool';

const SYSTEM = `أنت مرشد أكاديمي آلي لقسم نظم المعلومات. أجب بالعربية الفصحى المبسطة وباختصار.
قواعد صارمة:
1) اعتمد فقط على بيانات JSON المرفقة (خطة الطالب وسجله وتقرير المحرك). لا تخترع مساقات أو رموزًا أو متطلبات أو حدود ساعات أو معدلات أو قرارات.
2) إذا لم تكفِ البيانات للإجابة، قل ذلك صراحة واقترح مراجعة الجهة المختصة.
3) لا تغيّر توصيات المحرك؛ اشرحها فقط. اذكر رموز المساقات كما وردت.
4) لا تعِد بموعد تخرج مؤكد؛ التقدير مشروط.
5) لا تطلب بيانات شخصية.`;

export function llmAvailable(enabledByRule: boolean) {
  return enabledByRule && config.llm.provider === 'anthropic' && !!config.llm.apiKey && !!config.llm.model;
}

export async function askLLM(report: AdvisingReport, question: string): Promise<AssistantAnswer> {
  const local = answerQuestion(report, question);
  try {
    const ctx = buildGroundedContext(report);
    const res = await fetch(`${config.llm.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': config.llm.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: config.llm.model,
        max_tokens: 700,
        system: SYSTEM,
        messages: [{ role: 'user', content: `البيانات:\n${JSON.stringify(ctx)}\n\nإجابة المحرك المحلي (مرجعية):\n${local.answer}\n\nسؤال الطالب: ${question.slice(0, 500)}` }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data: any = await res.json();
    const text: string = (data.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
    // التحقق: كل رمز مساق مذكور يجب أن يكون في الخطة
    const known = new Set(report.courses.map((c) => c.code));
    const mentioned = text.match(/\b\d{8}\b/g) ?? [];
    const bad = mentioned.filter((m) => !known.has(m));
    if (!text || bad.length) {
      await q('INSERT INTO error_logs (level, message, context) VALUES ($1,$2,$3)', ['warn', 'LLM answer rejected (unknown course codes)', JSON.stringify({ bad })]);
      return local;
    }
    return { ...local, answer: text + (report.reliability !== 'final' ? `\n\nملاحظة: ${report.reliabilityText}` : ''), engine: 'llm' };
  } catch (e: any) {
    await q('INSERT INTO error_logs (level, message, context) VALUES ($1,$2,$3)', ['warn', 'LLM call failed – fallback to rules', JSON.stringify({ err: String(e?.message ?? e) })]);
    return local;
  }
}
