import { Ev } from '../core/events';
import { dcos, dsin, datan2, segDist2 } from '../core/detmath';
import { AS, ARENA_HH, ARENA_HW, BK, DT, ET, Team } from '../sim/constants';
import { enemyDef } from '../sim/content/enemies';
import { acquireToken, drainPlayer, hurtPlayer, killEnemy, releaseToken, SHIELD_HP, spawnBullet, spawnEnemy } from '../sim/systems/entities';
import { hasLOS } from '../sim/systems/physics';
import { arcFrom } from '../sim/systems/foundry';
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
/** telegraph / wind-up duration scaled by difficulty (never below what is readable) */
function tel(w: World, base: number): number {
  return base * w.diff.teleMul;
}

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
    if (E.buff[i]! > 0) E.buff[i] = E.buff[i]! - 1;
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
    if (E.haste[i]! > 0) E.haste[i] = E.haste[i]! - DT;
    // shorted by electricity: machines lock up completely, everything else just can't act
    if (E.shortT[i]! > 0) {
      E.shortT[i] = E.shortT[i]! - DT;
      E.vx[i] = E.vx[i]! * 0.85;
      E.vy[i] = E.vy[i]! * 0.85;
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
      case ET.Bloater:
        bloater(w, i);
        break;
      case ET.Dart:
        dart(w, i);
        break;
      case ET.Worm:
        worm(w, i);
        break;
      case ET.Parasite:
        parasite(w, i);
        break;
      case ET.Brood:
        brood(w, i);
        break;
      case ET.GearMite:
        gearMite(w, i);
        break;
      case ET.Stamper:
        stamper(w, i);
        break;
      case ET.ArcDrone:
        arcDrone(w, i);
        break;
      case ET.Hauler:
        hauler(w, i);
        break;
      case ET.Skiff:
        skiff(w, i);
        break;
      case ET.Overseer:
        overseer(w, i);
        break;
      case ET.Press:
        press(w, i);
        break;
      case ET.Assembler:
        assembler(w, i);
        break;
      case ET.Arm:
        arm(w, i);
        break;
    }
    contact(w, i);
    // safety net: nothing may ever leave the arena (an unreachable enemy would stall the wave)
    const r = E.r[i]!;
    if (E.x[i]! < -ARENA_HW + r) E.x[i] = -ARENA_HW + r;
    else if (E.x[i]! > ARENA_HW - r) E.x[i] = ARENA_HW - r;
    if (E.y[i]! < -ARENA_HH + r) E.y[i] = -ARENA_HH + r;
    else if (E.y[i]! > ARENA_HH - r) E.y[i] = ARENA_HH - r;
  }
}

function speedOf(w: World, i: number): number {
  const E = w.enemies;
  return enemyDef(E.type[i]!).speed * E.speedMul[i]! * w.phys.enemySpeed * (E.buff[i]! > 0 ? 1.3 : 1) * (E.haste[i]! > 0 ? 1.1 : 1);
}

function contact(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  if (!p.alive || E.st[i] === AS.Underground || E.st[i] === AS.Burrow || E.st[i] === AS.Attached) return;
  const dx = p.x - E.x[i]!;
  const dy = p.y - E.y[i]!;
  const rr = E.r[i]! + p.r * 0.8;
  if (dx * dx + dy * dy < rr * rr) {
    const t = E.type[i]!;
    // explicit attackers: a swarmer hurts by landing a pounce (bites are checked separately),
    // a worm only by its bites — walking into them is not a hit
    if (t === ET.Swarmer && E.st[i] !== AS.Leap) return;
    if (t === ET.Worm) return;
    let dmg = enemyDef(t).contactDmg;
    if (dmg <= 0) return;
    if (E.st[i] === AS.Dash || E.st[i] === AS.Leap) dmg *= 1.3;
    hurtPlayer(w, dmg, E.x[i]!, E.y[i]!, E.type[i]!);
  }
}

