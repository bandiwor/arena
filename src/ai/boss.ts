import { Ev } from '../core/events';
import { dcos, dsin, datan2, segDist2 } from '../core/detmath';
import { ARENA_HH, ARENA_HW, BK, DT, ET, MAX_LASERS, Team } from '../sim/constants';
import { hurtPlayer, killEnemy, spawnBullet, spawnEnemy } from '../sim/systems/entities';
import type { World } from '../sim/world';
import { faceToward, integrate } from './steer';

/** Boss pattern ids */
export const BP = {
  Idle: 0,
  Ring: 1,
  Spiral: 2,
  Fan: 3,
  Slam: 4,
  Laser: 5,
  Summon: 6,
  Teleport: 7,
} as const;

export const BOSS_PATTERN_NAMES = ['idle', 'ring', 'spiral', 'fan', 'slam', 'laser', 'summon', 'teleport'] as const;

const PHASE_PATTERNS: readonly (readonly number[])[] = [
  [],
  [BP.Ring, BP.Fan, BP.Ring, BP.Spiral, BP.Fan],
  [BP.Spiral, BP.Slam, BP.Summon, BP.Fan, BP.Ring, BP.Laser],
  [BP.Laser, BP.Spiral, BP.Teleport, BP.Slam, BP.Summon, BP.Fan, BP.Ring],
];

const PATTERN_DUR = [1, 0.9, 2.8, 1.1, 1.6, 4.8, 1.0, 0.9];

function orb(w: World, x: number, y: number, a: number, speed: number, big: boolean): void {
  spawnBullet(w, Team.Enemy, big ? BK.BossOrb : BK.Shard, x, y, a, speed * w.diff.bulletSpeedMul, big ? 16 : 11, big ? 0.42 : 0.26, 5, 0, 0, 0, 0, 0, 0);
}

/** Force a pattern (debug API). */
export function bossForcePattern(w: World, pattern: number): void {
  const B = w.boss;
  B.pattern = pattern;
  B.patternT = 0;
  B.slamT = 0;
}

