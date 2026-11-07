import './train.css';
import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { PageNav } from '../app/nav';
import { navigate } from '../app/router';
import { decodeGenome, defaultWeights, GENOME, tactician } from '../sim/bot/tactician';
import { ARENA_HH, ARENA_HW, AS, Team } from '../sim/constants';
import { DIFFICULTIES } from '../sim/content/difficulty';
import { enemyDef } from '../sim/content/enemies';
import { Scenario } from '../sim/scenario';
import { WavePhase } from '../sim/world';
import { Badge, Button, Row, Section, Segmented, Slider, TextField } from '../ui/kit';
import { kitFor, type Metrics } from './episode';
import { REWARD_INFO, terms, type Rewards } from './fitness';
import { describeRewards, exportJSON, saveModel, STAGES, type BotModel, type Stage } from './models';
import * as T from './store';

/**
 * #/train — evolve the Тактик's genome with CMA-ES in background workers. Reward sliders decide
 * what "better" means; models are saved in the browser, exported as JSON and watchable in the
 * game. All state is in ./store (signals): training continues while other pages are open.
 */
const DIFF_COLORS = DIFFICULTIES.map((d) => d.color);
const PRESETS: Record<string, [string, Rewards]> = {
  speed: ['Только скорость', { progress: 1, survival: 0.2, speed: 2, damage: 0.5, accuracy: 0, dashEconomy: 0, style: 0 }],
  tank: ['Только живучесть', { progress: 0.5, survival: 2, speed: 0, damage: 0, accuracy: 0, dashEconomy: 0.3, style: 0.3 }],
  aggro: ['Агрессор', { progress: 1, survival: 0.4, speed: 1.2, damage: 1.5, accuracy: 0.2, dashEconomy: 0, style: -0.8 }],
  sniper: ['Снайпер', { progress: 1, survival: 1, speed: 0.4, damage: 0.4, accuracy: 1.5, dashEconomy: 0.3, style: 1 }],
  balance: ['Баланс', { progress: 1, survival: 1, speed: 0.5, damage: 0.3, accuracy: 0.2, dashEconomy: 0.1, style: 0 }],
};

export default function TrainPage(): JSX.Element {
  void T.rev.value; // re-render when the current model changes in place
  useEffect(() => {
    (window as unknown as { __train: unknown }).__train = { get model() { return T.cur.value; }, start: () => void T.train(), stop: T.stop, terms: (m: Metrics) => terms(m) };
  }, []);
  return (
    <>
      <PageNav />
      <header class="tr-head">
        <div>
          <h1 class="title">
            NULL<span>//</span>TRAIN
          </h1>
          <div class="sub">обучение ботов · эволюция CMA-ES · {T.cores} потоков</div>
        </div>
      </header>
      <div class="tr-grid">
        <Models />
        <main class="tr-main">
          <Run />
          <RewardsPanel />
          <Cfg />
        </main>
        <aside class="tr-side">
          <Preview />
          <Genes />
        </aside>
      </div>
    </>
  );
}

