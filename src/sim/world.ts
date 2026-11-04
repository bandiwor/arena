import { Rng } from '../core/rng';
import { EventQueue } from '../core/events';
import { SpatialGrid } from '../core/spatial';
import {
  ARENA_H,
  ARENA_HH,
  ARENA_HW,
  ARENA_W,
  MAX_BULLETS,
  MAX_ENEMIES,
  MAX_LASERS,
  MAX_PICKUPS,
  MAX_PILLARS,
  MAX_WELLS,
  WEAPON_COUNT,
} from './constants';
import { difficulty, type DifficultyDef } from './content/difficulty';

/** Fixed-capacity free list of slot indices; deterministic (LIFO). */
export class FreeList {
  private readonly stack: Int32Array;
  private top: number;
  constructor(readonly capacity: number) {
    this.stack = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) this.stack[i] = capacity - 1 - i;
    this.top = capacity;
  }
  alloc(): number {
    if (this.top === 0) return -1;
    return this.stack[--this.top]!;
  }
  free(i: number): void {
    this.stack[this.top++] = i;
  }
  get used(): number {
    return this.capacity - this.top;
  }
}

export class EnemyStore {
  readonly cap = MAX_ENEMIES;
  readonly free = new FreeList(MAX_ENEMIES);
  hi = 0; // max index ever used + 1
  count = 0;
  readonly alive = new Uint8Array(MAX_ENEMIES);
  readonly type = new Uint8Array(MAX_ENEMIES);
  readonly st = new Uint8Array(MAX_ENEMIES);
  readonly token = new Uint8Array(MAX_ENEMIES);
  readonly affix = new Uint8Array(MAX_ENEMIES);
  readonly gen = new Uint16Array(MAX_ENEMIES);
  readonly x = new Float32Array(MAX_ENEMIES);
  readonly y = new Float32Array(MAX_ENEMIES);
  readonly px = new Float32Array(MAX_ENEMIES);
  readonly py = new Float32Array(MAX_ENEMIES);
  readonly vx = new Float32Array(MAX_ENEMIES);
  readonly vy = new Float32Array(MAX_ENEMIES);
  readonly kx = new Float32Array(MAX_ENEMIES);
  readonly ky = new Float32Array(MAX_ENEMIES);
  readonly hp = new Float32Array(MAX_ENEMIES);
  readonly maxHp = new Float32Array(MAX_ENEMIES);
  readonly r = new Float32Array(MAX_ENEMIES);
  readonly face = new Float32Array(MAX_ENEMIES);
  readonly faceP = new Float32Array(MAX_ENEMIES);
  readonly spawnT = new Float32Array(MAX_ENEMIES);
  readonly stT = new Float32Array(MAX_ENEMIES);
  readonly cd = new Float32Array(MAX_ENEMIES);
  readonly think = new Float32Array(MAX_ENEMIES);
  readonly aim = new Float32Array(MAX_ENEMIES);
  readonly charge = new Float32Array(MAX_ENEMIES);
  readonly flash = new Float32Array(MAX_ENEMIES);
  readonly walk = new Float32Array(MAX_ENEMIES);
  readonly seed = new Float32Array(MAX_ENEMIES);
  readonly tx = new Float32Array(MAX_ENEMIES);
  readonly ty = new Float32Array(MAX_ENEMIES);
  readonly speedMul = new Float32Array(MAX_ENEMIES);
  readonly dmgTaken = new Float32Array(MAX_ENEMIES);
  readonly burst = new Uint8Array(MAX_ENEMIES);
  /** generic per-archetype scratch (dodge cooldown, strafe dir, ...) */
  readonly aux = new Float32Array(MAX_ENEMIES);
  readonly aux2 = new Float32Array(MAX_ENEMIES);
  /** last utility scores, 6 per enemy (debug + inspector) */
  readonly util = new Float32Array(MAX_ENEMIES * 6);
  /** packed list of alive ids, rebuilt by rebuildActive() */
  readonly active = new Int32Array(MAX_ENEMIES);
  activeCount = 0;

  rebuildActive(): void {
    let n = 0;
    for (let i = 0; i < this.hi; i++) if (this.alive[i]) this.active[n++] = i;
    this.activeCount = n;
  }
}

