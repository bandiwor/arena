import { Ev, EV_STRIDE } from '../core/events';
import { Rng } from '../core/rng';
import { AS, ARENA_HH, ARENA_HW, BK, ET, Mat, MAX_LASERS, Team, WP } from '../sim/constants';
import { enemyDef } from '../sim/content/enemies';
import { MUTATORS } from '../sim/content/mutators';
import { weaponDef } from '../sim/content/weapons';
import type { World } from '../sim/world';
import type { AudioEngine } from '../audio/audio';
import type { SfxId } from '../audio/sfx';
import type { CameraRig } from './camera';
import type { EntityRenderer } from './entities';
import type { Floor } from './floor';
import type { Juice } from './juice';
import type { LightPool } from './lights';
import { lin, PAL } from './palette';
import { PS, type Particles } from './particles';
import { MAX_WAVES } from './post';
import { QK, QM, type QuadBatch } from './quads';

const TAU = Math.PI * 2;
const TFX = 512;

/** Per-material gore palette (linear rgb, HDR where it should glow). */
interface Gore {
  drop: readonly [number, number, number];
  dropAlpha: number;
  dropShape: number;
  glow: readonly [number, number, number];
  chunk: readonly [number, number, number];
  chunkShape: number;
  chunkAlpha: number;
  decal: readonly [number, number, number, number];
  hitSfx: SfxId;
  killSfx: SfxId;
}
const GORE: readonly Gore[] = [
  // flesh: dark arterial blood that occludes + hot red mist
  { drop: [0.22, 0.004, 0.01], dropAlpha: 1, dropShape: PS.Blood, glow: [2.6, 0.12, 0.18], chunk: [0.3, 0.02, 0.035], chunkShape: PS.Shard, chunkAlpha: 1, decal: [0.09, 0.0015, 0.005, 0.92], hitSfx: 'hit_flesh', killSfx: 'kill_flesh' },
  // plant: luminous sap, leaves and petals
  { drop: [0.12, 0.55, 0.02], dropAlpha: 0.65, dropShape: PS.Blood, glow: [0.8, 2.6, 0.15], chunk: [0.05, 0.22, 0.03], chunkShape: PS.Leaf, chunkAlpha: 1, decal: [0.07, 0.36, 0.02, 0.8], hitSfx: 'hit_plant', killSfx: 'kill_plant' },
  // machine: sparks, black oil, bolts, smoke
  { drop: [0.006, 0.006, 0.01], dropAlpha: 1, dropShape: PS.Blood, glow: [4.0, 1.5, 0.3], chunk: [0.1, 0.1, 0.13], chunkShape: PS.Shard, chunkAlpha: 1, decal: [0.004, 0.004, 0.007, 0.9], hitSfx: 'hit_machine', killSfx: 'kill_machine' },
  // crystal: glowing shards + glitter
  { drop: [0.5, 0.7, 2.4], dropAlpha: 0, dropShape: PS.Shard, glow: [1.2, 1.6, 3.6], chunk: [0.7, 0.9, 3.0], chunkShape: PS.Shard, chunkAlpha: 0, decal: [0.08, 0.12, 0.38, 0.5], hitSfx: 'hit_crystal', killSfx: 'kill_crystal' },
  // void: glitch pixels
  { drop: [1.6, 0.4, 3.2], dropAlpha: 0, dropShape: PS.Pixel, glow: [2.5, 1.0, 4.0], chunk: [3, 3, 3], chunkShape: PS.Pixel, chunkAlpha: 0, decal: [0.14, 0.02, 0.3, 0.6], hitSfx: 'hit_void', killSfx: 'explode_big' },
];

const C_PLAYER = new Float32Array(3);
const C_ENEMY = new Float32Array(3);
const C_ENEMY_B = new Float32Array(3);
const C_HAZ = new Float32Array(3);
const C_ENERGY = new Float32Array(3);
const C_PICK = new Float32Array(3);
const C_MUT = new Float32Array(3);
const C_RARE = [new Float32Array(3), new Float32Array(3), new Float32Array(3), new Float32Array(3)] as const;
lin(PAL.player, C_PLAYER);
lin(PAL.enemy, C_ENEMY);
lin(PAL.enemyBullet, C_ENEMY_B);
lin(PAL.hazard, C_HAZ);
lin(PAL.energy, C_ENERGY);
lin(PAL.pickup, C_PICK);
lin(0x2ef2ff, C_RARE[0]);
lin(0x5cff9b, C_RARE[1]);
lin(0xb36bff, C_RARE[2]);
lin(0xffb02e, C_RARE[3]);

/** hoisted colour constants (no per-event allocation) */
const K0 = new Float32Array([0.02, 0.02, 0.025]);
const K1 = new Float32Array([0.05, 0.24, 0.03]);
const K2 = new Float32Array([0.45, 0.04, 0.22]);
const K3 = new Float32Array([3, 3, 4]);
const K4 = new Float32Array([3, 2.6, 2.2]);
const K5 = new Float32Array([3, 3, 3]);
const K6 = new Float32Array([0.025, 0.02, 0.03]);
const K7 = new Float32Array([0.03, 0.03, 0.04]);
const K8 = new Float32Array([3, 0.3, 0.4]);
const K9 = new Float32Array([0.8, 2.6, 0.3]);
const K10 = new Float32Array([0.06, 0.25, 0.03]);
const K11 = new Float32Array([0.04, 0.03, 0.05]);
const K12 = new Float32Array([0.1, 0.08, 0.1]);
const K13 = new Float32Array([0.03, 0.03, 0.035]);
const K14 = new Float32Array([3, 2.5, 4]);
const K15 = new Float32Array([2, 2, 3]);
const K16 = new Float32Array([1.2, 1.6, 3.6]);
const K17 = new Float32Array([3, 0.6, 3]);

export interface FxDeps {
  particles: Particles;
  quads: QuadBatch;
  floor: Floor;
  lights: LightPool;
  juice: Juice;
  entities: EntityRenderer;
  camera: CameraRig;
  audio: AudioEngine | null;
}

/**
 * Turns simulation events + state into everything you see and hear.
 * Cosmetic randomness uses its own Rng stream so it can never desync gameplay.
 */
export class FxDirector {
  readonly rng = new Rng(0xf00d);
  /** screen shockwaves in world space: x, y, age, strength */
  readonly waves = new Float32Array(MAX_WAVES * 4);
  private waveCursor = 0;
  /** singularity lens target */
  lensX = 0;
  lensY = 0;
  lensS = 0;
  // timed quads
  private readonly tK = new Uint8Array(TFX);
  private readonly tM = new Uint8Array(TFX);
  private readonly tX = new Float32Array(TFX);
  private readonly tY = new Float32Array(TFX);
  private readonly tH = new Float32Array(TFX);
  private readonly tA = new Float32Array(TFX);
  private readonly tL = new Float32Array(TFX);
  private readonly tW = new Float32Array(TFX);
  private readonly tC = new Float32Array(TFX * 3);
  private readonly tT = new Float32Array(TFX);
  private readonly tLife = new Float32Array(TFX);
  private readonly tGrow = new Float32Array(TFX);
  private tCursor = 0;
  /** per-enemy last seen state, to detect transitions (windup starts → sounds, bursts) */
  private readonly prevSt = new Uint8Array(512).fill(255);
  private readonly prevGen = new Uint16Array(512);
  /** pending decals for particles still in flight */
  private readonly pdX = new Float32Array(256);
  private readonly pdY = new Float32Array(256);
  private readonly pdT = new Float32Array(256);
  private readonly pdS = new Float32Array(256);
  private readonly pdM = new Uint8Array(256);
  private pdCursor = 0;
  /** muted when sim is fast-forwarding (replays at high speed) */
  quiet = false;
  /** HUD hook */
  onEvent: ((type: number, d: Float32Array, o: number) => void) | null = null;
  private time = 0;

  constructor(private readonly d: FxDeps) {}

  setAudio(a: AudioEngine | null): void {
    this.d.audio = a;
  }

  // ───────────────────────────── primitives

