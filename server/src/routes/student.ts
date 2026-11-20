import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, audit } from '../auth';
import { getReport, loadRules } from '../services/advising';
import { answerQuestion } from '../../../shared/src/assistant';
import { askLLM, llmAvailable } from '../services/llm';
import { q } from '../db/pool';
import { ah } from '../util';

export const studentRouter = Router();
studentRouter.use(requireAuth('student'));

// كل المسارات تستخدم رقم الطالب من الجلسة فقط؛ لا يمكن تمرير رقم طالب آخر
studentRouter.get('/report', ah(async (req, res) => {
  const r = await getReport(req.user!.studentId!, { snapshot: true });
  if (!r) return res.status(404).json({ error: 'لم يُعثر على بيانات الطالب.' });
  res.json(r);
}));

studentRouter.get('/records', ah(async (req, res) => {
  const rows = await q(`SELECT r.course_code, c.name_ar, c.credits, r.term_code, t.name_ar AS term_name, r.status, r.grade
      FROM student_course_records r JOIN courses c ON c.code = r.course_code JOIN academic_terms t ON t.code = r.term_code
     WHERE r.student_id = $1 ORDER BY t.year_start, t.term_no, r.course_code`, [req.user!.studentId]);
  res.json(rows);
}));

studentRouter.get('/history', ah(async (req, res) => {
  res.json(await q('SELECT id, term_code, engine_version, reliability, summary, generated_at FROM advising_recommendations WHERE student_id = $1 ORDER BY generated_at DESC LIMIT 20', [req.user!.studentId]));
}));

const Ask = z.object({ question: z.string().trim().min(2).max(500) });
studentRouter.post('/assistant', ah(async (req, res) => {
  const { question } = Ask.parse(req.body);
  const r = await getReport(req.user!.studentId!);
  if (!r) return res.status(404).json({ error: 'لم يُعثر على بيانات الطالب.' });
  const rules = await loadRules();
  const ans = llmAvailable(rules.llmEnabled) ? await askLLM(r, question) : answerQuestion(r, question);
  await audit(req, 'ASSISTANT_QUERY', 'student', req.user!.studentId, { intent: ans.intent, engine: ans.engine, confidence: ans.confidence });
  res.json(ans);
}));
