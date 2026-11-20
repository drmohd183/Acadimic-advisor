-- مخطط قاعدة بيانات المرشد الأكاديمي الذكي – PostgreSQL 14+
-- كل الجداول مترابطة بمفاتيح أجنبية وقيود تمنع البيانات المتناقضة.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ===================== البنية الأكاديمية =====================
CREATE TABLE programs (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(16) NOT NULL UNIQUE,
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  department_ar TEXT NOT NULL
);

CREATE TABLE tracks (
  id         SERIAL PRIMARY KEY,
  program_id INT NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
  code       VARCHAR(16) NOT NULL UNIQUE,
  name_ar    TEXT NOT NULL,
  name_en    TEXT
);

-- عائلة الخطة لكل مسار، وإصداراتها في plan_versions
CREATE TABLE study_plans (
  id       SERIAL PRIMARY KEY,
  track_id INT NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
  name_ar  TEXT NOT NULL,
  UNIQUE (track_id, name_ar)
);

CREATE TABLE plan_versions (
  id                    SERIAL PRIMARY KEY,
  study_plan_id         INT NOT NULL REFERENCES study_plans(id) ON DELETE RESTRICT,
  label                 TEXT NOT NULL,
  effective_from_year   INT NOT NULL CHECK (effective_from_year BETWEEN 1990 AND 2100),
  effective_to_year     INT CHECK (effective_to_year IS NULL OR effective_to_year >= effective_from_year),
  total_credits         INT NOT NULL CHECK (total_credits > 0),
  status                VARCHAR(16) NOT NULL CHECK (status IN ('draft','imported','approved','archived','demo')),
  is_demo               BOOLEAN NOT NULL DEFAULT FALSE,
  min_gpa_for_graduation NUMERIC(5,2),
  source_note           TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at           TIMESTAMPTZ,
  approved_by           INT,
  -- لا تتداخل نطاقات سنوات الإصدارات الفعّالة (غير التجريبية) لنفس الخطة
  CONSTRAINT plan_versions_no_overlap EXCLUDE USING gist (
    study_plan_id WITH =,
    int4range(effective_from_year, COALESCE(effective_to_year, 2100), '[]') WITH &&
  ) WHERE (status IN ('imported','approved') AND NOT is_demo),
  CHECK (status <> 'demo' OR is_demo)
);

CREATE TABLE academic_terms (
  code       VARCHAR(8) PRIMARY KEY CHECK (code ~ '^[0-9]{4}-[123]$'),
  year_start INT NOT NULL,
  term_no    INT NOT NULL CHECK (term_no IN (1,2,3)),
  name_ar    TEXT NOT NULL,
  starts_on  DATE,
  ends_on    DATE,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (year_start, term_no),
  CHECK (code = year_start::text || '-' || term_no::text)
);
-- فصل حالي واحد فقط
CREATE UNIQUE INDEX one_current_term ON academic_terms (is_current) WHERE is_current;

CREATE TABLE courses (
  code      VARCHAR(8) PRIMARY KEY CHECK (code ~ '^[0-9]{8}$'),
  name_ar   TEXT NOT NULL,
  name_en   TEXT,
  credits   INT NOT NULL CHECK (credits BETWEEN 0 and 12),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE plan_categories (
  plan_version_id     INT NOT NULL REFERENCES plan_versions(id) ON DELETE CASCADE,
  category            VARCHAR(10) NOT NULL CHECK (category IN ('UNI_REQ','UNI_ELEC','COL_REQ','COL_ELEC','MAJ_REQ','MAJ_ELEC','REMEDIAL')),
  required_credits    INT NOT NULL CHECK (required_credits >= 0),
  counts_toward_total BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (plan_version_id, category)
);

CREATE TABLE plan_courses (
  plan_version_id INT NOT NULL,
  course_code     VARCHAR(8) NOT NULL REFERENCES courses(code) ON DELETE RESTRICT,
  category        VARCHAR(10) NOT NULL,
  suggested_year  INT CHECK (suggested_year BETWEEN 1 AND 6),
  suggested_term  INT CHECK (suggested_term BETWEEN 1 AND 3),
  PRIMARY KEY (plan_version_id, course_code),
  FOREIGN KEY (plan_version_id, category) REFERENCES plan_categories(plan_version_id, category) ON DELETE CASCADE,
  CHECK ((suggested_year IS NULL) = (suggested_term IS NULL))
);

-- المتطلبات السابقة تُحفظ لكل إصدار خطة (قد تختلف بين الخطط كما في الوثائق)
CREATE TABLE course_prerequisites (
  plan_version_id INT NOT NULL,
  course_code     VARCHAR(8) NOT NULL,
  prereq_code     VARCHAR(8) NOT NULL,
  PRIMARY KEY (plan_version_id, course_code, prereq_code),
  FOREIGN KEY (plan_version_id, course_code) REFERENCES plan_courses(plan_version_id, course_code) ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id, prereq_code) REFERENCES plan_courses(plan_version_id, course_code) ON DELETE CASCADE,
  CHECK (course_code <> prereq_code)
);