// ───────────────────────────── Swarmer: pack hunter — surrounds, POUNCES from mid range, BITES up close
export const SWARM = { pounceWind: 0.32, leap: 0.24, leapSpeed: 17, biteWind: 0.2, biteSnap: 0.12, biteReach: 1.0 } as const;
/** shared bite check: cone in front of the attacker; returns true if the player was hit */
function biteCheck(w: World, i: number, reach: number, dmg: number, cone = 0.35): boolean {
  const E = w.enemies;
  const p = w.player;
  if (!p.alive || p.dashT > 0) return false;
  const dx = p.x - E.x[i]!;
  const dy = p.y - E.y[i]!;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > E.r[i]! + p.r + reach) return false;
  const f = E.face[i]!;
  if (d > 0.3 && (dx * dcos(f) + dy * dsin(f)) / d < cone) return false;
  hurtPlayer(w, dmg, E.x[i]!, E.y[i]!, E.type[i]!);
  return true;
}
function swarmer(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  const toP = angleToPlayer(w, i);
  const sp = speedOf(w, i);
  switch (E.st[i]) {
    case AS.Windup: {
      // pounce coil: crouch, track the target (never shortened — already at reaction limit)
      faceToward(w, i, toP, 14);
      E.charge[i] = Math.min(1, E.stT[i]! / SWARM.pounceWind);
      integrate(w, i, -dcos(toP) * 0.6, -dsin(toP) * 0.6);
      if (E.stT[i]! >= SWARM.pounceWind) {
        E.aim[i] = E.face[i]!;
        setState(w, i, AS.Leap);
      }
      return;
    }
    case AS.Leap: {
      E.charge[i] = 0;
      const a = E.aim[i]!;
      E.vx[i] = dcos(a) * SWARM.leapSpeed;
      E.vy[i] = dsin(a) * SWARM.leapSpeed;
      integrate(w, i, E.vx[i]!, E.vy[i]!);
      if (E.stT[i]! >= SWARM.leap) {
        w.events.push(Ev.Land, E.x[i]!, E.y[i]!, ET.Swarmer);
        E.vx[i] = E.vx[i]! * 0.3;
        E.vy[i] = E.vy[i]! * 0.3;
        setState(w, i, AS.Recover);
      }
      return;
    }
    case AS.Attack: {
      // bite: rear back (mandibles open) → snap forward (they close) → a short cone check
      const t = E.stT[i]!;
      const W = SWARM.biteWind;
      if (t < W) {
        faceToward(w, i, toP, 12);
        E.charge[i] = t / W;
        integrate(w, i, -dcos(E.face[i]!) * 0.6, -dsin(E.face[i]!) * 0.6);
      } else {
        E.charge[i] = 0;
        const a = E.face[i]!;
        integrate(w, i, dcos(a) * 7, dsin(a) * 7);
        // the jaws close mid-lunge
        if (E.aux[i] === 0 && t >= W + 0.05) {
          E.aux[i] = 1;
          const hit = biteCheck(w, i, SWARM.biteReach, 8);
          w.events.push(Ev.Bite, E.x[i]! + dcos(a) * 0.5, E.y[i]! + dsin(a) * 0.5, a, ET.Swarmer, hit ? 1 : 0);
        }
        if (t >= W + SWARM.biteSnap) setState(w, i, AS.Recover);
      }
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
      let vx = (dv[0]! - dv[1]! * weave) * sp;
      let vy = (dv[1]! + dv[0]! * weave) * sp;
      // on cooldown and already at bite range: circle and snap at the air, never pile into the player
      const hold = E.r[i]! + p.r + 0.9;
      if (E.cd[i]! > 0 && d < hold + 0.6) {
        const rx = (p.x - E.x[i]!) / (d || 1);
        const ry = (p.y - E.y[i]!) / (d || 1);
        const radial = (d - hold) * 2.5;
        const s2 = E.aux2[i]! * sp * 0.55;
        vx = rx * radial - ry * s2;
        vy = ry * radial + rx * s2;
      }
      faceToward(w, i, datan2(vy, vx), 10);
      integrate(w, i, vx, vy);
      if (E.cd[i]! <= 0 && hasLOS(w, E.x[i]!, E.y[i]!, p.x, p.y)) {
        const reachBite = E.r[i]! + p.r + SWARM.biteReach + 0.3;
        if (d < reachBite) {
          E.aux[i] = 0;
          setState(w, i, AS.Attack);
        } else if (d > 2.6 && d < 5.5) setState(w, i, AS.Windup);
      }
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
    E.charge[i] = Math.min(1, E.stT[i]! / tel(w, 0.45));
    integrate(w, i, 0, 0);
    if (E.stT[i]! >= tel(w, 0.45)) {
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
      // alternate between the two barrels
      const side = (E.burst[i]! & 1 ? 1 : -1) * 0.25;
      const f = E.face[i]!;
      const mx = E.x[i]! + dcos(f) * 1.05 - dsin(f) * side;
      const my = E.y[i]! + dsin(f) * 1.05 + dcos(f) * side;
      const bb = spawnBullet(w, Team.Enemy, BK.Bolt, mx, my, a, 22 * w.diff.bulletSpeedMul, 9, 0.22, 2.2, 0, 0, 0, 0, 0, 0);
      if (bb >= 0) w.bullets.h0[bb] = 0.85;
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
      const WIND = Math.max(0.72, tel(w, 0.8));
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
const ARCHER_AIM_BASE = 1.15;
const archerAim = (w: World): number => tel(w, ARCHER_AIM_BASE);
function archer(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  const toP = angleToPlayer(w, i);
  const sp = speedOf(w, i);
  const st = E.st[i]!;
  if (st === AS.Windup) {
    // first 75% tracks with lead, then locks — dodgeable by reading the telegraph
    const lockAt = archerAim(w) * 0.75;
    if (E.stT[i]! < lockAt) {
      const L = leadAim(w, E.x[i]!, E.y[i]!, 30 * w.diff.bulletSpeedMul, 0.6);
      const target = datan2(L[1]! - E.y[i]!, L[0]! - E.x[i]!) + w.rng.sym() * 0.02 * aimErr(w);
      faceToward(w, i, target, 4);
      E.aim[i] = E.face[i]!;
    }
    E.charge[i] = Math.min(1, E.stT[i]! / archerAim(w));
    integrate(w, i, 0, 0);
    if (E.stT[i]! >= archerAim(w)) {
      const a = E.aim[i]!;
      const mx = E.x[i]! + dcos(a) * 0.9;
      const my = E.y[i]! + dsin(a) * 0.9;
      const ab = spawnBullet(w, Team.Enemy, BK.Arrow, mx, my, a, 30 * w.diff.bulletSpeedMul, 20, 0.2, 1.6, 0, 0, 0, 0, 0, 0);
      if (ab >= 0) w.bullets.h0[ab] = 1.3;
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
  // shattered shield reforms after SHIELD_DOWN seconds
  if (E.shield[i]! < 0) {
    E.shield[i] = E.shield[i]! + DT;
    if (E.shield[i]! >= 0) E.shield[i] = SHIELD_HP * w.diff.hpMul;
  }
  const st = E.st[i]!;
  if (st === AS.Windup) {
    E.charge[i] = Math.min(1, E.stT[i]! / tel(w, 0.65));
    integrate(w, i, 0, 0);
    if (E.stT[i]! >= tel(w, 0.65)) {
      const n = 5;
      for (let k = 0; k < n; k++) {
        const a = E.face[i]! + (k / (n - 1) - 0.5) * 0.7;
        const sb = spawnBullet(w, Team.Enemy, BK.Shard, E.x[i]! + dcos(a) * 1.2, E.y[i]! + dsin(a) * 1.2, a, 14 * w.diff.bulletSpeedMul, 10, 0.26, 2, 0, 0, 0, 0, 0, 0);
        if (sb >= 0) w.bullets.h0[sb] = 1.05;
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

// ───────────────────────────── Bloater: slow sac of acid; swells next to you and ruptures
const BLOAT_FUSE_BASE = 0.95;
function bloater(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  const sp = speedOf(w, i);
  E.aux[i] = Math.max(0, E.aux[i]! - DT); // pus-spray cooldown (see damageEnemy)
  if (E.st[i] === AS.Windup) {
    E.charge[i] = Math.min(1, E.stT[i]! / tel(w, BLOAT_FUSE_BASE));
    integrate(w, i, 0, 0);
    if (E.stT[i]! >= tel(w, BLOAT_FUSE_BASE)) {
      const x = E.x[i]!;
      const y = E.y[i]!;
      const R = 3.2;
      w.events.push(Ev.Explosion, x, y, R, 1.4, Team.Enemy);
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < R * R) hurtPlayer(w, 18, x, y, ET.Bloater);
      killEnemy(w, i, datan2(dy, dx), 0, 255, 0);
    }
    return;
  }
  const dv = pathTo(w, i, p.x, p.y, true);
  const wob = 0.85 + dsin(w.time * 5 + E.seed[i]! * 9) * 0.15;
  faceToward(w, i, datan2(dv[1]!, dv[0]!), 2.5);
  integrate(w, i, dv[0]! * sp * wob, dv[1]! * sp * wob);
  if (d < 3.4 && E.stT[i]! > 0.5) {
    E.aim[i] = angleToPlayer(w, i);
    setState(w, i, AS.Windup);
  }
}

// ───────────────────────────── Dart: fast drone, circles at range, then a telegraphed sting dive
function dart(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  const toP = angleToPlayer(w, i);
  const sp = speedOf(w, i);
  switch (E.st[i]) {
    case AS.Windup: {
      faceToward(w, i, toP, 9);
      E.aim[i] = E.face[i]!;
      E.charge[i] = Math.min(1, E.stT[i]! / tel(w, 0.5));
      integrate(w, i, -dcos(toP) * 1.5, -dsin(toP) * 1.5); // pull back before striking
      if (E.stT[i]! >= tel(w, 0.5)) setState(w, i, AS.Dash);
      return;
    }
    case AS.Dash: {
      const a = E.aim[i]!;
      E.vx[i] = dcos(a) * 26;
      E.vy[i] = dsin(a) * 26;
      integrate(w, i, E.vx[i]!, E.vy[i]!);
      if (E.stT[i]! >= 0.32) {
        E.charge[i] = 0;
        releaseToken(w, i);
        E.cd[i] = (2 + E.seed[i]! * 1.5) * cdMul(w);
        setState(w, i, AS.Recover);
      }
      return;
    }
    case AS.Recover:
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= 0.45) setState(w, i, AS.Strafe);
      return;
    default: {
      // orbit: tangential + radial correction toward ring of radius 7
      const s = E.aux2[i]!;
      const rx = (p.x - E.x[i]!) / (d || 1);
      const ry = (p.y - E.y[i]!) / (d || 1);
      const radial = Math.max(-1, Math.min(1, (d - 7) * 0.35));
      const vx = (-ry * s + rx * radial) * sp;
      const vy = (rx * s + ry * radial) * sp;
      faceToward(w, i, datan2(vy, vx), 8);
      if (d > 14) {
        const dv = pathTo(w, i, p.x, p.y, true);
        integrate(w, i, dv[0]! * sp, dv[1]! * sp);
      } else integrate(w, i, vx, vy);
      if (E.think[i]! <= 0) {
        E.think[i] = 0.25;
        if (d < 11 && E.cd[i]! <= 0 && hasLOS(w, E.x[i]!, E.y[i]!, p.x, p.y) && acquireToken(w, i)) setState(w, i, AS.Windup);
        else if (w.rng.chance(0.06)) E.aux2[i] = -E.aux2[i]!;
      }
    }
  }
}

// ───────────────────────────── Worm: crawls → DIVES beak-first from mid range → swims under the floor
// toward where you WILL be → the mound tracks you, then locks → BURSTS UP and bites.
// Skill: move after the lock and the bite misses — a worm that misses is stuck (+50% damage).
export const WORM = {
  diveMin: 5, diveMax: 12, burrow: 0.45, maxUnder: 3.6, speedUnder: 13,
  warn: 0.65, track: 0.5, trackSpeed: 3.2, emerge: 0.35, radius: 1.7, stuck: 1.1,
  biteWind: 0.35, biteSnap: 0.16,
} as const;
function worm(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  switch (E.st[i]) {
    case AS.Burrow: {
      // dive: a forward lunge, nose down, sinking into the floor
      const k = Math.max(0, 1 - E.stT[i]! / WORM.burrow);
      const a = E.face[i]!;
      integrate(w, i, dcos(a) * 8 * k, dsin(a) * 8 * k);
      if (E.stT[i]! >= WORM.burrow) {
        wormRetarget(w, i);
        setState(w, i, AS.Underground);
      }
      return;
    }
    case AS.Underground: {
      if (E.think[i]! <= 0) {
        E.think[i] = 0.25;
        wormRetarget(w, i);
      }
      const dx = E.tx[i]! - E.x[i]!;
      const dy = E.ty[i]! - E.y[i]!;
      const dd = Math.sqrt(dx * dx + dy * dy);
      const sp = WORM.speedUnder * w.phys.enemySpeed;
      if (dd > 0.01) {
        const step = Math.min(dd, sp * DT);
        E.vx[i] = (dx / dd) * sp;
        E.vy[i] = (dy / dd) * sp;
        // under the floor: pillars don't block, only the arena walls do
        E.x[i] = Math.max(-ARENA_HW + 1, Math.min(ARENA_HW - 1, E.x[i]! + (dx / dd) * step));
        E.y[i] = Math.max(-ARENA_HH + 1, Math.min(ARENA_HH - 1, E.y[i]! + (dy / dd) * step));
        E.face[i] = datan2(dy, dx);
        E.walk[i] = E.walk[i]! + step * 2;
      }
      if (dd < 1.2 || E.stT[i]! > WORM.maxUnder) {
        E.vx[i] = 0;
        E.vy[i] = 0;
        setState(w, i, AS.Windup);
      }
      return;
    }
    case AS.Windup: {
      // telegraph: the floor bulges. For the first half the mound creeps after you, then it locks.
      const W = tel(w, WORM.warn);
      E.charge[i] = Math.min(1, E.stT[i]! / W);
      if (E.stT[i]! < W * WORM.track && p.alive) {
        const dx = p.x - E.x[i]!;
        const dy = p.y - E.y[i]!;
        const dd = Math.sqrt(dx * dx + dy * dy) || 1;
        const step = Math.min(dd, WORM.trackSpeed * DT);
        E.x[i] = E.x[i]! + (dx / dd) * step;
        E.y[i] = E.y[i]! + (dy / dd) * step;
      }
      if (E.stT[i]! >= W) {
        E.charge[i] = 0;
        E.face[i] = angleToPlayer(w, i);
        // the bite: straight up out of the floor
        const dx = p.x - E.x[i]!;
        const dy = p.y - E.y[i]!;
        const inRange = p.alive && dx * dx + dy * dy < WORM.radius * WORM.radius;
        const hit = inRange && p.dashT <= 0;
        if (hit) hurtPlayer(w, 16, E.x[i]!, E.y[i]!, ET.Worm);
        E.aux[i] = hit ? 1 : 0; // remember: hit or miss
        w.events.push(Ev.WormEmerge, E.x[i]!, E.y[i]!, WORM.radius, hit ? 1 : 0);
        setState(w, i, AS.Emerge);
      }
      return;
    }
    case AS.Emerge:
      faceToward(w, i, angleToPlayer(w, i), 6);
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= WORM.emerge) {
        if (E.aux[i] === 1) {
          E.cd[i] = 1.4 * cdMul(w);
          setState(w, i, AS.Recover);
        } else setState(w, i, AS.Stunned); // missed: stuck half out of the floor
      }
      return;
    case AS.Stunned:
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= WORM.stuck) {
        E.cd[i] = 0.8 * cdMul(w);
        setState(w, i, AS.Move);
      }
      return;
    case AS.Attack: {
      // surface bite when you get close: rear up, then snap forward
      const t = E.stT[i]!;
      const W = tel(w, WORM.biteWind);
      if (t < W) {
        faceToward(w, i, angleToPlayer(w, i), 6);
        E.charge[i] = t / W;
        integrate(w, i, 0, 0);
      } else {
        E.charge[i] = 0;
        const a = E.face[i]!;
        integrate(w, i, dcos(a) * 9, dsin(a) * 9);
        if (E.aux[i] === 0) {
          E.aux[i] = 1;
          const hit = biteCheck(w, i, 1.1, 12);
          w.events.push(Ev.Bite, E.x[i]! + dcos(a) * 0.7, E.y[i]! + dsin(a) * 0.7, a, ET.Worm, hit ? 1 : 0);
        }
        if (t >= W + WORM.biteSnap) {
          E.cd[i] = 1.2 * cdMul(w);
          setState(w, i, AS.Recover);
        }
      }
      return;
    }
    case AS.Recover:
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= 0.5) setState(w, i, AS.Move);
      return;
    default: {
      // on the surface: crawl closer; dive from mid range, bite up close
      const sp = speedOf(w, i);
      const dv = pathTo(w, i, p.x, p.y, true);
      faceToward(w, i, datan2(dv[1]!, dv[0]!), 5);
      integrate(w, i, dv[0]! * sp, dv[1]! * sp);
      if (E.cd[i]! <= 0 && E.stT[i]! > 0.4 && p.alive) {
        if (d >= WORM.diveMin && d <= WORM.diveMax) {
          faceToward(w, i, angleToPlayer(w, i), 50);
          w.events.push(Ev.WormBurrow, E.x[i]! + dcos(E.face[i]!) * 0.8, E.y[i]! + dsin(E.face[i]!) * 0.8);
          setState(w, i, AS.Burrow);
        } else if (d < E.r[i]! + p.r + 1.6) {
          E.aux[i] = 0;
          setState(w, i, AS.Attack);
        }
      }
    }
  }
}

/** aim at the player's predicted position at arrival time (with difficulty-scaled error) */
function wormRetarget(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const dx = p.x - E.x[i]!;
  const dy = p.y - E.y[i]!;
  const d = Math.sqrt(dx * dx + dy * dy);
  const eta = d / WORM.speedUnder + tel(w, WORM.warn) * 0.6;
  const err = aimErr(w);
  E.tx[i] = Math.max(-ARENA_HW + 1.5, Math.min(ARENA_HW - 1.5, p.x + p.vx * eta * 0.8 + w.rng.sym() * err * 1.2));
  E.ty[i] = Math.max(-ARENA_HH + 1.5, Math.min(ARENA_HH - 1.5, p.y + p.vy * eta * 0.8 + w.rng.sym() * err * 1.2));
}

// ───────────────────────────── Parasite: a hungry blood-tick. State machine:
//   Move (hungry: picks a host — a sturdy creature or the player)
//   → Windup (crouch) → Leap ─┬─ touches the player → Attached(player) drains N×1 over ~1 s
//                             └─ misses → Recover → Move
//   Attached(player) ─┬─ fed → Retreat (hops away, swollen) → Guard (sated: keeps away, shrinks) → Move
//                     └─ player dashes → Stunned (shaken off, +50% damage) → Move
//   Attached(creature): rides and feeds it (−40% damage taken, +30% speed) until the host dies.
// E.tx = host index (-1 = the player), E.ty = host generation, E.aux = timer, E.burst = ticks drained.
export const PARA = { leapWind: 0.32, leap: 0.3, leapSpeed: 15, drainTicks: 6, drainTime: 1.0, hop: 0.35, sated: 4, shaken: 0.9 } as const;
function hostValid(w: World, h: number, gen: number): boolean {
  const E = w.enemies;
  return h >= 0 && !!E.alive[h] && E.gen[h] === gen && E.type[h] !== ET.Parasite && E.st[h] !== AS.Underground && E.st[h] !== AS.Spawning;
}
function parasite(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  switch (E.st[i]) {
    case AS.Attached: {
      const h = E.tx[i]! | 0;
      if (h === -1) {
        // ── on the player
        if (!p.alive) return setState(w, i, AS.Move);
        if (p.dashT > 0) {
          // shaken off by a dash: flung away and dazed
          const a = datan2(E.y[i]! - p.y, E.x[i]! - p.x);
          E.kx[i] = dcos(a) * 10;
          E.ky[i] = dsin(a) * 10;
          w.events.push(Ev.ShakeOff, E.x[i]!, E.y[i]!);
          return setState(w, i, AS.Stunned);
        }
        const f = p.face + Math.PI;
        E.x[i] = p.x + dcos(f) * 0.35;
        E.y[i] = p.y + dsin(f) * 0.35;
        E.face[i] = p.face;
        E.vx[i] = p.vx;
        E.vy[i] = p.vy;
        const n = PARA.drainTicks;
        const due = Math.min(n, Math.floor((E.stT[i]! / PARA.drainTime) * n + 1e-6));
        while (E.burst[i]! < due) {
          E.burst[i] = E.burst[i]! + 1;
          drainPlayer(w, 1, ET.Parasite);
          E.fed[i] = E.burst[i]! / n;
        }
        if (E.burst[i]! >= n) {
          // full: let go and hop away
          E.fed[i] = 1;
          const a = datan2(E.y[i]! - p.y, E.x[i]! - p.x) + w.rng.sym() * 0.6;
          E.aim[i] = a;
          setState(w, i, AS.Retreat);
        }
        return;
      }
      // ── on a creature
      if (!hostValid(w, h, E.ty[i]! | 0) || h === i) {
        setState(w, i, AS.Move);
        E.kx[i] = w.rng.sym() * 6;
        E.ky[i] = w.rng.sym() * 6;
        return;
      }
      E.buff[h] = 3;
      const f = E.face[h]!;
      E.x[i] = E.x[h]! - dcos(f) * E.r[h]! * 0.35;
      E.y[i] = E.y[h]! - dsin(f) * E.r[h]! * 0.35;
      E.face[i] = f;
      E.vx[i] = E.vx[h]!;
      E.vy[i] = E.vy[h]!;
      return;
    }
    case AS.Windup: {
      faceToward(w, i, angleToPlayer(w, i), 14);
      E.charge[i] = Math.min(1, E.stT[i]! / tel(w, PARA.leapWind));
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= tel(w, PARA.leapWind)) {
        E.aim[i] = E.face[i]!;
        setState(w, i, AS.Leap);
      }
      return;
    }
    case AS.Leap: {
      E.charge[i] = 0;
      const a = E.aim[i]!;
      E.vx[i] = dcos(a) * PARA.leapSpeed;
      E.vy[i] = dsin(a) * PARA.leapSpeed;
      integrate(w, i, E.vx[i]!, E.vy[i]!);
      if (p.alive && p.dashT <= 0 && !w.god && d < E.r[i]! + p.r + 0.25) {
        // latched
        E.tx[i] = -1;
        E.ty[i] = 0;
        E.burst[i] = 0;
        w.events.push(Ev.Latch, p.x, p.y);
        return setState(w, i, AS.Attached);
      }
      if (E.stT[i]! >= PARA.leap) {
        E.cd[i] = 0.9 * cdMul(w);
        setState(w, i, AS.Recover);
      }
      return;
    }
    case AS.Retreat: {
      // fed: one swollen hop away from the player
      const a = E.aim[i]!;
      const k = 1 - E.stT[i]! / PARA.hop;
      integrate(w, i, dcos(a) * 11 * Math.max(0, k), dsin(a) * 11 * Math.max(0, k));
      if (E.stT[i]! >= PARA.hop) {
        w.events.push(Ev.Land, E.x[i]!, E.y[i]!, ET.Parasite);
        setState(w, i, AS.Guard);
      }
      return;
    }
    case AS.Guard: {
      // sated: keeps its distance, digests (shrinks back), never attacks
      const S = PARA.sated * cdMul(w);
      E.fed[i] = Math.max(0, 1 - E.stT[i]! / S);
      const sp = speedOf(w, i) * 0.45;
      const away = d < 8 ? -1 : d > 11 ? 0.4 : 0;
      const rx = (p.x - E.x[i]!) / (d || 1);
      const ry = (p.y - E.y[i]!) / (d || 1);
      const s = E.aux2[i]! * 0.6;
      integrate(w, i, (rx * away - ry * s) * sp, (ry * away + rx * s) * sp);
      faceToward(w, i, datan2(E.vy[i]!, E.vx[i]!), 6);
      if (E.stT[i]! >= S) {
        E.fed[i] = 0;
        setState(w, i, AS.Move); // hungry again
      }
      return;
    }
    case AS.Stunned:
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= PARA.shaken) {
        E.cd[i] = 1.2 * cdMul(w);
        setState(w, i, AS.Move);
      }
      return;
    case AS.Recover:
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= 0.35) setState(w, i, AS.Move);
      return;
  }
  // ── Move: hungry — choose the best host: a sturdy creature, or the player
  if (E.think[i]! <= 0) {
    E.think[i] = 0.3;
    let best = -1;
    let bd = 1e9;
    for (let k = 0; k < E.activeCount; k++) {
      const j = E.active[k]!;
      const t = E.type[j];
      if (j === i || !E.alive[j] || t === ET.Parasite || t === ET.Boss || t === ET.Brood || E.buff[j]! > 0) continue;
      if (E.st[j] === AS.Spawning || E.st[j] === AS.Underground) continue;
      const dx = E.x[j]! - E.x[i]!;
      const dy = E.y[j]! - E.y[i]!;
      const d2 = dx * dx + dy * dy;
      if (d2 > 18 * 18) continue;
      // prefer sturdy hosts (a buffed charger is a threat, a buffed swarmer is a waste)
      const fodder = t === ET.Swarmer || t === ET.GearMite || t === ET.Bloater;
      const score = (Math.sqrt(d2) / (1 + E.maxHp[j]! / 40)) * (fodder ? 3 : 1);
      if (score < bd) {
        bd = score;
        best = j;
      }
    }
    // the player is fresh blood: valued like a mid-weight host
    if (p.alive && d / 3 < bd) best = -1;
    E.aux[i] = best;
  }
  const h = E.aux[i]! | 0;
  const sp = speedOf(w, i);
  if (h >= 0 && h !== i && E.alive[h] && E.buff[h] === 0 && E.type[h] !== ET.Parasite && E.st[h] !== AS.Spawning && E.st[h] !== AS.Underground) {
    const dx = E.x[h]! - E.x[i]!;
    const dy = E.y[h]! - E.y[i]!;
    const dh = Math.sqrt(dx * dx + dy * dy);
    if (dh < E.r[h]! + 0.5) {
      E.tx[i] = h;
      E.ty[i] = E.gen[h]!;
      E.buff[h] = 3;
      setState(w, i, AS.Attached);
      return;
    }
    const dv = pathTo(w, i, E.x[h]!, E.y[h]!, false);
    faceToward(w, i, datan2(dv[1]!, dv[0]!), 12);
    integrate(w, i, dv[0]! * sp, dv[1]! * sp);
    return;
  }
  // hunting the player: close in (holding ~2.6 u while recharging), then crouch and leap
  const dv = pathTo(w, i, p.x, p.y, true);
  faceToward(w, i, angleToPlayer(w, i), 10);
  if (E.cd[i]! > 0 && d < 3.4) {
    const rx = (p.x - E.x[i]!) / (d || 1);
    const ry = (p.y - E.y[i]!) / (d || 1);
    const radial = (d - 2.6) * 2.5;
    const s2 = E.aux2[i]! * sp * 0.5;
    integrate(w, i, rx * radial - ry * s2, ry * radial + rx * s2);
  } else integrate(w, i, dv[0]! * sp, dv[1]! * sp);
  if (p.alive && d < 4.6 && E.cd[i]! <= 0 && hasLOS(w, E.x[i]!, E.y[i]!, p.x, p.y)) setState(w, i, AS.Windup);
}

// ───────────────────────────── Brood (Матка): immobile mother; spits acid, births the next generation
function brood(w: World, i: number): void {
  const E = w.enemies;
  const hpf = E.hp[i]! / E.maxHp[i]!;
  const rage = hpf < 0.5;
  faceToward(w, i, angleToPlayer(w, i), 0.8);
  integrate(w, i, 0, 0);
  E.aux[i] = E.aux[i]! + DT; // birth clock
  const birthEvery = (rage ? 5 : 7.5) * cdMul(w);
  // contraction before a birth: charge rises during the last 1.2 s
  E.charge[i] = Math.max(0, Math.min(1, (E.aux[i]! - (birthEvery - 1.2)) / 1.2));
  if (E.aux[i]! >= birthEvery) {
    E.aux[i] = 0;
    const n = rage ? 4 : 3;
    for (let k = 0; k < n; k++) {
      const a = w.rng.range(0, 6.283);
      spawnEnemy(w, ET.Swarmer, clampX(E.x[i]! + dcos(a) * 3.6), clampY(E.y[i]! + dsin(a) * 3.6));
    }
    if (hpf < 0.75) spawnEnemy(w, ET.Worm, clampX(E.x[i]! + 4), clampY(E.y[i]! + 2));
    if (rage) spawnEnemy(w, ET.Parasite, clampX(E.x[i]! - 3), clampY(E.y[i]! + 3));
    w.events.push(Ev.Birth, E.x[i]!, E.y[i]!, n);
  }
  // SHOVE: hugging the mother is not safe — a telegraphed contraction throws you off
  const SHOVE_R = E.r[i]! + 2.4;
  const pd = distToPlayer(w, i);
  if (E.ty[i]! > 0) {
    E.ty[i] = E.ty[i]! + DT;
    if (E.ty[i]! >= tel(w, 0.7)) {
      const p = w.player;
      if (p.alive && p.dashT <= 0 && pd < SHOVE_R) {
        hurtPlayer(w, 12, E.x[i]!, E.y[i]!, ET.Brood);
        const a = angleToPlayer(w, i);
        p.vx += dcos(a) * 18;
        p.vy += dsin(a) * 18;
      }
      w.events.push(Ev.Shockwave, E.x[i]!, E.y[i]!, SHOVE_R);
      E.ty[i] = 0;
      E.tx[i] = -2.5; // refractory
    }
  } else if (E.tx[i]! < 0) E.tx[i] = Math.min(0, E.tx[i]! + DT);
  else if (pd < SHOVE_R) {
    E.tx[i] = E.tx[i]! + DT;
    if (E.tx[i]! > 0.45) {
      E.ty[i] = DT;
      E.tx[i] = 0;
      w.events.push(Ev.Telegraph, E.x[i]!, E.y[i]!, SHOVE_R, tel(w, 0.7));
    }
  } else E.tx[i] = 0;
  // acid volley
  if (E.st[i] === AS.Windup) {
    if (E.stT[i]! >= tel(w, 0.55)) {
      const base = angleToPlayer(w, i);
      const m = rage ? 9 : 7;
      for (let k = 0; k < m; k++) {
        const a = base + (k / (m - 1) - 0.5) * 1.1;
        const b = spawnBullet(w, Team.Enemy, BK.Shard, E.x[i]! + dcos(a) * 2.4, E.y[i]! + dsin(a) * 2.4, a, 11 * w.diff.bulletSpeedMul, 12, 0.3, 3, 0, 0, 0, 0, 0, 0);
        if (b >= 0) w.bullets.h0[b] = 1.8;
      }
      w.events.push(Ev.EnemyShoot, E.x[i]!, E.y[i]!, base, ET.Brood, BK.Shard);
      E.cd[i] = (rage ? 1.8 : 2.6) * cdMul(w);
      setState(w, i, AS.Move);
    }
  } else if (E.cd[i]! <= 0) setState(w, i, AS.Windup);
}

// ═════════════════════════════ Акт III · ЛИТЕЙНЫЙ ЦЕХ ═════════════════════════════

/** bounce off arena walls and pillars; returns true when a bounce happened (velocity reflected) */
function bounceMove(w: World, i: number, speed: number): boolean {
  const E = w.enemies;
  const r = E.r[i]!;
  let nx = E.x[i]! + E.vx[i]! * DT;
  let ny = E.y[i]! + E.vy[i]! * DT;
  let bounced = false;
  if (nx < -ARENA_HW + r || nx > ARENA_HW - r) {
    E.vx[i] = -E.vx[i]!;
    nx = Math.max(-ARENA_HW + r, Math.min(ARENA_HW - r, nx));
    bounced = true;
  }
  if (ny < -ARENA_HH + r || ny > ARENA_HH - r) {
    E.vy[i] = -E.vy[i]!;
    ny = Math.max(-ARENA_HH + r, Math.min(ARENA_HH - r, ny));
    bounced = true;
  }
  const P = w.pillars;
  for (let k = 0; k < P.count; k++) {
    const dx = nx - P.x[k]!;
    const dy = ny - P.y[k]!;
    const rr = P.r[k]! + r;
    const d2 = dx * dx + dy * dy;
    if (d2 < rr * rr) {
      const d = Math.sqrt(d2) || 0.001;
      const ux = dx / d;
      const uy = dy / d;
      const dot = E.vx[i]! * ux + E.vy[i]! * uy;
      E.vx[i] = E.vx[i]! - 2 * dot * ux;
      E.vy[i] = E.vy[i]! - 2 * dot * uy;
      nx = P.x[k]! + ux * (rr + 0.01);
      ny = P.y[k]! + uy * (rr + 0.01);
      bounced = true;
    }
  }
  // keep the speed exact after reflections
  const v = Math.sqrt(E.vx[i]! * E.vx[i]! + E.vy[i]! * E.vy[i]!) || 1;
  E.vx[i] = (E.vx[i]! / v) * speed;
  E.vy[i] = (E.vy[i]! / v) * speed;
  E.x[i] = nx;
  E.y[i] = ny;
  E.face[i] = datan2(E.vy[i]!, E.vx[i]!);
  E.walk[i] = E.walk[i]! + speed * DT * 2.2;
  return bounced;
}

// ───────────────────────────── Gear Mite: idle → spin-up → roll (≤3 bounces) → dizzy
function gearMite(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  switch (E.st[i]) {
    case AS.Windup: {
      // spin-up: lock a straight roll line at the player's predicted position
      const L = leadAim(w, E.x[i]!, E.y[i]!, 13, 0.6);
      faceToward(w, i, datan2(L[1]! - E.y[i]!, L[0]! - E.x[i]!), 8);
      E.charge[i] = Math.min(1, E.stT[i]! / tel(w, 0.6));
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= tel(w, 0.6)) {
        E.aim[i] = E.face[i]!;
        const v = 13 * w.phys.enemySpeed * (E.haste[i]! > 0 ? 1.1 : 1);
        E.vx[i] = dcos(E.aim[i]!) * v;
        E.vy[i] = dsin(E.aim[i]!) * v;
        E.burst[i] = 0;
        E.charge[i] = 1;
        setState(w, i, AS.Dash);
      }
      return;
    }
    case AS.Dash: {
      const v = 13 * w.phys.enemySpeed * (E.haste[i]! > 0 ? 1.1 : 1);
      if (bounceMove(w, i, v)) E.burst[i] = E.burst[i]! + 1;
      if (E.burst[i]! >= 3 || E.stT[i]! >= 2.5) {
        E.charge[i] = 0;
        E.vx[i] = E.vx[i]! * 0.2;
        E.vy[i] = E.vy[i]! * 0.2;
        setState(w, i, AS.Stunned); // dizzy: +25% damage taken
      }
      return;
    }
    case AS.Stunned:
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= 1.2) {
        E.aux[i] = w.rng.range(0.5, 1.5);
        setState(w, i, AS.Move);
      }
      return;
    default: {
      // scuttle in at full speed; spin up only once within striking range
      if (E.aux[i]! <= 0) E.aux[i] = w.rng.range(0.4, 1.1);
      const dv = pathTo(w, i, p.x, p.y, true);
      const d = distToPlayer(w, i);
      const sp = d > 7 ? speedOf(w, i) : speedOf(w, i) * 0.45;
      integrate(w, i, dv[0]! * sp, dv[1]! * sp);
      faceToward(w, i, angleToPlayer(w, i), 6);
      if (E.stT[i]! >= E.aux[i]! && d < 9) {
        E.aux[i] = 0;
        setState(w, i, AS.Windup);
      }
    }
  }
}

