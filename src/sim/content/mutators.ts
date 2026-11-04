import { dcos, dsin } from '../../core/detmath';
import { ARENA_HH, ARENA_HW } from '../constants';
import type { Phys, World } from '../world';

/**
 * Arena mutators: flexible events that rewrite the arena's physics while active.
 * `apply` writes physics targets (the world eases toward them), `tick` can drive
 * dynamic things (moving wells, rotating wind), `exit` cleans up.
 */
export interface MutatorDef {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  /** hex colour for UI and floor tint */
  readonly color: number;
  apply(target: Phys, w: World): void;
  tick?(w: World, dt: number, t: number): void;
  exit?(w: World): void;
}

const defs: Omit<MutatorDef, 'id'>[] = [
  {
    key: 'overclock',
    name: 'РАЗГОН',
    desc: 'Все снаряды летят на 45% быстрее, враги ускорены',
    color: 0xff4fd8,
    apply(t) {
      t.playerBulletSpeed = 1.45;
      t.enemyBulletSpeed = 1.45;
      t.enemySpeed = 1.15;
    },
  },
  {
    key: 'cryo',
    name: 'КРИОПОЛ',
    desc: 'Пол обледенел: инерция у всех',
    color: 0x7fe8ff,
    apply(t) {
      t.friction = 1.4;
      t.enemySpeed = 1.1;
    },
  },
  {
    key: 'gravity',
    name: 'ГРАВИКОЛОДЦЫ',
    desc: 'Блуждающие колодцы искривляют траектории',
    color: 0x9b5cff,
    apply() {},
    tick(w, dt, t) {
      const W = w.wells;
      if (W.count === 0 && t < 0.05) {
        W.count = 2;
        for (let i = 0; i < 2; i++) {
          W.x[i] = i === 0 ? -12 : 12;
          W.y[i] = i === 0 ? 4 : -4;
          const a = w.rng.range(0, 6.283);
          W.vx[i] = dcos(a) * 3;
          W.vy[i] = dsin(a) * 3;
          W.strength[i] = 0;
          W.radius[i] = 9;
        }
      }
      for (let i = 0; i < W.count; i++) {
        W.strength[i] = Math.min(1, W.strength[i]! + dt * 0.8) * 1;
        let x = W.x[i]! + W.vx[i]! * dt;
        let y = W.y[i]! + W.vy[i]! * dt;
        if (x < -ARENA_HW + 6 || x > ARENA_HW - 6) W.vx[i] = -W.vx[i]!;
        if (y < -ARENA_HH + 6 || y > ARENA_HH - 6) W.vy[i] = -W.vy[i]!;
        x = Math.max(-ARENA_HW + 6, Math.min(ARENA_HW - 6, x));
        y = Math.max(-ARENA_HH + 6, Math.min(ARENA_HH - 6, y));
        W.x[i] = x;
        W.y[i] = y;
      }
    },
    exit(w) {
      w.wells.count = 0;
    },
  },
  {
    key: 'ricochet',
    name: 'ЗЕРКАЛА',
    desc: 'Стены отражают все снаряды дважды',
    color: 0xe8ffff,
    apply(t) {
      t.wallBounce = 2;
      t.bulletLife = 1.6;
    },
  },
  {
    key: 'drift',
    name: 'ДРЕЙФ',
    desc: 'Вращающийся ветер сносит снаряды и бойцов',
    color: 0xb6ff3b,
    apply(t) {
      t.windWalkers = 0.22;
    },
    tick(w, _dt, t) {
      const a = t * 0.25;
      const s = Math.min(1, t * 0.5) * 9;
      w.physTarget.windX = dcos(a) * s;
      w.physTarget.windY = dsin(a) * s;
    },
    exit(w) {
      w.physTarget.windX = 0;
      w.physTarget.windY = 0;
    },
  },
  {
    key: 'stasis',
    name: 'СТАЗИС',
    desc: 'Снаряды вязнут: медленнее, но живут дольше',
    color: 0xffa126,
    apply(t) {
      t.playerBulletSpeed = 0.7;
      t.enemyBulletSpeed = 0.6;
      t.bulletLife = 1.8;
    },
  },
];

export const MUTATORS: readonly MutatorDef[] = defs.map((d, i) => ({ ...d, id: i }));

export function mutatorByKey(key: string): MutatorDef {
  const m = MUTATORS.find((x) => x.key === key);
  if (!m) throw new Error(`unknown mutator ${key}`);
  return m;
}
