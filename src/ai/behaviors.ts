import { Ev } from '../core/events';
import { dcos, dsin, datan2 } from '../core/detmath';
import { AS, ARENA_HH, ARENA_HW, BK, DT, ET, Team } from '../sim/constants';
import { enemyDef } from '../sim/content/enemies';
import { acquireToken, hurtPlayer, releaseToken, spawnBullet } from '../sim/systems/entities';
import { hasLOS } from '../sim/systems/physics';
import type { World } from '../sim/world';
import { angleToPlayer, dir, distToPlayer, faceToward, integrate, pathTo } from './steer';
import { updateBoss } from './boss';

/**
 * Utility AI: each archetype scores a small set of actions, best one wins (with hysteresis).
 * Scores are mirrored into E.util for the debug inspector.
 */
const U = new Float32Array(6);

function pickBest(w: World, i: number, current: number, ids: Int8Array): number {
  const E = w.enemies;
  let best = -1;
  let bestS = -1;
  for (let k = 0; k < ids.length; k++) {
    let s = U[k]!;
    if (ids[k] === current) s += 0.08; // hysteresis
    E.util[i * 6 + k] = U[k]!;
    if (s > bestS) {
      bestS = s;
      best = ids[k]!;
    }
  }
  return best;
}

function setState(w: World, i: number, st: number): void {
  const E = w.enemies;
  if (E.st[i] === st) return;
  E.st[i] = st;
  E.stT[i] = 0;
}

/** Effective cooldown multiplier: difficulty + mild dynamic adapt. */
function cdMul(w: World): number {
  return w.diff.cdMul * (1 - w.director.adapt * 0.5);
}
function aimErr(w: World): number {
  return w.diff.aimErr * (1 - w.director.adapt * 1.5);
}

/** Predict where the player will be when a projectile of `speed` arrives. */
const lead = new Float32Array(2);
function leadAim(w: World, x: number, y: number, speed: number, factor: number): Float32Array {
  const p = w.player;
  const dx = p.x - x;
  const dy = p.y - y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const t = d / speed;
  lead[0] = p.x + p.vx * t * factor;
  lead[1] = p.y + p.vy * t * factor;
  return lead;
}

/** Is a player bullet about to hit enemy i? Writes dodge direction into dir. */
function incomingThreat(w: World, i: number): boolean {
  const B = w.bullets;
  const E = w.enemies;
  const x = E.x[i]!;
  const y = E.y[i]!;
  const r = E.r[i]! + 0.7;
  for (let b = 0; b < B.hi; b++) {
    if (!B.alive[b] || B.team[b] !== Team.Player) continue;
    const rx = x - B.x[b]!;
    const ry = y - B.y[b]!;
    if (rx * rx + ry * ry > 100) continue;
    const vx = B.vx[b]!;
    const vy = B.vy[b]!;
    const v2 = vx * vx + vy * vy;
    if (v2 < 1) continue;
    const t = (rx * vx + ry * vy) / v2;
    if (t < 0 || t > 0.4) continue;
    const mx = rx - vx * t;
    const my = ry - vy * t;
    if (mx * mx + my * my < r * r) {
      // dodge perpendicular, away from the bullet line
      const l = Math.sqrt(v2);
      let px = -vy / l;
      let py = vx / l;
      if (px * mx + py * my < 0) {
        px = -px;
        py = -py;
      }
      dir[0] = px;
      dir[1] = py;
      return true;
    }
  }
  return false;
}