// ───────────────────────────── Stamper: walk → mark ×3 (predicted) → stamp → recover
function stamper(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const noMarks = E.aux2[i] === 99; // ASSEMBLER self-assembly walker
  const MARK = tel(w, 2.2);
  switch (E.st[i]) {
    case AS.Windup: {
      integrate(w, i, 0, 0);
      E.charge[i] = Math.min(1, E.stT[i]! / MARK);
      // drop marks at 0, 1/3, 2/3 of the wind-up; all go hot together at STAMP
      // (E.burst counts marks already placed — robust to the first-tick offset)
      if (E.stT[i]! <= DT * 1.01) E.burst[i] = 0;
      while (E.burst[i]! < 3) {
        const k = E.burst[i]!;
        const at = (k / 3) * MARK * 0.95;
        if (E.stT[i]! - DT < at - 1e-9) break;
        E.burst[i] = k + 1;
        {
          let mx = p.x + p.vx * 0.8;
          let my = p.y + p.vy * 0.8;
          if (p.dashT > 0) {
            // never land a mark on a dashing player: shove it off their line
            mx += -p.dashY * 2.2;
            my += p.dashX * 2.2;
          }
          mx = clampX(mx);
          my = clampY(my);
          w.marks.add(mx, my, 1.5, MARK - at, 0.4, 35, ET.Stamper);
        }
      }
      if (E.stT[i]! >= MARK) setState(w, i, AS.Attack);
      return;
    }
    case AS.Attack:
      integrate(w, i, 0, 0);
      E.charge[i] = 1;
      if (E.stT[i]! >= 0.4) {
        E.charge[i] = 0;
        releaseToken(w, i);
        E.cd[i] = 2.6 * cdMul(w);
        setState(w, i, AS.Recover);
      }
      return;
    case AS.Recover:
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= 1.6) setState(w, i, AS.Move);
      return;
    default: {
      const sp = speedOf(w, i);
      const dv = pathTo(w, i, p.x, p.y, true);
      faceToward(w, i, datan2(dv[1]!, dv[0]!), 1.05); // 60°/s
      integrate(w, i, dcos(E.face[i]!) * sp, dsin(E.face[i]!) * sp);
      if (!noMarks && E.think[i]! <= 0) {
        E.think[i] = 0.3;
        const d = distToPlayer(w, i);
        if (d < 13 && E.cd[i]! <= 0 && acquireToken(w, i)) setState(w, i, AS.Windup);
      }
    }
  }
}

