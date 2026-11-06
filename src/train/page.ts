import '../ui/style.css';
import '../ui/kit.css';
import './train.css';
import { badge, bindKit, button, row, section, segmented, slider, textField, type KitValue } from '../ui/kit';
import { decodeGenome, defaultWeights, GENOME, tactician } from '../sim/bot/tactician';
import { DIFFICULTIES } from '../sim/content/difficulty';
import { ARENA_HH, ARENA_HW, AS, Team } from '../sim/constants';
import { enemyDef } from '../sim/content/enemies';
import { Scenario } from '../sim/scenario';
import { WavePhase } from '../sim/world';
import { CMAES } from './cmaes';
import { kitFor, type Metrics } from './episode';
import { REWARD_INFO, terms, type Rewards } from './fitness';
import { deleteModel, describeRewards, exportJSON, importJSON, listModels, newModel, saveModel, STAGES, type BotModel, type Stage } from './models';
import { generation, WorkerPool } from './trainer';

/**
 * NULL//TRAIN — evolve the Тактик's genome with CMA-ES in background workers. Reward sliders decide
 * what "better" means; models are saved in the browser, exported as JSON and watchable in the game.
 */
const root = document.getElementById('train')!;
const DIFF_COLORS = ['#5cff9b', '#2ef2ff', '#ffa126', '#ff2d7a'];
const cores = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));

let models = listModels();
if (models.length === 0) {
  const m = newModel('Тактик · база');
  saveModel(m);
  models = [m];
}
let cur: BotModel = models[0]!;
let workers = cores;
let running = false;
let pool: WorkerPool | null = null;
let es: CMAES | null = null;
let lastGenSec = 0;
let status = 'готово к обучению';

root.innerHTML = `
<header class="tr-head">
  <div><h1 class="title">NULL<span>//</span>TRAIN</h1><div class="sub">обучение ботов · эволюция CMA-ES · ${cores} потоков</div></div>
  <a class="tr-back" href="./">← в игру</a>
</header>
<div class="tr-grid">
  <aside class="tr-models k-panel"></aside>
  <main class="tr-main">
    <section class="k-panel tr-run"></section>
    <section class="k-panel tr-rewards"></section>
    <section class="k-panel tr-cfg"></section>
  </main>
  <aside class="tr-side">
    <section class="k-panel tr-preview"><h4 class="tr-h">ПРОСМОТР МОДЕЛИ <small>2D, тот же симулятор</small></h4><canvas width="432" height="288"></canvas><div class="tr-prev-ctl"></div></section>
    <section class="k-panel tr-genes"></section>
  </aside>
</div>`;

const $ = <T extends HTMLElement>(s: string): T => root.querySelector<T>(s)!;

// ───────────────────────────── models list
function renderModels(): void {
  const el = $('.tr-models');
  el.innerHTML = `<h4 class="tr-h">МОДЕЛИ <small>${models.length}</small></h4>
    <div class="tr-mlist">${models
      .map((m) => {
        const last = m.history[m.history.length - 1];
        const gain = last && last.base !== 0 ? ((last.model - last.base) / Math.abs(last.base)) * 100 : 0;
        return `<button class="tr-model${m.id === cur.id ? ' on' : ''}" data-mid="${m.id}"><b>${esc(m.name)}</b><small>${m.history.length} покол. · ${describeRewards(m.rewards)}</small>${last ? `<em class="${gain >= 0 ? 'up' : 'down'}">${gain >= 0 ? '+' : ''}${gain.toFixed(0)}% к базе</em>` : ''}</button>`;
      })
      .join('')}</div>
    <div class="tr-mact">
      ${button('От Тактика', { size: 'sm', action: 'new', icon: '+', hint: 'стартовать с ручного Тактика и дообучить под свои награды' })}${button('С нуля', { size: 'sm', action: 'scratch', icon: '✱', hint: 'случайный геном — видно, как бот учится' })}${button('Копия', { size: 'sm', action: 'clone', icon: '⧉' })}${button('Импорт', { size: 'sm', action: 'import', icon: '⤒' })}
    </div>
    ${section(
      'Выбранная',
      `${row('Имя', textField('name', cur.name))}
       <div class="tr-mact">${button('Смотреть в игре', { size: 'sm', variant: 'primary', action: 'watch', icon: '▶' })}${button('Экспорт', { size: 'sm', action: 'export', icon: '⤓' })}${button('Сбросить', { size: 'sm', action: 'reset', icon: '↺', hint: 'вернуть геном к базовому Тактику' })}${button('Удалить', { size: 'sm', variant: 'danger', action: 'delete', icon: '✕' })}</div>`,
    )}
    <input type="file" accept="application/json,.json" class="hidden" id="tr-file">`;
}

