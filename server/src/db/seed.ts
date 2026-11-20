// تعبئة قاعدة البيانات بالبيانات الأولية: الخطط المستوردة + بيانات تجريبية معلّمة بوضوح
import bcrypt from 'bcryptjs';
import { pool } from './pool';
import { migrate } from './migrate';
import { insertPlan, insertEquivalences } from '../services/plans';
import { PROGRAM, TRACKS, buildPlans, buildStudents, buildTerms, DEMO_ADMIN, DEMO_STUDENT_PASSWORD } from '../../../shared/src/seedData';
import { DEFAULT_RULES } from '../../../shared/src/types';
import { config } from '../config';
import { RULE_DESCRIPTIONS } from '../../../shared/src/ruleDescriptions';


export async function seed(opts: { production?: boolean } = {}) {
  const production = opts.production ?? (config.appMode === 'production' || process.argv.includes('--production'));
  await migrate(false);
  const c = await pool.connect();
  try {
    const has = await c.query('SELECT count(*)::int AS n FROM programs');
    if (has.rows[0].n > 0) {
      console.log('ℹ قاعدة البيانات تحتوي بيانات مسبقًا؛ لا حاجة للتهيئة');
      return;
    }
    if (production && config.seedAdminPassword.length < 10) {
      throw new Error('في وضع الإنتاج يجب ضبط SEED_ADMIN_PASSWORD بكلمة مرور قوية (10 أحرف على الأقل) قبل التهيئة الأولى.');
    }
    await c.query('BEGIN');
    const pr = await c.query('INSERT INTO programs (code, name_ar, name_en, department_ar) VALUES ($1,$2,$3,$4) RETURNING id', [PROGRAM.code, PROGRAM.nameAr, PROGRAM.nameEn, PROGRAM.departmentAr]);
    for (const t of TRACKS) await c.query('INSERT INTO tracks (program_id, code, name_ar, name_en) VALUES ($1,$2,$3,$4)', [pr.rows[0].id, t.code, t.nameAr, t.nameEn]);

    for (const t of buildTerms()) await c.query('INSERT INTO academic_terms (code, year_start, term_no, name_ar, is_current) VALUES ($1,$2,$3,$4,$5)', [t.code, t.yearStart, t.termNo, t.nameAr, t.isCurrent]);

    // في الإنتاج: الخطتان المستوردتان فقط، دون الخطة السابقة التجريبية أو الطلبة التجريبيين
    const plans = buildPlans().filter((p) => !production || !p.isDemo);
    if (production) plans.forEach((p) => { p.equivalences = []; });
    // الخطة السابقة التجريبية أولًا لأن مساقاتها التجريبية مطلوبة في المعادلات
    for (const p of [...plans].sort((a, b) => (b.isDemo ? 1 : 0) - (a.isDemo ? 1 : 0))) {
      await insertPlan(c, p, { courseIsDemo: (code) => code.startsWith('99') });
    }
    for (const p of plans) await insertEquivalences(c, p.id, p.equivalences);
    await c.query(`SELECT setval('plan_versions_id_seq', (SELECT max(id) FROM plan_versions))`);

    for (const [k, v] of Object.entries(DEFAULT_RULES)) {
      await c.query('INSERT INTO advising_rules (key, value, description_ar) VALUES ($1,$2,$3)', [k, JSON.stringify(v), RULE_DESCRIPTIONS[k] ?? k]);
    }
    await c.query(`INSERT INTO integration_settings VALUES ('sis', $1, now())`, [JSON.stringify({ enabled: false, mode: 'none', note: 'لا يوجد تكامل مفعّل مع نظام معلومات الطلبة.' })]);

    const tracks = await c.query('SELECT id, code FROM tracks');
    const trackId = (code: string) => tracks.rows.find((t) => t.code === code).id;
    const studentHash = await bcrypt.hash(DEMO_STUDENT_PASSWORD, 10);
    for (const s of production ? [] : buildStudents(plans)) {
      const p = s.profile;
      await c.query(
        `INSERT INTO students (id, university_id, name_ar, track_id, enrollment_year, academic_year_level, gpa, record_complete, official_status, data_source, is_demo, plan_version_id, plan_assignment_note, scenario_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'demo',TRUE,$10,$11,$12)`,
        [p.id, p.universityId, p.nameAr, trackId(p.trackCode), p.enrollmentYear, p.academicYearLevel, p.gpa, p.recordComplete, p.officialStatus, p.planVersionId, p.planAssignmentNote, s.scenario]);
      for (const r of s.records) await c.query('INSERT INTO student_course_records (student_id, course_code, term_code, status, grade, source) VALUES ($1,$2,$3,$4,$5,$6)', [p.id, r.courseCode, r.termCode, r.status, r.grade, 'demo']);
      for (const r of s.registrations) await c.query('INSERT INTO course_registrations (student_id, course_code, term_code) VALUES ($1,$2,$3)', [p.id, r.courseCode, r.termCode]);
      for (const n of s.nonCredit) await c.query('INSERT INTO student_requirement_status (student_id, requirement_code, status) VALUES ($1,$2,$3)', [p.id, n.code, n.status]);
      await c.query('INSERT INTO users (username, password_hash, role, student_id, display_name) VALUES ($1,$2,$3,$4,$5)', [p.universityId, studentHash, 'student', p.id, p.nameAr]);
    }
    await c.query(`SELECT setval('students_id_seq', (SELECT max(id) FROM students))`);
    const adminPass = config.seedAdminPassword || DEMO_ADMIN.password;
    await c.query('INSERT INTO users (username, password_hash, role, display_name) VALUES ($1,$2,$3,$4)', [DEMO_ADMIN.username, await bcrypt.hash(adminPass, 12), 'admin', 'مدير النظام']);
    await c.query(`INSERT INTO audit_logs (action, entity, details) VALUES ('SEED', 'system', $1)`, [JSON.stringify({ note: 'تهيئة أولية ببيانات تجريبية وخطط مستوردة' })]);
    await c.query('COMMIT');
    console.log(production ? '✔ تمت التهيئة لوضع الإنتاج (دون بيانات تجريبية)' : '✔ تمت تعبئة البيانات الأولية');
    console.log(`  حساب الإدارة: ${DEMO_ADMIN.username} / ${config.seedAdminPassword ? '(من SEED_ADMIN_PASSWORD)' : DEMO_ADMIN.password}`);
    if (!production) console.log(`  حسابات الطلبة التجريبية: الرقم الجامعي (مثل 202490003) / ${DEMO_STUDENT_PASSWORD}`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

if (process.argv[1] && process.argv[1].endsWith('seed.ts')) {
  seed({ production: process.argv.includes('--production') || undefined }).then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