  sfx(id: SfxId, x: number, vol = 1, rate = 1, gap = 0.03, maxSame = 6): void {
    if (this.quiet || !this.d.audio) return;
    const pan = (x - this.d.camera.fx) / 22;
    this.d.audio.play(id, pan, vol, rate * (0.96 + this.rng.float() * 0.08), gap, maxSame);
  }

  timed(kind: number, mode: number, x: number, h: number, y: number, a: number, len: number, w: number, c: ArrayLike<number>, k: number, life: number, grow = 0): void {
    const i = this.tCursor;
    this.tCursor = (this.tCursor + 1) % TFX;
    this.tK[i] = kind;
    this.tM[i] = mode;
    this.tX[i] = x;
    this.tY[i] = y;
    this.tH[i] = h;
    this.tA[i] = a;
    this.tL[i] = len;
    this.tW[i] = w;
    this.tC[i * 3] = c[0]! * k;
    this.tC[i * 3 + 1] = c[1]! * k;
    this.tC[i * 3 + 2] = c[2]! * k;
    this.tT[i] = 0;
    this.tLife[i] = life;
    this.tGrow[i] = grow;
  }

  wave(x: number, y: number, strength: number): void {
    const o = this.waveCursor * 4;
    this.waveCursor = (this.waveCursor + 1) % MAX_WAVES;
    this.waves[o] = x;
    this.waves[o + 1] = y;
    this.waves[o + 2] = 0;
    this.waves[o + 3] = strength;
  }

  /** cone burst helper */
  burst(n: number, x: number, h: number, y: number, ang: number, spread: number, sMin: number, sMax: number, up: number, life: number, c: ArrayLike<number>, ck: number, size: number, drag: number, grav: number, shape: number, alpha: number): void {
    const P = this.d.particles;
    const r = this.rng;
    for (let k = 0; k < n; k++) {
      const a = ang + (r.float() - 0.5) * spread;
      const s = sMin + (sMax - sMin) * r.float();
      const v = 0.6 + r.float() * 0.8;
      P.emit(x, h, y, Math.cos(a) * s, up * (0.3 + r.float()), Math.sin(a) * s, life * (0.6 + r.float() * 0.8), c[0]! * ck * v, c[1]! * ck * v, c[2]! * ck * v, size * (0.6 + r.float() * 0.8), drag, grav, shape, alpha);
    }
  }

  private pendingDecal(x: number, y: number, delay: number, size: number, mat: number): void {
    const i = this.pdCursor;
    this.pdCursor = (this.pdCursor + 1) % 256;
    this.pdX[i] = x;
    this.pdY[i] = y;
    this.pdT[i] = delay;
    this.pdS[i] = size;
    this.pdM[i] = mat;
  }

  private decal(mat: number, x: number, y: number, size: number, stretchAngle = 0, stretch = 0): void {
    const g = GORE[mat]!;
    const glowK = mat === Mat.Plant ? 1.6 : 1;
    this.d.floor.decals.add(x, y, size, stretch ? -stretchAngle : this.rng.float() * TAU, g.decal[0] * glowK, g.decal[1] * glowK, g.decal[2] * glowK, g.decal[3], 0, this.rng.float() * 100, stretch);
  }

  // ───────────────────────────── composite effects (also used by the lab)

  hitFx(mat: number, x: number, y: number, h: number, ang: number, dmg: number, crit: boolean, rarity: number): void {
    const g = GORE[mat]!;
    const n = Math.min(24, 4 + Math.floor(dmg * 0.35));
    // directional spray out of the exit wound
    this.burst(n, x, h, y, ang, 1.1, 4, 11, 4, 0.6, g.drop, 1, 0.16, 2.5, 22, g.dropShape, g.dropAlpha);
    this.burst(Math.ceil(n * 0.5), x, h, y, ang, 1.6, 3, 9, 2, 0.25, g.glow, 1, 0.22, 6, 0, PS.Glow, 0);
    if (mat === Mat.Machine) this.burst(n, x, h, y, ang + Math.PI, 2.2, 6, 16, 6, 0.45, g.glow, 1.2, 0.12, 1.5, 28, PS.Spark, 0);
    if (mat === Mat.Plant && this.rng.chance(0.6)) this.burst(2, x, h + 0.4, y, ang, 1.5, 1, 4, 3, 1.2, g.chunk, 1, 0.24, 2, 6, PS.Leaf, 1);
    if (mat === Mat.Crystal) this.burst(6, x, h, y, ang + Math.PI, 2.4, 4, 10, 4, 0.4, g.glow, 1, 0.12, 2, 20, PS.Shard, 0);
    if (mat !== Mat.Crystal && mat !== Mat.Void && this.rng.chance(0.55)) this.pendingDecal(x + Math.cos(ang) * 1.2, y + Math.sin(ang) * 1.2, 0.25, 0.5 + dmg * 0.012, mat);
    this.timed(QK.Flash, QM.Billboard, x, h, y, this.rng.float() * TAU, 1.2 + dmg * 0.01, 1.2 + dmg * 0.01, g.glow, 0.6, 0.08);
    if (crit) {
      this.timed(QK.Ring, QM.Billboard, x, h, y, 0, 2.2, 2.2, C_RARE[3], 3, 0.25);
      this.burst(10, x, h, y, 0, TAU, 6, 12, 2, 0.3, C_RARE[3], 3, 0.1, 3, 0, PS.Spark, 0);
      this.sfx('crit', x, 0.6, 1, 0.05);
    }
    if (rarity >= 2) this.d.juice.addTrauma(0.03 * rarity);
    this.sfx(g.hitSfx, x, 0.5 + Math.min(0.5, dmg / 60), 1, 0.035);
  }

