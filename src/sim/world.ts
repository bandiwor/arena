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
  MAX_POOLS,
  MAX_LANES,
  MAX_PADS,
  MAX_PYLONS,
  MAX_MARKS,
  MAX_TRACKS,
  MAX_WELLS,
  WEAPON_COUNT,
} from './constants';
import { difficulty, type DifficultyDef } from './content/difficulty';
import { WAVES } from './content/waves';

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
  /** >0 while a parasite feeds this enemy (decays each tick) */
  readonly buff = new Uint8Array(MAX_ENEMIES);
  /** parasite fullness 0..1 (fed on blood → swollen; shrinks while sated) */
  readonly fed = new Float32Array(MAX_ENEMIES);
  /** Призма shield: >0 durability left; <0 = broken, counts up to 0 (seconds until it reforms) */
  readonly shield = new Float32Array(MAX_ENEMIES);
  /** >0: shorted by electricity (machines stunned, others can't attack) */
  readonly shortT = new Float32Array(MAX_ENEMIES);
  /** >0: hastened by an Overseer */
  readonly haste = new Float32Array(MAX_ENEMIES);
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
  /** magnetic rounds: locked target (−1 none) */
  readonly homing = new Int16Array(MAX_BULLETS);
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
  /** enemy slot the beam is attached to (−1 = static beam, e.g. ASSEMBLER weld) */
  readonly owner = new Int16Array(MAX_LASERS);
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

/** Flesh pools (Act II): slow the player down, natives move freely. */
export class Pools {
  count = 0;
  readonly x = new Float32Array(MAX_POOLS);
  readonly y = new Float32Array(MAX_POOLS);
  readonly r = new Float32Array(MAX_POOLS);
  /** seconds left (−1 = permanent) — flood mutator pools evaporate */
  readonly life = new Float32Array(MAX_POOLS);
  /** >0: electrified by a pylon discharge (seconds left) — hurts and shorts whatever stands in it */
  readonly live = new Float32Array(MAX_POOLS);
  add(x: number, y: number, r: number, life = -1): void {
    if (this.count >= MAX_POOLS) return;
    this.x[this.count] = x;
    this.y[this.count] = y;
    this.r[this.count] = r;
    this.life[this.count] = life;
    this.live[this.count] = 0;
    this.count++;
  }
  remove(k: number): void {
    const n = --this.count;
    this.x[k] = this.x[n]!;
    this.y[k] = this.y[n]!;
    this.r[k] = this.r[n]!;
    this.life[k] = this.life[n]!;
    this.live[k] = this.live[n]!;
  }
  /** index of a pool containing (x, y), or −1 */
  at(x: number, y: number): number {
    for (let k = 0; k < this.count; k++) {
      const dx = x - this.x[k]!;
      const dy = y - this.y[k]!;
      if (dx * dx + dy * dy < this.r[k]! * this.r[k]!) return k;
    }
    return -1;
  }
}

/** Foundry conveyor lanes: axis-aligned rects that carry ground entities and reverse on a cycle. */
export class Lanes {
  count = 0;
  readonly cx = new Float32Array(MAX_LANES);
  readonly cy = new Float32Array(MAX_LANES);
  readonly hw = new Float32Array(MAX_LANES);
  readonly hh = new Float32Array(MAX_LANES);
  readonly dx = new Float32Array(MAX_LANES);
  readonly dy = new Float32Array(MAX_LANES);
  /** time inside the current cycle */
  readonly t = new Float32Array(MAX_LANES);
  /** >0: reversal suspended (Overseer death, PRESS defeat) */
  readonly frozen = new Float32Array(MAX_LANES);
  /** >0: forced inward push toward the arena centre (ASSEMBLER CONVEYOR) */
  readonly inward = new Float32Array(MAX_LANES);
  add(cx: number, cy: number, hw: number, hh: number, dx: number, dy: number, t0: number): void {
    if (this.count >= MAX_LANES) return;
    const k = this.count++;
    this.cx[k] = cx;
    this.cy[k] = cy;
    this.hw[k] = hw;
    this.hh[k] = hh;
    this.dx[k] = dx;
    this.dy[k] = dy;
    this.t[k] = t0;
    this.frozen[k] = 0;
    this.inward[k] = 0;
  }
  at(x: number, y: number): number {
    for (let k = 0; k < this.count; k++) if (Math.abs(x - this.cx[k]!) < this.hw[k]! && Math.abs(y - this.cy[k]!) < this.hh[k]!) return k;
    return -1;
  }
}

