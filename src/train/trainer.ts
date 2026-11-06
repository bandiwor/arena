import { CMAES } from './cmaes';
import type { EpisodeCfg, Metrics } from './episode';
import { fitness, meanMetrics } from './fitness';
import { STAGES, type BotModel, type GenStat } from './models';

/** pool of headless sim workers */
export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: { genome: number[]; cfg: EpisodeCfg; res: (m: Metrics) => void }[] = [];
  private readonly pending = new Map<number, (m: Metrics) => void>();
  private nextId = 1;
  constructor(readonly size: number) {
    for (let k = 0; k < size; k++) {
      const w = new Worker(new URL('./train.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ id: number; metrics: Metrics }>) => {
        this.pending.get(e.data.id)?.(e.data.metrics);
        this.pending.delete(e.data.id);
        this.idle.push(w);
        this.pump();
      };
      this.workers.push(w);
      this.idle.push(w);
    }
  }
  run(genome: number[], cfg: EpisodeCfg): Promise<Metrics> {
    return new Promise((res) => {
      this.queue.push({ genome, cfg, res });
      this.pump();
    });
  }
  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      const id = this.nextId++;
      this.pending.set(id, job.res);
      w.postMessage({ id, genome: job.genome, cfg: job.cfg });
    }
  }
  dispose(): void {
    for (const w of this.workers) w.terminate();
  }
}

/** extra fresh games a challenger must win before it replaces the champion */
const VALIDATION = 4;

export interface GenResult {
  stat: GenStat;
  modelMetrics: Metrics;
  bestGenome: number[];
  seconds: number;
}

/**
 * One generation: λ candidates + the search point (CMA mean) + the champion (the saved model) +
 * the untrained baseline all play the SAME games (common random numbers → a fair, low-noise
 * comparison); new games every generation, so nothing is memorised.
 * The champion is replaced only when the search point beats it twice in a row.
 */
export async function generation(pool: { run(genome: number[], cfg: EpisodeCfg): Promise<Metrics> }, es: CMAES, model: BotModel): Promise<GenResult> {
  const t0 = performance.now();
  const cfg = model.cfg;
  const waves = STAGES[cfg.stage].waves;
  const games: EpisodeCfg[] = [];
  for (let s = 0; s < cfg.seeds; s++) {
    const seed = (es.gen + 1) * 7919 + s * 104729 + 17;
    games.push({ seed, difficulty: cfg.difficulty, startWave: waves[(es.gen * cfg.seeds + s) % waves.length]!, seconds: cfg.seconds });
  }
  const pop = es.ask();
  const search = [...es.mean];
  const champ = [...model.genome];
  const cands = [...pop, search, champ, Array(es.n).fill(0)];
  const results = await Promise.all(cands.map((g) => Promise.all(games.map((c) => pool.run(g, c)))));
  const metrics = results.map((r) => meanMetrics(r));
  const fit = metrics.map((m) => fitness(m, model.rewards));
  const L = pop.length;
  const popFit = fit.slice(0, L);
  es.tell(pop, popFit);
  const sorted = [...popFit].sort((a, b) => a - b);
  let bi = 0;
  for (let k = 1; k < L; k++) if (popFit[k]! > popFit[bi]!) bi = k;
  // champion bookkeeping
  const fSearch = fit[L]!;
  const fChamp = fit[L + 1]!;
  model.streak = fSearch > fChamp ? (model.streak ?? 0) + 1 : 0;
  let promoted = false;
  let modelFit = fChamp;
  let modelMetrics = metrics[L + 1]!;
  if (model.streak >= 2) {
    // validation match on fresh games before the champion is replaced (guards against luck)
    const val: EpisodeCfg[] = [];
    for (let s = 0; s < VALIDATION; s++) {
      const seed = 500009 + es.gen * 131 + s * 7907;
      val.push({ seed, difficulty: cfg.difficulty, startWave: waves[(es.gen + s * 3) % waves.length]!, seconds: cfg.seconds });
    }
    const [vs, vc] = await Promise.all([search, champ].map((g) => Promise.all(val.map((c) => pool.run(g, c)))));
    const fs = fitness(meanMetrics(vs!), model.rewards);
    const fc = fitness(meanMetrics(vc!), model.rewards);
    model.streak = 0;
    if (fs > fc) {
      model.genome = search;
      promoted = true;
      modelFit = fSearch;
      modelMetrics = metrics[L]!;
    }
  }
  return {
    stat: { gen: es.gen, best: popFit[bi]!, median: sorted[Math.floor(sorted.length / 2)]!, model: modelFit, search: fSearch, base: fit[L + 2]!, promoted },
    modelMetrics,
    bestGenome: pop[bi]!,
    seconds: (performance.now() - t0) / 1000,
  };
}
