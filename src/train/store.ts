import { signal } from '@preact/signals';
import { GENOME } from '../sim/bot/tactician';
import { CMAES } from './cmaes';
import type { Rewards } from './fitness';
import { deleteModel, importJSON, listModels, newModel, saveModel, type BotModel } from './models';
import { generation, WorkerPool } from './trainer';

/**
 * Training state, outside any component: training keeps running when you leave #/train (go watch
 * the game, come back — the chart has grown). The current model is mutated in place by the
 * optimiser; `rev` bumps after each change so the page re-renders exactly then.
 */
export const cores = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));

function initial(): BotModel[] {
  const m = listModels();
  if (m.length) return m;
  const base = newModel('Тактик · база');
  saveModel(base);
  return [base];
}
const first = initial();
export const models = signal<BotModel[]>(first);
export const cur = signal<BotModel>(first[0]!);
export const running = signal(false);
export const status = signal('готово к обучению');
export const lastGenSec = signal(0);
export const workers = signal(cores);
/** model changed in place (history, genome, rewards, cfg) */
export const rev = signal(0);
/** preview must restart (other model / genome) */
export const previewEpoch = signal(0);

const bump = (): void => void rev.value++;
function persist(): void {
  saveModel(cur.value);
  models.value = listModels();
  bump();
}

export function select(id: string): void {
  if (id === cur.value.id) return;
  running.value = false;
  cur.value = models.value.find((m) => m.id === id) ?? cur.value;
  lastGenSec.value = 0;
  status.value = 'готово к обучению';
  previewEpoch.value++;
}

export function rename(name: string): void {
  cur.value.name = name.slice(0, 40) || 'Без имени';
  persist();
}

export function setReward(k: keyof Rewards, v: number): void {
  cur.value.rewards[k] = v;
  persist();
}
export function setRewards(r: Rewards): void {
  cur.value.rewards = { ...r };
  persist();
}
export function setCfg<K extends keyof BotModel['cfg']>(k: K, v: BotModel['cfg'][K]): void {
  cur.value.cfg[k] = v;
  if (k === 'lambda') delete cur.value.cma; // population size is baked into the optimiser
  if (k === 'difficulty' || k === 'stage') previewEpoch.value++;
  persist();
}

export function create(kind: 'new' | 'clone' | 'scratch'): void {
  running.value = false;
  const c = cur.value;
  const n = models.value.length + 1;
  const m = newModel(kind === 'clone' ? `${c.name} · копия` : kind === 'scratch' ? `С нуля ${n}` : `Модель ${n}`, kind === 'clone' ? c : undefined);
  if (kind === 'clone') m.history = [...c.history];
  if (kind === 'scratch') {
    m.genome = GENOME.map(() => (Math.random() * 2 - 1) * 2.5);
    m.cfg.sigma = 0.8;
  }
  saveModel(m);
  models.value = listModels();
  cur.value = m;
  previewEpoch.value++;
}

export function remove(): void {
  running.value = false;
  deleteModel(cur.value.id);
  let all = listModels();
  if (all.length === 0) {
    const m = newModel('Тактик · база');
    saveModel(m);
    all = [m];
  }
  models.value = all;
  cur.value = all[0]!;
  previewEpoch.value++;
}

export function resetModel(): void {
  running.value = false;
  const c = cur.value;
  c.genome = Array(GENOME.length).fill(0);
  c.history = [];
  delete c.cma;
  delete c.metrics;
  persist();
  previewEpoch.value++;
}

export async function importFile(f: File): Promise<void> {
  const m = importJSON(await f.text());
  saveModel(m);
  models.value = listModels();
  cur.value = m;
  previewEpoch.value++;
}

let pool: WorkerPool | null = null;
export async function train(): Promise<void> {
  if (running.value) return;
  running.value = true;
  pool?.dispose();
  pool = new WorkerPool(workers.value);
  const model = cur.value;
  if (model.genome.length !== GENOME.length) model.genome = Array(GENOME.length).fill(0);
  const es = model.cma && model.cma.n === GENOME.length && model.cma.lambda === model.cfg.lambda ? CMAES.from(model.cma) : new CMAES(model.genome, model.cfg.sigma, { lambda: model.cfg.lambda, seed: (Date.now() & 0xffff) + 1 });
  status.value = 'обучение…';
  while (running.value && model === cur.value) {
    const res = await generation(pool, es, model);
    if (model !== cur.value) break;
    model.cma = es.state(); // the genome itself only changes on a promotion (inside generation)
    model.history.push(res.stat);
    model.metrics = res.modelMetrics;
    lastGenSec.value = res.seconds;
    const s = res.stat;
    const gain = s.base !== 0 ? ((s.model - s.base) / Math.abs(s.base)) * 100 : 0;
    status.value = `${s.promoted ? '★ новый чемпион · ' : ''}модель ${s.model.toFixed(1)} · база ${s.base.toFixed(1)} · ${gain >= 0 ? '+' : ''}${gain.toFixed(0)}%`;
    persist();
    if (s.promoted) previewEpoch.value++;
  }
  running.value = false;
  pool?.dispose();
  pool = null;
  status.value = 'пауза';
}
export function stop(): void {
  running.value = false;
}
