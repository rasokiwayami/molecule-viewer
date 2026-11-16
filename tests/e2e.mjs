import { chromium, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const catalog = JSON.parse(await readFile('public/data/index.json', 'utf8'));
await mkdir('test-results', { recursive: true });
const port = 4177,
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    'node_modules/vite/bin/vite.js',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);
let logs = '';
server.stdout.on('data', (b) => (logs += b));
server.stderr.on('data', (b) => (logs += b));
let browser;
const results = [];
try {
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('vite preview failed');
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    if (i === 59) throw new Error('preview startup timeout');
    await new Promise((r) => setTimeout(r, 200));
  }
  const engine = process.env.E2E_BROWSER === 'webkit' ? webkit : chromium;
  browser = await engine.launch({
    headless: true,
    args:
      engine === chromium
        ? [
            '--enable-webgl',
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
          ]
        : [],
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(15000);
  const page = await context.newPage(),
    errors = [],
    runtimeErrors = [],
    requests = [];
  page.setDefaultNavigationTimeout(20000);
  page.on('pageerror', (e) => {
    errors.push(e.message);
    runtimeErrors.push(e.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () =>
      document.querySelector('#molecule-name')?.textContent === 'カフェイン' &&
      document.querySelector('#stage canvas') &&
      !document.querySelector('#loading'),
  );
  await page.waitForTimeout(1600);
  const canvas = page.locator('#stage canvas');
  assert.ok((await canvas.boundingBox()).width > 100);
  // A rendered frame must have nonzero pixel variation, beyond an empty canvas.
  const rendered = await canvas.evaluate(
    (c) =>
      new Promise((resolve) =>
        requestAnimationFrame(() => {
          const copy = document.createElement('canvas');
          copy.width = c.width;
          copy.height = c.height;
          const ctx = copy.getContext('2d');
          ctx.drawImage(c, 0, 0);
          const a = ctx.getImageData(0, 0, c.width, c.height).data;
          let count = 0;
          for (let i = 0; i < a.length; i += 4) if (a[i] + a[i + 1] + a[i + 2] > 100) count++;
          resolve(count);
        }),
      ),
  );
  assert.ok(rendered > 100, `canvas appears blank: ${rendered}`);
  assert.equal(
    requests.filter((u) => u.includes('/mediapipe/')).length,
    0,
    'hands loaded before activation',
  );
  await page.screenshot({ path: 'test-results/desktop.png' });
  results.push('PASS: initial caffeine rendered, optional hand assets not loaded');
  for (const item of catalog) {
    await page.locator(`#chips button[data-id="${item.id}"]`).click();
    await page.waitForFunction(
      ({ ja, formula }) =>
        document.querySelector('#molecule-name').textContent === ja &&
        document.querySelector('#formula').textContent === formula,
      item,
    );
  }
  await page.waitForTimeout(1500);
  assert.deepEqual(errors, []);
  results.push('PASS: 40 names and formulas switch without console errors');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(
    () => document.querySelector('#molecule-name').textContent === 'カフェイン',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1600);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'test-results/mobile.png' });
  results.push('PASS: 390x844 has no horizontal overflow');
  // Wait for installation to finish before offline assertions; the UI remains usable meanwhile.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }),
      );
  });
  await context.route('https://**/*', (route) => route.abort());
  await page.locator('#search').fill('zzzz');
  await page.locator('#search').press('Enter');
  await page.waitForFunction(() =>
    document.querySelector('#status').textContent.includes('通信できません'),
  );
  await page.locator('#chips button[data-id="water"]').click();
  await page.waitForFunction(() => document.querySelector('#molecule-name').textContent === '水');
  results.push('PASS: external search fails gracefully, local selection remains usable');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(
    () =>
      document.querySelector('#molecule-name').textContent === '水' &&
      !document.querySelector('#loading'),
  );
  for (const item of catalog) {
    await page.locator(`#chips button[data-id="${item.id}"]`).click();
    await page.waitForFunction(
      (ja) => document.querySelector('#molecule-name').textContent === ja,
      item.ja,
    );
  }
  results.push('PASS: offline reload and all 40 selections');
  await context.setOffline(false);
  await context.unroute('https://**/*');
  await page.locator('#qr-open').click();
  await page.locator('dialog .qr svg').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await page.locator('#about-open').click();
  assert.ok(await page.locator('dialog').isVisible());
  await page.keyboard.press('Escape');
  results.push('PASS: QR and about dialogs');
  assert.deepEqual(runtimeErrors, [], 'unexpected runtime errors');
  console.log(results.join('\n'));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  results.push(`FAIL: ${error.stack}`);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await writeFile('test-results/e2e.log', results.join('\n') + '\n' + logs);
}
