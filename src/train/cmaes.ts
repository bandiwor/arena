/**
 * CMA-ES (Hansen's covariance matrix adaptation evolution strategy), maximising. Compact, dependency
 * free, deterministic (seeded). Good for 10–60 dimensions with noisy fitness: it learns the scale and
 * correlations of the useful steps, so a bot improves in a few dozen generations.
 *
 *   const es = new CMAES(x0, sigma0, { lambda, seed });
 *   const pop = es.ask();            // λ candidate vectors
 *   es.tell(pop, fitnesses);         // higher is better
 */
export interface CMAState {
  n: number;
  lambda: number;
  mean: number[];
  sigma: number;
  C: number[][];
  pc: number[];
  ps: number[];
  gen: number;
  seed: number;
}

export class CMAES {
  readonly n: number;
  readonly lambda: number;
  readonly mu: number;
  private readonly weights: number[];
  private readonly mueff: number;
  private readonly cc: number;
  private readonly cs: number;
  private readonly c1: number;
  private readonly cmu: number;
  private readonly damps: number;
  private readonly chiN: number;
  mean: number[];
  sigma: number;
  C: number[][];
  private B: number[][];
  private D: number[];
  pc: number[];
  ps: number[];
  gen = 0;
  private rngState: number;
  private spare: number | null = null;

  constructor(x0: readonly number[], sigma0: number, o: { lambda?: number; seed?: number } = {}) {
    const n = x0.length;
    this.n = n;
    this.lambda = o.lambda ?? 4 + Math.floor(3 * Math.log(n));
    this.mu = Math.floor(this.lambda / 2);
    const w = Array.from({ length: this.mu }, (_, i) => Math.log(this.mu + 0.5) - Math.log(i + 1));
    const sw = w.reduce((a, b) => a + b, 0);
    this.weights = w.map((v) => v / sw);
    this.mueff = 1 / this.weights.reduce((a, b) => a + b * b, 0);
    const me = this.mueff;
    this.cc = (4 + me / n) / (n + 4 + (2 * me) / n);
    this.cs = (me + 2) / (n + me + 5);
    this.c1 = 2 / ((n + 1.3) ** 2 + me);
    this.cmu = Math.min(1 - this.c1, (2 * (me - 2 + 1 / me)) / ((n + 2) ** 2 + me));
    this.damps = 1 + 2 * Math.max(0, Math.sqrt((me - 1) / (n + 1)) - 1) + this.cs;
    this.chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
    this.mean = [...x0];
    this.sigma = sigma0;
    this.C = eye(n);
    this.B = eye(n);
    this.D = Array(n).fill(1);
    this.pc = Array(n).fill(0);
    this.ps = Array(n).fill(0);
    this.rngState = (o.seed ?? 12345) >>> 0 || 1;
  }

  /** restore from a saved state (training resumes where it stopped) */
  static from(s: CMAState): CMAES {
    const es = new CMAES(s.mean, s.sigma, { lambda: s.lambda, seed: s.seed });
    es.C = s.C.map((r) => [...r]);
    es.pc = [...s.pc];
    es.ps = [...s.ps];
    es.gen = s.gen;
    es.decompose();
    return es;
  }

  state(): CMAState {
    return { n: this.n, lambda: this.lambda, mean: [...this.mean], sigma: this.sigma, C: this.C.map((r) => [...r]), pc: [...this.pc], ps: [...this.ps], gen: this.gen, seed: this.rngState };
  }

