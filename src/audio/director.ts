import { AS, ET } from '../sim/constants';
import { MUTATORS } from '../sim/content/mutators';
import { WavePhase, type World } from '../sim/world';
import type { BedId } from './beds';
import { LOOP_SLOTS, type AudioEngine } from './audio';
import type { SfxId } from './sfx';

export interface AudioContextInfo {
  mode: string;
  combo: number;
  comboTier: number;
  /** juice time scale: < 1 in slow-mo, 0 in hitstop */
  timeScale: number;
  corruption: number;
}

const ss = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const MUT_BED: Record<string, BedId> = {
  cryo: 'cryo',
  gravity: 'gravity',
  drift: 'drift',
  overclock: 'overclock',
  ricochet: 'ricochet',
  stasis: 'stasis',
};

/** Emitters that carry a continuous positional loop */
const HUM: Partial<Record<number, SfxId>> = {
  [ET.Gunner]: 'hum_gunner',
  [ET.Dart]: 'hum_dart',
  [ET.Bloater]: 'hum_bloater',
  [ET.Boss]: 'hum_boss',
  [ET.Worm]: 'hum_worm',
};

/**
 * Maps the state of the fight onto the mix. Runs at ~20 Hz; every target is smoothed with
 * asymmetric time constants (swell slowly, release even more slowly) so nothing ever jumps.
 */
export class AudioDirector {
  private acc = 0;
  /** smoothed tension (seconds-scale) */
  tension = 0;
  private hype = 0;
  private lastCombo = 0;
  private lastTier = 0;
  // loop-slot assignment
  private readonly slotKey = new Int32Array(LOOP_SLOTS).fill(-1);
  private readonly candI = new Int32Array(64);
  private readonly candD = new Float32Array(64);
  private readonly chosen = new Int32Array(LOOP_SLOTS);

  constructor(private readonly a: AudioEngine) {}

