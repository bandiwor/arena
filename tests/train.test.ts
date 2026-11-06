import { describe, expect, it } from 'vitest';
import { CMAES, jacobiEigen } from '../src/train/cmaes';
import { runEpisode } from '../src/train/episode';
import { DEFAULT_REWARDS, fitness } from '../src/train/fitness';
import { decodeGenome, defaultWeights, GENOME } from '../src/sim/bot/tactician';

describe('training · CMA-ES', () => {
  it('eigen-decomposition reconstructs a symmetric matrix', () => {
    const A = [[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]];
    const { values, vectors: V } = jacobiEigen(A);
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++) {
        let s = 0;
        for (let k = 0; k < 3; k++) s += V[i]![k]! * values[k]! * V[j]![k]!;
        expect(s).toBeCloseTo(A[i]![j]!, 6);
      }
  });
  it('solves a shifted, badly scaled quadratic in a few hundred evaluations', () => {
    const n = 10;
    const target = Array.from({ length: n }, (_, i) => (i % 3) - 1);
    const f = (x: number[]): number => -x.reduce((a, v, i) => a + (i + 1) ** 2 * (v - target[i]!) ** 2, 0);
    const es = new CMAES(Array(n).fill(0), 0.5, { seed: 7 });
    for (let g = 0; g < 120; g++) {
      const pop = es.ask();
      es.tell(pop, pop.map(f));
    }
    expect(-f(es.mean)).toBeLessThan(1e-3);
  });
  it('can be saved and resumed', () => {
    const es = new CMAES([1, 2, 3], 0.3, { seed: 3 });
    es.tell(es.ask(), [1, 2, 3, 4, 5, 6, 7]);
    const back = CMAES.from(JSON.parse(JSON.stringify(es.state())));
    expect(back.mean).toEqual(es.mean);
    expect(back.gen).toBe(1);
  });
});

describe('training · genome and episodes', () => {
  it('the zero genome is exactly the hand-tuned bot', () => {
    const w = decodeGenome(Array(GENOME.length).fill(0));
    expect(w).toEqual(defaultWeights());
  });
  it('episodes are deterministic and produce sane metrics', () => {
    const x = Array(GENOME.length).fill(0);
    const cfg = { seed: 5, difficulty: 1, startWave: 2, seconds: 20 };
    const a = runEpisode(x, cfg);
    const b = runEpisode(x, cfg);
    expect(a).toEqual(b);
    expect(a.kills).toBeGreaterThan(0);
    expect(a.seconds).toBeGreaterThan(5);
    expect(Number.isFinite(fitness(a, DEFAULT_REWARDS))).toBe(true);
  });
});
