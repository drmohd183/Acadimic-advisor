// إنشاء المخطط. الاستخدام: npm run db:migrate  (أو --reset لحذف كل شيء وإعادة الإنشاء)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool';

const here = path.dirname(fileURLToPath(import.meta.url));

export const UPGRADES = [
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE',
  'ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ',
];

export async function migrate(reset = false) {
  const c = await pool.connect();
  try {
    if (reset) {
      // يحذف كل ما أنشأه مستخدم التطبيق فقط (يعمل على كل إصدارات PostgreSQL ودون صلاحيات مدير)
      await c.query('DROP OWNED BY CURRENT_USER CASCADE');
      await c.query('CREATE SCHEMA IF NOT EXISTS public');
      console.log('✔ حُذف المخطط القديم');
    }
    const exists = await c.query("SELECT to_regclass('public.students') AS t");
    if (!exists.rows[0].t) {
      await c.query(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
      console.log('✔ أُنشئ مخطط قاعدة البيانات');
    }
    // ترقيات تراكمية آمنة للتكرار (تُطبَّق على القواعد المنشأة بإصدارات سابقة)
    for (const sql of UPGRADES) await c.query(sql);
  } finally {
    c.release();
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  migrate(process.argv.includes('--reset')).then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
}