  update(dt: number, w: World, info: AudioContextInfo): void {
    const A = this.a;
    if (!A.ctx || !A.ready) return;
    // slow-mo pitch on new one-shots (time dilation you can hear)
    const ts = info.timeScale <= 0 ? 0.6 : info.timeScale;
    A.rateScale = 0.72 + 0.28 * Math.min(1, ts);
    this.acc += dt;
    // hums are positional: update every frame for smooth panning
    this.updateLoops(w, info);
    if (this.acc < 0.05) return;
    const step = this.acc;
    this.acc = 0;

    const p = w.player;
    const ph = w.wave.phase;
    const menu = info.mode === 'menu';
    const paused = info.mode === 'pause';
    const over = info.mode === 'over';
    const calm = menu || ph === WavePhase.Transition || ph === WavePhase.Upgrade || ph === WavePhase.Intro || ph === WavePhase.Clear || ph === WavePhase.Victory || over;
    const boss = (w.boss.id >= 0 && w.enemies.type[w.boss.id] === ET.Boss) || w.miniBoss >= 0;

    // ── tension: rises fast-ish (≈1.2 s), decays slowly (≈4 s)
    const target = calm ? 0 : Math.max(w.director.tension, boss ? 0.75 : 0);
    const k = target > this.tension ? step / 1.2 : step / 4;
    this.tension += (target - this.tension) * Math.min(1, k);
    const t = this.tension;
    // ── hype from combo: builds per kill, bleeds off when the chain breaks
    const comboN = Math.min(1, info.combo / 30);
    this.hype += (comboN - this.hype) * Math.min(1, step / (comboN > this.hype ? 0.6 : 2.5));
    if (info.combo === 0 && this.lastCombo >= 10) A.playUi('combo_end', 0.5);
    if (info.comboTier > this.lastTier && info.comboTier >= 25) A.playUi('riser', 0.35);
    this.lastCombo = info.combo;
    this.lastTier = info.comboTier;

    // ── music stems: pad, pulse, drive, hype, boss
    const up = 1.6;
    const down = 3.2;
    const set = (i: number, g: number, prev: number): void => A.setStem(i, g, g > prev ? up : down);
    const pad = calm ? 0.95 : 0.7 - t * 0.25;
    const pulse = calm ? 0 : Math.max(ss(0.06, 0.3, t), boss ? 1 : 0) * 0.9;
    const drive = calm ? 0 : Math.max(ss(0.32, 0.62, t), boss ? 0.85 : 0) * 0.85;
    const hypeG = calm ? 0 : Math.max(ss(0.72, 0.95, t) * 0.6, ss(0.25, 0.8, this.hype) * 0.85);
    const bossG = boss && !calm ? 0.9 : 0;
    set(0, pad, this.prev[0]!);
    set(1, pulse, this.prev[1]!);
    set(2, drive, this.prev[2]!);
    set(3, hypeG, this.prev[3]!);
    set(4, bossG, this.prev[4]!);
    this.prev[0] = pad;
    this.prev[1] = pulse;
    this.prev[2] = drive;
    this.prev[3] = hypeG;
    this.prev[4] = bossG;
    // calm phases (upgrade pick, menu) heard "through a wall"
    A.setMusicLP(paused ? 500 : calm ? 1400 : 2200 + 16000 * ss(0.05, 0.5, t + this.hype * 0.4), calm ? 1.5 : 1.0);

    // ── ambience beds
    const fleshAct = w.act === 1;
    const trans = ph === WavePhase.Transition;
    A.setBed('room', menu ? 0.35 : fleshAct ? 0.12 : 0.5, 3);
    A.setBed('flesh', fleshAct ? 0.6 : 0, 3);
    A.setBed('calm', calm ? 0.55 : 0, 2.5);
    A.setBed('tension', calm ? 0 : ss(0.15, 0.85, t) * 0.55, t > 0.3 ? 2 : 3.5);
    A.setBed('corrupt', boss ? Math.min(1, info.corruption * 1.2) * 0.7 : 0, 2);
    for (const m of MUTATORS) {
      const bed = MUT_BED[m.key];
      if (bed) A.setBed(bed, w.mutators & (1 << m.id) ? 0.5 : 0, 2.2);
    }
    A.setAmbLP(paused ? 600 : 20000, 0.6);

    // ── master state filter: slow-mo, low HP, pause
    const hpR = p.alive ? p.hp / p.maxHp : 0;
    const slow = 1 - Math.min(1, ts);
    let cut = 20000 * Math.pow(0.12, slow);
    if (hpR < 0.35 && !calm) cut = Math.min(cut, 3200 + hpR * 30000);
    if (paused) cut = 900;
    A.setStateLP(cut, slow > 0.1 ? 0.06 : 0.35);
    // ── space: wetter in slow-mo, in the mirror arena and as the boss corrupts reality
    const ric = w.mutators & (1 << 3) ? 0.18 : 0;
    A.setReverb(0.22 + slow * 0.45 + ric + info.corruption * 0.15 + (calm ? 0.1 : 0) + (trans ? 0.35 : 0), 0.4);
    // ── body: hover engine follows speed; heartbeat fades in at low HP and speeds up
    const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    A.setHover(p.alive && !menu ? 0.06 + Math.min(1, sp / 12) * 0.12 + (p.dashT > 0 ? 0.15 : 0) : 0, 0.8 + Math.min(1, sp / 12) * 0.35 + (p.dashT > 0 ? 0.25 : 0));
    const danger = p.alive && !calm ? ss(0.4, 0.08, hpR) : 0;
    A.setHeart(danger * 0.85, 0.9 + danger * 0.5);
  }

  private readonly prev = new Float32Array(5);