export function updateBoss(w: World, i: number): void {
  const E = w.enemies;
  const B = w.boss;
  const p = w.player;
  B.t += DT;
  const x = E.x[i]!;
  const y = E.y[i]!;
  const toP = datan2(p.y - y, p.x - x);
  faceToward(w, i, toP, 1.2);

  if (B.dying > 0) {
    B.dying -= DT;
    B.corruption = Math.min(1, B.corruption + DT * 0.6);
    integrate(w, i, 0, 0);
    if ((w.tick % 9) === 0) {
      const a = w.rng.range(0, 6.283);
      const r = w.rng.range(0, 2.5);
      w.events.push(Ev.Explosion, x + dcos(a) * r, y + dsin(a) * r, 2.5, 1.5, Team.Player);
    }
    if (B.dying <= 0) {
      // purge enemy bullets & minions
      const Bu = w.bullets;
      for (let k = 0; k < Bu.hi; k++) if (Bu.alive[k] && Bu.team[k] === Team.Enemy) Bu.life[k] = 0.01;
      for (let k = 0; k < MAX_LASERS; k++) w.lasers.alive[k] = 0;
      killEnemy(w, i, toP, 3, 0, 9999);
      for (let k = 0; k < E.hi; k++) if (E.alive[k]) killEnemy(w, k, 0, 3, 0, 50);
      w.events.push(Ev.Explosion, x, y, 12, 8, Team.Player);
      B.corruption = 0;
    }
    return;
  }

  // phases by HP
  const hpf = E.hp[i]! / E.maxHp[i]!;
  const phase = hpf > 0.66 ? 1 : hpf > 0.33 ? 2 : 3;
  if (phase !== B.phase) {
    const first = B.phase === 0;
    B.phase = phase;
    B.pattern = BP.Idle;
    B.patternT = first ? -1.5 : -1.2;
    if (!first) {
      w.events.push(Ev.BossPhase, x, y, phase);
      // phase shockwave pushes the player away + ring of orbs
      for (let k = 0; k < 28; k++) orb(w, x, y, (k / 28) * 6.283 + B.spin, 9, true);
      E.flash[i] = 1;
    }
  }
  const targetCorr = phase === 1 ? 0.1 : phase === 2 ? 0.35 : 0.7;
  B.corruption += (targetCorr - B.corruption) * Math.min(1, DT * 1.5);

  // drift: hover between centre and player, slow
  const hx = p.x * 0.35;
  const hy = p.y * 0.35 - 2;
  const dx = hx - x;
  const dy = hy - y;
  const dd = Math.sqrt(dx * dx + dy * dy);
  const sp = 2.4 + phase * 0.6;
  const busy = B.pattern === BP.Slam || B.pattern === BP.Laser;
  integrate(w, i, dd > 1 && !busy ? (dx / dd) * sp : 0, dd > 1 && !busy ? (dy / dd) * sp : 0);

  B.patternT += DT;
  B.spin += DT * (0.5 + phase * 0.25);
  const pt = B.patternT;
  switch (B.pattern) {
    case BP.Ring: {
      // two staggered rings
      if (crossed(pt, 0.15) || crossed(pt, 0.6)) {
        const n = 12 + phase * 3;
        const off = crossed(pt, 0.6) ? 3.14159 / n : 0;
        for (let k = 0; k < n; k++) orb(w, x, y, (k / n) * 6.283 + off + B.spin, 8 + phase, true);
        w.events.push(Ev.EnemyShoot, x, y, 0, ET.Boss, BK.BossOrb);
      }
      break;
    }
    case BP.Spiral: {
      if (w.tick % (phase === 3 ? 5 : 6) === 0 && pt > 0) {
        const arms = phase === 3 ? 3 : 2;
        for (let k = 0; k < arms; k++) {
          const a = B.spin * 2.2 + (k / arms) * 6.283;
          orb(w, x + dcos(a) * 2.4, y + dsin(a) * 2.4, a, 10, false);
        }
        if (w.tick % 20 === 0) w.events.push(Ev.EnemyShoot, x, y, B.spin, ET.Boss, BK.Shard);
      }
      break;
    }
    case BP.Fan: {
      if (crossed(pt, 0.1) || crossed(pt, 0.45) || crossed(pt, 0.8)) {
        const n = 5 + phase * 2;
        const tt = Math.sqrt((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y)) / 15;
        const ax = p.x + p.vx * tt * 0.7;
        const ay = p.y + p.vy * tt * 0.7;
        const base = datan2(ay - y, ax - x);
        for (let k = 0; k < n; k++) orb(w, x + dcos(base) * 2.6, y + dsin(base) * 2.6, base + (k / (n - 1) - 0.5) * 0.9, 15, false);
        w.events.push(Ev.EnemyShoot, x, y, base, ET.Boss, BK.Shard);
      }
      break;
    }
    case BP.Slam: {
      if (crossed(pt, 0.05)) {
        B.slamX = p.x + p.vx * 0.4;
        B.slamY = p.y + p.vy * 0.4;
        w.events.push(Ev.Telegraph, B.slamX, B.slamY, 4.2, w.diff.teleMul);
      }
      if (crossed(pt, 0.05 + w.diff.teleMul)) {
        const ex = p.x - B.slamX;
        const ey = p.y - B.slamY;
        if (ex * ex + ey * ey < 4.2 * 4.2) hurtPlayer(w, 28, B.slamX, B.slamY, 41);
        w.events.push(Ev.Shockwave, B.slamX, B.slamY, 5);
        w.events.push(Ev.Explosion, B.slamX, B.slamY, 4.2, 2.2, Team.Enemy);
        const n = 10 + phase * 2;
        for (let k = 0; k < n; k++) orb(w, B.slamX, B.slamY, (k / n) * 6.283, 7, false);
      }
      break;
    }
    case BP.Laser: {
      if (crossed(pt, 0.05)) {
        const n = phase === 3 ? 3 : 2;
        const dirn = w.rng.sign();
        for (let k = 0; k < n; k++) {
          const L = w.lasers;
          L.alive[k] = 1;
          L.x[k] = x;
          L.y[k] = y;
          L.ang[k] = toP + 0.9 + (k / n) * 6.283;
          L.angP[k] = L.ang[k]!;
          L.angVel[k] = dirn * (0.55 + phase * 0.08);
          L.len[k] = 60;
          L.width[k] = 0.55;
          L.warm[k] = 1.1 * w.diff.teleMul;
          L.warmMax[k] = 1.1 * w.diff.teleMul;
          L.life[k] = 4.4;
          L.dmg[k] = 18;
          L.owner[k] = i;
        }
        w.events.push(Ev.LaserFire, x, y, toP);
      }
      break;
    }
    case BP.Summon: {
      if (crossed(pt, 0.2)) {
        const n = 3 + phase;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * 6.283 + B.spin;
          const sx = Math.max(-ARENA_HW + 2, Math.min(ARENA_HW - 2, x + dcos(a) * 4.5));
          const sy = Math.max(-ARENA_HH + 2, Math.min(ARENA_HH - 2, y + dsin(a) * 4.5));
          spawnEnemy(w, ET.Swarmer, sx, sy);
        }
      }
      break;
    }
    case BP.Teleport: {
      if (crossed(pt, 0.35)) {
        const a = w.rng.range(0, 6.283);
        const nx = Math.max(-ARENA_HW + 6, Math.min(ARENA_HW - 6, p.x + dcos(a) * 14));
        const ny = Math.max(-ARENA_HH + 6, Math.min(ARENA_HH - 6, p.y + dsin(a) * 14));
        w.events.push(Ev.BossTeleport, x, y, nx, ny);
        E.x[i] = nx;
        E.y[i] = ny;
        E.px[i] = nx;
        E.py[i] = ny;
        for (let k = 0; k < 16; k++) orb(w, nx, ny, (k / 16) * 6.283, 8, true);
      }
      break;
    }
    default:
      break;
  }
  if (pt >= (PATTERN_DUR[B.pattern] ?? 1)) {
    const list = PHASE_PATTERNS[phase]!;
    // avoid back-to-back lasers
    let next = list[w.rng.int(list.length)]!;
    if (next === B.pattern) next = list[(list.indexOf(next) + 1) % list.length]!;
    B.pattern = next;
    B.patternT = -(0.85 - phase * 0.1); // breathing room between patterns (read, reposition, punish)
  }
}