export function updateEnemies(w: World): void {
  const E = w.enemies;
  for (let k = 0; k < E.activeCount; k++) {
    const i = E.active[k]!;
    if (!E.alive[i]) continue;
    E.px[i] = E.x[i]!;
    E.py[i] = E.y[i]!;
    E.faceP[i] = E.face[i]!;
    E.flash[i] = Math.max(0, E.flash[i]! - DT * 11);
    if (E.st[i] === AS.Spawning) {
      E.spawnT[i] = E.spawnT[i]! - DT;
      if (E.spawnT[i]! <= 0) {
        E.st[i] = AS.Move;
        E.stT[i] = 0;
        w.events.push(Ev.SpawnDone, E.x[i]!, E.y[i]!, E.type[i]!, E.affix[i]!);
      }
      continue;
    }
    E.stT[i] = E.stT[i]! + DT;
    E.cd[i] = E.cd[i]! - DT;
    E.think[i] = E.think[i]! - DT;
    if (w.noAI) {
      integrate(w, i, 0, 0);
      continue;
    }
    switch (E.type[i]) {
      case ET.Swarmer:
        swarmer(w, i);
        break;
      case ET.Gunner:
        gunner(w, i);
        break;
      case ET.Charger:
        charger(w, i);
        break;
      case ET.Archer:
        archer(w, i);
        break;
      case ET.Shielder:
        shielder(w, i);
        break;
      case ET.Boss:
        updateBoss(w, i);
        break;
    }
    contact(w, i);
  }
}

function speedOf(w: World, i: number): number {
  return enemyDef(w.enemies.type[i]!).speed * w.enemies.speedMul[i]! * w.phys.enemySpeed;
}

function contact(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  if (!p.alive) return;
  const dx = p.x - E.x[i]!;
  const dy = p.y - E.y[i]!;
  const rr = E.r[i]! + p.r * 0.8;
  if (dx * dx + dy * dy < rr * rr) {
    let dmg = enemyDef(E.type[i]!).contactDmg;
    if (E.st[i] === AS.Dash || E.st[i] === AS.Leap) dmg *= 1.6;
    hurtPlayer(w, dmg, E.x[i]!, E.y[i]!);
  }
}

// ───────────────────────────── Swarmer: pack hunter, surrounds then leaps
function swarmer(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  const toP = angleToPlayer(w, i);
  const sp = speedOf(w, i);
  switch (E.st[i]) {
    case AS.Windup: {
      faceToward(w, i, toP, 14);
      E.charge[i] = E.stT[i]! / 0.3;
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= 0.3) {
        E.aim[i] = E.face[i]!;
        setState(w, i, AS.Leap);
      }
      return;
    }
    case AS.Leap: {
      E.charge[i] = 0;
      const a = E.aim[i]!;
      E.vx[i] = dcos(a) * 17;
      E.vy[i] = dsin(a) * 17;
      integrate(w, i, E.vx[i]!, E.vy[i]!);
      if (E.stT[i]! >= 0.22) setState(w, i, AS.Recover);
      return;
    }
    case AS.Recover: {
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= 0.3) {
        E.cd[i] = (1.1 + E.seed[i]! * 0.6) * cdMul(w);
        setState(w, i, AS.Move);
      }
      return;
    }
    default: {
      // surround: aim at a slot on a ring around the player, collapse when close
      let tx = p.x;
      let ty = p.y;
      if (d > 4.5) {
        const slot = E.seed[i]! * 6.283 + w.time * 0.3 * E.aux2[i]!;
        const ring = Math.min(3.2, d * 0.4);
        tx += dcos(slot) * ring;
        ty += dsin(slot) * ring;
      }
      const dv = pathTo(w, i, tx, ty, true);
      // slight sinus weave makes the swarm read as organic
      const weave = dsin(w.time * 7 + E.seed[i]! * 20) * 0.35;
      const vx = (dv[0]! - dv[1]! * weave) * sp;
      const vy = (dv[1]! + dv[0]! * weave) * sp;
      faceToward(w, i, datan2(vy, vx), 10);
      integrate(w, i, vx, vy);
      if (d < 4 && E.cd[i]! <= 0 && hasLOS(w, E.x[i]!, E.y[i]!, p.x, p.y)) setState(w, i, AS.Windup);
    }
  }
}

