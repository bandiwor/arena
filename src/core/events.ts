/** Sim → presentation event types. Plain numeric constants (no enums, isolatedModules-safe). */
export const Ev = {
  Shoot: 1, // x y angle weaponId rarity
  EnemyShoot: 2, // x y angle enemyType bulletKind
  Hit: 3, // x y angle material dmg enemyType rarity crit
  Kill: 4, // x y angle material enemyType radius weaponRarity overkill
  Impact: 5, // x y angle bulletKind team
  Explosion: 6, // x y radius power team
  SpawnTelegraph: 7, // x y enemyType duration
  SpawnDone: 8, // x y enemyType
  PlayerHurt: 9, // x y dmg hpLeft
  PlayerDash: 10, // x y angle
  RailBeam: 11, // x1 y1 x2 y2 rarity
  WaveStart: 12, // wave total
  WaveClear: 13, // wave
  BossPhase: 14, // x y phase
  BossDeath: 15, // x y
  Mutator: 16, // id on(1/0)
  UpgradeOffer: 17,
  UpgradePicked: 18, // upgradeId
  PlayerDeath: 19, // x y
  Victory: 20,
  WeaponSwitch: 21, // weaponId rarity
  ArcherRelease: 22, // x y angle
  ChargerDash: 23, // x y angle
  Implode: 24, // x y radius
  Shockwave: 25, // x y radius
  BossTeleport: 26, // x1 y1 x2 y2
  LaserFire: 27, // x y angle
  ShieldBlock: 28, // x y angle
  Pickup: 29, // x y kind
  Telegraph: 30, // x y radius duration (ground circle)
  WeaponGained: 31, // weaponId rarity
  ActTransition: 32, // act (new act index)
  ActSynth: 33, // x y act — the moment the new sector materialises
  WormBurrow: 34, // x y
  WormEmerge: 35, // x y radius
  Birth: 36, // x y count
  ShieldBreak: 37, // x y face
  PadWarn: 38, // x y
  PadStamp: 39, // x y
  LaneWarn: 40, // lane index
  LaneFlip: 41, // lane index
  PylonCharge: 42, // x y
  Arc: 43, // x0 y0 x1 y1 hitPlayer
  MarkHit: 44, // x y r
  HookFire: 45, // x y angle
  HookHit: 46, // x y
  Shorted: 47, // x y
  ArmDown: 48, // x y
  HubShield: 49, // x y on
  Shunt: 50, // lane index
} as const;
export type EvType = (typeof Ev)[keyof typeof Ev];

export const EV_STRIDE = 9;

/** Fixed-capacity flat event queue. No allocation after construction. */
export class EventQueue {
  readonly data: Float32Array;
  count = 0;
  dropped = 0;
  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity * EV_STRIDE);
  }
  push(t: EvType, x = 0, y = 0, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0): void {
    if (this.count >= this.capacity) {
      this.dropped++;
      return;
    }
    const o = this.count * EV_STRIDE;
    const D = this.data;
    D[o] = t;
    D[o + 1] = x;
    D[o + 2] = y;
    D[o + 3] = a;
    D[o + 4] = b;
    D[o + 5] = c;
    D[o + 6] = d;
    D[o + 7] = e;
    D[o + 8] = f;
    this.count++;
  }
  clear(): void {
    this.count = 0;
  }
}