function crossed(t: number, mark: number): boolean {
  return t >= mark && t - DT < mark;
}

export function updateLasers(w: World): void {
  const L = w.lasers;
  const p = w.player;
  const bi = w.boss.id;
  for (let k = 0; k < MAX_LASERS; k++) {
    if (!L.alive[k]) continue;
    L.angP[k] = L.ang[k]!;
    const own = L.owner[k]!;
    const ownerAlive = own < 0 || (w.enemies.alive[own] === 1 && own === bi);
    if (own >= 0 && ownerAlive) {
      L.x[k] = w.enemies.x[own]!;
      L.y[k] = w.enemies.y[own]!;
    }
    if (L.warm[k]! > 0) {
      L.warm[k] = L.warm[k]! - DT;
      L.ang[k] = L.ang[k]! + L.angVel[k]! * DT * 0.25;
      continue;
    }
    L.ang[k] = L.ang[k]! + L.angVel[k]! * DT;
    L.life[k] = L.life[k]! - DT;
    if (L.life[k]! <= 0 || !ownerAlive) {
      L.alive[k] = 0;
      continue;
    }
    const a = L.ang[k]!;
    const s0 = own >= 0 ? 2.2 : 0.8;
    const x0 = L.x[k]! + dcos(a) * s0;
    const y0 = L.y[k]! + dsin(a) * s0;
    const x1 = L.x[k]! + dcos(a) * L.len[k]!;
    const y1 = L.y[k]! + dsin(a) * L.len[k]!;
    const r = L.width[k]! + 0.3;
    if (p.alive && segDist2(p.x, p.y, x0, y0, x1, y1) < r * r) hurtPlayer(w, L.dmg[k]!, L.x[k]!, L.y[k]!, 40);
  }
}