CREATE TABLE course_corequisites (
  plan_version_id INT NOT NULL,
  course_code     VARCHAR(8) NOT NULL,
  coreq_code      VARCHAR(8) NOT NULL,
  PRIMARY KEY (plan_version_id, course_code, coreq_code),
  FOREIGN KEY (plan_version_id, course_code) REFERENCES plan_courses(plan_version_id, course_code) ON DELETE CASCADE,
  FOREIGN KEY (plan_version_id, coreq_code) REFERENCES plan_courses(plan_version_id, course_code) ON DELETE CASCADE,
  CHECK (course_code <> coreq_code)
);

-- خانات الخطة الاسترشادية العامة (مثل «متطلب جامعة اختياري – ساعتان»)
CREATE TABLE guiding_slots (
  id              SERIAL PRIMARY KEY,
  plan_version_id INT NOT NULL,
  year            INT NOT NULL CHECK (year BETWEEN 1 AND 6),
  term            INT NOT NULL CHECK (term BETWEEN 1 AND 3),
  category        VARCHAR(10) NOT NULL,
  credits         INT NOT NULL CHECK (credits > 0),
  label_ar        TEXT NOT NULL,
  FOREIGN KEY (plan_version_id, category) REFERENCES plan_categories(plan_version_id, category) ON DELETE CASCADE
);

-- متطلبات التخرج غير الساعية (مثل التدريب الميداني) والحدود العامة
CREATE TABLE graduation_requirements (
  id              SERIAL PRIMARY KEY,
  plan_version_id INT NOT NULL REFERENCES plan_versions(id) ON DELETE CASCADE,
  code            VARCHAR(32) NOT NULL,
  name_ar         TEXT NOT NULL,
  kind            VARCHAR(16) NOT NULL CHECK (kind IN ('non_credit')),
  description     TEXT,
  suggested_year  INT,
  suggested_term  INT,
  UNIQUE (plan_version_id, code)
);

-- معادلة مساقات خطط سابقة بمساقات الخطة الحالية
CREATE TABLE course_equivalences (
  plan_version_id INT NOT NULL,
  from_code       VARCHAR(8) NOT NULL REFERENCES courses(code),
  to_code         VARCHAR(8) NOT NULL,
  note            TEXT,
  PRIMARY KEY (plan_version_id, from_code),
  FOREIGN KEY (plan_version_id, to_code) REFERENCES plan_courses(plan_version_id, course_code) ON DELETE CASCADE
);

CREATE TABLE course_offerings (
  term_code   VARCHAR(8) NOT NULL REFERENCES academic_terms(code) ON DELETE CASCADE,
  course_code VARCHAR(8) NOT NULL REFERENCES courses(code) ON DELETE CASCADE,
  PRIMARY KEY (term_code, course_code)
);

-- ===================== الطلبة والسجلات =====================
CREATE TABLE students (
  id                    SERIAL PRIMARY KEY,
  university_id         VARCHAR(20) NOT NULL UNIQUE CHECK (university_id ~ '^[0-9A-Za-z]{4,20}$'),
  name_ar               TEXT NOT NULL,
  track_id              INT NOT NULL REFERENCES tracks(id),
  enrollment_year       INT NOT NULL CHECK (enrollment_year BETWEEN 1990 AND 2100),
  academic_year_level   INT NOT NULL CHECK (academic_year_level BETWEEN 1 AND 5),
  gpa                   NUMERIC(5,2) CHECK (gpa IS NULL OR gpa >= 0),
  record_complete       BOOLEAN NOT NULL DEFAULT TRUE,
  official_status       VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (official_status IN ('active','expected_graduate','graduated')),
  data_source           VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (data_source IN ('demo','sis','manual')),
  is_demo               BOOLEAN NOT NULL DEFAULT FALSE,
  plan_version_id       INT REFERENCES plan_versions(id) ON DELETE RESTRICT,
  plan_assignment_note  TEXT,
  scenario_note         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT is_demo OR data_source = 'demo')
);

CREATE TABLE student_course_records (
  id          SERIAL PRIMARY KEY,
  student_id  INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_code VARCHAR(8) NOT NULL REFERENCES courses(code) ON DELETE RESTRICT,
  term_code   VARCHAR(8) NOT NULL REFERENCES academic_terms(code) ON DELETE RESTRICT,
  status      VARCHAR(12) CHECK (status IS NULL OR status IN ('passed','failed','withdrawn','incomplete','exempt','transfer')),
  grade       NUMERIC(5,2) CHECK (grade IS NULL OR grade >= 0),
  source      VARCHAR(10) NOT NULL DEFAULT 'manual' CHECK (source IN ('demo','sis','manual','import')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, course_code, term_code),
  CHECK (status IS NOT NULL OR grade IS NOT NULL)
);