/** Hydraulic stamp pads (2×2), paired with phase offsets. */
export class Pads {
  count = 0;
  readonly x = new Float32Array(MAX_PADS);
  readonly y = new Float32Array(MAX_PADS);
  readonly offset = new Float32Array(MAX_PADS);
  add(x: number, y: number, offset: number): void {
    if (this.count >= MAX_PADS) return;
    this.x[this.count] = x;
    this.y[this.count] = y;
    this.offset[this.count] = offset;
    this.count++;
  }
}

/** Arc pylons (also registered as pillars for collision). charge > 0 while building up. */
/**
 * Arc pylons (also registered as pillars for collision): accumulators. Player shots fill `charge`
 * (0..1, leaks slowly); full → `state` 1 overload (telegraph, `timer` counts down) → discharge →
 * `state` 2 cooldown (`timer` counts down) → back to 0.
 */
export class Pylons {
  count = 0;
  readonly pillar = new Int8Array(MAX_PYLONS);
  readonly charge = new Float32Array(MAX_PYLONS);
  readonly state = new Uint8Array(MAX_PYLONS);
  readonly timer = new Float32Array(MAX_PYLONS);
}

/** Telegraphed impact zones (stamper marks, PRESS stamps): fill, then hot for a moment. */
export class Marks {
  readonly alive = new Uint8Array(MAX_MARKS);
  readonly x = new Float32Array(MAX_MARKS);
  readonly y = new Float32Array(MAX_MARKS);
  readonly r = new Float32Array(MAX_MARKS);
  /** square marks use r as half-size */
  readonly square = new Uint8Array(MAX_MARKS);
  readonly t = new Float32Array(MAX_MARKS);
  readonly fill = new Float32Array(MAX_MARKS);
  readonly hot = new Float32Array(MAX_MARKS);
  readonly dmg = new Float32Array(MAX_MARKS);
  readonly src = new Uint8Array(MAX_MARKS);
  /** enemy index that placed it (-1 = none): the render draws an aim beam from it while filling */
  readonly own = new Int16Array(MAX_MARKS).fill(-1);
  hi = 0;
  add(x: number, y: number, r: number, fill: number, hot: number, dmg: number, src: number, square = false): number {
    for (let i = 0; i < MAX_MARKS; i++) {
      if (this.alive[i]) continue;
      this.alive[i] = 1;
      this.x[i] = x;
      this.y[i] = y;
      this.r[i] = r;
      this.square[i] = square ? 1 : 0;
      this.own[i] = -1;
      this.t[i] = 0;
      this.fill[i] = fill;
      this.hot[i] = hot;
      this.dmg[i] = dmg;
      this.src[i] = src;
      if (i + 1 > this.hi) this.hi = i + 1;
      return i;
    }
    return -1;
  }
  inside(i: number, x: number, y: number, pad = 0): boolean {
    const dx = x - this.x[i]!;
    const dy = y - this.y[i]!;
    const r = this.r[i]! + pad;
    return this.square[i] ? Math.abs(dx) < r && Math.abs(dy) < r : dx * dx + dy * dy < r * r;
  }
}

/** Saw tracks: short segments that heat up, then burn for a while (ring buffer). */
export class Tracks {
  readonly alive = new Uint8Array(MAX_TRACKS);
  readonly x0 = new Float32Array(MAX_TRACKS);
  readonly y0 = new Float32Array(MAX_TRACKS);
  readonly x1 = new Float32Array(MAX_TRACKS);
  readonly y1 = new Float32Array(MAX_TRACKS);
  readonly age = new Float32Array(MAX_TRACKS);
  cursor = 0;
  add(x0: number, y0: number, x1: number, y1: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % MAX_TRACKS;
    this.alive[i] = 1;
    this.x0[i] = x0;
    this.y0[i] = y0;
    this.x1[i] = x1;
    this.y1[i] = y1;
    this.age[i] = 0;
  }
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
  /** Foundry: conveyor reversal period, seconds */
  lanePeriod: number;
  /** Foundry mutators (discrete switches) */
  magnetic: number;
  lockstep: number;
  flood: number;
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
    lanePeriod: 12,
    magnetic: 0,
    lockstep: 0,
    flood: 0,
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
  /** insulated plating: immune to arcs */
  insulated: number;
  /** extra arc chain targets */
  arcChain: number;
  /** machine kills burst into rivet shrapnel */
  shrapnel: number;
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
  /** being reeled in by a Clamp Hauler */
  pullT: number;
  pullBy: number;
  pullGen: number;
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
  /** between acts: decompile old sector, synthesise the next one */
  Transition: 7,
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
  /** damage taken per source (balance diagnostics) */
  dmgBy: Float32Array;
}