export class BulletStore {
  readonly cap = MAX_BULLETS;
  readonly free = new FreeList(MAX_BULLETS);
  hi = 0;
  count = 0;
  readonly alive = new Uint8Array(MAX_BULLETS);
  readonly team = new Uint8Array(MAX_BULLETS);
  readonly kind = new Uint8Array(MAX_BULLETS);
  readonly weapon = new Uint8Array(MAX_BULLETS);
  readonly rarity = new Uint8Array(MAX_BULLETS);
  readonly pierce = new Uint8Array(MAX_BULLETS);
  readonly bounce = new Uint8Array(MAX_BULLETS);
  readonly lastHit = new Int16Array(MAX_BULLETS);
  readonly x = new Float32Array(MAX_BULLETS);
  readonly y = new Float32Array(MAX_BULLETS);
  readonly px = new Float32Array(MAX_BULLETS);
  readonly py = new Float32Array(MAX_BULLETS);
  readonly vx = new Float32Array(MAX_BULLETS);
  readonly vy = new Float32Array(MAX_BULLETS);
  readonly life = new Float32Array(MAX_BULLETS);
  readonly age = new Float32Array(MAX_BULLETS);
  readonly dmg = new Float32Array(MAX_BULLETS);
  readonly r = new Float32Array(MAX_BULLETS);
  readonly knock = new Float32Array(MAX_BULLETS);
  readonly aoe = new Float32Array(MAX_BULLETS);
  readonly crit = new Uint8Array(MAX_BULLETS);
  /** cosmetic launch height (muzzle), renderer eases toward cruise height */
  readonly h0 = new Float32Array(MAX_BULLETS);
}

export class PickupStore {
  readonly cap = MAX_PICKUPS;
  readonly free = new FreeList(MAX_PICKUPS);
  hi = 0;
  readonly alive = new Uint8Array(MAX_PICKUPS);
  readonly kind = new Uint8Array(MAX_PICKUPS);
  readonly x = new Float32Array(MAX_PICKUPS);
  readonly y = new Float32Array(MAX_PICKUPS);
  readonly px = new Float32Array(MAX_PICKUPS);
  readonly py = new Float32Array(MAX_PICKUPS);
  readonly vx = new Float32Array(MAX_PICKUPS);
  readonly vy = new Float32Array(MAX_PICKUPS);
  readonly life = new Float32Array(MAX_PICKUPS);
  readonly value = new Float32Array(MAX_PICKUPS);
}

/** Rotating damage beams (boss lasers). */
export class LaserStore {
  readonly alive = new Uint8Array(MAX_LASERS);
  readonly x = new Float32Array(MAX_LASERS);
  readonly y = new Float32Array(MAX_LASERS);
  readonly ang = new Float32Array(MAX_LASERS);
  readonly angP = new Float32Array(MAX_LASERS);
  readonly angVel = new Float32Array(MAX_LASERS);
  readonly len = new Float32Array(MAX_LASERS);
  readonly width = new Float32Array(MAX_LASERS);
  readonly warm = new Float32Array(MAX_LASERS);
  readonly warmMax = new Float32Array(MAX_LASERS);
  readonly life = new Float32Array(MAX_LASERS);
  readonly dmg = new Float32Array(MAX_LASERS);
}

/** Gravity wells (mutator), bend projectiles. */
export class WellStore {
  count = 0;
  readonly x = new Float32Array(MAX_WELLS);
  readonly y = new Float32Array(MAX_WELLS);
  readonly vx = new Float32Array(MAX_WELLS);
  readonly vy = new Float32Array(MAX_WELLS);
  readonly strength = new Float32Array(MAX_WELLS);
  readonly radius = new Float32Array(MAX_WELLS);
}

export class Pillars {
  count = 0;
  readonly x = new Float32Array(MAX_PILLARS);
  readonly y = new Float32Array(MAX_PILLARS);
  readonly r = new Float32Array(MAX_PILLARS);
  add(x: number, y: number, r: number): void {
    if (this.count >= MAX_PILLARS) return;
    this.x[this.count] = x;
    this.y[this.count] = y;
    this.r[this.count] = r;
    this.count++;
  }
}

/**
 * Global, mutable "physics of the arena". Mutators push targets; current values ease toward them.
 * Everything that can be bent by arena events lives here.
 */