// ───────────────────────────── Arc Drone: hover → charge (locks a target point) → arc → cool
function arcDrone(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  const CH = tel(w, 1.0);
  switch (E.st[i]) {
    case AS.Windup: {
      E.charge[i] = Math.min(1, E.stT[i]! / CH);
      // keeps drifting around the target while charging — a stationary charge was a free kill
      {
        const rx = (p.x - E.x[i]!) / (d || 1);
        const ry = (p.y - E.y[i]!) / (d || 1);
        const s = E.aux2[i]! * speedOf(w, i) * 0.45;
        integrate(w, i, -ry * s, rx * s);
        // until the lock it may still side-step a shot
        E.aux[i] = Math.max(0, E.aux[i]! - DT);
        if (E.stT[i]! < CH * 0.75 && E.aux[i]! <= 0 && incomingThreat(w, i)) {
          E.kx[i] = E.kx[i]! + dir[0]! * 8;
          E.ky[i] = E.ky[i]! + dir[1]! * 8;
          E.aux[i] = 1.1;
        }
      }
      // tracks the player until 75% of the charge, then the bolt's end point is locked
      if (E.stT[i]! < CH * 0.75) {
        const La = leadAim(w, E.x[i]!, E.y[i]!, 30, 0.8);
        E.tx[i] = La[0]!;
        E.ty[i] = La[1]!;
        faceToward(w, i, angleToPlayer(w, i), 6);
      }
      if (E.stT[i]! >= CH) {
        // ARC: instant bolt to the locked point (max 9 u); if it lands in coolant, the pool is live
        const dx = E.tx[i]! - E.x[i]!;
        const dy = E.ty[i]! - E.y[i]!;
        const l = Math.sqrt(dx * dx + dy * dy) || 1;
        const reach = 10;
        const ex = E.x[i]! + (dx / l) * reach;
        const ey = E.y[i]! + (dy / l) * reach;
        const hit = p.alive && segDist2(p.x, p.y, E.x[i]!, E.y[i]!, ex, ey) < 0.85 * 0.85;
        w.events.push(Ev.Arc, E.x[i]!, E.y[i]!, ex, ey, hit ? 1 : 0);
        if (hit) hurtPlayer(w, 16, E.x[i]!, E.y[i]!, ET.ArcDrone);
        if (w.pools.at(ex, ey) >= 0) arcFrom(w, ex, ey, 4, 1, 12, true);
        E.charge[i] = 0;
        releaseToken(w, i);
        E.cd[i] = 1.6 * cdMul(w);
        setState(w, i, AS.Recover);
      }
      return;
    }
    case AS.Recover:
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= 0.3) setState(w, i, AS.Move);
      return;
    default: {
      // hover at ~9 u, orbiting; side-steps incoming fire like a gunner
      const sp = speedOf(w, i);
      E.aux[i] = Math.max(0, E.aux[i]! - DT);
      if (E.aux[i]! <= 0 && incomingThreat(w, i)) {
        E.kx[i] = E.kx[i]! + dir[0]! * 9;
        E.ky[i] = E.ky[i]! + dir[1]! * 9;
        E.aux[i] = 1.1;
        E.aux2[i] = -E.aux2[i]!;
      }
      const rx = (p.x - E.x[i]!) / (d || 1);
      const ry = (p.y - E.y[i]!) / (d || 1);
      const s = E.aux2[i]!;
      const radial = Math.max(-1, Math.min(1, (d - 9) * 0.4));
      integrate(w, i, (-ry * s + rx * radial) * sp, (rx * s + ry * radial) * sp);
      faceToward(w, i, angleToPlayer(w, i), 5);
      if (E.think[i]! <= 0) {
        E.think[i] = 0.25;
        if (d < 13 && E.cd[i]! <= 0 && hasLOS(w, E.x[i]!, E.y[i]!, p.x, p.y) && acquireToken(w, i)) setState(w, i, AS.Windup);
      }
    }
  }
}

