// Usage: node tools/shot.mjs "<url query>" out.png [waitMs] [jsToEval]
const { chromium } = require('playwright');
(async () => {
const [, , query = '', out = 'shot.png', wait = '2500', js = ''] = process.argv;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:5173/${query}`);
await page.waitForFunction(() => window.dbg, null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(parseInt(wait, 10));
if (js) {
  const r = await page.evaluate(js);
  if (r !== undefined) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r));
  await page.waitForTimeout(800);
}
await page.screenshot({ path: out });
console.log(logs.slice(0, 30).join('\n'));
await browser.close();
})();