// ───────────────────────────── run panel: status, chart, metrics
function renderRun(): void {
  $('.tr-run').innerHTML = `<div class="tr-runbar">
      ${running ? button('Пауза', { variant: 'danger', action: 'stop', icon: '❚❚' }) : button(cur.history.length ? 'Продолжить обучение' : 'Начать обучение', { variant: 'primary', action: 'start', icon: '▶' })}
      <div class="tr-status"><b>${esc(status)}</b><small>поколение ${cur.history.length}${lastGenSec ? ` · ${lastGenSec.toFixed(1)} с на поколение` : ''} · ${cur.cfg.lambda + 2} × ${cur.cfg.seeds} игр по ${cur.cfg.seconds} с</small></div>
    </div>
    <canvas class="tr-chart" width="900" height="240"></canvas>
    <div class="tr-legend">${badge('лучший кандидат', '#ffb02e')} ${badge('медиана', '#7f86a8')} ${badge('модель (чемпион)', '#2ef2ff')} ${badge('точка поиска', '#b36bff')} ${badge('база = 0 (необученный)', '#ff2d7a')} <span class="tr-star">★ — новый чемпион · по вертикали: преимущество над базой на тех же играх</span></div>
    <div class="tr-metrics"></div>`;
  drawChart();
  renderMetrics();
}

function renderMetrics(): void {
  const el = root.querySelector<HTMLElement>('.tr-metrics');
  if (!el) return;
  const m = cur.metrics;
  if (!m) {
    el.innerHTML = '<div class="tr-empty">метрики появятся после первого поколения</div>';
    return;
  }
  const min = Math.max(1 / 60, m.seconds / 60);
  const cells: [string, string][] = [
    ['волн за эпизод', m.progress.toFixed(2)],
    ['выживание', `${Math.round(m.alive * 100)}%`],
    ['урон по боту / мин', (m.dmgTaken / min).toFixed(0)],
    ['убийств / мин', (m.kills / min).toFixed(0)],
    ['время до убийства', `${m.ttk.toFixed(1)} с`],
    ['точность', m.shots ? `${Math.round((m.hits / m.shots) * 100)}%` : '—'],
    ['рывков / мин', (m.dashes / min).toFixed(1)],
    ['дистанция', m.avgDist.toFixed(1)],
  ];
  el.innerHTML = cells.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
}

function drawChart(): void {
  const cv = root.querySelector<HTMLCanvasElement>('.tr-chart');
  if (!cv) return;
  const g = cv.getContext('2d')!;
  const W = cv.width;
  const H = cv.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(8,7,20,0.6)';
  g.fillRect(0, 0, W, H);
  const h = cur.history;
  if (h.length === 0) {
    g.fillStyle = '#7f86a8';
    g.font = '13px JetBrains Mono, monospace';
    g.fillText('нажми «Начать обучение» — график фитнеса появится здесь', 20, H / 2);
    return;
  }
  // every generation plays new games, so absolute scores jump with the luck of the games;
  // what matters is the advantage over the untrained bot on the SAME games (smoothed a little)
  const keys = ['best', 'median', 'model', 'search'] as const;
  const rel: Record<(typeof keys)[number], number[]> = { best: [], median: [], model: [], search: [] };
  const ema: Record<string, number> = {};
  for (const s of h) {
    for (const k of keys) {
      const v = (s[k] ?? s.model) - s.base;
      ema[k] = ema[k] === undefined ? v : ema[k]! * 0.6 + v * 0.4;
      rel[k].push(ema[k]!);
    }
  }
  let lo = 0;
  let hi = 0;
  for (const k of keys) for (const v of rel[k]) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  if (hi - lo < 1) hi = lo + 1;
  const pad = 30;
  const X = (i: number): number => pad + (i / Math.max(1, h.length - 1)) * (W - pad * 2);
  const Y = (v: number): number => H - pad - ((v - lo) / (hi - lo)) * (H - pad * 2);
  g.strokeStyle = 'rgba(127,134,168,0.18)';
  g.lineWidth = 1;
  g.font = '11px JetBrains Mono, monospace';
  g.fillStyle = '#7f86a8';
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    g.beginPath();
    g.moveTo(pad, Y(v));
    g.lineTo(W - pad, Y(v));
    g.stroke();
    g.fillText((v >= 0 ? '+' : '') + v.toFixed(1), 2, Y(v) + 4);
  }
  // the baseline: the untrained bot = 0
  g.strokeStyle = '#ff2d7a';
  g.setLineDash([6, 4]);
  g.beginPath();
  g.moveTo(pad, Y(0));
  g.lineTo(W - pad, Y(0));
  g.stroke();
  g.setLineDash([]);
  const line = (key: (typeof keys)[number], color: string, width: number): void => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.shadowColor = color;
    g.shadowBlur = width > 2 ? 8 : 0;
    g.beginPath();
    rel[key].forEach((v, i) => (i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))));
    g.stroke();
    g.shadowBlur = 0;
  };
  line('median', '#7f86a8', 1.5);
  line('search', '#b36bff', 1.5);
  line('best', '#ffb02e', 1.5);
  line('model', '#2ef2ff', 3);
  // ★ where the champion was replaced
  g.fillStyle = '#5cff9b';
  h.forEach((s, i) => {
    if (s.promoted) g.fillText('★', X(i) - 4, Y(rel.model[i]!) - 6);
  });
}

