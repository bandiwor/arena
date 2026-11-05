import { Rng } from '../core/rng';
import { Buf, lfoAmp, loopify, noise, osc, pluck, type Stereo } from './synth';

/**
 * Ambience beds: long seamless stereo loops crossfaded by the audio director.
 * Rendered at a reduced sample rate (beds are dark / low-frequency) to keep startup cheap.
 */
export const BED_SR = 24000;
export const BED_LEN = 12;
const FADE = 1.5;

export const BEDS = ['room', 'tension', 'corrupt', 'cryo', 'gravity', 'drift', 'overclock', 'ricochet', 'stasis', 'calm', 'flesh', 'foundry'] as const;
export type BedId = (typeof BEDS)[number];

type Gen = (sr: number, dur: number, r: Rng, ch: number) => Buf;

const gens: Record<BedId, Gen> = {
  // arena room tone: mains hum with slow beating, ventilation air, distant metal creaks
  room(sr, dur, r, ch) {
    const b = new Buf(sr, dur);
    b.mix(osc(sr, dur, { wave: 'sine', f0: 50 + ch * 0.13 }, r), 0, 0.22);
    b.mix(osc(sr, dur, { wave: 'sine', f0: 100.2 - ch * 0.21 }, r), 0, 0.09);
    b.mix(osc(sr, dur, { wave: 'saw', f0: 150 }, r).lowpass(400), 0, 0.03);
    b.mix(lfoAmp(noise(sr, dur, r).bandpass(380, 520, 0.4), 0.07, 0.6, ch * 1.3), 0, 0.22);
    b.mix(lfoAmp(noise(sr, dur, r).lowpass(140), 0.05, 0.4, ch), 0, 0.35);
    for (let k = 0; k < 3; k++) {
      const t = r.range(0.5, dur - 3);
      b.mix(pluck(sr, 2.5, r.range(70, 140), 0.9993, r, 0.15).lowpass(900).env(0.05, 1.2), t, 0.08);
    }
    return b;
  },
  // dissonant cluster that swells — the director fades it in with tension
  tension(sr, dur, r, ch) {
    const b = new Buf(sr, dur);
    for (const f of [55, 58.27, 82.4, 87.3]) {
      b.mix(lfoAmp(osc(sr, dur, { wave: 'saw', f0: f * (1 + ch * 0.003), detune: 14 }, r).lowpass(320), 1 / 6, 0.5, f * 0.1 + ch), 0, 0.12);
    }
    // pulsing sub, like a giant engine under the floor (2 Hz = BPM 120 feel)
    b.mix(lfoAmp(osc(sr, dur, { wave: 'sine', f0: 36 }, r), 2, 0.85), 0, 0.3);
    b.mix(lfoAmp(noise(sr, dur, r).bandpass(1800, 1800, 0.85), 0.25, 0.9, ch * 2), 0, 0.04);
    return b;
  },
  // boss corruption: sub growl, digital crackle, buffer-stutter blips
  corrupt(sr, dur, r, ch) {
    const b = new Buf(sr, dur);
    b.mix(lfoAmp(osc(sr, dur, { wave: 'saw', f0: 41, vibrato: 0.04, vibRate: 0.3, detune: 30 }, r).lowpass(180, 260, 0.6), 0.13, 0.5, ch), 0, 0.3);
    for (let k = 0; k < 70; k++) {
      const t = r.range(0, dur);
      b.mix(noise(sr, r.range(0.005, 0.03), r).highpass(1500).crush(3, 6).env(0.001, 1), t, r.range(0.05, 0.15));
    }
    for (let k = 0; k < 10; k++) {
      const t = r.range(0, dur - 0.3);
      b.mix(osc(sr, 0.12, { wave: 'square', f0: r.range(200, 1200), pw: 0.2 }, r).crush(4, 8).env(0.001, 1).lowpass(3000), t, 0.05);
    }
    return b;
  },
  // ice: glassy partials appearing/disappearing + whistling wind
  cryo(sr, dur, r, ch) {
    const b = new Buf(sr, dur);
    for (let k = 0; k < 14; k++) {
      const t = r.range(0, dur - 2.5);
      const f = [1975, 2349, 2637, 3136, 3520][r.int(5)]! * (1 + ch * 0.002);
      b.mix(osc(sr, 2.5, { wave: 'sine', f0: f }, r).env(0.6, 1.6), t, 0.04);
    }
    b.mix(lfoAmp(noise(sr, dur, r).bandpass(900, 2200, 0.85), 0.11, 0.7, ch * 1.7), 0, 0.12);
    return b;
  },
  // gravity wells: slow sub wobble + reversed swells
  gravity(sr, dur, r, ch) {
    const b = new Buf(sr, dur);
    b.mix(osc(sr, dur, { wave: 'sine', f0: 32, vibrato: 0.12, vibRate: 0.5 + ch * 0.05 }, r), 0, 0.45);
    b.mix(lfoAmp(osc(sr, dur, { wave: 'saw', f0: 64, detune: 20 }, r).lowpass(200), 0.5, 0.8, ch), 0, 0.12);
    for (let k = 0; k < 4; k++) b.mix(noise(sr, 1.6, r).lowpass(300, 2000).env(1.5, 0.3).reverse(), k * 3 + r.range(0, 0.5), 0.12);
    return b;
  },
  // drift: howling wind with moving resonance
  drift(sr, dur, r, ch) {
    const b = new Buf(sr, dur);
    b.mix(lfoAmp(noise(sr, dur, r).bandpass(250 + ch * 40, 1300, 0.9), 0.08, 0.6, ch * 2.3), 0, 0.26);
    b.mix(lfoAmp(noise(sr, dur, r).bandpass(1400, 500, 0.92), 0.13, 0.8, ch * 0.7), 0, 0.14);
    b.mix(noise(sr, dur, r).lowpass(120), 0, 0.25);
    return b;
  },
  // overclock: fast mechanical ticking + electric whine
  overclock(sr, dur, r, ch) {
    const b = new Buf(sr, dur);
    const tick = noise(sr, 0.01, r).highpass(3000).env(0.0005, 3);
    for (let t = 0; t < dur; t += 1 / 16) b.mix(tick, t + (ch ? 0.008 : 0), (Math.floor(t * 16) % 4 === 0 ? 0.25 : 0.12));
    b.mix(lfoAmp(osc(sr, dur, { wave: 'saw', f0: 1760 + ch * 3, vibrato: 0.004, vibRate: 7 }, r).lowpass(3000), 0.5, 0.6), 0, 0.02);
    b.mix(osc(sr, dur, { wave: 'square', f0: 110, pw: 0.1 }, r).lowpass(600), 0, 0.04);
    return b;
  },
  // ricochet mirrors: metallic ringing shimmer
  ricochet(sr, dur, r, ch) {
    const b = new Buf(sr, dur);
    for (let k = 0; k < 18; k++) {
      const t = r.range(0, dur - 2);
      const f = r.range(600, 2400);
      const ring = osc(sr, 2, { wave: 'sine', f0: f, fmRatio: 1.41, fmIndex: 0.4, fmDecay: 3 }, r).env(0.002, 3);
      b.mix(ring, t + ch * 0.013, 0.05);
    }
    b.mix(lfoAmp(noise(sr, dur, r).bandpass(4000, 4000, 0.9), 0.3, 0.8, ch), 0, 0.03);
    return b;
  },
  // stasis: time feels thick — slow tremolo hum and backwards swells
  stasis(sr, dur, r, ch) {
    const b = new Buf(sr, dur);
    b.mix(lfoAmp(osc(sr, dur, { wave: 'tri', f0: 73.4 * (1 + ch * 0.004), detune: 10 }, r).lowpass(500), 0.75, 0.9, ch), 0, 0.2);
    for (let k = 0; k < 5; k++) b.mix(osc(sr, 2.2, { wave: 'saw', f0: 220 * (k % 2 ? 1.5 : 1), detune: 25 }, r).lowpass(1500).env(2, 0.2).reverse(), k * 2.4, 0.05);
    return b;
  },
  // flesh sector: slow breathing, a giant distant heartbeat, wet shifting, viscous drips
  flesh(sr, dur, r, ch) {
    const b = new Buf(sr, dur);
    // breathing: filtered noise swelling at ~0.25 Hz
    b.mix(lfoAmp(noise(sr, dur, r).bandpass(250, 600, 0.7), 0.25, 0.9, ch * 0.5), 0, 0.3);
    // heartbeat every 1.5 s (double thump)
    for (let t = 0; t < dur; t += 1.5) {
      const th = osc(sr, 0.25, { wave: 'sine', f0: 55, f1: 32 }, r).env(0.006, 2.4);
      b.mix(th, t, 0.6);
      b.mix(th, t + 0.28, 0.4);
    }
    // wet movement + drips (panned differently per ear)
    for (let k = 0; k < 20; k++) b.mix(osc(sr, 0.08, { wave: 'sine', f0: r.range(500, 1100), f1: r.range(150, 300) }, r).env(0.002, 2), r.range(0, dur), 0.08);
    b.mix(lfoAmp(noise(sr, dur, r).lowpass(90), 0.1, 0.5, ch), 0, 0.35);
    return b;
  },
  // foundry: 55 Hz mains hum, distant pistons on a 0.5 s grid, chain rattle, steam bursts
  foundry(sr, dur, r, ch) {
    const b = new Buf(sr, dur);
    b.mix(osc(sr, dur, { wave: 'saw', f0: 55 + ch * 0.11, detune: 8 }, r).lowpass(260), 0, 0.16);
    b.mix(osc(sr, dur, { wave: 'sine', f0: 110.3 - ch * 0.17 }, r), 0, 0.07);
    // piston percussion: heavy on the bar, lighter offbeats, alternating ears
    for (let t = 0; t < dur; t += 0.5) {
      const beat = Math.round(t * 2) % 8;
      if (beat === 0 || beat === 3 || beat === 6) {
        const th = osc(sr, 0.35, { wave: 'sine', f0: 70, f1: 34 }, r).env(0.003, 2.2).lowpass(400);
        b.mix(th, t + (ch ? 0.012 : 0), beat === 0 ? 0.42 : 0.24);
        b.mix(noise(sr, 0.12, r).bandpass(900, 700, 0.6).env(0.002, 2.5), t + 0.01, beat === 0 ? 0.12 : 0.07);
      }
      if (beat === 4 && (ch === 0) === (Math.floor(t / 4) % 2 === 0)) b.mix(noise(sr, 0.7, r).highpass(3000).env(0.02, 1.4), t + 0.1, 0.05); // steam
    }
    // conveyor chain rattle (amplitude-modulated grit)
    b.mix(lfoAmp(noise(sr, dur, r).bandpass(1400, 900, 0.7), 9 + ch * 0.4, 0.8), 0, 0.035);
    // distant metal resonances
    for (let k = 0; k < 4; k++) {
      const t = r.range(0.3, dur - 3);
      b.mix(osc(sr, 3, { wave: 'sine', f0: r.range(180, 420), fmRatio: 1.41, fmIndex: 0.6, fmDecay: 1.5 }, r).env(0.003, 1.2), t, 0.05);
    }
    return b;
  },
  // calm: between waves / menus — airy, low pad wash
  calm(sr, dur, r, ch) {
    const b = new Buf(sr, dur);
    for (const f of [110, 164.8, 220, 261.6]) b.mix(lfoAmp(osc(sr, dur, { wave: 'tri', f0: f * (1 + ch * 0.003), detune: 8 }, r).lowpass(900), 1 / 12, 0.6, f), 0, 0.05);
    b.mix(lfoAmp(noise(sr, dur, r).bandpass(2000, 2000, 0.6), 1 / 6, 0.8, ch * 3), 0, 0.03);
    return b;
  },
};

export function renderBed(id: BedId, seed: number): Stereo {
  const g = gens[id];
  const mk = (ch: number): Buf => {
    const r = new Rng(seed * 131 + BEDS.indexOf(id) * 17 + ch * 7919);
    const b = g(BED_SR, BED_LEN + FADE, r, ch);
    return loopify(b, BED_LEN, FADE).normalize(0.7);
  };
  return { l: mk(0), r: mk(1) };
}
