import { Rng } from '../core/rng';

/**
 * Procedural impulse response for the arena: a hard, metallic hall.
 * Early reflections (sparse taps, different per ear) + exponentially decaying noise tail that
 * darkens over time. Two decorrelated channels ⇒ wide, enveloping space on headphones.
 */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const r = new Rng(seed * 31 + ch * 977);
    const d = new Float32Array(n);
    // early reflections: 14 taps in the first 80 ms
    for (let k = 0; k < 14; k++) {
      const t = 0.004 + r.float() * 0.075;
      const i = Math.floor(t * sr);
      if (i < n) d[i] = (r.sym() > 0 ? 1 : -1) * (0.55 - t * 4) * (0.6 + r.float() * 0.4);
    }
    // diffuse tail: noise × exp decay, one-pole lowpass whose cutoff falls with time
    let lp = 0;
    const pre = Math.floor(0.012 * sr);
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp(-t * (6.9 / seconds)) * Math.min(1, t / 0.03);
      const cutoff = 0.55 * Math.exp(-t * 1.6) + 0.04; // normalised smoothing coeff
      lp += (r.sym() - lp) * cutoff;
      d[i] = d[i]! + lp * env * 0.45;
    }
    buf.copyToChannel(d, ch);
  }
  return buf;
}