// ───────────────────────────── Clamp Hauler: stalk → aim → hook (pull) → reel
function hauler(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  const AIM = tel(w, 1.0);
  switch (E.st[i]) {
    case AS.Windup:
      E.charge[i] = Math.min(1, E.stT[i]! / AIM);
      integrate(w, i, 0, 0);
      if (E.stT[i]! < AIM * 0.8) {
        faceToward(w, i, angleToPlayer(w, i), 4);
        E.aim[i] = E.face[i]!;
      }
      if (E.stT[i]! >= AIM) {
        E.aux[i] = 0; // hook distance
        w.events.push(Ev.HookFire, E.x[i]!, E.y[i]!, E.aim[i]!);
        setState(w, i, AS.Attack);
      }
      return;
    case AS.Attack: {
      integrate(w, i, 0, 0);
      E.aux[i] = E.aux[i]! + 18 * DT;
      const a = E.aim[i]!;
      const hx = E.x[i]! + dcos(a) * E.aux[i]!;
      const hy = E.y[i]! + dsin(a) * E.aux[i]!;
      const dx = p.x - hx;
      const dy = p.y - hy;
      if (p.alive && p.dashT <= 0 && dx * dx + dy * dy < 0.85 * 0.85) {
        hurtPlayer(w, 15, hx, hy, ET.Hauler);
        p.pullT = 0.5;
        p.pullBy = i;
        p.pullGen = E.gen[i]!;
        w.events.push(Ev.HookHit, hx, hy);
        E.charge[i] = 0;
        E.burst[i] = 1; // hooked: the clamp closes on arrival
        setState(w, i, AS.Recover);
      } else if (E.aux[i]! >= 9) {
        E.charge[i] = 0;
        setState(w, i, AS.Recover);
      }
      return;
    }
    case AS.Recover: {
      // reel: hook retracts at half speed, body exposed (+30%)
      integrate(w, i, 0, 0);
      E.aux[i] = Math.max(0, E.aux[i]! - 9 * DT);
      // CLAMP: a hooked target that arrives is crushed — telegraphed, a dash still escapes.
      // burst: 1 = hooked, waiting for arrival · 2 = clamp closing (aim = start time)
      const CL = tel(w, 0.4);
      if (E.burst[i] === 1) {
        if (distToPlayer(w, i) < 2.8) {
          E.burst[i] = 2;
          E.aim[i] = E.stT[i]!;
          w.events.push(Ev.Telegraph, E.x[i]!, E.y[i]!, 2.4, CL);
        } else if (E.stT[i]! > 1.0) E.burst[i] = 0; // the pull missed its window
      } else if (E.burst[i] === 2) {
        E.charge[i] = Math.min(1, (E.stT[i]! - E.aim[i]!) / CL);
        if (E.charge[i]! >= 1) {
          if (p.alive && p.dashT <= 0 && distToPlayer(w, i) < 2.4) hurtPlayer(w, 18, E.x[i]!, E.y[i]!, ET.Hauler);
          w.events.push(Ev.Shockwave, E.x[i]!, E.y[i]!, 2.4);
          E.charge[i] = 0;
          E.burst[i] = 0;
        }
      }
      if (E.stT[i]! >= 1.2 && E.burst[i] === 0) {
        releaseToken(w, i);
        E.cd[i] = 3 * cdMul(w);
        E.aux[i] = 0;
        E.charge[i] = 0;
        setState(w, i, AS.Move);
      }
      return;
    }
    default: {
      // stalk at 9–12 u
      const sp = speedOf(w, i);
      const rx = (p.x - E.x[i]!) / (d || 1);
      const ry = (p.y - E.y[i]!) / (d || 1);
      const radial = d < 9 ? -0.8 : d > 12 ? 0.8 : 0;
      const s = E.aux2[i]!;
      if (d > 14 || !hasLOS(w, E.x[i]!, E.y[i]!, p.x, p.y)) {
        const dv = pathTo(w, i, p.x, p.y, true);
        integrate(w, i, dv[0]! * sp, dv[1]! * sp);
      } else integrate(w, i, (rx * radial - ry * s * 0.6) * sp, (ry * radial + rx * s * 0.6) * sp);
      faceToward(w, i, angleToPlayer(w, i), 3);
      if (E.think[i]! <= 0) {
        E.think[i] = 0.3;
        if (d > 5 && d < 10.5 && E.cd[i]! <= 0 && hasLOS(w, E.x[i]!, E.y[i]!, p.x, p.y) && acquireToken(w, i)) setState(w, i, AS.Windup);
      }
    }
  }
}

