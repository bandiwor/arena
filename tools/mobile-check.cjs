// Mobile smoke test: phone emulation (landscape, touch), boot screen → menu → play, then real
// multi-touch through CDP: left stick drag + right stick drag at the same time, dash button, double tap.
// Usage: node tools/mobile-check.cjs outDir
const { chromium } = require('playwright');
(async () => {
  const [, , out = '.'] = process.argv;
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:5173/');
  await p.waitForSelector('.boot .boot-go', { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${out}/m0-boot.png` });
  await p.tap('.boot .boot-go');
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${out}/m1-compile.png` });
  const t0 = Date.now();
  await p.waitForSelector('.boot', { state: 'detached', timeout: 120000 });
  console.log('boot →menu ms', Date.now() - t0);
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/m2-menu.png` });
  await p.tap('[data-a="start"]');
  await p.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 6, radiusY: 6, force: 1 })) });
  const st = () => p.evaluate(() => { const g = window.__game; const w = g.world; return { x: +w.player.x.toFixed(2), y: +w.player.y.toFixed(2), shots: w.stats.shots, mode: g.mode, dashCd: +w.player.dashCd.toFixed(2), face: +w.player.face.toFixed(2) }; });
  const s0 = await st();
  // two thumbs: left pushes right (+x), right stick pushes up (aim north) and fires
  await touch('touchStart', [[110, 290, 1], [730, 290, 2]]);
  for (let k = 1; k <= 12; k++) {
    await touch('touchMove', [[110 + k * 6, 290, 1], [730, 290 - k * 6, 2]]);
    await p.waitForTimeout(40);
  }
  await p.waitForTimeout(900);
  await p.screenshot({ path: `${out}/m3-twinstick.png` });
  const s1 = await st();
  await touch('touchEnd', []);
  // dash button
  const box = await p.locator('.t-dash').boundingBox();
  await touch('touchStart', [[box.x + box.width / 2, box.y + box.height / 2, 3]]);
  await touch('touchEnd', []);
  await p.waitForTimeout(60);
  const s2 = await st();
  // double tap on the left half dashes too
  await p.waitForTimeout(1200);
  // (software GL makes CDP touches ~1 frame each, too slow for a 260 ms double tap → dispatch in-page)
  await p.evaluate(() => {
    const z = document.querySelector('.tz-l');
    const ev = (t, id, x) => z.dispatchEvent(new PointerEvent(t, { pointerId: id, pointerType: 'touch', clientX: x, clientY: 250, bubbles: true, cancelable: true }));
    ev('pointerdown', 11, 150); ev('pointerup', 11, 150);
    ev('pointerdown', 12, 153); ev('pointerup', 12, 153);
  });
  await p.waitForTimeout(150);
  const s3 = await st();
  // pause button
  const pb = await p.locator('.t-pause').boundingBox();
  await p.touchscreen.tap(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await p.waitForTimeout(300);
  const s4 = await st();
  await p.screenshot({ path: `${out}/m4-pause.png` });
  // tab switch → pause; fullscreen keeper never throws
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  console.log(JSON.stringify({ s0, s1, s2, s3, s4 }));
  console.log('moved +x:', s1.x > s0.x + 1, ' fired:', s1.shots > s0.shots, ' aim north:', Math.abs(s1.face + Math.PI / 2) < 0.6, ' dash btn:', s2.dashCd > 0.3, ' double tap dash:', s3.dashCd > 0.3, ' paused:', s4.mode === 'pause');
  console.log('errors:', errs.join(' | ') || 'none');
  await b.close();
})();
