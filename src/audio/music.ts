import { Rng } from '../core/rng';
import { Buf, osc, noise, pluck } from './synth';

export const BPM = 124;
const BEAT = 60 / BPM;
const BARS = 8;
export const LOOP_SEC = BEAT * 4 * BARS;

// A minor: Am – F – Dm – E (2 bars each)
const ROOTS = [57, 53, 50, 52];
const CHORDS = [
  [57, 60, 64],
  [53, 57, 60],
  [50, 53, 57],
  [52, 56, 59],
];
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

function kick(sr: number, r: Rng): Buf {
  const b = osc(sr, 0.35, { wave: 'sine', f0: 150, f1: 40 }, r).env(0.001, 2.2);
  b.mix(noise(sr, 0.01, r).highpass(3000), 0, 0.3);
  return b.drive(1.5);
}
function snare(sr: number, r: Rng): Buf {
  const b = noise(sr, 0.22, r).bandpass(1800, 1200, 0.4).env(0.001, 2.5);
  b.mix(osc(sr, 0.12, { wave: 'tri', f0: 220, f1: 160 }, r).env(0.001, 2), 0, 0.6);
  return b;
}
function hat(sr: number, r: Rng, open: boolean): Buf {
  return noise(sr, open ? 0.18 : 0.05, r).highpass(7000).env(0.001, open ? 1.5 : 3);
}

/** layer 0 = ambient, 1 = combat drums+bass, 2 = boss/high intensity */
export function renderMusicLayer(layer: number, sr: number, seed: number): Buf {
  const r = new Rng(seed + layer * 101);
  const out = new Buf(sr, LOOP_SEC);
  const bar = BEAT * 4;
  if (layer === 0) {
    for (let c = 0; c < 4; c++) {
      const t0 = c * bar * 2;
      for (const m of CHORDS[c]!) {
        const pad = osc(sr, bar * 2, { wave: 'saw', f0: mtof(m - 12), detune: 18 }, r).lowpass(300, 1400, 0.3).env(0.6, 0.6, bar);
        out.mix(pad, t0, 0.12);
      }
      out.mix(osc(sr, bar * 2, { wave: 'sine', f0: mtof(ROOTS[c]! - 24) }, r).env(0.3, 0.5, bar), t0, 0.35);
      // sparse plucked arp
      for (let s = 0; s < 16; s++) {
        if (r.float() < 0.45) continue;
        const note = CHORDS[c]![s % 3]! + (s % 4 === 3 ? 12 : 0);
        out.mix(pluck(sr, 0.6, mtof(note + 12), 0.996, r, 0.4).env(0.001, 2).lowpass(2500), t0 + s * BEAT * 0.5, 0.12);
      }
    }
    return out.echo(BEAT * 0.75, 0.45, 0.6);
  }
  if (layer === 1) {
    const k = kick(sr, r);
    const sn = snare(sr, r);
    const hc = hat(sr, r, false);
    const ho = hat(sr, r, true);
    for (let b = 0; b < BARS * 4; b++) {
      const t = b * BEAT;
      out.mix(k, t, 0.9);
      if (b % 2 === 1) out.mix(sn, t, 0.45);
      out.mix(hc, t + BEAT * 0.5, 0.18);
      if (b % 4 === 3) out.mix(ho, t + BEAT * 0.75, 0.12);
    }
    // driving 16th bass with octave jumps, ducked on kicks
    for (let s = 0; s < BARS * 16; s++) {
      const c = Math.floor(s / 32) % 4;
      const root = ROOTS[c]! - 24;
      const note = root + (s % 8 === 6 ? 12 : s % 16 === 14 ? 7 : 0);
      const duck = s % 4 === 0 ? 0.4 : 1;
      const nb = osc(sr, BEAT * 0.25, { wave: 'saw', f0: mtof(note), detune: 8 }, r).lowpass(1600, 250, 0.5).env(0.003, 1.5);
      out.mix(nb, s * BEAT * 0.25, 0.22 * duck);
    }
    return out.drive(0.6);
  }
  // layer 2: boss — reese bass + aggressive lead arps + extra percussion
  for (let c = 0; c < 4; c++) {
    const t0 = c * bar * 2;
    out.mix(osc(sr, bar * 2, { wave: 'saw', f0: mtof(ROOTS[c]! - 24), detune: 35 }, r).lowpass(500, 900, 0.6).env(0.02, 0.4, bar).drive(3), t0, 0.22);
    for (let s = 0; s < 32; s++) {
      const ch = CHORDS[c]!;
      const note = ch[(s * 2 + (s >> 2)) % 3]! + 12 + (s % 8 >= 6 ? 12 : 0);
      out.mix(osc(sr, BEAT * 0.22, { wave: 'square', f0: mtof(note), pw: 0.25 }, r).lowpass(4000, 900).env(0.002, 2), t0 + s * BEAT * 0.25, 0.08);
    }
  }
  for (let b = 0; b < BARS * 8; b++) {
    if (r.float() < 0.5) out.mix(noise(sr, 0.04, r).bandpass(5000).env(0.001, 3), b * BEAT * 0.5 + BEAT * 0.25, 0.15);
  }
  return out.echo(BEAT * 0.5, 0.3, 0.4);
}
