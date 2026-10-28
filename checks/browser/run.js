'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const output = path.resolve(process.env.BROWSER_CHECK_OUTPUT || path.join(root, 'outputs/browser-check'));
const port = Number(process.env.BROWSER_CHECK_PORT || 4198);
assert(Number.isInteger(port) && port > 0 && port < 65536, 'Invalid BROWSER_CHECK_PORT');
const base = `http://127.0.0.1:${port}`;
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const report = {
  startedAt: new Date().toISOString(), revision: git('rev-parse', 'HEAD'),
  dirty: !!git('status', '--porcelain'), node: process.version,
  playwright: require('playwright/package.json').version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  viewports: [{ width: 1440, height: 1000 }, { width: 375, height: 812 }],
  checks: [], passed: false,
};
let server, browser;
const errors = [];
async function check(name, fn) {
  const details = await fn();
  report.checks.push({ name, passed: true, ...(details || {}) });
  console.log(`PASS: ${name}`);
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  server = spawn(process.execPath, [path.join(root, 'server/app.js')], {
    cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CALC_WORKERS: '2' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    let stderr = '', stdout = '';
    const timer = setTimeout(() => reject(new Error(`Server startup timed out: ${stderr}`)), 10000);
    server.stderr.on('data', chunk => { stderr += chunk; });
    server.on('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited (${code}): ${stderr}`)); });
    server.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.includes(`listening on ${base}`)) { clearTimeout(timer); resolve(); }
    });
  });
  browser = await chromium.launch({ headless: true });
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: report.viewports[0], colorScheme: 'light' });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!document.querySelector('#lab_fan .main-svg'));

  await check('Picker traps keyboard focus and restores the opener', async () => {
    await page.locator('#tab-equity').click();
    await page.locator('#slot_hero0').click();
    assert(await page.locator('#picker.on').isVisible());
    assert(await page.evaluate(() => document.activeElement.matches('#pgrid .pcard:not(:disabled)')));
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'pickclose');
    await page.keyboard.press('Shift+Tab');
    assert(await page.evaluate(() => document.activeElement === [...document.querySelectorAll('#pgrid .pcard:not(:disabled)')].at(-1)));
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'pickclose');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'slot_hero0');
    assert.equal(await page.locator('#picker.on').count(), 0);
    assert.equal(await page.locator('body > [inert]').count(), 0);
  });
  await check('Bankroll identifies the posterior risk interval', async () => {
    await page.locator('#tab-bankroll').click();
    await page.locator('#bp_run').click();
    await page.waitForFunction(() => document.getElementById('bp_results').dataset.resultState === 'current');
    assert.match(await page.locator('#bp_kpis').innerText(), /Risk, 95% posterior interval/);
  });
  await check('Rendered charts redraw for dark and light themes', async () => {
    const chartIds = await page.locator('.js-plotly-plot').evaluateAll(els => els.filter(e => e.data?.length).map(e => e.id));
    assert(chartIds.includes('lab_fan') && chartIds.includes('bp_posterior') && chartIds.includes('bp_curve'));
    const before = await page.evaluate(ids => ids.map(id => document.getElementById(id).layout.font.color), chartIds);
    for (const colorScheme of ['dark', 'light']) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction(ids => {
        const css = getComputedStyle(document.documentElement);
        const muted = css.getPropertyValue('--muted').trim();
        return ids.every(id => document.getElementById(id).layout.font.color === muted);
      }, chartIds);
      const colors = await page.evaluate(ids => ids.map(id => document.getElementById(id).layout.font.color), chartIds);
      if (colorScheme === 'dark') assert(colors.every((c, i) => c !== before[i]));
      else assert.deepEqual(colors, before);
    }
    return { chartIds, scope: 'Chart font follows CSS in both directions; trace/fill replacement has separate UI unit tests.' };
  });
  await check('Demo data is visible in all three Preflop views', async () => {
    await page.locator('#tab-preflop').click();
    for (const mode of ['library', 'compare', 'trainer']) {
      await page.locator(`#pf-mode-${mode}`).click();
      assert(await page.locator(`#pf-view-${mode}`).isVisible());
      assert(await page.locator('#pf_demo_badge').isVisible());
      assert.equal(await page.locator('#pf_demo_badge').innerText(), 'Demo data');
    }
    await page.locator('#pf-mode-compare').click();
    await page.screenshot({ path: path.join(output, 'preflop-desktop.png') });
  });
  await check('375 CSS-pixel layout fits Preflop and Bankroll', async () => {
    await page.setViewportSize(report.viewports[1]);
    for (const tab of ['preflop', 'bankroll']) {
      await page.locator(`#tab-${tab}`).click();
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1);
      const size = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
      assert.equal(size.viewport, 375);
      assert(size.content <= 376, `${tab} overflows: ${JSON.stringify(size)}`);
      await page.screenshot({ path: path.join(output, `${tab}-phone.png`), fullPage: true });
    }
  });
  await check('No uncaught page errors', async () => assert.deepEqual(errors, []));
  report.passed = true;
}
main().catch(error => {
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  try { await browser?.close(); }
  finally {
    if (server && server.exitCode === null) {
      const stopped = new Promise(resolve => server.once('exit', resolve));
      server.kill('SIGTERM');
      const killTimer = setTimeout(() => server.kill('SIGKILL'), 6000);
      await stopped;
      clearTimeout(killTimer);
    }
    report.finishedAt = new Date().toISOString();
    report.pageErrors = errors;
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'browser-check.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`Report: ${path.join(output, 'browser-check.json')}`);
  }
});
