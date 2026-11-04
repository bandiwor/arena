// E2E check of the PWA flow against `vite preview` on :4173.
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const out = process.argv[2] || '.';
const PORT = 4174;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
// static server that reads dist/ on every request (vite preview snapshots the file list at startup)
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(__dirname, '../dist', p);
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT);
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:4174/', { waitUntil: 'domcontentloaded' });
  const v1 = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { scope: reg.scope, active: !!reg.active };
  });
  console.log('registered:', JSON.stringify(v1));
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500);
  console.log('controlled:', await page.evaluate(() => !!navigator.serviceWorker.controller));
  const manifest = await page.evaluate(async () => (await fetch('./manifest.webmanifest')).json());
  console.log('manifest icons:', manifest.icons.length, manifest.display);
  // fake install prompt → chip
  await page.evaluate(() => {
    const e = new Event('beforeinstallprompt');
    e.prompt = async () => {};
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  });
  await page.waitForTimeout(500);
  console.log('install chip:', await page.evaluate(() => document.querySelector('#pwa-install')?.textContent));
  // ship a new version
  fs.appendFileSync('src/ui/style.css', '\n/* update-probe */ .pwa-probe{color:red}\n');
  execSync('npx vite build', { stdio: 'ignore' });
  console.log('rebuilt');
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.waitForSelector('#pwa-update', { timeout: 90000 });
  console.log('update toast:', await page.evaluate(() => document.querySelector('#pwa-update')?.textContent));
  await page.screenshot({ path: out + '/pwa.png' });
  // start a fight → toast must hide; back to menu → returns
  await page.evaluate(() => document.querySelector('[data-a="start"]').click());
  await page.waitForFunction(() => !document.querySelector('.hud').classList.contains('hidden'), null, { timeout: 30000 });
  await page.waitForTimeout(600);
  console.log('toast during play:', await page.evaluate(() => !!document.querySelector('#pwa-update')));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pwa-update.in', { timeout: 30000 }).catch(() => {});
  console.log('toast on pause:', await page.evaluate(() => !!document.querySelector('#pwa-update')));
  const reloaded = page.waitForEvent('domcontentloaded');
  await page.click('#pwa-update .pwa-btn.primary');
  await reloaded.catch(() => console.log('no reload event'));
  await page.waitForSelector('.menu .title', { timeout: 60000 });
  console.log('reloaded after update, waiting:', await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting));
  // offline reload
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.menu .title', { timeout: 60000 }).catch(() => {});
  console.log('offline title:', await page.title(), 'canvas:', await page.evaluate(() => !!document.querySelector('#game')), 'menu:', await page.evaluate(() => !!document.querySelector('.menu .title')));
  await ctx.setOffline(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.menu .title', { timeout: 60000 });
  await page.waitForTimeout(1000);
  console.log('errors:', errs.join(' | ') || 'none');
  await browser.close();
  server.close();
})();
