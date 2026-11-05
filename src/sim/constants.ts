export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

/** Arena is centered at 0,0. Sim uses X/Y on the ground plane. */
export const ARENA_W = 72;
export const ARENA_H = 48;
export const ARENA_HW = ARENA_W / 2;
export const ARENA_HH = ARENA_H / 2;

export const MAX_ENEMIES = 384;
export const MAX_BULLETS = 6144;
export const MAX_PICKUPS = 128;
export const MAX_LASERS = 6;
export const MAX_WELLS = 4;
export const MAX_PILLARS = 16;
export const MAX_POOLS = 8;

export const Team = { Player: 0, Enemy: 1 } as const;

export const Mat = { Flesh: 0, Plant: 1, Machine: 2, Crystal: 3, Void: 4 } as const;
export type MatId = (typeof Mat)[keyof typeof Mat];

export const BK = {
  Pulse: 0,
  Pellet: 1,
  Grenade: 2,
  Orb: 3,
  Bolt: 4,
  Arrow: 5,
  BossOrb: 6,
  Shard: 7,
  Needle: 8,
  /** death-spray acid: starts slow and accelerates, so a point-blank burst is still dodgeable */
  Acid: 9,
} as const;
export type BulletKind = (typeof BK)[keyof typeof BK];

export const ET = {
  Swarmer: 0,
  Gunner: 1,
  Charger: 2,
  Archer: 3,
  Shielder: 4,
  Boss: 5,
  Bloater: 6,
  Dart: 7,
  Worm: 8,
  Parasite: 9,
  Brood: 10,
} as const;
export type EnemyType = (typeof ET)[keyof typeof ET];
export const ENEMY_TYPE_COUNT = 11;

export const WP = {
  Pulse: 0,
  Scatter: 1,
  Needler: 2,
  Launcher: 3,
  Rail: 4,
  Singularity: 5,
} as const;
export type WeaponId = (typeof WP)[keyof typeof WP];
export const WEAPON_COUNT = 6;

/** AI states (shared vocabulary for all archetypes; renderer reads these). */
export const AS = {
  Spawning: 0,
  Move: 1,
  Strafe: 2,
  Windup: 3,
  Attack: 4,
  Recover: 5,
  Retreat: 6,
  Dodge: 7,
  Dash: 8,
  Stunned: 9,
  Guard: 10,
  Leap: 11,
  Burrow: 12,
  Underground: 13,
  Emerge: 14,
  Attached: 15,
} as const;
export type AIState = (typeof AS)[keyof typeof AS];

export const Affix = { None: 0, Fast: 1, Armored: 2, Volatile: 4 } as const;

export const Btn = {
  Fire: 1,
  Dash: 2,
  Next: 4,
  Prev: 8,
  // upgrade choice stored in bits 4..6 (value 1..3)
  PickShift: 4,
  PickMask: 0x70,
  Slot1: 0x80, // direct slot select: bits 7..10 = slot+1
  SlotShift: 7,
  SlotMask: 0x780,
} as const;
