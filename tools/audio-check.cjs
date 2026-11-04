// Plays a scripted fight in headless Chromium and meters the master output:
// peaks (clipping), loudness jumps between 100 ms windows, boot synthesis time, runtime errors.
const { chromium } = require('playwright');
(async () => {
  const [, , query = '?scene=archers'] = process.argv;
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 800, height: 450 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:5173/' + query);
  await p.waitForFunction(() => window.dbg, null, { timeout: 60000 });
  const res = await p.evaluate(async () => {
    const g = window.dbg.game;
    g.renderer.renderScale = 0.25; g.renderer.resize();
    const a = g.audio;
    a.binaural = true;
    const longs = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(e.duration); }).observe({ type: 'longtask', buffered: false });
    await new Promise((r) => setTimeout(r, 1500)); // let the page settle before measuring
    longs.length = 0;
    const t0 = performance.now();
    await a.init(7);
    const bootLongs = longs.slice();
    await a.ctx.resume();
    const bootTotal = performance.now() - t0;
    window.dbg.god(); window.dbg.selfPlay();
    const lv = { peak: 0, rms: 0 };
    const samples = [];
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 100));
      a.levels(lv);
      samples.push([lv.peak, lv.rms, g.audioDirector.tension]);
    }
    const stems = a.stems.map((g) => +g.gain.value.toFixed(2));
    const beds = Object.fromEntries([...a.beds].map(([k, g]) => [k, +g.gain.value.toFixed(2)]));
    return { stems, beds, bootLongs, bootTotal, boot: a.bootMs, state: a.ctx.state, sr: a.ctx.sampleRate, samples };
  });
  const s = res.samples;
  const peaks = s.map((x) => x[0]);
  const rms = s.map((x) => x[1]).slice(20); // skip 2 s warm-up (music still fading in after boot)
  const db = (v) => (v > 0 ? 20 * Math.log10(v) : -120);
  let maxJump = 0;
  for (let i = 1; i < rms.length; i++) if (rms[i] > 1e-4 && rms[i - 1] > 1e-4) maxJump = Math.max(maxJump, db(rms[i]) - db(rms[i - 1]));
  console.log('ctx', res.state, res.sr, 'boot ms', Math.round(res.bootTotal), JSON.stringify(res.boot, (k, v) => (typeof v === 'number' ? Math.round(v) : v)));
  console.log('main-thread long tasks during boot:', res.bootLongs.length, 'max', Math.round(Math.max(0, ...res.bootLongs)), 'ms');
  console.log('peak max', Math.max(...peaks).toFixed(3), `(${db(Math.max(...peaks)).toFixed(1)} dBFS)`);
  console.log('rms mean', db(rms.reduce((a, b) => a + b, 0) / rms.length).toFixed(1), 'dBFS', ' rms max', db(Math.max(...rms)).toFixed(1));
  console.log('max upward loudness jump between 100ms windows:', maxJump.toFixed(1), 'dB');
  let ji = 0, jv = -1;
  for (let i = 1; i < rms.length; i++) if (rms[i] > 1e-4 && rms[i - 1] > 1e-4 && db(rms[i]) - db(rms[i - 1]) > jv) { jv = db(rms[i]) - db(rms[i - 1]); ji = i; }
  console.log('  at window', ji, 'rms dB around:', rms.slice(Math.max(0, ji - 4), ji + 4).map((v) => db(v).toFixed(0)).join(' '));
  console.log('tension range', Math.min(...s.map((x) => x[2])).toFixed(2), '→', Math.max(...s.map((x) => x[2])).toFixed(2));
  console.log('silent windows', rms.filter((r) => r < 1e-4).length, '/', rms.length);
  console.log('stems [pad,pulse,drive,hype,boss]:', JSON.stringify(res.stems), ' beds:', JSON.stringify(res.beds));
  console.log('errors:', errs.length ? errs.join(' | ') : 'none');
  await b.close();
})();
