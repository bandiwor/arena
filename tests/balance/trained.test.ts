import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { CMAES } from '../../src/train/cmaes';
import { runEpisode, type EpisodeCfg } from '../../src/train/episode';
import { DEFAULT_REWARDS, type Rewards } from '../../src/train/fitness';
import { newModel, type Stage } from '../../src/train/models';
import { generation } from '../../src/train/trainer';
import { decodeGenome, GENOME, tactician } from '../../src/sim/bot/tactician';
import { Scenario } from '../../src/sim/scenario';
import { DIFFICULTIES } from '../../src/sim/content/difficulty';
import { WavePhase } from '../../src/sim/world';

/**
 * Trained bots vs. the hand-tuned Tactician (not part of the normal suite):
 *   TRAINED=1 TRAINED_PROFILE=default|survival|speed [TRAINED_GENS=30] [TRAINED_DIFF=2,3,4]
 *     [TRAINED_SEEDS=12] [TRAINED_OUT=file] [TRAINED_GENOME=file.json] npx vitest run tests/balance/trained
 * Trains a model headless exactly like train.html (CMA-ES, champion + validation), then plays full
 * campaigns on held-out seeds that training never saw. Profile "tactician" skips training (genome 0).
 */
const PROFILES: Record<string, Rewards> = {
  default: { ...DEFAULT_REWARDS },
  survival: { ...DEFAULT_REWARDS, progress: 1, survival: 2, speed: 0.2, damage: 0.1 },
  speed: { ...DEFAULT_REWARDS, progress: 1.5, survival: 0.5, speed: 1.5 },
};

it.skipIf(!process.env['TRAINED'])('trained bot vs tactician', async () => {
  const profile = process.env['TRAINED_PROFILE'] ?? 'default';
  const gens = Number(process.env['TRAINED_GENS'] ?? 30);
  const trainDiff = Number(process.env['TRAINED_TRAIN_DIFF'] ?? 4);
  const stage = (process.env['TRAINED_STAGE'] ?? 'mixed') as Stage;
  const file = process.env['TRAINED_GENOME'];
  let genome: number[] = Array(GENOME.length).fill(0);
  if (profile !== 'tactician') {
    if (file && existsSync(file)) genome = JSON.parse(readFileSync(file, 'utf8')) as number[];
    else {
      const pool = { run: async (g: number[], c: EpisodeCfg) => runEpisode(g, c) };
      const m = newModel(profile);
      m.rewards = PROFILES[profile]!;
      m.cfg = { difficulty: trainDiff, stage, seconds: 60, seeds: 3, lambda: 12, sigma: 0.6 };
      const es = new CMAES(genome, m.cfg.sigma, { lambda: m.cfg.lambda, seed: 42 });
      let promos = 0;
      for (let g = 0; g < gens; g++) if ((await generation(pool, es, m)).stat.promoted) promos++;
      genome = m.genome;
      console.log(`${profile}: ${gens} gens, ${promos} promotions`);
      if (file) writeFileSync(file, JSON.stringify(genome));
    }
  }
  const diffs = (process.env['TRAINED_DIFF'] ?? '2,3,4').split(',').map(Number);
  const n = Number(process.env['TRAINED_SEEDS'] ?? 12);
  const weights = decodeGenome(genome);
  for (const di of diffs) {
    let wins = 0, waves = 0, dmg = 0, mins = 0;
    const deaths: number[] = [];
    for (let k = 0; k < n; k++) {
      const s = new Scenario(50000 + k * 41, di, 'campaign');
      s.input(tactician({ weights, reaction: 6 }));
      s.autoPick = 0;
      const w = s.world;
      for (let t = 0; t < 60 * 60 * 30; t += 600) {
        s.run(600);
        if (w.wave.phase === WavePhase.Dead || w.wave.phase === WavePhase.Victory) break;
      }
      if (w.wave.phase === WavePhase.Victory) wins++;
      else deaths.push(w.wave.index + 1);
      waves += w.wave.index + 1;
      dmg += w.stats.dmgTaken;
      mins += w.tick / 3600;
    }
    const line = `${profile}|${DIFFICULTIES[di]!.name}|${wins}|${n}|${(waves / n).toFixed(1)}|${(dmg / mins).toFixed(0)}|${deaths.join(',')}`;
    console.log(line);
    if (process.env['TRAINED_OUT']) appendFileSync(process.env['TRAINED_OUT'], line + '\n');
  }
}, 7_200_000);
