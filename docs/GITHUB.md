# تشغيل المرشد الأكاديمي عبر GitHub

يعمل المشروع على GitHub بأربع طرق مستقلة. لم يتغير أي شيء في البرنامج نفسه: لا المتطلبات، ولا القواعد، ولا الواجهات، ولا قاعدة البيانات، ولا الاختبارات. كل ما أضيف ملفات تشغيل خاصة بـ GitHub.

| الطريقة | ماذا تعطي | الملف |
|---|---|---|
| **GitHub Pages** | رابط عام لنسخة العرض، تعمل في المتصفح دون خادم | `.github/workflows/pages.yml` |
| **GitHub Actions (CI)** | فحص الأنواع والاختبارات الـ90 والبناء تلقائيًا عند كل تعديل | `.github/workflows/ci.yml` |
| **GitHub Codespaces** | النظام الكامل (الخادم + PostgreSQL) في المتصفح بنقرة واحدة | `.devcontainer/` |
| **GitHub Container Registry** | صورة Docker جاهزة للإنتاج يسحبها خادم الجامعة | `.github/workflows/docker.yml` + `deploy/docker-compose.ghcr.yml` |

---

## 1. رفع المشروع إلى GitHub (مرة واحدة)

1. أنشئ مستودعًا جديدًا فارغًا على github.com (دون README أو .gitignore)، مثلًا `smart-advisor`.
2. من مجلد المشروع:

```bash
git remote add origin https://github.com/<اسم-المستخدم>/smart-advisor.git
git push -u origin main
```

المجلد مهيأ مسبقًا كمستودع git وفيه أول إيداع (commit). إن حذفت مجلد `.git` فابدأ بـ `git init -b main && git add . && git commit -m "first"`.

> **الخصوصية:** يُفضَّل أن يكون المستودع **خاصًا (Private)**. البيانات فيه افتراضية، لكن ملفات Word الأصلية للخطط موجودة في `docs/source-plans/`. لاحظ أن GitHub Pages لمستودع خاص يحتاج اشتراكًا مدفوعًا (Pro أو Team أو Enterprise). أما في الحساب المجاني فيلزم أن يكون المستودع عامًا.

## 2. تفعيل GitHub Pages (نسخة العرض)

1. في المستودع: **Settings ← Pages**.
2. في **Source** اختر **GitHub Actions**.
3. من تبويب **Actions** شغّل «Deploy demo to GitHub Pages»، أو ادفع أي تعديل إلى `main`.

الرابط: `https://<اسم-المستخدم>.github.io/smart-advisor/`

- هي نفسها `dist-demo/index.html`: نفس المحرك والمساعد والخطط والسيناريوهات التجريبية الاثنا عشر.
- الحسابات: `admin` / `Admin@2026`، وأي رقم جامعي تجريبي / `Demo@2026`.
- التعديلات مؤقتة في ذاكرة المتصفح وتزول عند إعادة التحميل، كما في README تمامًا.
- لا تُدخل فيها بيانات طلبة حقيقيين؛ هي للعرض فقط.

## 3. الاختبارات التلقائية (CI)

تعمل تلقائيًا عند كل `push` إلى `main` وعند كل طلب دمج. تنشئ قاعدة PostgreSQL 16 مؤقتة ثم:

1. `npm run typecheck`
2. `npm test`: الاختبارات الـ90 (`engine` و`courseCheck` و`api` و`production`)
3. `npm run build` و`npm run build:demo`

النتيجة تظهر في تبويب **Actions** (علامة ✓ أو ✗ بجانب كل إيداع). ويُرفق بكل تشغيل ملف `smart-advisor-demo` قابل للتنزيل يحوي نسخة العرض.

## 4. النظام الكامل في GitHub Codespaces

لتجربة النسخة الحقيقية (الخادم + PostgreSQL + لوحة الإدارة + الاستيراد) دون تثبيت أي شيء:

1. في صفحة المستودع: **Code ← Codespaces ← Create codespace on main**.
2. انتظر الإعداد الأول (بضع دقائق). يُنفَّذ تلقائيًا:
   - `npm ci`
   - `npm run setup`: المخطط والخطط المستوردة والبيانات التجريبية وبناء الواجهة.
3. يبدأ الخادم بالأمر `npm start` ويفتح المنفذ 4000 في المتصفح.

أوامر مفيدة داخل Codespaces:

```bash
npm test                  # الاختبارات الـ90 (قاعدة advisor_test جاهزة)
npm run dev:server        # وضع التطوير، وفي نافذة ثانية:
npm run dev:web           # http://localhost:5173 (يُفتح عبر المنفذ المُمرَّر)
npm run db:reset          # إعادة البيانات التجريبية لحالتها الأولى
```

- الرابط المُمرَّر خاص بصاحب الحساب افتراضيًا. لمشاركته: تبويب **Ports**، ثم زر الفأرة الأيمن على 4000، ثم **Port Visibility**.
- Codespaces بيئة تجربة وتطوير، وليست بيئة إنتاج. تتوقف بعد فترة خمول، ولها حصة ساعات مجانية شهرية.

## 5. الإنتاج على خادم الجامعة من صورة GitHub الجاهزة

عند كل دفع إلى `main` تُبنى صورة Docker من `deploy/Dockerfile` نفسه وتُنشر على:
`ghcr.io/<اسم-المستخدم>/smart-advisor:latest`

وعند وسم إصدار (`git tag v1.1.0 && git push --tags`) تُنشر أيضًا بالوسم `1.1.0`.

على خادم الجامعة، بدل البناء المحلي الموصوف في `deploy/DEPLOY.md` (القسم 2):

```bash
# المستودع الخاص يحتاج دخولًا برمز وصول شخصي بصلاحية read:packages
docker login ghcr.io -u <اسم-المستخدم>

export APP_IMAGE=ghcr.io/<اسم-المستخدم>/smart-advisor:latest
docker compose -f deploy/docker-compose.ghcr.yml --env-file deploy/.env.production pull
docker compose -f deploy/docker-compose.ghcr.yml --env-file deploy/.env.production up -d
```

- `docker-compose.ghcr.yml` مطابق لـ `docker-compose.prod.yml`. الفرق الوحيد أن التطبيق يُسحب جاهزًا.
- كل ما بعد ذلك يبقى كما في `DEPLOY.md`: Nginx وHTTPS والنسخ الاحتياطي، والوضع `APP_MODE=production`، وإلزام `SEED_ADMIN_PASSWORD`.
- **التحديث لاحقًا:** نفّذ `pull` ثم `up -d`.

## 6. الأسرار (Secrets)

لا تحتاج أي من مسارات العمل أسرارًا إضافية؛ `GITHUB_TOKEN` يُمنح تلقائيًا.

لا تضع ملف `.env` أو `deploy/.env.production` أو أي كلمة مرور أو `LLM_API_KEY` في المستودع. هي مستثناة في `.gitignore`. إن احتجت مفتاحًا داخل Codespaces فضعه في **Settings ← Secrets and variables ← Codespaces**.