  private rand(): number {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return (this.rngState + 0.5) / 4294967296;
  }
  private gauss(): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return s;
    }
    const u = this.rand();
    const v = this.rand();
    const r = Math.sqrt(-2 * Math.log(u));
    this.spare = r * Math.sin(2 * Math.PI * v);
    return r * Math.cos(2 * Math.PI * v);
  }

  ask(): number[][] {
    const n = this.n;
    const pop: number[][] = [];
    for (let k = 0; k < this.lambda; k++) {
      const z = Array.from({ length: n }, () => this.gauss());
      const y = Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let j = 0; j < n; j++) s += this.B[i]![j]! * this.D[j]! * z[j]!;
        y[i] = s;
      }
      pop.push(this.mean.map((m, i) => m + this.sigma * y[i]!));
    }
    return pop;
  }

  tell(pop: readonly number[][], fitness: readonly number[]): void {
    const n = this.n;
    const idx = fitness.map((f, i) => [f, i] as const).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    const old = [...this.mean];
    this.mean = Array(n).fill(0);
    for (let k = 0; k < this.mu; k++) {
      const x = pop[idx[k]!]!;
      for (let i = 0; i < n; i++) this.mean[i] = this.mean[i]! + this.weights[k]! * x[i]!;
    }
    const y = this.mean.map((m, i) => (m - old[i]!) / this.sigma);
    // C^{-1/2} y = B D^{-1} Bᵀ y
    const bty = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += this.B[j]![i]! * y[j]!;
      bty[i] = s / this.D[i]!;
    }
    const invSqrtY = Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += this.B[i]![j]! * bty[j]!;
      invSqrtY[i] = s;
    }
    const csn = Math.sqrt(this.cs * (2 - this.cs) * this.mueff);
    for (let i = 0; i < n; i++) this.ps[i] = (1 - this.cs) * this.ps[i]! + csn * invSqrtY[i]!;
    const psNorm = Math.sqrt(this.ps.reduce((a, b) => a + b * b, 0));
    const hsig = psNorm / Math.sqrt(1 - (1 - this.cs) ** (2 * (this.gen + 1))) / this.chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    const ccn = Math.sqrt(this.cc * (2 - this.cc) * this.mueff);
    for (let i = 0; i < n; i++) this.pc[i] = (1 - this.cc) * this.pc[i]! + hsig * ccn * y[i]!;
    // covariance update: rank-one + rank-μ
    const dh = (1 - hsig) * this.cc * (2 - this.cc);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let rmu = 0;
        for (let k = 0; k < this.mu; k++) {
          const x = pop[idx[k]!]!;
          rmu += this.weights[k]! * ((x[i]! - old[i]!) / this.sigma) * ((x[j]! - old[j]!) / this.sigma);
        }
        const v = (1 - this.c1 - this.cmu) * this.C[i]![j]! + this.c1 * (this.pc[i]! * this.pc[j]! + dh * this.C[i]![j]!) + this.cmu * rmu;
        this.C[i]![j] = v;
        this.C[j]![i] = v;
      }
    }
    this.sigma *= Math.exp((this.cs / this.damps) * (psNorm / this.chiN - 1));
    this.sigma = Math.min(Math.max(this.sigma, 1e-4), 5);
    this.gen++;
    this.decompose();
  }

  private decompose(): void {
    const { vectors, values } = jacobiEigen(this.C);
    this.B = vectors;
    this.D = values.map((v) => Math.sqrt(Math.max(v, 1e-20)));
  }
}

function eye(n: number): number[][] {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
}

/** symmetric eigen-decomposition (cyclic Jacobi) — n ≤ ~60 is instant */
export function jacobiEigen(Ain: number[][]): { values: number[]; vectors: number[][] } {
  const n = Ain.length;
  const A = Ain.map((r) => [...r]);
  const V = eye(n);
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i]![j]! * A[i]![j]!;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p]![q]!;
        if (Math.abs(apq) < 1e-30) continue;
        const theta = (A[q]![q]! - A[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k]![p]!;
          const akq = A[k]![q]!;
          A[k]![p] = c * akp - s * akq;
          A[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p]![k]!;
          const aqk = A[q]![k]!;
          A[p]![k] = c * apk - s * aqk;
          A[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k]![p]!;
          const vkq = V[k]![q]!;
          V[k]![p] = c * vkp - s * vkq;
          V[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: A.map((r, i) => r[i]!), vectors: V };
}