// ───────────────────────────── Gunner: keeps range, strafes, dodges, bursts with lead
const GUNNER_ACTS = new Int8Array([AS.Move, AS.Strafe, AS.Retreat, AS.Windup, AS.Dodge]);
function gunner(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  const toP = angleToPlayer(w, i);
  const sp = speedOf(w, i);
  E.aux[i] = Math.max(0, E.aux[i]! - DT); // dodge cooldown
  const st = E.st[i]!;

  if (st === AS.Windup) {
    const L = leadAim(w, E.x[i]!, E.y[i]!, 22 * w.diff.bulletSpeedMul, 0.8);
    faceToward(w, i, datan2(L[1]! - E.y[i]!, L[0]! - E.x[i]!), 6);
    E.charge[i] = Math.min(1, E.stT[i]! / 0.45);
    integrate(w, i, 0, 0);
    if (E.stT[i]! >= 0.45) {
      E.burst[i] = 3;
      setState(w, i, AS.Attack);
    }
    return;
  }
  if (st === AS.Attack) {
    E.charge[i] = 1;
    const L = leadAim(w, E.x[i]!, E.y[i]!, 22 * w.diff.bulletSpeedMul, 0.8);
    faceToward(w, i, datan2(L[1]! - E.y[i]!, L[0]! - E.x[i]!), 4);
    integrate(w, i, 0, 0);
    if (E.stT[i]! >= 0.11 && E.burst[i]! > 0) {
      E.stT[i] = 0;
      E.burst[i] = E.burst[i]! - 1;
      const a = E.face[i]! + w.rng.sym() * 0.09 * aimErr(w);
      const mx = E.x[i]! + dcos(a) * 0.8;
      const my = E.y[i]! + dsin(a) * 0.8;
      spawnBullet(w, Team.Enemy, BK.Bolt, mx, my, a, 22 * w.diff.bulletSpeedMul, 9, 0.22, 2.2, 0, 0, 0, 0, 0, 0);
      w.events.push(Ev.EnemyShoot, mx, my, a, ET.Gunner, BK.Bolt);
      E.kx[i] = E.kx[i]! - dcos(a) * 1.5;
      E.ky[i] = E.ky[i]! - dsin(a) * 1.5;
    }
    if (E.burst[i] === 0 && E.stT[i]! > 0.15) {
      releaseToken(w, i);
      E.charge[i] = 0;
      E.cd[i] = (1.7 + E.seed[i]! * 0.8) * cdMul(w);
      setState(w, i, AS.Recover);
    }
    return;
  }
  if (st === AS.Recover) {
    integrate(w, i, 0, 0);
    if (E.stT[i]! > 0.35) setState(w, i, AS.Strafe);
    return;
  }
  if (st === AS.Dodge) {
    integrate(w, i, E.tx[i]! * sp * 2.6, E.ty[i]! * sp * 2.6);
    if (E.stT[i]! > 0.28) setState(w, i, AS.Strafe);
    return;
  }

  // ── think
  if (E.think[i]! <= 0) {
    E.think[i] = 0.18 + E.seed[i]! * 0.1;
    const los = hasLOS(w, E.x[i]!, E.y[i]!, p.x, p.y);
    const threat = E.aux[i]! <= 0 && incomingThreat(w, i);
    U[0] = (los ? 0 : 0.9) + (d > 17 ? 0.7 : 0) + (d < 7 ? 0.2 : 0); // reposition
    U[1] = los && d >= 7 && d <= 17 ? 0.6 : 0.1; // strafe
    U[2] = d < 6.5 ? 0.4 + (1 - d / 6.5) * 0.6 : 0; // retreat
    U[3] = los && E.cd[i]! <= 0 && d < 21 ? 0.85 : 0; // attack (needs token)
    U[4] = threat ? 0.97 : 0; // dodge
    if (U[3]! > 0 && !acquireToken(w, i)) U[3] = 0;
    const best = pickBest(w, i, st, GUNNER_ACTS);
    if (best !== AS.Windup && E.token[i]) releaseToken(w, i);
    if (best === AS.Dodge) {
      E.tx[i] = dir[0]!;
      E.ty[i] = dir[1]!;
      E.aux[i] = 1.2;
    } else if (best === AS.Move) {
      // choose a point on the ideal ring with LOS
      const base = datan2(E.y[i]! - p.y, E.x[i]! - p.x);
      for (let s = 0; s < 5; s++) {
        const a = base + w.rng.sym() * 1.2;
        const r = 11 + w.rng.sym() * 2;
        const tx = clampX(p.x + dcos(a) * r);
        const ty = clampY(p.y + dsin(a) * r);
        E.tx[i] = tx;
        E.ty[i] = ty;
        if (hasLOS(w, tx, ty, p.x, p.y)) break;
      }
    } else if (best === AS.Strafe && w.rng.chance(0.15)) {
      E.aux2[i] = -E.aux2[i]!;
    }
    setState(w, i, best);
  }

  const cur = E.st[i]!;
  faceToward(w, i, toP, 5);
  if (cur === AS.Move) {
    const dv = pathTo(w, i, E.tx[i]!, E.ty[i]!, false);
    integrate(w, i, dv[0]! * sp, dv[1]! * sp);
  } else if (cur === AS.Strafe) {
    const s = E.aux2[i]!;
    const rx = (p.x - E.x[i]!) / (d || 1);
    const ry = (p.y - E.y[i]!) / (d || 1);
    const radial = d > 12 ? 0.45 : d < 9 ? -0.45 : 0;
    integrate(w, i, (-ry * s + rx * radial) * sp * 0.85, (rx * s + ry * radial) * sp * 0.85);
  } else if (cur === AS.Retreat) {
    integrate(w, i, -dcos(toP) * sp * 1.1, -dsin(toP) * sp * 1.1);
  } else {
    integrate(w, i, 0, 0);
  }
}