CREATE TABLE course_registrations (
  id          SERIAL PRIMARY KEY,
  student_id  INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  course_code VARCHAR(8) NOT NULL REFERENCES courses(code) ON DELETE RESTRICT,
  term_code   VARCHAR(8) NOT NULL REFERENCES academic_terms(code) ON DELETE RESTRICT,
  status      VARCHAR(10) NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','dropped')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, course_code, term_code)
);

CREATE TABLE student_requirement_status (
  student_id      INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  requirement_code VARCHAR(32) NOT NULL,
  status          VARCHAR(12) NOT NULL CHECK (status IN ('met','not_met','in_progress')),
  term_code       VARCHAR(8) REFERENCES academic_terms(code),
  note            TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (student_id, requirement_code)
);

-- لقطة من التوصيات المولدة (للتتبع والتقارير)
CREATE TABLE advising_recommendations (
  id              SERIAL PRIMARY KEY,
  student_id      INT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  term_code       VARCHAR(8) REFERENCES academic_terms(code),
  plan_version_id INT REFERENCES plan_versions(id),
  engine_version  VARCHAR(16) NOT NULL,
  reliability     VARCHAR(12) NOT NULL,
  summary         JSONB NOT NULL,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX advising_recs_student ON advising_recommendations (student_id, generated_at DESC);

-- ===================== القواعد والمستخدمون والسجلات =====================
CREATE TABLE advising_rules (
  key            VARCHAR(48) PRIMARY KEY,
  value          JSONB,
  description_ar TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     INT
);

CREATE TABLE users (
  id              SERIAL PRIMARY KEY,
  username        VARCHAR(32) NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  role            VARCHAR(10) NOT NULL CHECK (role IN ('student','admin')),
  student_id      INT UNIQUE REFERENCES students(id) ON DELETE CASCADE,
  display_name    TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((role = 'student') = (student_id IS NOT NULL))
);

CREATE TABLE sessions (
  id          VARCHAR(64) PRIMARY KEY, -- SHA-256 لرمز الجلسة (لا يُخزّن الرمز نفسه)
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token  VARCHAR(64) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  action     VARCHAR(48) NOT NULL,
  entity     VARCHAR(48),
  entity_id  TEXT,
  details    JSONB,
  ip         TEXT
);
CREATE INDEX audit_at ON audit_logs (at DESC);

CREATE TABLE error_logs (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  level   VARCHAR(8) NOT NULL DEFAULT 'error',
  message TEXT NOT NULL,
  context JSONB
);

-- إعدادات تكامل نظام معلومات الطلبة (لا تحتوي أسرارًا؛ الأسرار في متغيرات البيئة)
CREATE TABLE integration_settings (
  key        VARCHAR(48) PRIMARY KEY,
  value      JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- تحديث updated_at تلقائيًا
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER students_touch BEFORE UPDATE ON students FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- منع تعديل محتوى خطة معتمدة يرتبط بها طلبة (يُنشأ إصدار جديد بدل ذلك)
CREATE OR REPLACE FUNCTION guard_approved_plan() RETURNS trigger AS $$
DECLARE pv INT; st TEXT;
BEGIN
  pv := COALESCE(NEW.plan_version_id, OLD.plan_version_id);
  SELECT status INTO st FROM plan_versions WHERE id = pv;
  IF st = 'approved' AND current_setting('advisor.allow_approved_edit', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'PLAN_LOCKED: لا يمكن تعديل خطة معتمدة؛ أنشئ إصدارًا جديدًا منها';
  END IF;
  RETURN COALESCE(NEW, OLD);
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER plan_courses_guard BEFORE INSERT OR UPDATE OR DELETE ON plan_courses FOR EACH ROW EXECUTE FUNCTION guard_approved_plan();
CREATE TRIGGER prereq_guard BEFORE INSERT OR UPDATE OR DELETE ON course_prerequisites FOR EACH ROW EXECUTE FUNCTION guard_approved_plan();
CREATE TRIGGER coreq_guard BEFORE INSERT OR UPDATE OR DELETE ON course_corequisites FOR EACH ROW EXECUTE FUNCTION guard_approved_plan();
CREATE TRIGGER cats_guard BEFORE INSERT OR UPDATE OR DELETE ON plan_categories FOR EACH ROW EXECUTE FUNCTION guard_approved_plan();