// ───────────────────────────── Sawblade Skiff: cruise (homing turn 45°/s, burning track) → drift
function skiff(w: World, i: number): void {
  const E = w.enemies;
  if (E.st[i] === AS.Stunned) {
    // drift: slow, exposed (+20%)
    const v = 2;
    if (Math.abs(E.vx[i]!) + Math.abs(E.vy[i]!) < 0.01) {
      E.vx[i] = dcos(E.face[i]!);
      E.vy[i] = dsin(E.face[i]!);
    }
    bounceMove(w, i, v);
    if (E.stT[i]! >= 1.5) {
      E.burst[i] = 0;
      setState(w, i, AS.Move);
    }
    return;
  }
  // cruise
  const v = speedOf(w, i);
  faceToward(w, i, angleToPlayer(w, i), 1.25);
  E.vx[i] = dcos(E.face[i]!) * v;
  E.vy[i] = dsin(E.face[i]!) * v;
  if (bounceMove(w, i, v)) E.burst[i] = E.burst[i]! + 1;
  // drop a track segment every 0.25 s
  E.aux[i] = E.aux[i]! + DT;
  if (E.aux[i]! >= 0.25) {
    E.aux[i] = 0;
    if (E.stT[i]! > 0.3) w.tracks.add(E.tx[i]!, E.ty[i]!, E.x[i]!, E.y[i]!);
    E.tx[i] = E.x[i]!;
    E.ty[i] = E.y[i]!;
  }
  if (E.burst[i]! >= 4 || E.stT[i]! > 6) setState(w, i, AS.Stunned);
}

// ───────────────────────────── Overseer: patrol far → pulse (reverse nearby lanes) → tighten mites
function overseer(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const d = distToPlayer(w, i);
  // exposed once after losing 40% HP
  if (E.st[i] !== AS.Guard && E.aux2[i] !== 77 && E.dmgTaken[i]! >= E.maxHp[i]! * 0.4) {
    E.aux2[i] = 77;
    E.charge[i] = 0;
    setState(w, i, AS.Guard);
  }
  switch (E.st[i]) {
    case AS.Guard:
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= 2) setState(w, i, AS.Move);
      return;
    case AS.Windup: {
      E.charge[i] = Math.min(1, E.stT[i]! / 0.8);
      integrate(w, i, 0, 0);
      if (E.stT[i]! >= 0.8) {
        const L = w.lanes;
        const period = w.phys.lanePeriod;
        for (let k = 0; k < L.count; k++) {
          const dx = L.cx[k]! - E.x[i]!;
          const dy = L.cy[k]! - E.y[i]!;
          if (dx * dx + dy * dy > 12 * 12 || L.frozen[k]! > 0) continue;
          if (L.t[k]! < period - 1.0) L.t[k] = period - 1.0; // shortened warning
          w.events.push(Ev.LaneWarn, k);
        }
        E.charge[i] = 0;
        setState(w, i, AS.Attack);
      }
      return;
    }
    case AS.Attack:
      // tighten: nearby mites spin faster for 4 s
      integrate(w, i, 0, 0);
      if (E.stT[i]! < DT * 1.5) {
        for (let k = 0; k < E.hi; k++) {
          if (!E.alive[k] || E.type[k] !== ET.GearMite) continue;
          const dx = E.x[k]! - E.x[i]!;
          const dy = E.y[k]! - E.y[i]!;
          if (dx * dx + dy * dy < 64) E.haste[k] = 4;
        }
      }
      if (E.stT[i]! >= 1) {
        E.aux[i] = 0;
        setState(w, i, AS.Move);
      }
      return;
    default: {
      const sp = speedOf(w, i);
      const rx = (p.x - E.x[i]!) / (d || 1);
      const ry = (p.y - E.y[i]!) / (d || 1);
      const radial = d < 10 ? -1 : d > 15 ? 0.6 : 0;
      integrate(w, i, (rx * radial - ry * E.aux2[i]! * 0.5) * sp, (ry * radial + rx * E.aux2[i]! * 0.5) * sp);
      faceToward(w, i, angleToPlayer(w, i), 2);
      // too close: call the line's press down on the intruder (a telegraphed square mark)
      if (d < 7 && E.cd[i]! <= 0 && p.alive) {
        const mx = clampX(p.x + p.vx * 0.5);
        const my = clampY(p.y + p.vy * 0.5);
        w.marks.add(mx, my, 1.4, tel(w, 1.1), 0.3, 25, ET.Overseer, true);
        w.events.push(Ev.PadWarn, mx, my);
        E.cd[i] = 3.5 * cdMul(w);
      }
      E.aux[i] = E.aux[i]! + DT;
      if (E.aux[i]! >= 6 * cdMul(w)) setState(w, i, AS.Windup);
    }
  }
}

