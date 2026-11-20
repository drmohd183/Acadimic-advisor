import { Link } from 'react-router-dom';
import { api } from '../../api';
import { useLoad } from '../../components/useLoad';
import { Loading, ErrorBox, Section, AlertItem } from '../../components/ui';

export function AdminOverview() {
  const { data, err, reload } = useLoad(() => api.admin.overview());
  if (err) return <ErrorBox error={err} onRetry={reload} />;
  if (!data) return <Loading />;
  const c = data.counts;
  const order: Record<string, number> = { danger: 0, warning: 1, info: 2 };
  const issues = [...data.issues].sort((a: any, b: any) => order[a.level] - order[b.level]);
  const stats = [
    ['الطلبة', c.students, `${c.demo_students} منهم تجريبيون`, '/admin/students'],
    ['إصدارات الخطط', c.plans, `${c.approved_plans} معتمدة`, '/admin/plans'],
    ['المساقات في الدليل', c.courses, '', '/admin/courses'],
    ['الفصل الحالي', c.current_term ?? 'غير محدد', '', '/admin/terms'],
    ['أخطاء آخر 7 أيام', c.errors_7d, '', '/admin/logs'],
  ];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-olive-deep">لوحة إدارة النظام</h1>
        <p className="mt-1 text-sm text-muted">دور الإدارة تهيئة البيانات الرسمية وصيانتها؛ الإرشاد اليومي للطلبة يعمل آليًا. وضع التشغيل: {data.appMode === 'demo' ? 'نموذج تجريبي مستقل' : 'النظام الفعلي'}.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map(([k, v, sub, to]) => (
          <Link key={k as string} to={to as string} className="panel p-4 hover:border-olive/50">
            <p className="text-xs text-muted">{k}</p>
            <p className="num mt-1 font-display text-2xl font-semibold text-olive-deep">{v}</p>
            {sub && <p className="text-xs text-muted">{sub}</p>}
          </Link>
        ))}
      </div>
      <Section title="فحص سلامة البيانات" aside={`${issues.length} ملاحظة`}>
        <p className="mb-3 text-sm text-muted">ملاحظات آلية على الخطط والقواعد المحمّلة. لا يمكن اعتماد خطة فيها ملاحظة حرجة.</p>
        <div className="space-y-2">{issues.map((i: any, k: number) => <AlertItem key={k} a={{ level: i.level, text: (i.plan ? `${i.plan}: ` : '') + i.text }} />)}</div>
      </Section>
      <Section title="المساعد الذكي">
        <p className="text-sm">
          {data.llm.available ? 'النموذج اللغوي الخارجي مفعّل ويتلقى سياقًا مجهّلًا فقط، مع رفض أي إجابة تذكر مساقات غير موجودة.' : 'يعمل المساعد بمحرك قواعد محلي مقيّد ببيانات الخطة والسجل، دون إرسال أي بيانات خارج النظام.'}
          {!data.llm.configured && ' لتفعيل نموذج لغوي اضبط LLM_PROVIDER و LLM_API_KEY و LLM_MODEL في الخادم ثم فعّل القاعدة llmEnabled.'}
        </p>
      </Section>
    </div>
  );
}
