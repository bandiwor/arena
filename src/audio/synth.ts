import { Rng } from '../core/rng';

/**
 * Tiny offline DSP toolkit. Everything renders into Float32Arrays once at startup
 * (deterministic by seed), so playback is just buffer sources — no per-shot node graphs.
 */
export class Buf {
  readonly d: Float32Array<ArrayBuffer>;
  constructor(
    readonly sr: number,
    readonly dur: number,
  ) {
    this.d = new Float32Array(new ArrayBuffer(Math.max(1, Math.ceil(sr * dur)) * 4));
  }
  get n(): number {
    return this.d.length;
  }
  /** add other buffer at offset seconds */
  mix(o: Buf, at = 0, gain = 1): this {
    const off = Math.floor(at * this.sr);
    const n = Math.min(o.n, this.n - off);
    for (let i = 0; i < n; i++) this.d[off + i] = this.d[off + i]! + o.d[i]! * gain;
    return this;
  }
  gain(g: number): this {
    for (let i = 0; i < this.n; i++) this.d[i] = this.d[i]! * g;
    return this;
  }
  normalize(peak = 0.9): this {
    let m = 0;
    for (let i = 0; i < this.n; i++) m = Math.max(m, Math.abs(this.d[i]!));
    if (m > 0) this.gain(peak / m);
    return this;
  }
  /** soft clip drive */
  drive(amount: number): this {
    const k = 1 + amount;
    const norm = Math.tanh(k);
    for (let i = 0; i < this.n; i++) this.d[i] = Math.tanh(this.d[i]! * k) / norm;
    return this;
  }
  /** sample-rate + bit-depth reduction (glitch flavour) */
  crush(bits: number, hold: number): this {
    const q = Math.pow(2, bits);
    let last = 0;
    for (let i = 0; i < this.n; i++) {
      if (i % hold === 0) last = Math.round(this.d[i]! * q) / q;
      this.d[i] = last;
    }
    return this;
  }
  /** one-pole lowpass with cutoff sweep (Hz at start → end) */
  lowpass(f0: number, f1 = f0, res = 0): this {
    // simple resonant 2-pole state variable filter
    let low = 0;
    let band = 0;
    for (let i = 0; i < this.n; i++) {
      const t = i / this.n;
      const f = f0 * Math.pow(f1 / f0, t);
      const F = 2 * Math.sin((Math.PI * Math.min(f, this.sr * 0.45)) / this.sr);
      const q = 1 - res * 0.95;
      low += F * band;
      const high = this.d[i]! - low - q * band;
      band += F * high;
      this.d[i] = low;
    }
    return this;
  }
  highpass(f0: number, f1 = f0): this {
    let low = 0;
    let band = 0;
    for (let i = 0; i < this.n; i++) {
      const t = i / this.n;
      const f = f0 * Math.pow(f1 / f0, t);
      const F = 2 * Math.sin((Math.PI * Math.min(f, this.sr * 0.45)) / this.sr);
      low += F * band;
      const high = this.d[i]! - low - band;
      band += F * high;
      this.d[i] = high;
    }
    return this;
  }
  bandpass(f0: number, f1 = f0, q = 0.5): this {
    let low = 0;
    let band = 0;
    for (let i = 0; i < this.n; i++) {
      const t = i / this.n;
      const f = f0 * Math.pow(f1 / f0, t);
      const F = 2 * Math.sin((Math.PI * Math.min(f, this.sr * 0.45)) / this.sr);
      low += F * band;
      const high = this.d[i]! - low - (1 - q) * band;
      band += F * high;
      this.d[i] = band;
    }
    return this;
  }
  /** amplitude envelope: attack, then exponential-ish decay shaped by curve */
  env(attack: number, decayCurve = 3, hold = 0): this {
    const a = Math.max(1, Math.floor(attack * this.sr));
    const h = Math.floor(hold * this.sr);
    for (let i = 0; i < this.n; i++) {
      let g: number;
      if (i < a) g = i / a;
      else if (i < a + h) g = 1;
      else g = Math.pow(1 - (i - a - h) / Math.max(1, this.n - a - h), decayCurve);
      this.d[i] = this.d[i]! * g;
    }
    return this;
  }
  reverse(): this {
    this.d.reverse();
    return this;
  }
  /** feedback delay — cheap space */
  echo(time: number, fb: number, wet: number): this {
    const dl = Math.floor(time * this.sr);
    for (let i = dl; i < this.n; i++) this.d[i] = this.d[i]! + this.d[i - dl]! * fb * wet;
    return this;
  }
  fadeOut(sec: number): this {
    const k = Math.floor(sec * this.sr);
    for (let i = 0; i < k && i < this.n; i++) {
      const j = this.n - 1 - i;
      this.d[j] = this.d[j]! * (i / k);
    }
    return this;
  }
}