// ───────────────────────────── Charger: telegraphed bull rush, stuns on walls
function charger(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  const toP = angleToPlayer(w, i);
  const sp = speedOf(w, i);
  switch (E.st[i]) {
    case AS.Windup: {
      const WIND = 0.8;
      if (E.stT[i]! < WIND * 0.7) {
        const L = leadAim(w, E.x[i]!, E.y[i]!, 24, 0.5);
        faceToward(w, i, datan2(L[1]! - E.y[i]!, L[0]! - E.x[i]!), 5);
        E.aim[i] = E.face[i]!;
      }
      E.charge[i] = Math.min(1, E.stT[i]! / WIND);
      integrate(w, i, -dcos(E.aim[i]!) * 0.8, -dsin(E.aim[i]!) * 0.8);
      if (E.stT[i]! >= WIND) {
        setState(w, i, AS.Dash);
        w.events.push(Ev.ChargerDash, E.x[i]!, E.y[i]!, E.aim[i]!);
      }
      return;
    }
    case AS.Dash: {
      E.charge[i] = 1;
      const a = E.aim[i]!;
      const v = 24 * w.phys.enemySpeed;
      E.vx[i] = dcos(a) * v;
      E.vy[i] = dsin(a) * v;
      const ox = E.x[i]!;
      const oy = E.y[i]!;
      integrate(w, i, E.vx[i]!, E.vy[i]!);
      // blocked → slammed into wall/pillar
      const moved = Math.abs(E.x[i]! - ox) + Math.abs(E.y[i]! - oy);
      if (moved < v * DT * 0.5 && E.stT[i]! > 0.05) {
        w.events.push(Ev.Shockwave, E.x[i]!, E.y[i]!, 3);
        E.vx[i] = 0;
        E.vy[i] = 0;
        E.charge[i] = 0;
        releaseToken(w, i);
        E.cd[i] = 3 * cdMul(w);
        setState(w, i, AS.Stunned);
        return;
      }
      if (E.stT[i]! >= 0.6) {
        E.charge[i] = 0;
        releaseToken(w, i);
        E.cd[i] = 2.6 * cdMul(w);
        setState(w, i, AS.Recover);
      }
      return;
    }
    case AS.Stunned:
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= 1.1) setState(w, i, AS.Move);
      return;
    case AS.Recover:
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= 0.6) setState(w, i, AS.Move);
      return;
    default: {
      const dv = pathTo(w, i, p.x, p.y, true);
      faceToward(w, i, datan2(dv[1]!, dv[0]!), 3);
      integrate(w, i, dv[0]! * sp, dv[1]! * sp);
      if (E.think[i]! <= 0) {
        E.think[i] = 0.2;
        if (d < 12 && d > 3 && E.cd[i]! <= 0 && hasLOS(w, E.x[i]!, E.y[i]!, p.x, p.y) && acquireToken(w, i)) {
          E.aim[i] = toP;
          setState(w, i, AS.Windup);
        }
      }
    }
  }
}