// ───────────────────────────── models list
function Models(): JSX.Element {
  const c = T.cur.value;
  const file = useRef<HTMLInputElement>(null);
  const exportCur = (): void => {
    const el = document.createElement('a');
    el.href = URL.createObjectURL(new Blob([exportJSON(c)], { type: 'application/json' }));
    el.download = `null-arena-bot-${c.name.replace(/[^\wа-яё-]+/gi, '_')}.json`;
    el.click();
  };
  return (
    <aside class="tr-models k-panel">
      <h4 class="tr-h">
        МОДЕЛИ <small>{T.models.value.length}</small>
      </h4>
      <div class="tr-mlist">
        {T.models.value.map((m) => {
          const last = m.history[m.history.length - 1];
          const gain = last && last.base !== 0 ? ((last.model - last.base) / Math.abs(last.base)) * 100 : 0;
          return (
            <button key={m.id} class={`tr-model${m.id === c.id ? ' on' : ''}`} onClick={() => T.select(m.id)}>
              <b>{m.id === c.id ? c.name : m.name}</b>
              <small>
                {m.history.length} покол. · {describeRewards(m.rewards)}
              </small>
              {last && (
                <em class={gain >= 0 ? 'up' : 'down'}>
                  {gain >= 0 ? '+' : ''}
                  {gain.toFixed(0)}% к базе
                </em>
              )}
            </button>
          );
        })}
      </div>
      <div class="tr-mact">
        <Button size="sm" icon="plus" hint="стартовать с ручного Тактика и дообучить под свои награды" onClick={() => T.create('new')}>
          От Тактика
        </Button>
        <Button size="sm" icon="spark" hint="случайный геном — видно, как бот учится" onClick={() => T.create('scratch')}>
          С нуля
        </Button>
        <Button size="sm" icon="copy" onClick={() => T.create('clone')}>
          Копия
        </Button>
        <Button size="sm" icon="upload" onClick={() => file.current?.click()}>
          Импорт
        </Button>
      </div>
      <Section title="Выбранная">
        <Row label="Имя">
          <TextField value={c.name} onInput={T.rename} />
        </Row>
        <div class="tr-mact">
          <Button
            size="sm"
            variant="primary"
            icon="play"
            onClick={() => {
              saveModel(c);
              navigate(`#/watch/${encodeURIComponent(c.id)}/${c.cfg.difficulty}`);
            }}
          >
            Смотреть в игре
          </Button>
          <Button size="sm" icon="download" onClick={exportCur}>
            Экспорт
          </Button>
          <Button size="sm" icon="reset" hint="вернуть геном к базовому Тактику" onClick={T.resetModel}>
            Сбросить
          </Button>
          <Button size="sm" variant="danger" icon="trash" onClick={() => confirm(`Удалить модель «${c.name}»?`) && T.remove()}>
            Удалить
          </Button>
        </div>
      </Section>
      <input
        type="file"
        accept="application/json,.json"
        class="hidden"
        ref={file}
        onChange={async (e) => {
          const inp = e.currentTarget;
          if (!inp.files?.[0]) return;
          try {
            await T.importFile(inp.files[0]);
          } catch (err) {
            alert(`Не удалось импортировать: ${(err as Error).message}`);
          }
          inp.value = '';
        }}
      />
    </aside>
  );
}

// ───────────────────────────── run: status, chart, metrics
function Run(): JSX.Element {
  const c = T.cur.value;
  const run = T.running.value;
  const cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => drawChart(cv.current!, c), [T.rev.value, c]);
  const m = c.metrics;
  return (
    <section class="k-panel tr-run">
      <div class="tr-runbar">
        {run ? (
          <Button variant="danger" icon="pause" onClick={T.stop}>
            Пауза
          </Button>
        ) : (
          <Button variant="primary" icon="play" onClick={() => void T.train()}>
            {c.history.length ? 'Продолжить обучение' : 'Начать обучение'}
          </Button>
        )}
        <div class="tr-status">
          <b>{T.status.value}</b>
          <small>
            поколение {c.history.length}
            {T.lastGenSec.value ? ` · ${T.lastGenSec.value.toFixed(1)} с на поколение` : ''} · {c.cfg.lambda + 2} × {c.cfg.seeds} игр по {c.cfg.seconds} с
          </small>
        </div>
      </div>
      <canvas class="tr-chart" width={900} height={240} ref={cv} />
      <div class="tr-legend">
        <Badge accent="#ffb02e">лучший кандидат</Badge> <Badge accent="#7f86a8">медиана</Badge> <Badge accent="#2ef2ff">модель (чемпион)</Badge> <Badge accent="#b36bff">точка поиска</Badge> <Badge accent="#ff2d7a">база = 0 (необученный)</Badge>{' '}
        <span class="tr-star">★ — новый чемпион · по вертикали: преимущество над базой на тех же играх</span>
      </div>
      <div class="tr-metrics">{m ? <MetricCells m={m} /> : <div class="tr-empty">метрики появятся после первого поколения</div>}</div>
    </section>
  );
}

function MetricCells({ m }: { m: Metrics }): JSX.Element {
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
  return (
    <>
      {cells.map(([k, v]) => (
        <div key={k}>
          <b>{v}</b>
          <span>{k}</span>
        </div>
      ))}
    </>
  );
}