export interface Phys {
  playerBulletSpeed: number;
  enemyBulletSpeed: number;
  /** ground friction for player/enemies (1/s). Low = ice. */
  friction: number;
  enemySpeed: number;
  playerSpeed: number;
  windX: number;
  windY: number;
  /** extra wall bounces granted to all projectiles */
  wallBounce: number;
  /** 0..1, how strongly wind pushes walkers (bullets always fully) */
  windWalkers: number;
  /** projectile lifetime multiplier */
  bulletLife: number;
}

export function defaultPhys(): Phys {
  return {
    playerBulletSpeed: 1,
    enemyBulletSpeed: 1,
    friction: 14,
    enemySpeed: 1,
    playerSpeed: 1,
    windX: 0,
    windY: 0,
    wallBounce: 0,
    windWalkers: 0,
    bulletLife: 1,
  };
}

export interface PlayerStats {
  dmgMul: number;
  rateMul: number;
  speedMul: number;
  projAdd: number;
  pierceAdd: number;
  bounceAdd: number;
  crit: number;
  bulletSpeedMul: number;
  dashCdMul: number;
  lifesteal: number;
  dashShock: number;
}

export interface Player {
  alive: boolean;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  face: number;
  faceP: number;
  ax: number;
  ay: number;
  r: number;
  hp: number;
  maxHp: number;
  inv: number;
  hurtT: number;
  dashT: number;
  dashCd: number;
  dashX: number;
  dashY: number;
  fireCd: number;
  firing: boolean;
  shotCount: number;
  slots: Int8Array;
  slotCount: number;
  cur: number;
  stats: PlayerStats;
  /** visual recoil impulse 0..1 */
  recoil: number;
  walk: number;
}

export const WavePhase = {
  Intro: 0,
  Fight: 1,
  Clear: 2,
  Upgrade: 3,
  Victory: 4,
  Dead: 5,
  Sandbox: 6,
} as const;

export interface WaveState {
  index: number;
  phase: number;
  t: number;
  /** per-group spawned count */
  spawned: Int32Array;
  groupNext: Float32Array;
  pendingSpawns: number;
  totalThisWave: number;
  killedThisWave: number;
  offer: Int16Array;
  offerCount: number;
  mutator: number;
}

export interface Director {
  tension: number;
  adapt: number;
  dmgRecent: number;
  tokensMax: number;
  tokensUsed: number;
  killsRecent: number;
}

export interface BossState {
  id: number; // enemy slot or -1
  phase: number;
  t: number;
  patternT: number;
  pattern: number;
  spin: number;
  summonT: number;
  slamT: number;
  slamX: number;
  slamY: number;
  laserT: number;
  teleportT: number;
  dying: number;
  /** 0..1 corruption level the renderer uses for glitch/arena */
  corruption: number;
}

export interface Stats {
  kills: number;
  dmgDealt: number;
  dmgTaken: number;
  shots: number;
  score: number;
  ticks: number;
  upgrades: number;
}

export interface FlowField {
  cols: number;
  rows: number;
  cell: number;
  blocked: Uint8Array;
  dist: Uint16Array;
  dirX: Float32Array;
  dirY: Float32Array;
  queue: Int32Array;
  targetCell: number;
}

export type WorldMode = 'campaign' | 'sandbox';

export interface WorldOptions {
  seed: number;
  difficulty: number;
  mode?: WorldMode;
  startWave?: number;
}

export class World {
  readonly seed: number;
  readonly diff: DifficultyDef;
  readonly mode: WorldMode;
  readonly rng: Rng;
  readonly events = new EventQueue(2048);
  readonly enemies = new EnemyStore();
  readonly bullets = new BulletStore();
  readonly pickups = new PickupStore();
  readonly lasers = new LaserStore();
  readonly wells = new WellStore();
  readonly pillars = new Pillars();
  readonly grid = new SpatialGrid(-ARENA_HW - 2, -ARENA_HH - 2, ARENA_W + 4, ARENA_H + 4, 2, MAX_ENEMIES);
  /** scratch for spatial queries */
  readonly qbuf = new Int32Array(256);
  readonly qbuf2 = new Int32Array(256);
  tick = 0;
  time = 0;
  phys: Phys = defaultPhys();
  physTarget: Phys = defaultPhys();
  /** active mutator ids bitmask */
  mutators = 0;
  mutatorT = new Float32Array(16);
  player: Player;
  wave: WaveState;
  director: Director;
  boss: BossState;
  stats: Stats;
  flow: FlowField;
  /** debug flags (never affect determinism unless used on purpose in scenarios) */
  god = false;
  noAI = false;