export type Wave = 'sine' | 'saw' | 'square' | 'tri' | 'noise';

export interface OscOpts {
  wave: Wave;
  f0: number;
  f1?: number;
  /** curve exponent for sweep: 1 = exponential in log space */
  amp?: number;
  /** FM: modulator ratio & index */
  fmRatio?: number;
  fmIndex?: number;
  fmDecay?: number;
  vibrato?: number;
  vibRate?: number;
  detune?: number; // cents spread for unison of 3
  pw?: number;
}

export function osc(sr: number, dur: number, o: OscOpts, rng: Rng): Buf {
  const b = new Buf(sr, dur);
  const f1 = o.f1 ?? o.f0;
  const amp = o.amp ?? 1;
  const voices = o.detune ? 3 : 1;
  for (let v = 0; v < voices; v++) {
    const dt = o.detune ? Math.pow(2, ((v - 1) * o.detune) / 1200) : 1;
    let ph = rng.float();
    let mph = 0;
    for (let i = 0; i < b.n; i++) {
      const t = i / b.n;
      let f = o.f0 * Math.pow(f1 / o.f0, t) * dt;
      if (o.vibrato) f *= 1 + Math.sin((i / sr) * Math.PI * 2 * (o.vibRate ?? 6)) * o.vibrato;
      if (o.fmRatio) {
        mph += (f * o.fmRatio) / sr;
        const idx = (o.fmIndex ?? 1) * (o.fmDecay ? Math.exp(-t * o.fmDecay) : 1);
        f += Math.sin(mph * Math.PI * 2) * idx * f;
      }
      ph += f / sr;
      ph -= Math.floor(ph);
      let s: number;
      switch (o.wave) {
        case 'sine':
          s = Math.sin(ph * Math.PI * 2);
          break;
        case 'saw':
          s = ph * 2 - 1;
          break;
        case 'square':
          s = ph < (o.pw ?? 0.5) ? 1 : -1;
          break;
        case 'tri':
          s = ph < 0.5 ? ph * 4 - 1 : 3 - ph * 4;
          break;
        default:
          s = rng.sym();
      }
      b.d[i] = b.d[i]! + (s * amp) / voices;
    }
  }
  return b;
}

/** Karplus–Strong plucked string (bow twangs, metal hits) */
export function pluck(sr: number, dur: number, freq: number, damp: number, rng: Rng, bright = 0.5): Buf {
  const b = new Buf(sr, dur);
  const p = Math.max(2, Math.floor(sr / freq));
  const ring = new Float32Array(p);
  for (let i = 0; i < p; i++) ring[i] = rng.sym();
  let idx = 0;
  let last = 0;
  for (let i = 0; i < b.n; i++) {
    const cur = ring[idx]!;
    const next = ring[(idx + 1) % p]!;
    const v = (cur * (1 - bright) + next * bright) * damp;
    ring[idx] = v;
    b.d[i] = cur;
    last = v;
    idx = (idx + 1) % p;
  }
  void last;
  return b;
}

export function noise(sr: number, dur: number, rng: Rng, amp = 1): Buf {
  return osc(sr, dur, { wave: 'noise', f0: 1, amp }, rng);
}
