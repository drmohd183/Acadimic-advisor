# دليل نشر «المرشد الأكاديمي» على خوادم الجامعة

موجّه إلى مركز تكنولوجيا المعلومات في جامعة فلسطين التقنية – خضوري.

**الهدف:** تشغيل التطبيق كخدمة مستقلة على نطاق فرعي، بنفس نمط خدمات الجامعة الحالية مثل `lms.ptuk.edu.ps` و`exam.ptuk.edu.ps`. ثم إضافة رابط إليه في صفحة قسم نظم المعلومات.

الاسم المقترح للنطاق: **`advisor.ptuk.edu.ps`**. أي اسم آخر يعمل بتعديل سطر واحد في إعداد Nginx وفي رابط صفحة القسم.

---

## 1. المتطلبات

| البند | الحد الأدنى المقترح لـ300 طالب |
|---|---|
| الخادم | Linux (Ubuntu 22.04/24.04 أو ما يماثله)، معالجان، ذاكرة 2 غيغابايت، قرص 20 غيغابايت |
| البرامج | **إما** Docker مع Docker Compose، **أو** Node.js 20+ مع PostgreSQL 14+ |
| الشبكة | نطاق فرعي يشير إلى الخادم، وشهادة HTTPS (شهادة الجامعة أو Let's Encrypt)، والمنفذان 80 و443 فقط مفتوحان للعموم |
| الوصول | من داخل الحرم وخارجه، لأن الطلبة يدخلون من بيوتهم |

**تقدير الحمل:** البيانات أقل من 100 ميغابايت، وحساب تقرير الطالب يستغرق أجزاء من الثانية. الخادم المقترح يتحمل أضعاف هذا العدد.

---

## 2. الطريقة الأولى: Docker (الموصى بها)

```bash
# 1) نسخ المشروع إلى الخادم
sudo mkdir -p /opt/smart-advisor && cd /opt/smart-advisor
# (فك ضغط smart-advisor.zip هنا)

# 2) ملف الإعدادات
cp deploy/env.production.example deploy/.env.production
nano deploy/.env.production
#   DB_PASSWORD=كلمة طويلة عشوائية
#   SEED_ADMIN_PASSWORD=كلمة مرور الإدارة الأولى (10 أحرف على الأقل)
#   PUBLIC_URL=https://advisor.ptuk.edu.ps
chmod 600 deploy/.env.production

# 3) البناء والتشغيل (التهيئة الأولى تحدث تلقائيًا عند أول تشغيل)
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build

# 4) التحقق
curl http://127.0.0.1:4000/api/health      # {"ok":true,"mode":"production"}
docker compose -f deploy/docker-compose.prod.yml logs -f app
```

خصائص هذا الإعداد:
- قاعدة البيانات داخل الحاوية ولا تُفتح خارج الخادم.
- التطبيق يستمع على `127.0.0.1:4000` فقط، ويصل إليه العموم عبر Nginx.
- الحاويتان تعودان للعمل تلقائيًا بعد إعادة تشغيل الخادم (`restart: always`).

## 3. الطريقة الثانية: دون Docker

```bash
# Node.js 22 و PostgreSQL من مستودعات النظام
sudo apt install -y postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs

# قاعدة البيانات
sudo -u postgres psql -c "CREATE USER advisor WITH PASSWORD 'كلمة-قوية';"
sudo -u postgres psql -c "CREATE DATABASE advisor OWNER advisor;"

# التطبيق
sudo useradd -r -m -d /opt/smart-advisor advisor
cd /opt/smart-advisor   # فك ضغط المشروع هنا ثم:
cp deploy/env.production.example .env && nano .env
#   DATABASE_URL=postgres://advisor:كلمة-قوية@localhost:5432/advisor
#   SEED_ADMIN_PASSWORD=...
npm ci && npm run build
npm run db:init:prod          # إنشاء الجداول + الخطتين + حساب الإدارة، دون بيانات تجريبية
sudo chown -R advisor:advisor /opt/smart-advisor

# خدمة دائمة
sudo cp deploy/systemd/smart-advisor.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now smart-advisor
sudo systemctl status smart-advisor
```

## 4. Nginx وHTTPS

```bash
sudo cp deploy/nginx/advisor.ptuk.edu.ps.conf /etc/nginx/sites-available/
sudo ln -s /etc/nginx/sites-available/advisor.ptuk.edu.ps.conf /etc/nginx/sites-enabled/
# عدّل مساري الشهادة داخل الملف، أو استخدم: sudo certbot --nginx -d advisor.ptuk.edu.ps
sudo nginx -t && sudo systemctl reload nginx
```

ملاحظات:
- **`TRUST_PROXY=1`** في الإعدادات ضروري لأن Nginx يقع أمام التطبيق. به يعرف التطبيق عنوان الطالب الحقيقي لأغراض الحماية وسجل العمليات.
- **`COOKIE_SECURE=true`** يجب أن يبقى مفعّلًا مع HTTPS.

## 5. النسخ الاحتياطي

```bash
sudo mkdir -p /var/backups/smart-advisor
sudo crontab -e
# أضف السطر التالي (نسخة يوميًا الساعة 2:30 فجرًا، والاحتفاظ بآخر 30 نسخة):
30 2 * * * DATABASE_URL=postgres://advisor:PASS@localhost:5432/advisor /opt/smart-advisor/deploy/backup.sh >> /var/log/smart-advisor-backup.log 2>&1
```

مع Docker يكتشف السكربت حاوية قاعدة البيانات تلقائيًا.

**الاستعادة:**
```bash
pg_restore --clean --if-exists -d "$DATABASE_URL" /var/backups/smart-advisor/advisor-YYYYMMDD-HHMM.dump
```

يُنصح بنسخ مجلد النسخ إلى خادم آخر ضمن سياسة النسخ الاحتياطي المعتمدة في الجامعة.

## 6. بعد التشغيل: مهام القسم

ينفّذها مسؤول القسم من لوحة الإدارة، وليست من مهام مركز تكنولوجيا المعلومات:

1. الدخول بحساب `admin` وكلمة `SEED_ADMIN_PASSWORD`، ثم **تغيير كلمة المرور فورًا** من «تغيير كلمة المرور».
2. مراجعة الخطتين في «الخطط الدراسية» واعتمادهما، وضبط «قواعد الإرشاد».
3. التأكد من الفصل الحالي في «الفصول والطرح».
4. من «التكامل»، استيراد الملفات بالترتيب: **الطلبة**، ثم **السجل الأكاديمي**، ثم **التسجيل الحالي**.
5. عند استيراد الطلبة يُنزَّل ملف بكلمات المرور الأولية للحسابات الجديدة. يُسلَّم لكل طالب ما يخصه، ويُلزم الطالب بتغييرها عند أول دخول. **الملف لا يظهر مرة أخرى**، فاحفظه في مكان آمن ثم احذفه بعد التوزيع.

## 7. التحديث إلى إصدار جديد

```bash
cd /opt/smart-advisor
./deploy/backup.sh                     # نسخة قبل التحديث
# استبدل ملفات المشروع بالإصدار الجديد، مع إبقاء .env / deploy/.env.production
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.production up -d --build
# أو دون Docker:  npm ci && npm run build && sudo systemctl restart smart-advisor
```

ترقيات قاعدة البيانات تُطبَّق تلقائيًا عند التشغيل، ولا تمس البيانات الموجودة.

## 8. المراقبة

| ما يُراقب | كيف |
|---|---|
| حالة الخدمة | `GET https://advisor.ptuk.edu.ps/api/health` يعيد `{"ok":true}`؛ يمكن ربطه بنظام المراقبة في الجامعة |
| سجلات التشغيل | `docker compose ... logs app` أو `journalctl -u smart-advisor` |
| أخطاء التطبيق وسجل العمليات | من لوحة الإدارة ← «السجلات» |

## 9. الأمن والخصوصية: قائمة تحقق

- [ ] HTTPS مفعّل، وHTTP يحوّل إليه تلقائيًا.
- [ ] منفذا 4000 و5432 غير مفتوحين للعموم.
- [ ] كلمة مرور `admin` غُيّرت بعد أول دخول.
- [ ] ملف `.env` بصلاحية 600، ولا يُرفع إلى أي مستودع.
- [ ] النسخ الاحتياطي اليومي يعمل، وجُرّبت الاستعادة مرة واحدة على الأقل.
- [ ] النموذج اللغوي الخارجي معطل (`LLM_PROVIDER` فارغ). التطبيق لا يرسل أي بيانات خارج الخادم.
- [ ] ملفات التصدير المستلمة من القبول والتسجيل تُحذف بعد استيرادها.

**ما يحميه التطبيق نفسه:**
- كلمات المرور مخزنة بتجزئة bcrypt.
- الحساب يُقفل 15 دقيقة بعد 5 محاولات دخول خاطئة.
- الجلسات في كوكي محمية من JavaScript (httpOnly) ومن الطلبات القادمة من مواقع أخرى (SameSite=Strict)، مع حماية CSRF.
- الطالب لا يصل إلا إلى بياناته.
- كل عملية إدارية تُسجَّل.

## 10. مراحل لاحقة (تحتاج تنسيقًا مع المركز)

- **الدخول بحساب الجامعة:** ربط تسجيل الدخول بحسابات Microsoft 365 الجامعية (OpenID Connect)، فيدخل الطالب بنفس بريده الجامعي دون كلمة مرور منفصلة.
- **الربط مع Edugate:** واجهة قراءة فقط من نظام معلومات الطلبة تغني عن ملفات التصدير. الطبقة جاهزة في `server/src/services/sis.ts` وتحتاج توثيق الواجهة ومفتاح وصول.