export interface FlowField {
  cols: number;
  rows: number;
  cell: number;
  blocked: Uint8Array;
  dist: Uint16Array;
  /** per-cell direction, computed lazily: valid where dirVer[c] === ver */
  dirX: Float32Array;
  dirY: Float32Array;
  dirVer: Uint32Array;
  /** bumps on every BFS (and when obstacles change) */
  ver: number;
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
  readonly pools = new Pools();
  readonly lanes = new Lanes();
  readonly pads = new Pads();
  readonly pylons = new Pylons();
  readonly marks = new Marks();
  readonly tracks = new Tracks();
  /** flood mutator clock */
  floodT = 0;
  /** current act (0 = Карантин, 1 = Плоть) */
  act = 0;
  /** active mini-boss slot (Матка), -1 if none */
  miniBoss = -1;
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
        insulated: 0,
        arcChain: 0,
        shrapnel: 0,
      },
      recoil: 0,
      walk: 0,
      pullT: 0,
      pullBy: -1,
      pullGen: 0,
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
    this.stats = { kills: 0, dmgDealt: 0, dmgTaken: 0, shots: 0, score: 0, ticks: 0, upgrades: 0, dmgBy: new Float32Array(48) };
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
      dirVer: new Uint32Array(cols * rows),
      ver: 1,
      queue: new Int32Array(cols * rows),
      targetCell: -1,
    };
    const sw = WAVES[this.wave.index];
    this.act = sw?.act ?? 0;
    buildArenaLayout(this);
  }
}

/** Default arena: symmetric pillars give cover and break lines of sight. */
export function buildArenaLayout(w: World): void {
  const P = w.pillars;
  P.count = 0;
  w.pools.count = 0;
  w.lanes.count = 0;
  w.pads.count = 0;
  w.pylons.count = 0;
  w.marks.alive.fill(0);
  w.tracks.alive.fill(0);
  if (w.act === 0) {
    P.add(-14, -8, 1.6);
    P.add(14, -8, 1.6);
    P.add(-14, 8, 1.6);
    P.add(14, 8, 1.6);
    P.add(0, -15, 1.2);
    P.add(0, 15, 1.2);
    P.add(-26, 0, 1.3);
    P.add(26, 0, 1.3);
  } else if (w.act === 2) {
    // Литейный цех: machine blocks, two arc pylons, four conveyor lanes, stamp pad pairs, coolant
    P.add(-16, -12, 1.5);
    P.add(16, 12, 1.5);
    const py = w.pylons;
    py.count = 0;
    // four arc pylons, each next to a coolant pool
    for (const [x, y] of [[-10, 6], [10, -6], [-27, 11], [27, -11]] as const) {
      py.pillar[py.count] = P.count;
      py.charge[py.count] = 0;
      py.state[py.count] = 0;
      py.timer[py.count] = 0;
      py.count++;
      P.add(x, y, 0.8);
    }
    const L = w.lanes;
    L.count = 0;
    // long belts (16 u horizontal, 13 u vertical) — they should shape movement, not be a strip
    L.add(-21, -3, 8, 1.2, 1, 0, 0);
    L.add(21, 3, 8, 1.2, -1, 0, 6);
    L.add(0, -16.5, 1.2, 6.5, 0, 1, 3);
    L.add(0, 16.5, 1.2, 6.5, 0, -1, 9);
    const D = w.pads;
    D.count = 0;
    D.add(-6, -14, 0);
    D.add(-3, -14, 1);
    D.add(3, 14, 0);
    D.add(6, 14, 1);
    D.add(-26, -18, 0);
    D.add(-23, -18, 1);
    w.pools.add(-6, 4, 2.5);
    w.pools.add(6, -4, 2.5);
    w.pools.add(-24, 6, 2.5);
    w.pools.add(24, -6, 2.5);
  } else {
    // Плоть: asymmetric growths around a central open "womb"; flesh pools in the lanes
    P.add(-11, -11, 1.8);
    P.add(12, -9, 1.4);
    P.add(-20, 6, 1.5);
    P.add(19, 10, 1.9);
    P.add(-3, 16, 1.2);
    P.add(28, -12, 1.3);
    P.add(-29, -8, 1.2);
    w.pools.add(0, 6, 4.2);
    w.pools.add(-22, -14, 3.6);
    w.pools.add(22, -2, 3.4);
    w.pools.add(-12, 16, 3.2);
    w.pools.add(14, 18, 2.8);
  }
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
  F.ver++;
}