  private updateLoops(w: World, info: AudioContextInfo): void {
    const A = this.a;
    const E = w.enemies;
    const p = w.player;
    // gather candidates (nearest humming emitters)
    let n = 0;
    for (let i = 0; i < E.hi && n < 64; i++) {
      if (!E.alive[i] || E.st[i] === AS.Spawning || !HUM[E.type[i]!]) continue;
      const dx = E.x[i]! - p.x;
      const dy = E.y[i]! - p.y;
      this.candI[n] = i;
      this.candD[n] = dx * dx + dy * dy;
      n++;
    }
    // partial selection of the nearest LOOP_SLOTS
    const m = Math.min(LOOP_SLOTS, n);
    for (let a = 0; a < m; a++) {
      let best = a;
      for (let b = a + 1; b < n; b++) if (this.candD[b]! < this.candD[best]!) best = b;
      const ti = this.candI[a]!;
      const td = this.candD[a]!;
      this.candI[a] = this.candI[best]!;
      this.candD[a] = this.candD[best]!;
      this.candI[best] = ti;
      this.candD[best] = td;
      this.chosen[a] = this.candI[a]!;
    }
    // keep existing slot assignments stable; fill free slots with newcomers
    const keyOf = (i: number): number => i * 65536 + E.gen[i]!;
    let usedMask = 0;
    let takenMask = 0;
    for (let s = 0; s < LOOP_SLOTS; s++) {
      for (let c = 0; c < m; c++) {
        if (takenMask & (1 << c)) continue;
        if (this.slotKey[s] === keyOf(this.chosen[c]!)) {
          usedMask |= 1 << s;
          takenMask |= 1 << c;
          break;
        }
      }
    }
    for (let c = 0; c < m; c++) {
      if (takenMask & (1 << c)) continue;
      for (let s = 0; s < LOOP_SLOTS; s++) {
        if (usedMask & (1 << s)) continue;
        this.slotKey[s] = keyOf(this.chosen[c]!);
        usedMask |= 1 << s;
        takenMask |= 1 << c;
        break;
      }
    }
    for (let s = 0; s < LOOP_SLOTS; s++) {
      if (!(usedMask & (1 << s))) {
        if (this.slotKey[s] !== -1) {
          A.setLoop(s, null, -1, 0, 0, 0, 1, 0);
          this.slotKey[s] = -1;
        }
        continue;
      }
      const key = this.slotKey[s]!;
      const i = (key / 65536) | 0;
      const type = E.type[i]!;
      const id = HUM[type]!;
      const rx = E.x[i]! - p.x;
      const ry = E.y[i]! - p.y;
      const dist = Math.sqrt(rx * rx + ry * ry);
      // doppler from radial velocity (toward the listener ⇒ higher)
      const vr = dist > 0.01 ? (E.vx[i]! * rx + E.vy[i]! * ry) / dist : 0;
      const dop = Math.max(0.8, Math.min(1.25, 1 - vr / 90));
      const ch = E.charge[i]!;
      let g = 0.3;
      let rate = 1;
      switch (type) {
        case ET.Gunner:
          g = 0.32 + ch * 0.2;
          rate = 1 + ch * 0.25;
          break;
        case ET.Dart:
          g = 0.26 + (E.st[i] === AS.Dash ? 0.35 : ch * 0.2);
          rate = 1 + Math.sqrt(E.vx[i]! * E.vx[i]! + E.vy[i]! * E.vy[i]!) / 40;
          break;
        case ET.Bloater:
          g = 0.3 + ch * 0.4;
          rate = 1 + ch * 0.6;
          break;
        case ET.Worm: {
          // loud grind while tunnelling, swelling right before it erupts; quiet on the surface
          const st = E.st[i]!;
          g = st === AS.Underground ? 0.75 : st === AS.Windup ? 0.9 + ch * 0.4 : 0.12;
          rate = st === AS.Windup ? 1 + ch * 0.5 : 1;
          break;
        }
        case ET.Boss:
          g = 0.85;
          rate = 1 + info.corruption * 0.08;
          break;
      }
      A.setLoop(s, id, key, rx, ry, g, rate * dop * A.rateScale, dist);
    }
  }
}