// ───────────────────────────── rewards & config
function renderRewards(): void {
  const r = cur.rewards;
  $('.tr-rewards').innerHTML = section(
    'Награды — за что хвалить бота',
    (Object.keys(REWARD_INFO) as (keyof Rewards)[])
      .map((k) => {
        const info = REWARD_INFO[k];
        return row(info.name, slider(`rw:${k}`, r[k], { min: info.min, max: info.max, step: 0.05, fmt: (v) => (k === 'style' ? (v > 0.05 ? `далеко ${v.toFixed(2)}` : v < -0.05 ? `близко ${(-v).toFixed(2)}` : 'всё равно') : `×${v.toFixed(2)}`) }), info.hint);
      })
      .join('') + `<div class="tr-presets">${button('Только скорость', { size: 'sm', action: 'pre:speed' })}${button('Только живучесть', { size: 'sm', action: 'pre:tank' })}${button('Агрессор', { size: 'sm', action: 'pre:aggro' })}${button('Снайпер', { size: 'sm', action: 'pre:sniper' })}${button('Баланс', { size: 'sm', action: 'pre:balance' })}</div>`,
    'можно менять на ходу',
  );
}

function renderCfg(): void {
  const c = cur.cfg;
  $('.tr-cfg').innerHTML = section(
    'Сценарий и алгоритм',
    row('Сложность', segmented('cfg:difficulty', c.difficulty, DIFFICULTIES.map((d, i) => ({ value: i, label: d.name, accent: DIFF_COLORS[i] })))) +
      row('Где учиться', segmented('cfg:stage', c.stage, (Object.keys(STAGES) as Stage[]).map((k) => ({ value: k, label: STAGES[k].name }))), 'стартовые волны эпизодов; в середине кампании бот получает типичный набор апгрейдов') +
      row('Длина эпизода', slider('cfg:seconds', c.seconds, { min: 20, max: 180, step: 5, fmt: (v) => `${v} с игры` }), 'длиннее — точнее оценка, медленнее') +
      row('Игр на кандидата', segmented('cfg:seeds', c.seeds, [1, 2, 3, 5].map((v) => ({ value: v, label: String(v) }))), 'больше — меньше шума от удачи') +
      row('Популяция', slider('cfg:lambda', c.lambda, { min: 6, max: 32, step: 2, fmt: (v) => `${v} ботов` }), 'кандидатов в поколении') +
      row('Шаг поиска σ', slider('cfg:sigma', c.sigma, { min: 0.05, max: 1, step: 0.05, fmt: (v) => v.toFixed(2) }), 'насколько смело мутировать (при новом старте)') +
      row('Потоки', segmented('cfg:workers', workers, [1, 2, 4, cores].filter((v, i, a) => a.indexOf(v) === i).map((v) => ({ value: v, label: String(v) }))), `ядер доступно: ${navigator.hardwareConcurrency || '?'}`),
  );
}

