// node tools/labshot.cjs out_prefix "<js list separated by ;;>"  — takes one screenshot per step
const { chromium } = require('playwright');
(async () => {
  const [, , prefix, steps = ''] = process.argv;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto('http://localhost:5173/#/lab');
  await page.waitForFunction(() => window.lab && typeof window.lab.model === 'function', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  let i = 0;
  for (const s of steps.split(';;').filter(Boolean)) {
    const [js, wait] = s.split('@@');
    await page.evaluate(js);
    await page.waitForTimeout(parseInt(wait ?? '900', 10));
    await page.screenshot({ path: `${prefix}${i++}.png` });
  }
  console.log(logs.slice(0, 20).join('\n'));
  await browser.close();
})();