  killFx(mat: number, type: number, x: number, y: number, ang: number, radius: number, rarity: number, overkill: number, face: number, seed: number): void {
    const g = GORE[mat]!;
    const def = enemyDef(type);
    const h = def.height * 0.5;
    const size = radius / 0.6;
    const big = overkill > 25 || rarity >= 2;
    const P = this.d.particles;
    this.d.entities.addGhost(type, x, y, face, seed);
    // core pop
    this.timed(QK.Flash, QM.Billboard, x, h, y, this.rng.float() * TAU, 3.5 * size, 3.5 * size, g.glow, 1.2, 0.14);
    this.timed(QK.Ring, QM.Ground, x, 0.05, y, 0, 3.4 * size, 3.4 * size, g.glow, 0.8, 0.35);
    this.d.lights.flash(x, y, 1.5, 7 * size, g.glow[0] * 1.2, g.glow[1] * 1.2, g.glow[2] * 1.2, 0.25);
    // radial gore + directional bias along the killing blow
    const n = Math.floor((big ? 40 : 24) * Math.min(2.2, size));
    this.burst(n, x, h, y, ang, 2.4, 3, big ? 16 : 11, 6, 0.9, g.drop, 1, 0.2 * Math.min(1.6, size), 2, 24, g.dropShape, g.dropAlpha);
    this.burst(Math.floor(n * 0.5), x, h, y, 0, TAU, 2, 7, 5, 0.9, g.drop, 1, 0.16, 2, 24, g.dropShape, g.dropAlpha);
    this.burst(Math.floor(n * 0.35), x, h, y, ang, 3, 5, 14, 7, 1.4, g.chunk, 1, 0.26 * size, 1.2, 26, g.chunkShape, g.chunkAlpha);
    this.burst(14, x, h, y, 0, TAU, 2, 6, 1, 0.35, g.glow, 1, 0.5, 5, 0, PS.Glow, 0);
    switch (mat) {
      case Mat.Machine:
        this.burst(30, x, h, y, 0, TAU, 8, 20, 10, 0.7, g.glow, 1.3, 0.1, 1.5, 30, PS.Spark, 0);
        this.burst(10, x, h, y, 0, TAU, 0.5, 2, 2, 1.6, K0, 1, 1.2, 1.5, -0.6, PS.Smoke, 0.7);
        this.burst(8, x, h, y, 0, TAU, 2, 5, 3, 0.8, C_HAZ, 3, 0.4, 3, 0, PS.Ember, 0);
        this.d.floor.decals.add(x, y, 2.6 * size, this.rng.float() * TAU, 0.002, 0.002, 0.003, 0.7, 1, this.rng.float() * 100);
        this.sfx('explode', x, 0.5, 1.3, 0.06);
        break;
      case Mat.Plant:
        this.burst(18, x, h + 0.5, y, 0, TAU, 1.5, 6, 4, 2.2, K1, 1, 0.3, 2.5, 5, PS.Leaf, 1);
        this.burst(10, x, h + 0.7, y, 0, TAU, 1.5, 5, 4, 2.0, K2, 1, 0.28, 2.5, 5, PS.Leaf, 1);
        // pollen drifts up
        for (let k = 0; k < 16; k++) P.emit(x + this.rng.sym(), h, y + this.rng.sym(), this.rng.sym() * 1.5, 1 + this.rng.float() * 2, this.rng.sym() * 1.5, 2.5, 0.9, 2.4, 0.2, 0.09, 1.2, 0, PS.Ember, 0);
        break;
      case Mat.Crystal:
        this.burst(26, x, h + 0.4, y, 0, TAU, 6, 15, 8, 1.2, g.chunk, 1, 0.3, 1.5, 24, PS.Shard, 0);
        this.burst(30, x, h, y, 0, TAU, 1, 6, 4, 1.4, K3, 1, 0.07, 2, 3, PS.Glow, 0);
        break;
      case Mat.Void:
        this.burst(80, x, h, y, 0, TAU, 2, 18, 8, 1.6, g.drop, 1, 0.35, 1.5, 6, PS.Pixel, 0);
        break;
      default:
        // flesh: blood fountain + big pool
        for (let k = 0; k < 10; k++) {
          const a = ang + this.rng.sym() * 0.8;
          P.emit(x, h + 0.3, y, Math.cos(a) * this.rng.range(1, 4), this.rng.range(5, 10), Math.sin(a) * this.rng.range(1, 4), 1.2, 0.35, 0.01, 0.02, 0.24, 0.3, 26, PS.Blood, 1);
        }
    }
    if (mat !== Mat.Crystal) {
      this.decal(mat, x, y, 1.8 * size);
      this.decal(mat, x + Math.cos(ang) * 1.6 * size, y + Math.sin(ang) * 1.6 * size, 1.4 * size, ang, 1.2);
      for (let k = 0; k < 3; k++) this.pendingDecal(x + Math.cos(ang) * (2 + k * 1.2) + this.rng.sym(), y + Math.sin(ang) * (2 + k * 1.2) + this.rng.sym(), 0.2 + k * 0.1, 0.5 + this.rng.float() * 0.5, mat);
    }
    this.d.juice.addTrauma(0.06 + size * 0.05 + (big ? 0.08 : 0));
    if (big) {
      this.d.juice.stop(0.035 + rarity * 0.012);
      this.wave(x, y, 0.5);
    }
    this.d.floor.ripple(x, y, 0.4 * size);
    this.sfx(g.killSfx, x, 0.7, 0.9 + 0.2 * this.rng.float(), 0.04);
  }

  explosionFx(x: number, y: number, radius: number, power: number, team: number): void {
    const hot = team === Team.Enemy ? C_ENEMY : C_HAZ;
    const P = this.d.particles;
    const R = radius;
    this.timed(QK.Flash, QM.Billboard, x, 1, y, this.rng.float() * TAU, R * 2.4, R * 2.4, K4, 1, 0.12);
    this.timed(QK.Ring, QM.Ground, x, 0.06, y, 0, R * 2.6, R * 2.6, hot, 2.5, 0.45);
    this.timed(QK.Ring, QM.Ground, x, 0.06, y, 0, R * 1.6, R * 1.6, K5, 1, 0.22);
    // fireball (embers) + sparks + smoke
    for (let k = 0; k < 40 + R * 10; k++) {
      const a = this.rng.float() * TAU;
      const s = this.rng.range(1, R * 3.2);
      const heat = this.rng.float();
      P.emit(x, 0.6, y, Math.cos(a) * s, this.rng.range(1, 6), Math.sin(a) * s, this.rng.range(0.25, 0.6), hot[0]! * (2 + heat * 3), hot[1]! * (1.5 + heat * 3), hot[2]! * (1 + heat * 2), this.rng.range(0.5, 1.2) * Math.min(2, R / 2), 4, 0, PS.Glow, 0);
    }
    this.burst(30 + R * 6, x, 0.5, y, 0, TAU, 8, 22, 10, 0.7, hot, 3, 0.12, 1.5, 30, PS.Spark, 0);
    this.burst(14, x, 0.6, y, 0, TAU, 0.6, R * 0.8, 2, 2.2, K6, 1, 1.4 * Math.min(2, R / 2), 1.2, -0.8, PS.Smoke, 0.75);
    this.d.floor.decals.add(x, y, R * 1.6, this.rng.float() * TAU, 0.006, 0.004, 0.005, 0.85, 1, this.rng.float() * 100);
    this.d.lights.flash(x, y, 2, R * 5, hot[0]! * 8, hot[1]! * 8, hot[2]! * 8, 0.35);
    this.d.floor.ripple(x, y, 0.9);
    this.wave(x, y, Math.min(1.6, 0.5 + power * 0.3));
    this.d.juice.addTrauma(Math.min(0.6, 0.18 + power * 0.08));
    this.d.juice.addChroma(0.3);
    this.d.juice.doFlash(Math.min(0.25, power * 0.04), 1, 0.7, 0.4);
    this.d.juice.punch(0.25);
    this.d.audio?.duck(0.4, 0.3);
    this.sfx(R > 5 ? 'explode_big' : 'explode', x, 0.9, 1, 0.05);
  }

  muzzleFx(x: number, y: number, ang: number, weapon: number, rarity: number): void {
    const wd = weaponDef(weapon);
    const c = C_RARE[Math.min(3, rarity)]!;
    const P = this.d.particles;
    const J = this.d.juice;
    const big = 0.8 + wd.recoil;
    this.timed(QK.Flash, QM.Billboard, x, 0.7, y, this.rng.float() * TAU, big * 1.6, big * 1.6, c, 2, 0.06);
    this.d.lights.flash(x, y, 1, 5 + wd.recoil * 6, c[0]! * 5, c[1]! * 5, c[2]! * 5, 0.07 + wd.recoil * 0.06);
    this.burst(3 + Math.floor(wd.recoil * 10), x, 0.7, y, ang, 0.5, 8, 20, 1, 0.12, c, 3, 0.08, 6, 0, PS.Spark, 0);
    J.addTrauma(wd.shake * 0.5);
    J.kick(-Math.cos(ang), -Math.sin(ang), wd.recoil * 3);
    switch (weapon) {
      case WP.Pulse:
        this.sfx('shoot_pulse', x, 0.45, 1, 0.04);
        break;
      case WP.Scatter:
        this.sfx('shoot_scatter', x, 0.8);
        this.burst(8, x, 0.7, y, ang, 0.8, 2, 5, 1, 0.6, K7, 1, 0.5, 3, -0.3, PS.Smoke, 0.5);
        J.punch(0.15);
        break;
      case WP.Needler:
        this.sfx('shoot_needle', x, 0.35, 1, 0.02, 10);
        break;
      case WP.Launcher:
        this.sfx('shoot_launcher', x, 0.75);
        this.burst(6, x, 0.7, y, ang, 0.6, 1, 4, 1, 0.8, K7, 1, 0.6, 2, -0.4, PS.Smoke, 0.5);
        break;
      case WP.Rail:
        this.sfx('shoot_rail', x, 1);
        J.addChroma(0.6);
        J.addGlitch(0.15);
        J.punch(0.35);
        J.stop(0.04);
        break;
      case WP.Singularity:
        this.sfx('shoot_sing', x, 1);
        J.addChroma(1);
        J.addGlitch(0.4);
        J.doFlash(0.25, 0.6, 0.3, 1);
        J.punch(0.5);
        J.stop(0.07);
        this.wave(x, y, 0.8);
        this.d.audio?.duck(0.6, 0.6);
        for (let k = 0; k < 40; k++) {
          const a = this.rng.float() * TAU;
          P.emit(x + Math.cos(a) * 3, 0.7, y + Math.sin(a) * 3, -Math.cos(a) * 9, 0, -Math.sin(a) * 9, 0.32, 1.2, 0.4, 3, 0.12, 0.1, 0, PS.Spark, 0);
        }
        break;
    }
  }