function drawChart(cv: HTMLCanvasElement, cur: BotModel): void {
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
  for (const k of keys)
    for (const v of rel[k]) {
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
  g.fillStyle = '#5cff9b';
  h.forEach((s, i) => {
    if (s.promoted) g.fillText('★', X(i) - 4, Y(rel.model[i]!) - 6);
  });
}

// ───────────────────────────── rewards & config
function RewardsPanel(): JSX.Element {
  const r = T.cur.value.rewards;
  return (
    <section class="k-panel tr-rewards">
      <Section title="Награды — за что хвалить бота" note="можно менять на ходу">
        {(Object.keys(REWARD_INFO) as (keyof Rewards)[]).map((k) => {
          const info = REWARD_INFO[k];
          const fmt = (v: number): string => (k === 'style' ? (v > 0.05 ? `далеко ${v.toFixed(2)}` : v < -0.05 ? `близко ${(-v).toFixed(2)}` : 'всё равно') : `×${v.toFixed(2)}`);
          return (
            <Row key={k} label={info.name} hint={info.hint}>
              <Slider value={r[k]} min={info.min} max={info.max} step={0.05} fmt={fmt} onInput={(v) => T.setReward(k, v)} />
            </Row>
          );
        })}
        <div class="tr-presets">
          {Object.entries(PRESETS).map(([k, [label, rw]]) => (
            <Button key={k} size="sm" onClick={() => T.setRewards(rw)}>
              {label}
            </Button>
          ))}
        </div>
      </Section>
    </section>
  );
}

function Cfg(): JSX.Element {
  const c = T.cur.value.cfg;
  const wk = [1, 2, 4, T.cores].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <section class="k-panel tr-cfg">
      <Section title="Сценарий и алгоритм">
        <Row label="Сложность">
          <Segmented value={c.difficulty} options={DIFFICULTIES.map((d, i) => ({ value: i, label: d.name, accent: DIFF_COLORS[i] }))} onChange={(v) => T.setCfg('difficulty', v)} />
        </Row>
        <Row label="Где учиться" hint="стартовые волны эпизодов; в середине кампании бот получает типичный набор апгрейдов">
          <Segmented<Stage> value={c.stage} options={(Object.keys(STAGES) as Stage[]).map((k) => ({ value: k, label: STAGES[k].name }))} onChange={(v) => T.setCfg('stage', v)} />
        </Row>
        <Row label="Длина эпизода" hint="длиннее — точнее оценка, медленнее">
          <Slider value={c.seconds} min={20} max={180} step={5} fmt={(v) => `${v} с игры`} onInput={(v) => T.setCfg('seconds', v)} />
        </Row>
        <Row label="Игр на кандидата" hint="больше — меньше шума от удачи">
          <Segmented value={c.seeds} options={[1, 2, 3, 5].map((v) => ({ value: v, label: String(v) }))} onChange={(v) => T.setCfg('seeds', v)} />
        </Row>
        <Row label="Популяция" hint="кандидатов в поколении">
          <Slider value={c.lambda} min={6} max={32} step={2} fmt={(v) => `${v} ботов`} onInput={(v) => T.setCfg('lambda', v)} />
        </Row>
        <Row label="Шаг поиска σ" hint="насколько смело мутировать (при новом старте)">
          <Slider value={c.sigma} min={0.05} max={1} step={0.05} fmt={(v) => v.toFixed(2)} onInput={(v) => T.setCfg('sigma', v)} />
        </Row>
        <Row label="Потоки" hint={`ядер доступно: ${navigator.hardwareConcurrency || '?'}`}>
          <Segmented value={T.workers.value} options={wk.map((v) => ({ value: v, label: String(v) }))} onChange={(v) => (T.workers.value = v)} />
        </Row>
      </Section>
    </section>
  );
}