function renderGenes(): void {
  const w = decodeGenome(cur.genome);
  const d = defaultWeights();
  const groups = [...new Set(GENOME.map((g) => g.group))];
  $('.tr-genes').innerHTML = `<h4 class="tr-h">ГЕНЫ МОДЕЛИ <small>× к базовому Тактику</small></h4>${groups
    .map(
      (gr) =>
        `<div class="tr-ggroup"><h5>${gr}</h5>${GENOME.filter((g) => g.group === gr)
          .map((g) => {
            const ratio = w[g.key] / d[g.key];
            const lr = Math.log2(ratio || 1);
            const f = Math.max(-1, Math.min(1, lr / 2));
            return `<div class="tr-gene" title="${esc(g.name)}: ${w[g.key].toFixed(2)} (база ${d[g.key]})"><span>${esc(g.name)}</span><i><u style="${f >= 0 ? `left:50%;width:${f * 50}%` : `left:${50 + f * 50}%;width:${-f * 50}%`}" class="${f >= 0 ? 'p' : 'n'}"></u></i><b>×${ratio.toFixed(2)}</b></div>`;
          })
          .join('')}</div>`,
    )
    .join('')}`;
}

function renderAll(): void {
  renderModels();
  renderRun();
  renderRewards();
  renderCfg();
  renderGenes();
}

// ───────────────────────────── training loop
async function train(): Promise<void> {
  if (running) return;
  running = true;
  pool?.dispose();
  pool = new WorkerPool(workers);
  es = cur.cma && cur.cma.n === GENOME.length && cur.cma.lambda === cur.cfg.lambda ? CMAES.from(cur.cma) : new CMAES(cur.genome, cur.cfg.sigma, { lambda: cur.cfg.lambda, seed: (Date.now() & 0xffff) + 1 });
  if (cur.genome.length !== GENOME.length) cur.genome = Array(GENOME.length).fill(0);
  status = 'обучение…';
  renderRun();
  const model = cur;
  while (running && model === cur) {
    const res = await generation(pool, es, cur);
    if (model !== cur) break;
    cur.cma = es.state(); // the genome itself is updated by generation() only on a promotion
    cur.history.push(res.stat);
    cur.metrics = res.modelMetrics;
    lastGenSec = res.seconds;
    const s = res.stat;
    const gain = s.base !== 0 ? ((s.model - s.base) / Math.abs(s.base)) * 100 : 0;
    status = `${s.promoted ? '★ новый чемпион · ' : ''}модель ${s.model.toFixed(1)} · база ${s.base.toFixed(1)} · ${gain >= 0 ? '+' : ''}${gain.toFixed(0)}%`;
    saveModel(cur);
    models = listModels();
    renderModels();
    renderRun();
    renderGenes();
    previewDirty = true;
  }
  running = false;
  pool?.dispose();
  pool = null;
  status = 'пауза';
  renderRun();
}

// ───────────────────────────── interactions
const PRESETS: Record<string, Rewards> = {
  speed: { progress: 1, survival: 0.2, speed: 2, damage: 0.5, accuracy: 0, dashEconomy: 0, style: 0 },
  tank: { progress: 0.5, survival: 2, speed: 0, damage: 0, accuracy: 0, dashEconomy: 0.3, style: 0.3 },
  aggro: { progress: 1, survival: 0.4, speed: 1.2, damage: 1.5, accuracy: 0.2, dashEconomy: 0, style: -0.8 },
  sniper: { progress: 1, survival: 1, speed: 0.4, damage: 0.4, accuracy: 1.5, dashEconomy: 0.3, style: 1 },
  balance: { progress: 1, survival: 1, speed: 0.5, damage: 0.3, accuracy: 0.2, dashEconomy: 0.1, style: 0 },
};