  spawnFx(x: number, y: number, type: number, done: boolean): void {
    const def = enemyDef(type);
    const P = this.d.particles;
    if (!done) {
      this.sfx(type === ET.Boss ? 'boss_phase' : 'spawn', x, type === ET.Boss ? 1 : 0.35, 1, 0.08, 4);
      for (let k = 0; k < 14; k++) {
        const a = this.rng.float() * TAU;
        const r = def.r * 2.5;
        P.emit(x + Math.cos(a) * r, 0.05, y + Math.sin(a) * r, -Math.cos(a) * r * 1.5, this.rng.range(1, 4), -Math.sin(a) * r * 1.5, def.spawnTime * 0.7, C_ENEMY[0]! * 3, C_ENEMY[1]! * 3, C_ENEMY[2]! * 3, 0.12, 1, 0, PS.Pixel, 0);
      }
    } else {
      this.timed(QK.Ring, QM.Ground, x, 0.05, y, 0, def.r * 7, def.r * 7, C_ENEMY, 2.5, 0.35);
      this.timed(QK.Flash, QM.Billboard, x, def.height * 0.5, y, 0, def.r * 5, def.r * 5, C_ENEMY, 1.5, 0.12);
      this.burst(18, x, def.height * 0.5, y, 0, TAU, 3, 9, 3, 0.4, C_ENEMY, 3, 0.1, 3, 6, PS.Pixel, 0);
      this.d.lights.flash(x, y, 1, 5 * def.r + 3, C_ENEMY[0]! * 4, C_ENEMY[1]! * 4, C_ENEMY[2]! * 4, 0.3);
      this.sfx('spawn_done', x, 0.4, 1, 0.05);
      if (type === ET.Boss) {
        this.d.juice.addTrauma(0.8);
        this.d.juice.addGlitch(1);
        this.wave(x, y, 1.5);
        this.d.floor.ripple(x, y, 2);
      }
    }
  }

  // ───────────────────────────── event consumption (call after every sim tick)

