// Screenshots of the act transition at given sim times: node tools/transition-shots.cjs outPrefix 1.0 3.5 5.6 8.5
const { chromium } = require('playwright');
(async () => {
  const [, , prefix, ...times] = process.argv;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5173/?scene=transition');
  await p.waitForFunction(() => window.dbg, null, { timeout: 60000 });
  await p.evaluate(() => { document.querySelector('.dbg-panel').style.display = 'none'; });
  let i = 0;
  for (const t of times.map(Number)) {
    // after the transition ends (8 s) we keep measuring by wall clock
    await p.waitForFunction((tt) => { const w = window.dbg.world; return w.wave.phase !== 7 || w.wave.t >= tt; }, t, { timeout: 240000, polling: 50 });
    await p.screenshot({ path: `${prefix}${i++}.png` });
    console.log('shot at', t, await p.evaluate(() => [window.dbg.world.wave.phase, window.dbg.world.wave.t.toFixed(2), window.dbg.world.act].join(' ')));
  }
  console.log('errors:', errs.join(' | ') || 'none');
  await b.close();
})();
