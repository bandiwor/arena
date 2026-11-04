import { Rng } from '../core/rng';
import { Buf, osc, noise, pluck, type Stereo } from './synth';

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

/**
 * Stems, all exactly LOOP_SEC long and started together so they stay sample-locked.
 * The director crossfades them by tension, combo and boss state.
 */
export const STEMS = ['pad', 'pulse', 'drive', 'hype', 'boss'] as const;
export type StemId = (typeof STEMS)[number];

/** equal-power pan gain for channel ch (0 = L, 1 = R), pan in [-1, 1] */
const pg = (ch: number, pan: number): number => Math.cos(((ch === 0 ? pan + 1 : 1 - pan) * Math.PI) / 4);

function kick(sr: number, r: Rng): Buf {
  const b = osc(sr, 0.4, { wave: 'sine', f0: 140, f1: 38 }, r).env(0.001, 2.2);
  b.mix(noise(sr, 0.008, r).highpass(2500), 0, 0.25);
  return b.drive(1.4);
}
function snare(sr: number, r: Rng): Buf {
  const b = noise(sr, 0.25, r).bandpass(1900, 1300, 0.4).env(0.001, 2.4);
  b.mix(osc(sr, 0.12, { wave: 'tri', f0: 210, f1: 160 }, r).env(0.001, 2), 0, 0.6);
  return b;
}
function hat(sr: number, r: Rng, open: boolean): Buf {
  return noise(sr, open ? 0.2 : 0.045, r).highpass(7500).env(0.001, open ? 1.4 : 3);
}

/**
 * pr: pattern rng (identical for both channels → same notes)
 * r: sound rng (differs per channel → decorrelated phases & noise = width)
 */
function stem(id: StemId, sr: number, ch: number, pr: Rng, r: Rng): Buf {
  // render 2 s past the loop and fold the tail onto the head (seamless echo/release wrap)
  const out = new Buf(sr, LOOP_SEC + 2);
  const bar = BEAT * 4;
  switch (id) {
    case 'pad': {
      for (let c = 0; c < 4; c++) {
        const t0 = c * bar * 2;
        CHORDS[c]!.forEach((m, k) => {
          const pad = osc(sr, bar * 2 + 0.6, { wave: 'saw', f0: mtof(m - 12) * (1 + (ch - 0.5) * 0.004), detune: 16 }, r).lowpass(260, 1100, 0.3).env(0.9, 0.7, bar);
          out.mix(pad, t0, 0.11 * pg(ch, (k - 1) * 0.6));
        });
        out.mix(osc(sr, bar * 2, { wave: 'sine', f0: mtof(ROOTS[c]! - 24) }, r).env(0.4, 0.5, bar), t0, 0.3);
        for (let s = 0; s < 16; s++) {
          if (pr.float() < 0.5) continue;
          const note = CHORDS[c]![s % 3]! + (s % 4 === 3 ? 12 : 0);
          const pan = pr.sym() * 0.8;
          out.mix(pluck(sr, 0.8, mtof(note + 12), 0.996, r, 0.35).env(0.001, 2).lowpass(2400), t0 + s * BEAT * 0.5, 0.1 * pg(ch, pan));
        }
      }
      return out.echo(BEAT * (ch ? 0.75 : 0.5), 0.45, 0.55);
    }
    case 'pulse': {
      const k = kick(sr, r);
      const hc = hat(sr, r, false);
      for (let b = 0; b < BARS * 4; b++) {
        const t = b * BEAT;
        out.mix(k, t, 0.55);
        out.mix(hc, t + BEAT * 0.5, 0.11 * pg(ch, 0.35));
        if (b % 2 === 1) out.mix(hc, t + BEAT * 0.75, 0.06 * pg(ch, -0.35));
      }
      return out;
    }
    case 'drive': {
      const sn = snare(sr, r);
      for (let b = 0; b < BARS * 4; b++) if (b % 2 === 1) out.mix(sn, b * BEAT, 0.34 * pg(ch, -0.1));
      for (let s = 0; s < BARS * 16; s++) {
        const c = Math.floor(s / 32) % 4;
        const root = ROOTS[c]! - 24;
        const note = root + (s % 8 === 6 ? 12 : s % 16 === 14 ? 7 : 0);
        const duck = s % 4 === 0 ? 0.35 : 1; // implied sidechain against the kick
        const nb = osc(sr, BEAT * 0.25, { wave: 'saw', f0: mtof(note), detune: 9 }, r).lowpass(1500, 260, 0.5).env(0.003, 1.5);
        out.mix(nb, s * BEAT * 0.25, 0.2 * duck);
      }
      return out.drive(0.5);
    }
    case 'hype': {
      // sparkling arps ping-ponged L/R + open hats + claps
      for (let c = 0; c < 4; c++) {
        const t0 = c * bar * 2;
        for (let s = 0; s < 32; s++) {
          const chd = CHORDS[c]!;
          const note = chd[(s * 2 + (s >> 2)) % 3]! + 12 + (s % 8 >= 6 ? 12 : 0);
          const pan = s % 2 ? 0.7 : -0.7;
          out.mix(osc(sr, BEAT * 0.24, { wave: 'square', f0: mtof(note), pw: 0.25 }, r).lowpass(4500, 1000).env(0.002, 2), t0 + s * BEAT * 0.25, 0.07 * pg(ch, pan));
        }
      }
      const ho = hat(sr, r, true);
      for (let b = 0; b < BARS * 4; b++) {
        out.mix(ho, b * BEAT + BEAT * 0.5, 0.08 * pg(ch, 0.5));
        if (b % 4 === 3) out.mix(noise(sr, 0.15, r).bandpass(1500, 1100, 0.5).env(0.001, 2.5), b * BEAT, 0.12 * pg(ch, pr.sym() * 0.4));
      }
      return out.echo(BEAT * 0.75, 0.35, 0.5);
    }
    case 'boss': {
      for (let c = 0; c < 4; c++) {
        const t0 = c * bar * 2;
        out.mix(osc(sr, bar * 2, { wave: 'saw', f0: mtof(ROOTS[c]! - 24) * (1 + (ch - 0.5) * 0.006), detune: 35 }, r).lowpass(420, 900, 0.6).env(0.02, 0.4, bar).drive(3), t0, 0.2);
      }
      const k = kick(sr, r);
      for (let b = 0; b < BARS * 8; b++) {
        if (b % 8 === 3 || b % 8 === 6) out.mix(k, b * BEAT * 0.5, 0.35);
        if (pr.float() < 0.55) out.mix(noise(sr, 0.04, r).bandpass(5000).env(0.001, 3), b * BEAT * 0.5 + BEAT * 0.25, 0.12 * pg(ch, pr.sym()));
      }
      return out.echo(BEAT * 0.5, 0.3, 0.4);
    }
  }
}

export function renderStem(id: StemId, sr: number, seed: number): Stereo {
  const idx = STEMS.indexOf(id);
  const mk = (ch: number): Buf => wrapTail(stem(id, sr, ch, new Rng(seed + idx * 101), new Rng(seed + idx * 101 + (ch + 1) * 7777)), LOOP_SEC);
  return { l: mk(0), r: mk(1) };
}

function wrapTail(b: Buf, len: number): Buf {
  const out = new Buf(b.sr, len);
  const n = out.n;
  for (let i = 0; i < n; i++) out.d[i] = b.d[i]!;
  for (let i = n; i < b.n; i++) out.d[i - n] = out.d[i - n]! + b.d[i]!;
  return out;
}