  consume(w: World): void {
    const Q = w.events;
    const D = Q.data;
    const J = this.d.juice;
    const P = this.d.particles;
    for (let k = 0; k < Q.count; k++) {
      const o = k * EV_STRIDE;
      const t = D[o]!;
      const x = D[o + 1]!;
      const y = D[o + 2]!;
      const a = D[o + 3]!;
      const b = D[o + 4]!;
      const c = D[o + 5]!;
      const d = D[o + 6]!;
      const e = D[o + 7]!;
      const f = D[o + 8]!;
      switch (t) {
        case Ev.Shoot:
          this.muzzleFx(x, y, a, b, c);
          break;
        case Ev.EnemyShoot: {
          const big = b === ET.Boss;
          this.timed(QK.Flash, QM.Billboard, x, 1, y, this.rng.float() * TAU, big ? 3.5 : 1.4, big ? 3.5 : 1.4, C_ENEMY_B, 2, 0.08);
          this.d.lights.flash(x, y, 1, big ? 9 : 4, C_ENEMY[0]! * 4, C_ENEMY[1]! * 4, C_ENEMY[2]! * 4, 0.1);
          this.burst(4, x, 1, y, a, 0.6, 5, 12, 1, 0.12, C_ENEMY_B, 3, 0.08, 6, 0, PS.Spark, 0);
          this.sfx(big || c === BK.BossOrb ? 'enemy_orb' : 'enemy_shoot', x, big ? 0.6 : 0.35, 1, 0.05, 4);
          break;
        }
        case Ev.Hit: {
          const def = enemyDef(d);
          this.hitFx(b, x, y, def.height * 0.55, a, c, f > 0.5, e);
          break;
        }
        case Ev.Kill: {
          // face isn't in the event; ghost uses kill angle as facing
          this.killFx(b, c, x, y, a, d, e, f, a + Math.PI, this.rng.float());
          if (e >= 3) {
            J.stop(0.06);
            J.addChroma(0.4);
          }
          break;
        }
        case Ev.Impact: {
          const team = c;
          const col = team === Team.Player ? C_PLAYER : C_ENEMY_B;
          const bounce = d > 0.5;
          this.burst(bounce ? 6 : 5, x, 0.7, y, a + Math.PI, 1.6, 3, 9, 2, 0.2, col, 3, 0.07, 4, 10, PS.Spark, 0);
          this.timed(QK.Flash, QM.Billboard, x, 0.7, y, this.rng.float() * TAU, 0.9, 0.9, col, 1.5, 0.06);
          if (bounce) this.timed(QK.Ring, QM.Billboard, x, 0.7, y, 0, 1.4, 1.4, col, 2, 0.15);
          if (team === Team.Player) this.sfx('impact_wall', x, 0.25, 1, 0.05, 3);
          break;
        }
        case Ev.Explosion:
          this.explosionFx(x, y, a, b, c);
          break;
        case Ev.SpawnTelegraph:
          this.spawnFx(x, y, a, false);
          break;
        case Ev.SpawnDone:
          this.spawnFx(x, y, a, true);
          break;
        case Ev.PlayerHurt: {
          J.damage = Math.min(1, J.damage + 0.5 + a * 0.02);
          J.addTrauma(0.35);
          J.addChroma(0.9);
          J.addGlitch(0.45);
          J.stop(0.06);
          J.doFlash(0.15, 1, 0.1, 0.2);
          this.burst(20, x, 0.8, y, c, 1.8, 4, 12, 3, 0.35, C_PLAYER, 3, 0.1, 3, 18, PS.Spark, 0);
          this.burst(12, x, 0.8, y, 0, TAU, 2, 8, 3, 0.5, K8, 1, 0.12, 2, 10, PS.Pixel, 0);
          this.sfx('player_hurt', x, 0.9, 1, 0.08);
          this.d.audio?.duck(0.5, 0.4);
          break;
        }
        case Ev.PlayerDash: {
          this.sfx('dash', x, 0.6);
          this.timed(QK.Ring, QM.Ground, x, 0.05, y, 0, 2.6, 2.6, C_PLAYER, 2, 0.25);
          this.burst(16, x, 0.4, y, a + Math.PI, 1.2, 3, 9, 1, 0.35, C_PLAYER, 2.5, 0.12, 4, 0, PS.Glow, 0);
          J.addChroma(0.25);
          break;
        }
        case Ev.RailBeam: {
          const dx = a - x;
          const dy = b - y;
          const len = Math.sqrt(dx * dx + dy * dy);
          const ang = Math.atan2(dy, dx);
          const col = C_RARE[2];
          this.timed(QK.Beam, QM.Ground, (x + a) / 2, 0.75, (y + b) / 2, ang, len, 1.6, col, 3, 0.32);
          this.timed(QK.Beam, QM.Ground, (x + a) / 2, 0.75, (y + b) / 2, ang, len, 0.5, K5, 1, 0.12);
          for (let s = 0; s < len; s += 0.5) {
            const px = x + (dx / len) * s;
            const py = y + (dy / len) * s;
            P.emit(px, 0.75, py, this.rng.sym() * 2, this.rng.sym() * 2, this.rng.sym() * 2, 0.5 + this.rng.float() * 0.4, col[0]! * 2.5, col[1]! * 2.5, col[2]! * 2.5, 0.16, 3, 0, PS.Glow, 0);
          }
          this.d.lights.flash((x + a) / 2, (y + b) / 2, 1, len * 0.6, col[0]! * 6, col[1]! * 6, col[2]! * 6, 0.25);
          if (d > 2) {
            J.stop(0.05 + Math.min(0.06, d * 0.01));
            J.slow(0.35, 0.18);
          }
          break;
        }
        case Ev.WaveStart:
          this.sfx(a > 0.5 ? 'boss_phase' : 'wave_start', 0, 0.8, 1, 0.5);
          J.addGlitch(0.5);
          break;
        case Ev.WaveClear:
          this.sfx('wave_clear', 0, 0.8, 1, 0.5);
          J.slow(0.3, 0.7);
          J.doFlash(0.12, 0.6, 1, 1);
          break;
        case Ev.BossPhase:
          J.addGlitch(1.4);
          J.addTrauma(0.8);
          J.slow(0.25, 0.7);
          J.doFlash(0.45, 0.8, 0.5, 1);
          J.addChroma(1.5);
          this.wave(x, y, 2);
          this.d.floor.ripple(x, y, 2.5);
          this.timed(QK.Ring, QM.Ground, x, 0.1, y, 0, 30, 30, C_ENERGY, 3, 0.8);
          this.sfx('boss_phase', x, 1, 1, 0.5);
          this.d.audio?.duck(0.7, 1.2);
          break;
        case Ev.BossDeath:
          J.slow(0.2, 3.2);
          J.addGlitch(1.5);
          J.addTrauma(1);
          J.doFlash(0.6, 1, 1, 1);
          this.sfx('boss_death', x, 1, 1, 1);
          this.wave(x, y, 2);
          break;
        case Ev.Mutator: {
          if (y > 0.5) {
            const m = MUTATORS[x];
            if (m) {
              lin(m.color, C_MUT);
              this.timed(QK.Ring, QM.Ground, this.d.camera.fx, 0.1, this.d.camera.fy, 0, 50, 50, C_MUT, 1.2, 1.4);
            }
            J.addGlitch(0.8);
            this.sfx('mutator', 0, 0.8, 1, 0.5);
          }
          break;
        }
        case Ev.UpgradePicked:
          this.sfx(a >= 3 ? 'legendary' : 'upgrade', 0, 0.8, 1, 0.3);
          if (a >= 2) {
            J.doFlash(0.3, C_RARE[3][0], C_RARE[3][1], C_RARE[3][2]);
            J.addGlitch(0.5);
          }
          break;
        case Ev.PlayerDeath:
          J.slow(0.15, 2.5);
          J.addGlitch(1.5);
          J.addTrauma(1);
          J.doFlash(0.5, 1, 0.1, 0.2);
          this.burst(80, x, 0.7, y, 0, TAU, 3, 18, 8, 1.2, C_PLAYER, 3, 0.2, 1.5, 15, PS.Pixel, 0);
          this.explosionFx(x, y, 3, 3, Team.Player);
          break;
        case Ev.Victory:
          J.doFlash(0.5, 1, 1, 1);
          break;
        case Ev.WeaponSwitch:
          this.sfx('weapon_switch', this.d.camera.fx, 0.5, 1 + y * 0.05, 0.05);
          break;
        case Ev.ArcherRelease:
          this.timed(QK.Flash, QM.Billboard, x, 1.6, y, 0, 2.4, 2.4, K9, 1.2, 0.12);
          this.burst(10, x, 1.6, y, a + Math.PI, 2.5, 2, 6, 2, 1, K10, 1, 0.22, 2.5, 5, PS.Leaf, 1);
          this.burst(10, x, 1.6, y, a, 0.4, 10, 20, 0, 0.18, C_ENEMY_B, 3, 0.08, 5, 0, PS.Spark, 0);
          this.sfx('archer_release', x, 0.7, 1, 0.06);
          break;
        case Ev.ChargerDash:
          this.sfx('charger_roar', x, 0.8, 1, 0.1);
          this.timed(QK.Ring, QM.Ground, x, 0.05, y, 0, 3.5, 3.5, C_ENEMY, 2, 0.3);
          this.burst(16, x, 0.2, y, a + Math.PI, 1.5, 2, 6, 1, 0.9, K11, 1, 0.9, 2, -0.2, PS.Smoke, 0.6);
          J.addTrauma(0.12);
          break;
        case Ev.Shockwave:
          this.timed(QK.Ring, QM.Ground, x, 0.06, y, 0, a * 3, a * 3, C_HAZ, 2.5, 0.45);
          this.burst(24, x, 0.3, y, 0, TAU, 4, 12, 6, 0.8, K12, 1, 0.22, 2, 25, PS.Shard, 1);
          this.burst(12, x, 0.4, y, 0, TAU, 1, 4, 1, 1.5, K13, 1, 1.3, 2, -0.3, PS.Smoke, 0.7);
          this.d.floor.ripple(x, y, 1.5);
          this.wave(x, y, 1);
          J.addTrauma(0.4);
          this.sfx('slam', x, 0.9, 1, 0.1);
          break;
        case Ev.Implode: {
          J.stop(0.12);
          J.addGlitch(1.2);
          J.addChroma(1.6);
          J.addTrauma(0.85);
          J.doFlash(0.5, 0.7, 0.4, 1);
          J.slow(0.3, 0.45);
          this.wave(x, y, 2.2);
          this.d.floor.ripple(x, y, 2.5);
          this.timed(QK.Ring, QM.Ground, x, 0.08, y, 0, a * 3.2, a * 3.2, C_ENERGY, 4, 0.6);
          this.timed(QK.Flash, QM.Billboard, x, 1, y, 0, a * 2, a * 2, K14, 1.5, 0.2);
          this.burst(120, x, 0.7, y, 0, TAU, 6, 30, 6, 0.9, C_ENERGY, 3, 0.12, 2, 4, PS.Spark, 0);
          this.burst(60, x, 0.7, y, 0, TAU, 2, 14, 6, 1.5, K15, 1, 0.15, 1.5, 4, PS.Pixel, 0);
          this.d.lights.flash(x, y, 2, 25, 12, 6, 20, 0.6);
          this.d.floor.decals.add(x, y, a * 1.3, 0, 0.04, 0.0, 0.08, 0.8, 1, this.rng.float() * 100);
          this.sfx('implode', x, 1, 1, 0.2);
          this.d.audio?.duck(0.8, 0.8);
          break;
        }
        case Ev.BossTeleport: {
          this.burst(60, x, 2.5, y, 0, TAU, 2, 10, 4, 0.8, C_ENERGY, 3, 0.25, 2, 0, PS.Pixel, 0);
          this.burst(60, a, 2.5, b, 0, TAU, 2, 10, 4, 0.8, K5, 1, 0.25, 2, 0, PS.Pixel, 0);
          const dx = a - x;
          const dy = b - y;
          this.timed(QK.Lightning, QM.Ground, (x + a) / 2, 1.5, (y + b) / 2, Math.atan2(dy, dx), Math.sqrt(dx * dx + dy * dy), 1.5, C_ENERGY, 3, 0.3);
          J.addGlitch(1.2);
          this.wave(a, b, 1.2);
          this.sfx('teleport', a, 1, 1, 0.2);
          break;
        }
        case Ev.LaserFire:
          this.sfx('laser_warn', x, 0.8, 1, 0.5);
          break;
        case Ev.ShieldBlock: {
          const lc = K16;
          this.burst(8, x, 1, y, a + Math.PI, 1.8, 6, 14, 3, 0.25, lc, 1, 0.08, 4, 10, PS.Spark, 0);
          this.timed(QK.Ring, QM.Billboard, x, 1, y, 0, 1.6, 1.6, lc, 1.5, 0.15);
          this.sfx('shield_block', x, 0.45, 1, 0.04);
          break;
        }
        case Ev.Pickup:
          this.timed(QK.Ring, QM.Ground, x, 0.05, y, 0, 3, 3, C_PICK, 3, 0.35);
          this.burst(16, x, 0.6, y, 0, TAU, 2, 6, 4, 0.5, C_PICK, 3, 0.12, 3, 0, PS.Glow, 0);
          this.sfx('pickup', x, 0.6);
          break;
        case Ev.Telegraph:
          this.timed(QK.TeleCircle, QM.Ground, x, 0.07, y, 0, a * 2, a * 2, C_ENEMY, 2.5, b, 1);
          break;
        case Ev.WeaponGained:
          if (y >= 3) {
            J.doFlash(0.6, 1, 0.75, 0.3);
            J.addGlitch(1);
            J.slow(0.3, 0.6);
          }
          break;
      }
      this.onEvent?.(t, D, o);
    }
  }