// ───────────────────────────── Archer: roots, blooms, locks aim, releases a fast thorn
const ARCHER_ACTS = new Int8Array([AS.Move, AS.Retreat, AS.Windup]);
const ARCHER_AIM = 1.15;
function archer(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  const toP = angleToPlayer(w, i);
  const sp = speedOf(w, i);
  const st = E.st[i]!;
  if (st === AS.Windup) {
    // first 75% tracks with lead, then locks — dodgeable by reading the telegraph
    const lockAt = ARCHER_AIM * 0.75;
    if (E.stT[i]! < lockAt) {
      const L = leadAim(w, E.x[i]!, E.y[i]!, 30 * w.diff.bulletSpeedMul, 0.6);
      const target = datan2(L[1]! - E.y[i]!, L[0]! - E.x[i]!) + w.rng.sym() * 0.02 * aimErr(w);
      faceToward(w, i, target, 4);
      E.aim[i] = E.face[i]!;
    }
    E.charge[i] = Math.min(1, E.stT[i]! / ARCHER_AIM);
    integrate(w, i, 0, 0);
    if (E.stT[i]! >= ARCHER_AIM) {
      const a = E.aim[i]!;
      const mx = E.x[i]! + dcos(a) * 0.9;
      const my = E.y[i]! + dsin(a) * 0.9;
      spawnBullet(w, Team.Enemy, BK.Arrow, mx, my, a, 30 * w.diff.bulletSpeedMul, 20, 0.2, 1.6, 0, 0, 0, 0, 0, 0);
      w.events.push(Ev.ArcherRelease, mx, my, a);
      w.events.push(Ev.EnemyShoot, mx, my, a, ET.Archer, BK.Arrow);
      E.kx[i] = E.kx[i]! - dcos(a) * 3;
      E.ky[i] = E.ky[i]! - dsin(a) * 3;
      releaseToken(w, i);
      E.charge[i] = 0;
      E.cd[i] = (2.2 + E.seed[i]!) * cdMul(w);
      setState(w, i, AS.Recover);
    }
    return;
  }
  if (st === AS.Recover) {
    E.charge[i] = Math.max(0, E.charge[i]! - DT * 3);
    integrate(w, i, 0, 0);
    if (E.stT[i]! > 0.45) {
      pickArcherSpot(w, i);
      setState(w, i, AS.Move);
    }
    return;
  }
  if (E.think[i]! <= 0) {
    E.think[i] = 0.25;
    const los = hasLOS(w, E.x[i]!, E.y[i]!, p.x, p.y);
    U[0] = (los ? 0.2 : 0.8) + (d > 22 ? 0.5 : 0) + (d < 9 ? 0.3 : 0);
    U[1] = d < 7 ? 0.6 + (1 - d / 7) * 0.4 : 0;
    U[2] = los && E.cd[i]! <= 0 && d > 6 && d < 24 ? 0.9 : 0;
    if (U[2]! > 0 && !acquireToken(w, i)) U[2] = 0;
    const best = pickBest(w, i, st, ARCHER_ACTS);
    if (best !== AS.Windup && E.token[i]) releaseToken(w, i);
    if (best === AS.Move && (st !== AS.Move || E.stT[i]! > 2.5)) pickArcherSpot(w, i);
    setState(w, i, best);
  }
  const cur = E.st[i]!;
  if (cur === AS.Move) {
    const dv = pathTo(w, i, E.tx[i]!, E.ty[i]!, false);
    faceToward(w, i, datan2(dv[1]!, dv[0]!), 6);
    const dx = E.tx[i]! - E.x[i]!;
    const dy = E.ty[i]! - E.y[i]!;
    const slow = Math.min(1, Math.sqrt(dx * dx + dy * dy) / 2);
    integrate(w, i, dv[0]! * sp * slow, dv[1]! * sp * slow);
  } else if (cur === AS.Retreat) {
    faceToward(w, i, toP, 6);
    integrate(w, i, -dcos(toP) * sp * 1.2, -dsin(toP) * sp * 1.2);
  } else {
    integrate(w, i, 0, 0);
  }
}