// ───────────────────────────── PRESS (mini-boss): stamp grid & sweeps → lane control → crush
const PRESS_PAT = { drop: 1, sweep: 2, lanes: 3, chain: 4, slam: 5, crush: 6, run: 7 } as const;
function press(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  const hpf = E.hp[i]! / E.maxHp[i]!;
  const phase = hpf > 0.66 ? 1 : hpf > 0.33 ? 2 : 3;
  if (phase !== E.burst[i]) {
    if (E.burst[i]! > 0) w.events.push(Ev.BossPhase, E.x[i]!, E.y[i]!, phase);
    E.burst[i] = phase;
    E.aux[i] = 0;
    E.cd[i] = 1.2;
  }
  const tg = (base: number): number => tel(w, base) - 0.2 * (phase - 1);
  const pat = E.aux[i]!;
  // hover north of the player (the gantry slides along its rail)
  if (pat !== PRESS_PAT.crush && pat !== PRESS_PAT.sweep) {
    const tx = clampX(p.x);
    const ty = clampY(Math.max(-ARENA_HH + 4, p.y - 9));
    const dx = tx - E.x[i]!;
    const dy = ty - E.y[i]!;
    const dd = Math.sqrt(dx * dx + dy * dy);
    const sp = speedOf(w, i) * (phase === 3 ? 1.4 : 1);
    integrate(w, i, dd > 0.5 ? (dx / dd) * sp : 0, dd > 0.5 ? (dy / dd) * sp : 0);
  }
  faceToward(w, i, angleToPlayer(w, i), 1);
  if (pat === 0) {
    if (E.cd[i]! > 0) return; // cd ticks in updateEnemies
    const opts = phase === 1 ? [PRESS_PAT.drop, PRESS_PAT.sweep] : phase === 2 ? [PRESS_PAT.lanes, PRESS_PAT.chain, PRESS_PAT.slam, PRESS_PAT.drop] : [PRESS_PAT.crush, PRESS_PAT.run, PRESS_PAT.drop];
    E.aux[i] = opts[w.rng.int(opts.length)]!;
    E.stT[i] = 0;
    E.tx[i] = 0;
    E.ty[i] = 0;
    return;
  }
  // time since the pattern started (stT already advanced once on the first tick)
  const t = E.stT[i]! - DT;
  const once = (at: number): boolean => t >= at && t - DT < at;
  switch (pat) {
    case PRESS_PAT.drop: {
      // 3×3 grid of 2×2 stamps around the player, one row left safe
      if (once(0)) {
        const safe = w.rng.int(3);
        const cx = clampX(p.x);
        const cy = clampY(p.y);
        const f = Math.max(0.8, tg(1.4));
        for (let r = 0; r < 3; r++) {
          if (r === safe) continue;
          for (let c = 0; c < 3 + (phase - 1); c++) w.marks.add(clampX(cx + (c - 1) * 2.6), clampY(cy + (r - 1) * 2.6), 1, f, 0.5, 35, ET.Press, true);
        }
        w.events.push(Ev.EnemyShoot, E.x[i]!, E.y[i]!, 0, ET.Press, 0);
      }
      if (t >= 2) endPattern(w, i, 0.8);
      return;
    }
    case PRESS_PAT.sweep: {
      // the gantry crosses the arena at the player's row, stamping behind itself
      const lead = Math.max(0.6, tg(1.0));
      if (once(0)) {
        E.ty[i] = clampY(p.y);
        E.tx[i] = p.x > 0 ? -ARENA_HW + 3 : ARENA_HW - 3; // start on the far side
        w.events.push(Ev.Telegraph, 0, E.ty[i]!, 0, lead);
      }
      const dir = E.tx[i]! < 0 ? 1 : -1;
      const x = E.tx[i]! + dir * Math.max(0, t - lead) * 6;
      if (t < lead) {
        // the gantry slides to the start of its run during the telegraph
        const k = Math.min(1, DT * 7);
        E.x[i] = E.x[i]! + (E.tx[i]! - E.x[i]!) * k;
        E.y[i] = E.y[i]! + (E.ty[i]! - 1 - E.y[i]!) * k;
      } else {
        E.x[i] = x;
        E.y[i] = E.ty[i]! - 1;
      }
      for (let k = 0; k < 40; k++) {
        const mx = E.tx[i]! + dir * k * 2;
        const at = lead + (k * 2) / 6;
        if (once(at) && Math.abs(mx) < ARENA_HW - 1) w.marks.add(mx, E.ty[i]!, 1, 0.6, 0.3, 30, ET.Press, true);
      }
      if ((Math.abs(x) > ARENA_HW - 2 && t > lead + 1) || t > lead + 14) {
        E.x[i] = clampX(E.x[i]!);
        endPattern(w, i, 0.8);
      }
      return;
    }
    case PRESS_PAT.lanes: {
      if (once(0)) {
        // reverse the two lanes nearest the player (with the normal warning)
        const L = w.lanes;
        const period = w.phys.lanePeriod;
        let a = -1;
        let b = -1;
        let da = 1e9;
        let db = 1e9;
        for (let k = 0; k < L.count; k++) {
          const dx = L.cx[k]! - p.x;
          const dy = L.cy[k]! - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < da) {
            db = da;
            b = a;
            da = d2;
            a = k;
          } else if (d2 < db) {
            db = d2;
            b = k;
          }
        }
        for (const k of [a, b]) {
          if (k < 0) continue;
          L.frozen[k] = 0;
          L.t[k] = Math.max(L.t[k]!, period - 1.5);
          w.events.push(Ev.LaneWarn, k);
        }
      }
      if (t >= 1.6) endPattern(w, i, 0.5);
      return;
    }
    case PRESS_PAT.chain: {
      // coolant gushes from the press, then it discharges into every pool
      if (once(0)) {
        for (let k = 0; k < 2; k++) w.pools.add(clampX(E.x[i]! + (k ? 3 : -3)), clampY(E.y[i]! + 4), 2.5, 7);
        w.events.push(Ev.PylonCharge, E.x[i]!, E.y[i]!);
      }
      const at = Math.max(0.8, tg(1.2));
      if (once(at)) arcFrom(w, E.x[i]!, E.y[i]!, 30, 3, 14, true);
      if (t >= at + 0.6) endPattern(w, i, 0.8);
      return;
    }
    case PRESS_PAT.slam: {
      // a lane is about to shunt 6 u in one tick: get off the belt
      const at = Math.max(1.0, tg(1.5));
      if (once(0)) {
        const k = w.lanes.at(p.x, p.y);
        let pick = k;
        if (pick < 0) {
          let bd = 1e9;
          for (let j = 0; j < w.lanes.count; j++) {
            const dx = w.lanes.cx[j]! - p.x;
            const dy = w.lanes.cy[j]! - p.y;
            if (dx * dx + dy * dy < bd) {
              bd = dx * dx + dy * dy;
              pick = j;
            }
          }
        }
        E.tx[i] = pick;
        if (pick >= 0) w.events.push(Ev.Shunt, pick, at, 0);
      }
      E.charge[i] = Math.min(1, t / at);
      if (once(at)) {
        const k = E.tx[i]! | 0;
        if (k >= 0 && k < w.lanes.count) {
          const L = w.lanes;
          if (p.alive && Math.abs(p.x - L.cx[k]!) < L.hw[k]! && Math.abs(p.y - L.cy[k]!) < L.hh[k]!) {
            hurtPlayer(w, 20, L.cx[k]!, L.cy[k]!, ET.Press);
            p.x = Math.max(-ARENA_HW + 0.6, Math.min(ARENA_HW - 0.6, p.x + L.dx[k]! * 6));
            p.y = Math.max(-ARENA_HH + 0.6, Math.min(ARENA_HH - 0.6, p.y + L.dy[k]! * 6));
          }
          w.events.push(Ev.Shunt, k, 0, 1);
        }
        E.charge[i] = 0;
      }
      if (t >= at + 0.5) endPattern(w, i, 0.8);
      return;
    }
    case PRESS_PAT.crush: {
      // descends on the centre: 6×6 zone, corners are safe
      const at = Math.max(1.4, tg(2.0));
      if (once(0)) w.marks.add(0, 0, 3, at, 1.0, 40, ET.Press, true);
      const k = Math.min(1, t / at);
      E.x[i] = E.x[i]! + (0 - E.x[i]!) * Math.min(1, DT * 4);
      E.y[i] = E.y[i]! + (0 - E.y[i]!) * Math.min(1, DT * 4);
      E.charge[i] = k;
      if (once(at)) w.events.push(Ev.Shockwave, 0, 0, 4);
      if (t >= at + 1.2) {
        E.charge[i] = 0;
        endPattern(w, i, 0.8);
      }
      return;
    }
    case PRESS_PAT.run: {
      // random walk, a stamp mark at the player's feet every second
      for (let s = 0; s < 5; s++) if (once(s * 1.0)) w.marks.add(clampX(p.x + p.vx * 0.5), clampY(p.y + p.vy * 0.5), 1.6, 0.9, 0.3, 30, ET.Press);
      if (t >= 5) endPattern(w, i, 1.0);
      return;
    }
  }
}