  // ───────────────────────────── per-frame state visuals

  frame(w: World, alpha: number, dt: number, time: number): void {
    this.time = time;
    const Qb = this.d.quads;
    const P = this.d.particles;
    const L = this.d.lights;
    const r = this.rng;
    Qb.begin();
    L.beginFrame(dt);
    // waves age
    for (let i = 0; i < MAX_WAVES; i++) {
      const o = i * 4;
      if (this.waves[o + 3]! > 0) {
        this.waves[o + 2] = this.waves[o + 2]! + dt;
        if (this.waves[o + 2]! > 0.8) this.waves[o + 3] = 0;
      }
    }
    // pending decals
    for (let i = 0; i < 256; i++) {
      if (this.pdT[i]! <= 0) continue;
      this.pdT[i] = this.pdT[i]! - dt;
      if (this.pdT[i]! <= 0) this.decal(this.pdM[i]!, this.pdX[i]!, this.pdY[i]!, this.pdS[i]!);
    }
    // timed quads
    for (let i = 0; i < TFX; i++) {
      const life = this.tLife[i]!;
      if (life <= 0) continue;
      const t = (this.tT[i] = this.tT[i]! + dt);
      if (t >= life) {
        this.tLife[i] = 0;
        continue;
      }
      const p = t / life;
      Qb.push(this.tK[i]!, this.tM[i]!, this.tX[i]!, this.tH[i]!, this.tY[i]!, this.tA[i]!, this.tL[i]!, this.tW[i]!, this.tC[i * 3]!, this.tC[i * 3 + 1]!, this.tC[i * 3 + 2]!, 0, this.tGrow[i]! > 0 ? p : p, i * 0.618);
    }

    const pl = w.player;
    const ppx = pl.px + (pl.x - pl.px) * alpha;
    const ppy = pl.py + (pl.y - pl.py) * alpha;
    // player light + thrusters + crosshair
    if (pl.alive) {
      L.add(ppx, ppy, 1.4, 9, C_PLAYER[0]! * 2.2, C_PLAYER[1]! * 2.2, C_PLAYER[2]! * 2.2);
      const sp = Math.sqrt(pl.vx * pl.vx + pl.vy * pl.vy);
      if (sp > 1 && r.chance(0.7)) {
        const ba = pl.face + Math.PI;
        P.emit(ppx + Math.cos(ba) * 0.6, 0.5, ppy + Math.sin(ba) * 0.6, -pl.vx * 0.2 + r.sym(), 0.5, -pl.vy * 0.2 + r.sym(), 0.25, C_PLAYER[0]! * 2, C_PLAYER[1]! * 2, C_PLAYER[2]! * 2, 0.18, 3, 0, PS.Glow, 0);
      }
      if (pl.dashT > 0) {
        Qb.push(QK.Streak, QM.Ground, ppx, 0.5, ppy, Math.atan2(pl.vy, pl.vx), 4, 1.2, C_PLAYER[0]! * 2, C_PLAYER[1]! * 2, C_PLAYER[2]! * 2, 0, 0.2, 0);
        for (let k = 0; k < 3; k++) P.emit(ppx + r.sym() * 0.4, 0.3 + r.float() * 0.8, ppy + r.sym() * 0.4, 0, 0, 0, 0.3, C_PLAYER[0]! * 3, C_PLAYER[1]! * 3, C_PLAYER[2]! * 3, 0.2, 1, 0, PS.Pixel, 0);
      }
      Qb.push(QK.Crosshair, QM.Ground, pl.ax, 0.08, pl.ay, 0, 1.3, 1.3, C_PLAYER[0]! * 1.5, C_PLAYER[1]! * 1.5, C_PLAYER[2]! * 1.5, 0, pl.firing ? 1 : 0, 0);
      // low HP heartbeat
      if (pl.hp < pl.maxHp * 0.3) {
        const beat = Math.pow(Math.max(0, Math.sin(time * 7)), 8);
        this.d.juice.damage = Math.max(this.d.juice.damage, 0.25 + beat * 0.3);
      }
    }

    // bullets
    const B = w.bullets;
    for (let i = 0; i < B.hi; i++) {
      if (!B.alive[i]) continue;
      const x = B.px[i]! + (B.x[i]! - B.px[i]!) * alpha;
      const y = B.py[i]! + (B.y[i]! - B.py[i]!) * alpha;
      const vx = B.vx[i]!;
      const vy = B.vy[i]!;
      const a = Math.atan2(vy, vx);
      const kind = B.kind[i]!;
      const crit = B.crit[i] === 1;
      switch (kind) {
        case BK.Pulse:
        case BK.Pellet: {
          const c = crit ? C_RARE[3] : C_PLAYER;
          const k = crit ? 3.5 : 2.6;
          const len = kind === BK.Pulse ? 1.25 : 0.85;
          Qb.push(QK.Capsule, QM.Ground, x, 0.7, y, a, len, crit ? 0.5 : 0.36, c[0]! * k, c[1]! * k, c[2]! * k, 0, 0, i);
          if ((i + w.tick) % 2 === 0) P.emit(x, 0.7, y, r.sym() * 0.3, r.sym() * 0.3, r.sym() * 0.3, 0.14, c[0]!, c[1]!, c[2]!, 0.14, 1, 0, PS.Glow, 0);
          break;
        }
        case BK.Needle:
          Qb.push(QK.Needle, QM.Ground, x, 0.7, y, a, 1.1, 0.16, 0.6, 3, 2.2, 0, 0, i);
          break;
        case BK.Grenade: {
          const p = B.age[i]! / Math.max(0.01, B.age[i]! + B.life[i]!);
          Qb.push(QK.Grenade, QM.Billboard, x, 0.55, y, 0, 0.75, 0.75, C_HAZ[0]! * 3, C_HAZ[1]! * 3, C_HAZ[2]! * 3, 1, p, i);
          L.add(x, y, 0.8, 4, C_HAZ[0]! * 2, C_HAZ[1]! * 2, C_HAZ[2]! * 2);
          if (r.chance(0.6)) P.emit(x, 0.55, y, 0, 0.6, 0, 0.5, 0.03, 0.03, 0.035, 0.35, 1, -0.5, PS.Smoke, 0.5);
          break;
        }
        case BK.Orb: {
          const R = B.aoe[i]!;
          const ramp = Math.min(1, B.age[i]! * 3);
          Qb.push(QK.Vortex, QM.Ground, x, 0.12, y, time * 2, R * 1.2 * ramp, R * 1.2 * ramp, C_ENERGY[0]! * 3, C_ENERGY[1]! * 3, C_ENERGY[2]! * 3, 1, 0, i);
          Qb.push(QK.Orb, QM.Billboard, x, 0.9, y, 0, 1.6, 1.6, 0.4, 0.15, 1.2, 0, 0, i);
          L.add(x, y, 1, 12, 3, 1.2, 6);
          for (let k = 0; k < 4; k++) {
            const pa = r.float() * TAU;
            const pr = R * (0.6 + r.float() * 0.4);
            P.emit(x + Math.cos(pa) * pr, 0.3 + r.float(), y + Math.sin(pa) * pr, -Math.cos(pa + 0.6) * pr * 2.5, 0, -Math.sin(pa + 0.6) * pr * 2.5, 0.35, C_ENERGY[0]! * 3, C_ENERGY[1]! * 3, C_ENERGY[2]! * 3, 0.1, 0.5, 0, PS.Spark, 0);
          }
          this.lensX = x;
          this.lensY = y;
          this.lensS = Math.max(this.lensS, ramp);
          break;
        }
        case BK.Bolt:
          Qb.push(QK.Capsule, QM.Ground, x, 0.8, y, a, 1.0, 0.46, C_ENEMY_B[0]! * 3, C_ENEMY_B[1]! * 3, C_ENEMY_B[2]! * 3, 0, 0, i);
          break;
        case BK.Arrow:
          Qb.push(QK.Arrow, QM.Ground, x, 1.2, y, a, 1.6, 0.42, C_ENEMY_B[0]! * 3, C_ENEMY_B[1]! * 3, C_ENEMY_B[2]! * 3, 0, 0, i);
          if ((i + w.tick) % 2 === 0) P.emit(x, 1.2, y, r.sym(), r.sym(), r.sym(), 0.3, 0.6, 2.2, 0.2, 0.1, 2, 0, PS.Glow, 0);
          break;
        case BK.BossOrb:
          Qb.push(QK.Orb, QM.Billboard, x, 1.1, y, 0, 1.15, 1.15, 2.2, 0.5, 3.2, 0, 0, i);
          break;
        case BK.Shard:
          Qb.push(QK.Shard, QM.Ground, x, 1, y, a, 0.75, 0.55, C_ENEMY_B[0]! * 3, C_ENEMY_B[1]! * 3, C_ENEMY_B[2]! * 3, 0, 0, i);
          break;
        default:
          Qb.push(QK.Orb, QM.Billboard, x, 0.9, y, 0, 0.8, 0.8, 3, 0.4, 1.5, 0, 0, i);
      }
    }
    if (this.lensS > 0) this.lensS = Math.max(0, this.lensS - dt * 2);

    // enemies: telegraphs, portals, state-transition fx
    const E = w.enemies;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) {
        this.prevSt[i] = 255;
        continue;
      }
      const st = E.st[i]!;
      if (this.prevGen[i] !== E.gen[i]) {
        this.prevGen[i] = E.gen[i]!;
        this.prevSt[i] = 255;
      }
      const prev = this.prevSt[i]!;
      this.prevSt[i] = st;
      const type = E.type[i]!;
      const def = enemyDef(type);
      const x = E.px[i]! + (E.x[i]! - E.px[i]!) * alpha;
      const y = E.py[i]! + (E.y[i]! - E.py[i]!) * alpha;
      const ch = E.charge[i]!;
      if (st === AS.Spawning) {
        const p = 1 - E.spawnT[i]! / def.spawnTime;
        Qb.push(QK.Portal, QM.Ground, x, 0.06, y, 0, def.r * 5, def.r * 5, C_ENEMY[0]! * 2.5, C_ENEMY[1]! * 2.5, C_ENEMY[2]! * 2.5, 1, p, E.seed[i]!);
        if (r.chance(0.5)) P.emit(x + r.sym() * def.r, 0.05, y + r.sym() * def.r, 0, r.range(2, 5), 0, 0.4, C_ENEMY[0]! * 3, C_ENEMY[1]! * 3, C_ENEMY[2]! * 3, 0.1, 0.5, 0, PS.Pixel, 0);
        continue;
      }
      // state transitions → audio cues & bursts
      if (st !== prev && prev !== 255 && st === AS.Windup) {
        if (type === ET.Archer) this.sfx('archer_charge', x, 0.5, 1, 0.1, 3);
        else if (type === ET.Gunner) this.sfx('gunner_charge', x, 0.35, 1, 0.06, 3);
        else if (type === ET.Charger) this.sfx('charger_roar', x, 0.4, 1.3, 0.1, 2);
      }
      if (st === AS.Windup) {
        if (type === ET.Archer) {
          const a = E.aim[i]!;
          const hx = x;
          const hy = y;
          const locked = E.stT[i]! > 1.15 * 0.75;
          const k = locked ? 3.2 : 1.6;
          Qb.push(QK.TeleLine, QM.Ground, hx + Math.cos(a) * 11.5, 0.07, hy + Math.sin(a) * 11.5, a, 22, locked ? 0.55 : 0.4, C_ENEMY[0]! * k, C_ENEMY[1]! * k, C_ENEMY[2]! * k, 0, ch, i);
          // converge: pollen + sap motes spiral into the bloom
          for (let k2 = 0; k2 < 2; k2++) {
            const pa = r.float() * TAU;
            const rr = 1.8 - ch;
            const tx = hx + Math.cos(pa) * rr;
            const ty = hy + Math.sin(pa) * rr;
            const life = 0.25;
            P.emit(tx, 1.9 + r.sym() * 0.6, ty, (hx - tx) / life, 0, (hy - ty) / life, life, 0.6 + ch * 2, 2.4, 0.2 + ch, 0.09 + ch * 0.06, 0.01, 0, PS.Glow, 0);
          }
          L.add(x, y, 1.9, 3 + ch * 4, 1.5 * ch, 3 * ch, 0.4 * ch);
          if (locked && r.chance(0.5)) P.emit(x + Math.cos(a), 1.9, y + Math.sin(a), Math.cos(a) * 6, 0, Math.sin(a) * 6, 0.15, 3, 0.3, 1.5, 0.1, 2, 0, PS.Spark, 0);
        } else if (type === ET.Gunner) {
          const a = E.face[i]!;
          Qb.push(QK.TeleLine, QM.Ground, x + Math.cos(a) * 3.5, 0.07, y + Math.sin(a) * 3.5, a, 6, 0.3, C_ENEMY[0]! * 2, C_ENEMY[1]! * 2, C_ENEMY[2]! * 2, 0, ch, i);
          L.add(x, y, 1, 3 + ch * 3, C_ENEMY[0]! * ch * 3, C_ENEMY[1]! * ch * 3, C_ENEMY[2]! * ch * 3);
          if (r.chance(0.6)) {
            const pa = r.float() * TAU;
            P.emit(x + Math.cos(a) * 0.6 + Math.cos(pa) * 0.8, 1, y + Math.sin(a) * 0.6 + Math.sin(pa) * 0.8, -Math.cos(pa) * 3, 0, -Math.sin(pa) * 3, 0.25, 3, 0.3, 1.5, 0.07, 0.5, 0, PS.Spark, 0);
          }
        } else if (type === ET.Charger) {
          const a = E.aim[i]!;
          Qb.push(QK.TeleLine, QM.Ground, x + Math.cos(a) * 7.5, 0.07, y + Math.sin(a) * 7.5, a, 14, def.r * 2.2, C_ENEMY[0]! * 2.2, C_ENEMY[1]! * 2.2, C_ENEMY[2]! * 2.2, 0, ch, i);
          if (r.chance(0.5)) P.emit(x - Math.cos(a) * 0.8 + r.sym() * 0.5, 0.1, y - Math.sin(a) * 0.8 + r.sym() * 0.5, -Math.cos(a) * 3 + r.sym(), 1, -Math.sin(a) * 3 + r.sym(), 0.6, 0.04, 0.03, 0.05, 0.5, 2, 0, PS.Smoke, 0.5);
          L.add(x, y, 1.5, 4 + ch * 4, 3 * ch, 0.2 * ch, 0.8 * ch);
        } else if (type === ET.Shielder) {
          const a = E.face[i]!;
          for (let k2 = -2; k2 <= 2; k2++) {
            const aa = a + k2 * 0.175;
            Qb.push(QK.TeleLine, QM.Ground, x + Math.cos(aa) * 4, 0.07, y + Math.sin(aa) * 4, aa, 7, 0.18, C_ENEMY[0]! * 1.5, C_ENEMY[1]! * 1.5, C_ENEMY[2]! * 1.5, 0, ch, i + k2);
          }
        } else if (type === ET.Swarmer) {
          if (r.chance(0.4)) P.emit(x, 0.5, y, r.sym() * 2, 1, r.sym() * 2, 0.2, 3, 0.2, 0.3, 0.08, 1, 0, PS.Spark, 0);
        }
      } else if (st === AS.Dash && type === ET.Charger) {
        const a = E.aim[i]!;
        Qb.push(QK.Streak, QM.Ground, x - Math.cos(a) * 1.5, 0.8, y - Math.sin(a) * 1.5, a, 5, 2, C_ENEMY[0]! * 2, C_ENEMY[1]! * 2, C_ENEMY[2]! * 2, 0, 0.3, 0);
        if (r.chance(0.8)) P.emit(x + r.sym(), 0.1, y + r.sym(), r.sym() * 3, 1.5, r.sym() * 3, 0.7, 0.05, 0.04, 0.06, 0.7, 2, 0, PS.Smoke, 0.6);
      } else if (st === AS.Stunned && type === ET.Charger) {
        if (r.chance(0.3)) {
          const pa = time * 6 + r.float();
          P.emit(x + Math.cos(pa) * 0.8, 2, y + Math.sin(pa) * 0.8, 0, 0.5, 0, 0.4, 3, 2.5, 0.5, 0.12, 1, 0, PS.Pixel, 0);
        }
      }
      // elite aura motes
      if (E.affix[i] && r.chance(0.25)) P.emit(x + r.sym() * def.r, 0.2, y + r.sym() * def.r, 0, r.range(1, 3), 0, 0.6, 1.5, 2.2, 0.3, 0.1, 1, 0, PS.Ember, 0);
      // heavily wounded flesh drips
      if ((def.material === Mat.Flesh || def.material === Mat.Plant) && E.hp[i]! < E.maxHp[i]! * 0.4 && r.chance(0.08)) {
        const g = GORE[def.material]!;
        P.emit(x + r.sym() * 0.4, def.height * 0.6, y + r.sym() * 0.4, 0, 0, 0, 0.8, g.drop[0], g.drop[1], g.drop[2], 0.12, 1, 20, PS.Blood, g.dropAlpha);
        if (r.chance(0.3)) this.pendingDecal(x, y, 0.3, 0.3, def.material);
      }
      if (type === ET.Boss) {
        L.add(x, y, 4, 16, C_ENERGY[0]! * 3, C_ENERGY[1]! * 3, C_ENERGY[2]! * 3);
        if (r.chance(0.5)) {
          const pa = r.float() * TAU;
          P.emit(x + Math.cos(pa) * 3, r.range(0.5, 5), y + Math.sin(pa) * 3, Math.cos(pa) * 0.5, r.range(0.5, 2), Math.sin(pa) * 0.5, 1.2, C_ENERGY[0]! * 3, C_ENERGY[1]! * 3, C_ENERGY[2]! * 3, 0.15, 0.5, 0, PS.Pixel, 0);
        }
      }
    }

    // boss lasers
    const LS = w.lasers;
    for (let k = 0; k < MAX_LASERS; k++) {
      if (!LS.alive[k]) continue;
      const a = LS.angP[k]! + (LS.ang[k]! - LS.angP[k]!) * alpha;
      const ox = LS.x[k]!;
      const oy = LS.y[k]!;
      // clip to arena
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let tMax = LS.len[k]!;
      if (dx > 0) tMax = Math.min(tMax, (ARENA_HW - ox) / dx);
      if (dx < 0) tMax = Math.min(tMax, (-ARENA_HW - ox) / dx);
      if (dy > 0) tMax = Math.min(tMax, (ARENA_HH - oy) / dy);
      if (dy < 0) tMax = Math.min(tMax, (-ARENA_HH - oy) / dy);
      const s0 = 2.2;
      const len = tMax - s0;
      const cx = ox + dx * (s0 + len / 2);
      const cy = oy + dy * (s0 + len / 2);
      if (LS.warm[k]! > 0) {
        const p = 1 - LS.warm[k]! / LS.warmMax[k]!;
        const flick = Math.floor(time * 20) % 2 ? 1 : 0.5;
        Qb.push(QK.TeleLine, QM.Ground, cx, 0.08, cy, a, len, 1.3, C_ENEMY[0]! * 2 * flick, C_ENEMY[1]! * 2 * flick, C_ENEMY[2]! * 2 * flick, 0, p, k);
      } else {
        Qb.push(QK.Laser, QM.Ground, cx, 1.6, cy, a, len, 1.9, 2.2, 0.35, 3.2, 0, 0, k);
        Qb.push(QK.Laser, QM.Ground, cx, 0.06, cy, a, len, 3.2, 0.8, 0.1, 1.2, 0, 0, k + 7);
        const ex = ox + dx * tMax;
        const ey = oy + dy * tMax;
        this.burst(3, ex, 1, ey, a + Math.PI, 2, 6, 14, 5, 0.3, K17, 1, 0.1, 2, 20, PS.Spark, 0);
        L.add(ex, ey, 1, 6, 6, 1, 6);
        L.add(cx, cy, 1.5, len * 0.5, 2, 0.3, 2.5);
        if (r.chance(0.3)) this.d.floor.decals.add(ex - dx * 0.5, ey - dy * 0.5, 0.8, r.float() * TAU, 0.01, 0.0, 0.02, 0.6, 1, r.float() * 100);
        this.d.juice.addTrauma(dt * 0.6);
        if (w.tick % 30 === 0) this.sfx('laser_fire', cx, 0.4, 1, 0.4, 2);
      }
    }

    // gravity wells
    const W = w.wells;
    const wellU = this.d.floor.material.uniforms['uWells']!.value as { set(a: number, b: number, c: number, d: number): void }[];
    for (let k = 0; k < 4; k++) {
      if (k < W.count) {
        const s = W.strength[k]!;
        wellU[k]!.set(W.x[k]!, W.y[k]!, W.radius[k]!, s);
        Qb.push(QK.Vortex, QM.Ground, W.x[k]!, 0.09, W.y[k]!, -time * 1.5, W.radius[k]! * 0.55 * s, W.radius[k]! * 0.55 * s, C_ENERGY[0]! * 1.2, C_ENERGY[1]! * 1.2, C_ENERGY[2]! * 1.2, 0.8, 0, k);
        L.add(W.x[k]!, W.y[k]!, 0.5, W.radius[k]!, C_ENERGY[0]! * 2, C_ENERGY[1]! * 2, C_ENERGY[2]! * 2);
        if (r.chance(0.6)) {
          const pa = r.float() * TAU;
          const pr = W.radius[k]! * 0.9;
          P.emit(W.x[k]! + Math.cos(pa) * pr, 0.2, W.y[k]! + Math.sin(pa) * pr, -Math.cos(pa + 1) * pr, 0.3, -Math.sin(pa + 1) * pr, 1, C_ENERGY[0]! * 2, C_ENERGY[1]! * 2, C_ENERGY[2]! * 2, 0.1, 0.8, 0, PS.Glow, 0);
        }
      } else wellU[k]!.set(0, 0, 0, 0);
    }
    // wind streaks (drift mutator)
    const wind = Math.sqrt(w.phys.windX * w.phys.windX + w.phys.windY * w.phys.windY);
    if (wind > 0.5) {
      for (let k = 0; k < 3; k++) {
        const sx = this.d.camera.fx + r.sym() * 24;
        const sy = this.d.camera.fy + r.sym() * 16;
        P.emit(sx, 0.3 + r.float() * 2, sy, w.phys.windX * 2.5, 0, w.phys.windY * 2.5, 0.8, 0.5, 1.4, 0.3, 0.12, 0.2, 0, PS.Spark, 0);
      }
    }

    // pickups
    const PK = w.pickups;
    for (let i = 0; i < PK.hi; i++) {
      if (!PK.alive[i]) continue;
      const x = PK.px[i]! + (PK.x[i]! - PK.px[i]!) * alpha;
      const y = PK.py[i]! + (PK.y[i]! - PK.py[i]!) * alpha;
      const blink = PK.life[i]! < 3 && Math.floor(time * 10) % 2 === 0 ? 0.3 : 1;
      Qb.push(QK.Pickup, QM.Billboard, x, 0.6 + Math.sin(time * 4 + i) * 0.12, y, 0, 0.9, 0.9, C_PICK[0]! * 3 * blink, C_PICK[1]! * 3 * blink, C_PICK[2]! * 3 * blink, 0, 0, i);
      L.add(x, y, 0.8, 3.5, C_PICK[0]! * 1.5, C_PICK[1]! * 1.5, C_PICK[2]! * 1.5);
    }
    L.endFrame();
    Qb.end(time);
  }

  get now(): number {
    return this.time;
  }
}
