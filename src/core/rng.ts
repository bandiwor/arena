/**
 * Deterministic PRNG (sfc32) seeded via splitmix32.
 * Only integer ops via Math.imul / |0 / >>> — bit-identical across JS engines.
 * Separate streams are used for sim / fx / audio so cosmetics never desync gameplay.
 */
export class Rng {
  private a = 0;
  private b = 0;
  private c = 0;
  private d = 0;

  constructor(seed: number) {
    this.reseed(seed);
  }

  reseed(seed: number): void {
    let s = seed >>> 0;
    const sm = (): number => {
      s = (s + 0x9e3779b9) | 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.a = sm();
    this.b = sm();
    this.c = sm();
    this.d = sm() | 1;
    for (let i = 0; i < 12; i++) this.u32();
  }

  u32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** [0, 1) */
  float(): number {
    return this.u32() / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }
  /** integer in [0, n) */
  int(n: number): number {
    return Math.floor(this.float() * n);
  }
  chance(p: number): boolean {
    return this.float() < p;
  }
  sign(): number {
    return this.u32() & 1 ? 1 : -1;
  }
  /** symmetric [-1, 1) */
  sym(): number {
    return this.float() * 2 - 1;
  }
  pick<T>(arr: readonly T[]): T {
    const v = arr[this.int(arr.length)];
    if (v === undefined) throw new Error('Rng.pick on empty array');
    return v;
  }

  getState(out: Uint32Array): Uint32Array {
    out[0] = this.a >>> 0;
    out[1] = this.b >>> 0;
    out[2] = this.c >>> 0;
    out[3] = this.d >>> 0;
    return out;
  }
  setState(s: Uint32Array): void {
    this.a = s[0]! | 0;
    this.b = s[1]! | 0;
    this.c = s[2]! | 0;
    this.d = s[3]! | 0;
  }
}

/** Stateless integer hash → [0,1). Handy for per-entity cosmetic variation. */
export function hash01(n: number): number {
  let z = (n | 0) + 0x6d2b79f5;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
}