function endPattern(w: World, i: number, gap: number): void {
  const E = w.enemies;
  E.aux[i] = 0;
  E.cd[i] = gap;
  E.charge[i] = 0;
}

// ───────────────────────────── ASSEMBLER (act boss): hub + 4 arms
function assembler(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  integrate(w, i, 0, 0);
  faceToward(w, i, angleToPlayer(w, i), 0.6);
  // first tick: build the arms
  if (E.aux2[i] !== 55) {
    E.aux2[i] = 55;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) spawnEnemy(w, ET.Arm, E.x[i]! + sx * 10, E.y[i]! + sy * 7);
    E.cd[i] = 2;
    E.aux[i] = 0;
    E.tx[i] = 0; // weld clock
    E.ty[i] = 0; // forge clock
  }
  const hpf = E.hp[i]! / E.maxHp[i]!;
  const phase = hpf > 0.7 ? 1 : hpf > 0.35 ? 2 : 3;
  if (phase !== E.burst[i]) {
    if (E.burst[i]! > 0) w.events.push(Ev.BossPhase, E.x[i]!, E.y[i]!, phase);
    E.burst[i] = phase;
  }
  // shield / closed timer
  if (E.shield[i]! > 0) {
    E.shield[i] = E.shield[i]! - DT;
    if (E.shield[i]! <= 0) w.events.push(Ev.HubShield, E.x[i]!, E.y[i]!, 0);
  }
  // phase 3: open 3 s / closed 4 s
  if (phase === 3) {
    E.charge[i] = E.charge[i]! + DT;
    const cyc = E.charge[i]! % 7;
    if (cyc >= 3 && E.shield[i]! <= 0) {
      E.shield[i] = 7 - cyc;
      w.events.push(Ev.HubShield, E.x[i]!, E.y[i]!, 1);
    }
  }
  // live arms
  let nArms = 0;
  const arms = scratchArms;
  for (let k = 0; k < E.hi && nArms < 4; k++) if (E.alive[k] && E.type[k] === ET.Arm && E.st[k] !== AS.Spawning) arms[nArms++] = k;
  // production line (budgeted by the director's spirit: never flood the arena)
  E.aux[i] = E.aux[i]! + DT;
  if (E.aux[i]! >= 3.6 * cdMul(w) && nArms > 0 && E.count < 22) {
    E.aux[i] = 0;
    const a = arms[w.rng.int(nArms)]!;
    if (w.rng.chance(0.5)) {
      spawnEnemy(w, ET.GearMite, clampX(E.x[a]! + 1.5), clampY(E.y[a]! + 1.5));
      spawnEnemy(w, ET.GearMite, clampX(E.x[a]! - 1.5), clampY(E.y[a]! + 1.5));
      spawnEnemy(w, ET.GearMite, clampX(E.x[a]!), clampY(E.y[a]! + 2.2));
    } else spawnEnemy(w, ET.ArcDrone, clampX(E.x[a]!), clampY(E.y[a]! + 2));
    if (phase >= 2 && w.rng.chance(0.4)) spawnEnemy(w, ET.Hauler, clampX(E.x[a]! + 2), clampY(E.y[a]!));
  }
  // WELD: a static beam from an arm that is NOT the one next to the player
  E.tx[i] = E.tx[i]! + DT;
  if (E.tx[i]! >= 6 * cdMul(w) && nArms > 0) {
    E.tx[i] = 0;
    let near = -1;
    let nd = 1e9;
    for (let k = 0; k < nArms; k++) {
      const a = arms[k]!;
      const d2 = (E.x[a]! - p.x) ** 2 + (E.y[a]! - p.y) ** 2;
      if (d2 < nd) {
        nd = d2;
        near = a;
      }
    }
    let src = -1;
    for (let k = 0; k < nArms; k++) if (arms[k] !== near || nArms === 1) src = arms[k]!;
    const L = w.lasers;
    for (let k = 0; k < L.alive.length; k++) {
      if (L.alive[k] || src < 0) continue;
      const tx = p.x + p.vx * 0.6;
      const ty = p.y + p.vy * 0.6;
      L.alive[k] = 1;
      L.owner[k] = -1;
      L.x[k] = E.x[src]!;
      L.y[k] = E.y[src]!;
      L.ang[k] = datan2(ty - L.y[k]!, tx - L.x[k]!);
      L.angP[k] = L.ang[k]!;
      L.angVel[k] = 0;
      L.len[k] = 40;
      L.width[k] = 0.45;
      L.warm[k] = tel(w, 1.0);
      L.warmMax[k] = L.warm[k]!;
      L.life[k] = 0.8;
      L.dmg[k] = 18;
      break;
    }
  }
  // FORGE: three rings, each with a ≥60° gap
  E.ty[i] = E.ty[i]! + DT;
  const forgeAt = 7 * cdMul(w);
  const ft = E.ty[i]! - forgeAt;
  if (ft >= 0) {
    if (ft < DT) w.events.push(Ev.Telegraph, E.x[i]!, E.y[i]!, 3.5, tel(w, 1.5));
    for (let r = 0; r < 3; r++) {
      const at = tel(w, 1.5) + r * 0.45;
      if (ft >= at && ft - DT < at) {
        const gap = w.rng.range(0, 6.283);
        const n = 22;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * 6.283185 + r * 0.14;
          let dg = a - gap;
          dg = dg - 6.283185 * Math.floor((dg + 3.14159) / 6.283185);
          if (Math.abs(dg) < 0.6) continue; // ~69° gap
          const b = spawnBullet(w, Team.Enemy, BK.BossOrb, E.x[i]! + dcos(a) * 2.6, E.y[i]! + dsin(a) * 2.6, a, 5 * w.diff.bulletSpeedMul, 14, 0.42, 6, 0, 0, 0, 0, 0, 0);
          if (b >= 0) w.bullets.h0[b] = 2;
        }
        w.events.push(Ev.EnemyShoot, E.x[i]!, E.y[i]!, 0, ET.Assembler, BK.BossOrb);
      }
    }
    if (ft > tel(w, 1.5) + 1.5) E.ty[i] = 0;
  }
  // phase 3 extras: CONVEYOR (all lanes push inward) and SELF_ASSEMBLY (a mark-less walker)
  if (phase === 3) {
    if (E.cd[i]! <= 0) {
      E.cd[i] = 9 * cdMul(w);
      if (w.rng.chance(0.5)) {
        for (let k = 0; k < w.lanes.count; k++) {
          w.lanes.inward[k] = 4 + tel(w, 1.5);
          w.events.push(Ev.LaneWarn, k);
        }
      } else {
        const s = spawnEnemy(w, ET.Stamper, clampX(E.x[i]! + 3), clampY(E.y[i]! + 3));
        if (s >= 0) E.aux2[s] = 99;
      }
    }
  }
}
const scratchArms = new Int32Array(4);

// ───────────────────────────── ASSEMBLER arm: tracks the intruder, sweeps whoever gets close
function arm(w: World, i: number): void {
  const E = w.enemies;
  const p = w.player;
  integrate(w, i, 0, 0);
  const d = distToPlayer(w, i);
  const R = E.r[i]! + 3.1;
  switch (E.st[i]) {
    case AS.Windup: {
      const W = tel(w, 0.75);
      E.charge[i] = Math.min(1, E.stT[i]! / W);
      faceToward(w, i, angleToPlayer(w, i), 0.8);
      if (E.stT[i]! >= W) {
        if (p.alive && p.dashT <= 0 && d < R) {
          hurtPlayer(w, 16, E.x[i]!, E.y[i]!, ET.Arm);
          const a = angleToPlayer(w, i);
          p.vx += dcos(a) * 14;
          p.vy += dsin(a) * 14;
        }
        w.events.push(Ev.Shockwave, E.x[i]!, E.y[i]!, R);
        E.charge[i] = 0;
        E.cd[i] = 2.4 * cdMul(w);
        setState(w, i, AS.Recover);
      }
      return;
    }
    case AS.Recover:
      if (E.stT[i]! >= 0.5) setState(w, i, AS.Move);
      return;
    default:
      faceToward(w, i, angleToPlayer(w, i), 1.2);
      if (d < R && E.cd[i]! <= 0 && p.alive) {
        setState(w, i, AS.Windup);
        w.events.push(Ev.Telegraph, E.x[i]!, E.y[i]!, R, tel(w, 0.75));
      }
  }
}
