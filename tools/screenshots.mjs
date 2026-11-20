// لقطات شاشة آلية للتحقق البصري: node tools/screenshots.mjs <baseUrl> <outDir>
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:4000';
const out = process.argv[3] ?? 'screenshots';
const hash = base.endsWith('.html') ? '#' : '';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
async function shoot(user, pass, pages, w = 1366, prefix = '') {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: 'ar' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(base + (hash ? '#/' : '/'));
  await p.fill('#u', user); await p.fill('#p', pass);
  await p.click('button:has-text("تسجيل الدخول")');
  await p.waitForTimeout(1200);
  for (const [name, path] of pages) {
    await p.goto(base + hash + path);
    await p.waitForTimeout(1000);
    await p.screenshot({ path: `${out}/${prefix}${name}.png`, fullPage: true });
  }
  await ctx.close();
  return errors;
}
const ctx0 = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const p0 = await ctx0.newPage(); await p0.goto(base + (hash ? '#/' : '/')); await p0.waitForTimeout(800); await p0.screenshot({ path: `${out}/00-login.png`, fullPage: true }); await ctx0.close();
const e1 = await shoot('202490003', 'Demo@2026', [['01-dashboard', '/'], ['02-plan', '/plan'], ['03-recs', '/recommendations'], ['04-progress', '/progress']]);
const e2 = await shoot('202490006', 'Demo@2026', [['05-mobile-dash', '/']], 390, '');
const e3 = await shoot('admin', 'Admin@2026', [['10-admin', '/admin'], ['11-admin-plan', '/admin/plans/1'], ['12-admin-student', '/admin/students/3'], ['13-admin-reports', '/admin/reports'], ['14-admin-rules', '/admin/rules']]);
console.log('errors', [...e1, ...e2, ...e3]);
await browser.close();