bindKit(root, {
  onChange: (k: string, v: KitValue) => {
    if (k === 'name') {
      cur.name = String(v).slice(0, 40) || 'Без имени';
      saveModel(cur);
      models = listModels();
      root.querySelectorAll<HTMLElement>(`.tr-model[data-mid="${cur.id}"] b`).forEach((b) => (b.textContent = cur.name));
      return;
    }
    if (k.startsWith('rw:')) {
      cur.rewards[k.slice(3) as keyof Rewards] = v as number;
    } else if (k === 'cfg:workers') {
      workers = v as number;
      return;
    } else if (k.startsWith('cfg:')) {
      const key = k.slice(4) as keyof BotModel['cfg'];
      (cur.cfg as unknown as Record<string, KitValue>)[key] = v;
      if (key === 'lambda') delete cur.cma; // population size is baked into the optimiser
    }
    saveModel(cur);
  },
  onAction: (a: string) => {
    if (a === 'start') void train();
    else if (a === 'stop') running = false;
    else if (a === 'new' || a === 'clone' || a === 'scratch') {
      running = false;
      const m = newModel(a === 'clone' ? `${cur.name} · копия` : a === 'scratch' ? `С нуля ${models.length + 1}` : `Модель ${models.length + 1}`, a === 'clone' ? cur : undefined);
      if (a === 'clone') m.history = [...cur.history];
      if (a === 'scratch') {
        m.genome = GENOME.map(() => (Math.random() * 2 - 1) * 2.5);
        m.cfg.sigma = 0.8;
      }
      saveModel(m);
      models = listModels();
      cur = m;
      previewDirty = true;
      renderAll();
    } else if (a === 'import') $<HTMLInputElement>('#tr-file').click();
    else if (a === 'export') {
      const el = document.createElement('a');
      el.href = URL.createObjectURL(new Blob([exportJSON(cur)], { type: 'application/json' }));
      el.download = `null-arena-bot-${cur.name.replace(/[^\wа-яё-]+/gi, '_')}.json`;
      el.click();
    } else if (a === 'delete') {
      if (!confirm(`Удалить модель «${cur.name}»?`)) return;
      running = false;
      deleteModel(cur.id);
      models = listModels();
      if (models.length === 0) {
        const m = newModel('Тактик · база');
        saveModel(m);
        models = [m];
      }
      cur = models[0]!;
      previewDirty = true;
      renderAll();
    } else if (a === 'reset') {
      running = false;
      cur.genome = Array(GENOME.length).fill(0);
      cur.history = [];
      delete cur.cma;
      delete cur.metrics;
      saveModel(cur);
      previewDirty = true;
      renderAll();
    } else if (a === 'watch') {
      saveModel(cur);
      location.href = `./?watch=${encodeURIComponent(cur.id)}&diff=${cur.cfg.difficulty}`;
    } else if (a.startsWith('pre:')) {
      cur.rewards = { ...PRESETS[a.slice(4)]! };
      saveModel(cur);
      renderRewards();
    } else if (a.startsWith('spd:')) previewSpeed = Number(a.slice(4));
  },
});
root.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-mid]');
  if (!b || b.dataset['mid'] === cur.id) return;
  running = false;
  cur = models.find((m) => m.id === b.dataset['mid']) ?? cur;
  lastGenSec = 0;
  status = 'готово к обучению';
  previewDirty = true;
  renderAll();
});
root.addEventListener('change', async (e) => {
  const inp = e.target as HTMLInputElement;
  if (inp.id !== 'tr-file' || !inp.files?.[0]) return;
  try {
    const m = importJSON(await inp.files[0].text());
    saveModel(m);
    models = listModels();
    cur = m;
    previewDirty = true;
    renderAll();
  } catch (err) {
    alert(`Не удалось импортировать: ${(err as Error).message}`);
  }
  inp.value = '';
});

// ───────────────────────────── live 2D preview of the current model
let previewDirty = true;
let previewSpeed = 2;
let sim: Scenario | null = null;
let simT = 0;
let simSeed = 1;
$('.tr-prev-ctl').innerHTML = `${segmented('spd', 2, [1, 2, 4, 8].map((v) => ({ value: v, label: `${v}×` })))}<span class="tr-prev-info"></span>`;
$('.tr-prev-ctl').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
  if (b) previewSpeed = Number(b.dataset['v']);
});

function restartPreview(): void {
  const waves = STAGES[cur.cfg.stage].waves;
  const wave = waves[simSeed % waves.length]!;
  const s = new Scenario(simSeed++, cur.cfg.difficulty, 'campaign', wave);
  for (const k of kitFor(wave)) {
    try {
      s.upgrade(k);
    } catch {
      /* not available */
    }
  }
  s.input(tactician({ weights: decodeGenome(cur.genome), reaction: 6 }));
  sim = s;
  simT = 0;
  previewDirty = false;
}