function Genes(): JSX.Element {
  const w = decodeGenome(T.cur.value.genome);
  const d = defaultWeights();
  const groups = [...new Set(GENOME.map((g) => g.group))];
  return (
    <section class="k-panel tr-genes">
      <h4 class="tr-h">
        ГЕНЫ МОДЕЛИ <small>× к базовому Тактику</small>
      </h4>
      {groups.map((gr) => (
        <div key={gr} class="tr-ggroup">
          <h5>{gr}</h5>
          {GENOME.filter((g) => g.group === gr).map((g) => {
            const ratio = w[g.key] / d[g.key];
            const f = Math.max(-1, Math.min(1, Math.log2(ratio || 1) / 2));
            return (
              <div key={g.key} class="tr-gene" title={`${g.name}: ${w[g.key].toFixed(2)} (база ${d[g.key]})`}>
                <span>{g.name}</span>
                <i>
                  <u class={f >= 0 ? 'p' : 'n'} style={f >= 0 ? { left: '50%', width: `${f * 50}%` } : { left: `${50 + f * 50}%`, width: `${-f * 50}%` }} />
                </i>
                <b>×{ratio.toFixed(2)}</b>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}

// ───────────────────────────── live 2D preview (runs only while this page is open)
const COL: Record<number, string> = { 0: '#ff3a52', 1: '#b6ff3b', 2: '#ffa126', 3: '#8fa6ff', 4: '#c77dff' };

function Preview(): JSX.Element {
  const speed = useSignal(2);
  const cv = useRef<HTMLCanvasElement>(null);
  const info = useRef<HTMLSpanElement>(null);
  const spd = useRef(2);
  spd.current = speed.value;
  useEffect(() => {
    const g2 = cv.current!.getContext('2d')!;
    let sim: Scenario | null = null;
    let simT = 0;
    let seed = 1;
    let epoch = -1;
    let raf = 0;
    const restart = (): void => {
      const m = T.cur.value;
      const waves = STAGES[m.cfg.stage].waves;
      const wave = waves[seed % waves.length]!;
      const s = new Scenario(seed++, m.cfg.difficulty, 'campaign', wave);
      for (const k of kitFor(wave)) {
        try {
          s.upgrade(k);
        } catch {
          /* not available */
        }
      }
      s.input(tactician({ weights: decodeGenome(m.genome), reaction: 6 }));
      sim = s;
      simT = 0;
      epoch = T.previewEpoch.peek();
    };
    const loop = (): void => {
      if (!sim || epoch !== T.previewEpoch.peek()) restart();
      const s = sim!;
      for (let k = 0; k < spd.current; k++) {
        s.run(1);
        simT++;
        const ph = s.world.wave.phase;
        if (ph === WavePhase.Dead || ph === WavePhase.Victory || simT > 60 * 90) {
          sim = null;
          break;
        }
      }
      drawPreview(g2, s, info.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <section class="k-panel tr-preview">
      <h4 class="tr-h">
        ПРОСМОТР МОДЕЛИ <small>2D, тот же симулятор</small>
      </h4>
      <canvas width={432} height={288} ref={cv} />
      <div class="tr-prev-ctl">
        <Segmented value={speed.value} options={[1, 2, 4, 8].map((v) => ({ value: v, label: `${v}×` }))} onChange={(v) => (speed.value = v)} />
        <span class="tr-prev-info" ref={info} />
      </div>
    </section>
  );
}

function drawPreview(g2: CanvasRenderingContext2D, sim: Scenario, info: HTMLElement | null): void {
  const w = sim.world;
  const cv = g2.canvas;
  const W = cv.width;
  const H = cv.height;
  const k = Math.min(W / (ARENA_HW * 2), H / (ARENA_HH * 2));
  const X = (x: number): number => W / 2 + x * k;
  const Y = (y: number): number => H / 2 + y * k;
  g2.fillStyle = '#07060e';
  g2.fillRect(0, 0, W, H);
  g2.strokeStyle = 'rgba(46,242,255,0.25)';
  g2.strokeRect(X(-ARENA_HW), Y(-ARENA_HH), ARENA_HW * 2 * k, ARENA_HH * 2 * k);
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
  // health pickups
  const P = w.pickups;
  g2.fillStyle = '#5cff9b';
  for (let i = 0; i < P.hi; i++) if (P.alive[i]) g2.fillRect(X(P.x[i]!) - 2, Y(P.y[i]!) - 2, 4, 4);
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
  const B = w.bullets;
  for (let i = 0; i < B.hi; i++) {
    if (!B.alive[i]) continue;
    g2.fillStyle = B.team[i] === Team.Player ? '#9ffcff' : '#ff4fd8';
    g2.fillRect(X(B.x[i]!) - 1, Y(B.y[i]!) - 1, 2, 2);
  }
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
  if (info) info.textContent = `волна ${w.wave.index + 1} · HP ${Math.ceil(p.hp)}/${Math.round(p.maxHp)} · убийств ${w.stats.kills}`;
}