function pickArcherSpot(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  let bestX = E.x[i]!;
  let bestY = E.y[i]!;
  let bestS = -1e9;
  for (let s = 0; s < 6; s++) {
    const a = w.rng.range(0, 6.283);
    const r = w.rng.range(13, 19);
    const tx = clampX(p.x + dcos(a) * r);
    const ty = clampY(p.y + dsin(a) * r);
    let score = hasLOS(w, tx, ty, p.x, p.y) ? 10 : 0;
    const dx = tx - E.x[i]!;
    const dy = ty - E.y[i]!;
    score -= Math.sqrt(dx * dx + dy * dy) * 0.3;
    if (score > bestS) {
      bestS = score;
      bestX = tx;
      bestY = ty;
    }
  }
  E.tx[i] = bestX;
  E.ty[i] = bestY;
}

// ───────────────────────────── Shielder: bodyguards a ranged ally, slow turn (flank it!)
function shielder(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  const toP = angleToPlayer(w, i);
  const sp = speedOf(w, i);
  faceToward(w, i, toP, 1.7);
  const st = E.st[i]!;
  if (st === AS.Windup) {
    E.charge[i] = Math.min(1, E.stT[i]! / 0.65);
    integrate(w, i, 0, 0);
    if (E.stT[i]! >= 0.65) {
      const n = 5;
      for (let k = 0; k < n; k++) {
        const a = E.face[i]! + (k / (n - 1) - 0.5) * 0.7;
        spawnBullet(w, Team.Enemy, BK.Shard, E.x[i]! + dcos(a), E.y[i]! + dsin(a), a, 14 * w.diff.bulletSpeedMul, 10, 0.26, 2, 0, 0, 0, 0, 0, 0);
      }
      w.events.push(Ev.EnemyShoot, E.x[i]!, E.y[i]!, E.face[i]!, ET.Shielder, BK.Shard);
      releaseToken(w, i);
      E.charge[i] = 0;
      E.cd[i] = 3.2 * cdMul(w);
      setState(w, i, AS.Guard);
    }
    return;
  }
  if (E.think[i]! <= 0) {
    E.think[i] = 0.3;
    // find nearest ranged ally to protect
    let ally = -1;
    let bestD = 14 * 14;
    for (let k = 0; k < E.activeCount; k++) {
      const j = E.active[k]!;
      if (j === i || !E.alive[j]) continue;
      const t = E.type[j];
      if (t !== ET.Archer && t !== ET.Gunner) continue;
      const dx = E.x[j]! - E.x[i]!;
      const dy = E.y[j]! - E.y[i]!;
      const dd = dx * dx + dy * dy;
      if (dd < bestD) {
        bestD = dd;
        ally = j;
      }
    }
    if (ally >= 0) {
      const ax = E.x[ally]!;
      const ay = E.y[ally]!;
      const a = datan2(p.y - ay, p.x - ax);
      E.tx[i] = ax + dcos(a) * 2.6;
      E.ty[i] = ay + dsin(a) * 2.6;
    } else {
      E.tx[i] = p.x - dcos(toP) * 7;
      E.ty[i] = p.y - dsin(toP) * 7;
    }
    E.aux[i] = ally;
    if (E.cd[i]! <= 0 && d < 15 && hasLOS(w, E.x[i]!, E.y[i]!, p.x, p.y) && acquireToken(w, i)) {
      setState(w, i, AS.Windup);
      integrate(w, i, 0, 0);
      return;
    }
    setState(w, i, AS.Guard);
  }
  const dx = E.tx[i]! - E.x[i]!;
  const dy = E.ty[i]! - E.y[i]!;
  const dd = Math.sqrt(dx * dx + dy * dy);
  if (dd > 0.6) {
    const dv = pathTo(w, i, E.tx[i]!, E.ty[i]!, false);
    const s = Math.min(1, dd / 2) * sp;
    integrate(w, i, dv[0]! * s, dv[1]! * s);
  } else {
    integrate(w, i, 0, 0);
  }
}

function clampX(x: number): number {
  return Math.max(-ARENA_HW + 2, Math.min(ARENA_HW - 2, x));
}
function clampY(y: number): number {
  return Math.max(-ARENA_HH + 2, Math.min(ARENA_HH - 2, y));
}
