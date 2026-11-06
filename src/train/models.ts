import type { CMAState } from './cmaes';
import type { Metrics } from './episode';
import { DEFAULT_REWARDS, type Rewards } from './fitness';
import { decodeGenome, GENOME, tactician } from '../sim/bot/tactician';
import type { BotSkill } from '../sim/scenario';

/** where the training games start */
export type Stage = 'act1' | 'act2' | 'act3' | 'mixed';
export const STAGES: Record<Stage, { name: string; waves: number[] }> = {
  act1: { name: 'Акт I · Карантин', waves: [1, 2, 3, 4, 5, 6, 7, 8] },
  act2: { name: 'Акт II · Плоть', waves: [10, 11, 12] },
  act3: { name: 'Акт III · Цех', waves: [14, 15, 16, 17] },
  mixed: { name: 'Вся кампания', waves: [2, 4, 6, 8, 10, 11, 12, 14, 15, 16, 17] },
};

export interface TrainCfg {
  difficulty: number;
  stage: Stage;
  /** game seconds per episode */
  seconds: number;
  /** episodes per candidate (more = less noise, slower) */
  seeds: number;
  /** population per generation */
  lambda: number;
  /** initial exploration step */
  sigma: number;
}
export const DEFAULT_CFG: TrainCfg = { difficulty: 2, stage: 'mixed', seconds: 60, seeds: 3, lambda: 12, sigma: 0.6 };

export interface GenStat {
  gen: number;
  best: number;
  median: number;
  /** the saved model (champion) on this generation's games */
  model: number;
  /** the optimiser's current search point */
  search: number;
  base: number;
  /** the search point replaced the champion this generation */
  promoted?: boolean;
}

export interface BotModel {
  id: string;
  name: string;
  created: number;
  updated: number;
  /** genome of the saved model — the champion: only replaced by a search point that beat it on
   *  the same games twice in a row, so noise can't make the model worse */
  genome: number[];
  /** consecutive generations the search point has beaten the champion */
  streak?: number;
  rewards: Rewards;
  cfg: TrainCfg;
  history: GenStat[];
  /** metrics of the model on the last generation's games */
  metrics?: Metrics;
  /** optimiser state: training resumes where it stopped */
  cma?: CMAState;
  /** genome length guard: old saves after the genome changed */
  version: number;
}

const LS = 'null-arena:bot-models';
export const GENOME_VERSION = GENOME.length;

export function listModels(): BotModel[] {
  try {
    const raw = localStorage.getItem(LS);
    const arr = raw ? (JSON.parse(raw) as BotModel[]) : [];
    return arr.filter((m) => Array.isArray(m.genome)).map(fixup);
  } catch {
    return [];
  }
}
function fixup(m: BotModel): BotModel {
  // pad / trim the genome when the genome layout changed between versions
  const g = Array.from({ length: GENOME.length }, (_, i) => m.genome[i] ?? 0);
  const keep = m.version === GENOME_VERSION;
  return { ...m, genome: g, rewards: { ...DEFAULT_REWARDS, ...m.rewards }, version: GENOME_VERSION, ...(keep ? {} : { cma: undefined }) } as BotModel;
}
export function saveModel(m: BotModel): void {
  const all = listModels().filter((x) => x.id !== m.id);
  all.unshift({ ...m, updated: Date.now() });
  try {
    localStorage.setItem(LS, JSON.stringify(all));
  } catch {
    // storage full: drop optimiser states of other models and retry
    for (const x of all) if (x.id !== m.id) delete x.cma;
    localStorage.setItem(LS, JSON.stringify(all));
  }
}
export function deleteModel(id: string): void {
  localStorage.setItem(LS, JSON.stringify(listModels().filter((x) => x.id !== id)));
}
export function newModel(name: string, from?: BotModel): BotModel {
  const now = Date.now();
  return {
    id: `m${now.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    name,
    created: now,
    updated: now,
    genome: from ? [...from.genome] : Array(GENOME.length).fill(0),
    rewards: { ...(from?.rewards ?? DEFAULT_REWARDS) },
    cfg: { ...(from?.cfg ?? DEFAULT_CFG) },
    history: [],
    version: GENOME_VERSION,
  };
}
export function exportJSON(m: BotModel): string {
  const { cma: _c, ...rest } = m;
  return JSON.stringify({ format: 'null-arena-bot', ...rest }, null, 1);
}
export function importJSON(text: string): BotModel {
  const o = JSON.parse(text) as Partial<BotModel> & { format?: string };
  if (o.format !== 'null-arena-bot' || !Array.isArray(o.genome)) throw new Error('это не файл модели NULL//ARENA');
  const m = newModel(o.name ?? 'Импорт');
  return fixup({ ...m, genome: o.genome, rewards: { ...DEFAULT_REWARDS, ...(o.rewards ?? {}) }, cfg: { ...DEFAULT_CFG, ...(o.cfg ?? {}) }, history: o.history ?? [], version: o.version ?? 0 } as BotModel);
}

/** saved models as watchable bots (menu → «Смотреть бота») */
export function modelSkills(): BotSkill[] {
  return listModels().map((m) => ({
    key: `model:${m.id}`,
    name: m.name,
    desc: `Обученная модель · ${m.history.length} покол. · ${describeRewards(m.rewards)}`,
    make: () => tactician({ weights: decodeGenome(m.genome), reaction: 6 }),
  }));
}
export function describeRewards(r: Rewards): string {
  const top = (Object.entries(r) as [keyof Rewards, number][]).filter(([k]) => k !== 'style').sort((a, b) => b[1] - a[1]).slice(0, 2);
  const N: Record<string, string> = { progress: 'прогресс', survival: 'живучесть', speed: 'скорость', damage: 'урон', accuracy: 'точность', dashEconomy: 'экономия рывка' };
  return top.map(([k]) => N[k]).join(' + ') + (r.style > 0.3 ? ', дальний бой' : r.style < -0.3 ? ', ближний бой' : '');
}