  constructor(opts: WorldOptions) {
    this.seed = opts.seed >>> 0;
    this.diff = difficulty(opts.difficulty);
    this.mode = opts.mode ?? 'campaign';
    this.rng = new Rng(this.seed);
    this.player = {
      alive: true,
      x: 0,
      y: 6,
      px: 0,
      py: 6,
      vx: 0,
      vy: 0,
      face: -Math.PI / 2,
      faceP: -Math.PI / 2,
      ax: 0,
      ay: 0,
      r: 0.5,
      hp: this.diff.playerHp,
      maxHp: this.diff.playerHp,
      inv: 0,
      hurtT: 0,
      dashT: 0,
      dashCd: 0,
      dashX: 0,
      dashY: 0,
      fireCd: 0,
      firing: false,
      shotCount: 0,
      slots: new Int8Array(WEAPON_COUNT).fill(-1),
      slotCount: 1,
      cur: 0,
      stats: {
        dmgMul: 1,
        rateMul: 1,
        speedMul: 1,
        projAdd: 0,
        pierceAdd: 0,
        bounceAdd: 0,
        crit: 0.04,
        bulletSpeedMul: 1,
        dashCdMul: 1,
        lifesteal: 0,
        dashShock: 0,
      },
      recoil: 0,
      walk: 0,
    };
    this.player.slots[0] = 0;
    this.wave = {
      index: (opts.startWave ?? 1) - 1,
      phase: this.mode === 'sandbox' ? WavePhase.Sandbox : WavePhase.Intro,
      t: 0,
      spawned: new Int32Array(16),
      groupNext: new Float32Array(16),
      pendingSpawns: 0,
      totalThisWave: 0,
      killedThisWave: 0,
      offer: new Int16Array(3),
      offerCount: 0,
      mutator: -1,
    };
    this.director = { tension: 0, adapt: 0, dmgRecent: 0, tokensMax: this.diff.tokens, tokensUsed: 0, killsRecent: 0 };
    this.boss = {
      id: -1,
      phase: 0,
      t: 0,
      patternT: 0,
      pattern: 0,
      spin: 0,
      summonT: 0,
      slamT: 0,
      slamX: 0,
      slamY: 0,
      laserT: 0,
      teleportT: 0,
      dying: 0,
      corruption: 0,
    };
    this.stats = { kills: 0, dmgDealt: 0, dmgTaken: 0, shots: 0, score: 0, ticks: 0, upgrades: 0 };
    const cell = 1;
    const cols = Math.ceil(ARENA_W / cell);
    const rows = Math.ceil(ARENA_H / cell);
    this.flow = {
      cols,
      rows,
      cell,
      blocked: new Uint8Array(cols * rows),
      dist: new Uint16Array(cols * rows),
      dirX: new Float32Array(cols * rows),
      dirY: new Float32Array(cols * rows),
      queue: new Int32Array(cols * rows),
      targetCell: -1,
    };
    buildArenaLayout(this);
  }
}

/** Default arena: symmetric pillars give cover and break lines of sight. */
export function buildArenaLayout(w: World): void {
  const P = w.pillars;
  P.count = 0;
  P.add(-14, -8, 1.6);
  P.add(14, -8, 1.6);
  P.add(-14, 8, 1.6);
  P.add(14, 8, 1.6);
  P.add(0, -15, 1.2);
  P.add(0, 15, 1.2);
  P.add(-26, 0, 1.3);
  P.add(26, 0, 1.3);
  const F = w.flow;
  F.blocked.fill(0);
  for (let cy = 0; cy < F.rows; cy++) {
    for (let cx = 0; cx < F.cols; cx++) {
      const wx = -ARENA_HW + (cx + 0.5) * F.cell;
      const wy = -ARENA_HH + (cy + 0.5) * F.cell;
      for (let p = 0; p < P.count; p++) {
        const dx = wx - P.x[p]!;
        const dy = wy - P.y[p]!;
        const rr = P.r[p]! + 0.6;
        if (dx * dx + dy * dy < rr * rr) F.blocked[cy * F.cols + cx] = 1;
      }
    }
  }
  F.targetCell = -1;
}