const cv = $<HTMLCanvasElement>('.tr-preview canvas');
const g2 = cv.getContext('2d')!;
const COL: Record<number, string> = { 0: '#ff3a52', 1: '#b6ff3b', 2: '#ffa126', 3: '#8fa6ff', 4: '#c77dff' };
function drawPreview(): void {
  if (!sim) return;
  const w = sim.world;
  const W = cv.width;
  const H = cv.height;
  const k = Math.min(W / (ARENA_HW * 2), H / (ARENA_HH * 2));
  const X = (x: number): number => W / 2 + x * k;
  const Y = (y: number): number => H / 2 + y * k;
  g2.fillStyle = '#07060e';
  g2.fillRect(0, 0, W, H);
  g2.strokeStyle = 'rgba(46,242,255,0.25)';
  g2.strokeRect(X(-ARENA_HW), Y(-ARENA_HH), ARENA_HW * 2 * k, ARENA_HH * 2 * k);
  // lanes, pools, marks
  const L = w.lanes;
  g2.fillStyle = 'rgba(255,161,38,0.12)';
  for (let i = 0; i < L.count; i++) g2.fillRect(X(L.cx[i]! - L.hw[i]!), Y(L.cy[i]! - L.hh[i]!), L.hw[i]! * 2 * k, L.hh[i]! * 2 * k);
  for (let i = 0; i < w.pools.count; i++) {
    g2.fillStyle = w.pools.live[i]! > 0 ? 'rgba(155,92,255,0.6)' : 'rgba(155,92,255,0.18)';
    g2.beginPath();
    g2.arc(X(w.pools.x[i]!), Y(w.pools.y[i]!), w.pools.r[i]! * k, 0, Math.PI * 2);
    g2.fill();
  }
  const M = w.marks;
  g2.strokeStyle = '#ffa126';
  for (let i = 0; i < M.hi; i++) {
    if (!M.alive[i]) continue;
    g2.beginPath();
    g2.arc(X(M.x[i]!), Y(M.y[i]!), M.r[i]! * k, 0, Math.PI * 2);
    g2.stroke();
  }
  g2.fillStyle = '#2a2640';
  for (let i = 0; i < w.pillars.count; i++) {
    g2.beginPath();
    g2.arc(X(w.pillars.x[i]!), Y(w.pillars.y[i]!), w.pillars.r[i]! * k, 0, Math.PI * 2);
    g2.fill();
  }
  // enemies by race colour
  const E = w.enemies;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i]) continue;
    const def = enemyDef(E.type[i]!);
    const st = E.st[i]!;
    g2.globalAlpha = st === AS.Spawning ? 0.3 : st === AS.Underground ? 0.25 : 1;
    g2.fillStyle = COL[def.material] ?? '#ff2d7a';
    g2.beginPath();
    g2.arc(X(E.x[i]!), Y(E.y[i]!), Math.max(1.5, E.r[i]! * k), 0, Math.PI * 2);
    g2.fill();
    if (st === AS.Windup) {
      g2.strokeStyle = '#ffffff';
      g2.stroke();
    }
  }
  g2.globalAlpha = 1;
  // bullets
  const B = w.bullets;
  for (let i = 0; i < B.hi; i++) {
    if (!B.alive[i]) continue;
    g2.fillStyle = B.team[i] === Team.Player ? '#9ffcff' : '#ff4fd8';
    g2.fillRect(X(B.x[i]!) - 1, Y(B.y[i]!) - 1, 2, 2);
  }
  // player + aim
  const p = w.player;
  if (p.alive) {
    g2.strokeStyle = 'rgba(46,242,255,0.35)';
    g2.beginPath();
    g2.moveTo(X(p.x), Y(p.y));
    g2.lineTo(X(p.ax), Y(p.ay));
    g2.stroke();
    g2.fillStyle = p.dashT > 0 ? '#ffffff' : '#2ef2ff';
    g2.beginPath();
    g2.arc(X(p.x), Y(p.y), p.r * k * 1.4, 0, Math.PI * 2);
    g2.fill();
  }
  const info = root.querySelector<HTMLElement>('.tr-prev-info');
  if (info) info.textContent = `волна ${w.wave.index + 1} · HP ${Math.ceil(p.hp)}/${Math.round(p.maxHp)} · убийств ${w.stats.kills}`;
}

function loop(): void {
  if (previewDirty || !sim) restartPreview();
  const s = sim!;
  for (let k = 0; k < previewSpeed; k++) {
    s.run(1);
    simT++;
    const ph = s.world.wave.phase;
    if (ph === WavePhase.Dead || ph === WavePhase.Victory || simT > 60 * 90) {
      previewDirty = true;
      break;
    }
  }
  drawPreview();
  requestAnimationFrame(loop);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

renderAll();
requestAnimationFrame(loop);
// expose for automation / debugging
(window as unknown as { __train: unknown }).__train = { get model() { return cur; }, start: () => void train(), stop: () => (running = false), terms: (m: Metrics) => terms(m) };
