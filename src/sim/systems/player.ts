import { Ev } from '../../core/events';
import { angDiff, dcos, dsin, datan2, segDist2 } from '../../core/detmath';
import { AS, ARENA_HH, ARENA_HW, Btn, DT, Mat, Team, WP } from '../constants';
import { weaponDef } from '../content/weapons';
import { cmdSlot, type InputCmd } from '../input';
import type { World } from '../world';
import { damageEnemy, spawnBullet } from './entities';
import { collidePillars, pushOut } from './physics';
import { shortEnemy } from './foundry';
import { enemyDef } from '../content/enemies';

const BASE_SPEED = 9.5;
export const MUZZLE_FWD = 1.3;
export const MUZZLE_SIDE = 0.2;
const ACCEL = 85;
const DASH_TIME = 0.17;
const DASH_SPEED = 30;
const DASH_CD = 0.85;

export function updatePlayer(w: World, cmd: InputCmd): void {
  const p = w.player;
  p.px = p.x;
  p.py = p.y;
  p.faceP = p.face;
  if (!p.alive) {
    p.vx *= 0.9;
    p.vy *= 0.9;
    return;
  }
  p.inv = Math.max(0, p.inv - DT);
  p.hurtT = Math.max(0, p.hurtT - DT * 2);
  p.dashCd = Math.max(0, p.dashCd - DT);
  p.fireCd = Math.max(0, p.fireCd - DT);
  p.recoil = Math.max(0, p.recoil - DT * 6);

  // aim
  p.ax = cmd.ax;
  p.ay = cmd.ay;
  p.face = datan2(cmd.ay - p.y, cmd.ax - p.x);

  // weapon switching
  if (p.slotCount > 1) {
    const slot = cmdSlot(cmd);
    let changed = false;
    if (slot >= 0 && slot < p.slotCount && slot !== p.cur) {
      p.cur = slot;
      changed = true;
    } else if (cmd.btn & Btn.Next) {
      p.cur = (p.cur + 1) % p.slotCount;
      changed = true;
    } else if (cmd.btn & Btn.Prev) {
      p.cur = (p.cur + p.slotCount - 1) % p.slotCount;
      changed = true;
    }
    if (changed) {
      const wd = weaponDef(p.slots[p.cur]!);
      p.fireCd = Math.max(p.fireCd, 0.12);
      w.events.push(Ev.WeaponSwitch, wd.id, wd.rarity);
    }
  }

  // movement
  let mx = cmd.mx;
  let my = cmd.my;
  const ml = Math.sqrt(mx * mx + my * my);
  if (ml > 0) {
    mx /= ml;
    my /= ml;
  }
  if (cmd.btn & Btn.Dash && p.dashCd <= 0) {
    let dx = mx;
    let dy = my;
    if (ml === 0) {
      dx = dcos(p.face);
      dy = dsin(p.face);
    }
    p.dashT = DASH_TIME;
    p.dashCd = DASH_CD * p.stats.dashCdMul;
    p.dashX = dx;
    p.dashY = dy;
    w.events.push(Ev.PlayerDash, p.x, p.y, datan2(dy, dx));
  }
  // Clamp Hauler hook: reeled toward the hauler until the hook lets go — a dash snaps the cable
  if (p.pullT > 0) {
    const E = w.enemies;
    const h = p.pullBy;
    if (p.dashT > 0 || h < 0 || !E.alive[h] || E.gen[h] !== p.pullGen) p.pullT = 0;
    else {
      p.pullT -= DT;
      const dx = E.x[h]! - p.x;
      const dy = E.y[h]! - p.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > E.r[h]! + p.r + 0.4) {
        p.vx = (dx / d) * 14;
        p.vy = (dy / d) * 14;
      } else p.pullT = 0;
    }
  }
  if (p.dashT > 0) {
    p.dashT -= DT;
    p.vx = p.dashX * DASH_SPEED;
    p.vy = p.dashY * DASH_SPEED;
    if (p.stats.dashShock > 0) dashShock(w);
  } else if (p.pullT > 0) {
    // reeled: no steering
  } else {
    let speed = BASE_SPEED * p.stats.speedMul * w.phys.playerSpeed;
    // flesh pools drag at the player's feet
    const PL = w.pools;
    for (let k = 0; k < (w.act === 1 ? PL.count : 0); k++) {
      const dx = p.x - PL.x[k]!;
      const dy = p.y - PL.y[k]!;
      if (dx * dx + dy * dy < PL.r[k]! * PL.r[k]!) {
        speed *= 0.62;
        break;
      }
    }
    const tvx = mx * speed;
    const tvy = my * speed;
    // accelerate toward target; friction governs how fast we lose speed (ice!)
    const fr = w.phys.friction;
    const accel = ml > 0 ? Math.min(ACCEL, ACCEL * (fr / 14) + 6) : fr * speed * 0.8;
    let dvx = tvx - p.vx;
    let dvy = tvy - p.vy;
    const dl = Math.sqrt(dvx * dvx + dvy * dvy);
    const maxDv = accel * DT;
    if (dl > maxDv) {
      dvx = (dvx / dl) * maxDv;
      dvy = (dvy / dl) * maxDv;
    }
    p.vx += dvx;
    p.vy += dvy;
    p.vx += w.phys.windX * w.phys.windWalkers * DT;
    p.vy += w.phys.windY * w.phys.windWalkers * DT;
  }
  p.x += p.vx * DT;
  p.y += p.vy * DT;
  const lim = 0.6;
  if (p.x < -ARENA_HW + lim) { p.x = -ARENA_HW + lim; p.vx = Math.abs(p.vx) * 0.3; }
  if (p.x > ARENA_HW - lim) { p.x = ARENA_HW - lim; p.vx = -Math.abs(p.vx) * 0.3; }
  if (p.y < -ARENA_HH + lim) { p.y = -ARENA_HH + lim; p.vy = Math.abs(p.vy) * 0.3; }
  if (p.y > ARENA_HH - lim) { p.y = ARENA_HH - lim; p.vy = -Math.abs(p.vy) * 0.3; }
  const pushed = collidePillars(w, p.x, p.y, p.r);
  if (pushed) {
    p.x = pushOut[0]!;
    p.y = pushOut[1]!;
  }
  const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  p.walk += sp * DT * 1.6;

  // firing
  p.firing = (cmd.btn & Btn.Fire) !== 0;
  if (p.firing && p.fireCd <= 0) fire(w);
}


function dashShock(w: World): void {
  const p = w.player;
  const E = w.enemies;
  const n = w.grid.query(p.x, p.y, 2.5, w.qbuf);
  for (let k = 0; k < n; k++) {
    const i = w.qbuf[k]!;
    if (!E.alive[i] || E.flash[i]! > 0.6) continue;
    const dx = E.x[i]! - p.x;
    const dy = E.y[i]! - p.y;
    const rr = E.r[i]! + p.r + 0.3;
    if (dx * dx + dy * dy < rr * rr) {
      damageEnemy(w, i, p.stats.dashShock, datan2(dy, dx), 10, 1, 255, false);
    }
  }
}

function fire(w: World): void {
  const p = w.player;
  const wd = weaponDef(p.slots[p.cur]!);
  const S = p.stats;
  p.fireCd = wd.cooldown / S.rateMul;
  p.recoil = Math.min(1, p.recoil + wd.recoil);
  p.shotCount++;
  w.stats.shots++;
  // muzzle of the gun model: forward 1.3, offset 0.2 to the gun side
  const fx = dcos(p.face);
  const fy = dsin(p.face);
  const mx = p.x + fx * MUZZLE_FWD - fy * MUZZLE_SIDE;
  const my = p.y + fy * MUZZLE_FWD + fx * MUZZLE_SIDE;
  // aim converges on the cursor from the muzzle (not from the body centre)
  const adx = p.ax - mx;
  const ady = p.ay - my;
  const aim = adx * adx + ady * ady > 2.5 ? datan2(ady, adx) : p.face;
  // recoil push — heavy weapons shove the player back
  p.vx -= fx * wd.recoil * 6.5;
  p.vy -= fy * wd.recoil * 6.5;
  w.events.push(Ev.Shoot, mx, my, aim, wd.id, wd.rarity, Team.Player);
  const dmgBase = wd.dmg * S.dmgMul;
  if (wd.kind === -1) {
    fireRail(w, mx, my, aim, dmgBase, wd.rarity, wd.knock, wd.id === WP.ArcRail ? 3 : 999, wd.id);
    return;
  }
  const count = wd.count + (wd.id === WP.Singularity ? 0 : S.projAdd);
  const spreadTotal = wd.spread + (count > wd.count ? 0.08 * (count - wd.count) : 0);
  for (let k = 0; k < count; k++) {
    let a = aim;
    if (count > 1) a += (k / (count - 1) - 0.5) * spreadTotal;
    a += w.rng.sym() * wd.spread * 0.35;
    const spd = wd.speed * S.bulletSpeedMul * (1 + w.rng.sym() * wd.speedJitter);
    const crit = w.rng.chance(S.crit);
    const b = spawnBullet(
      w,
      Team.Player,
      wd.kind,
      mx,
      my,
      a,
      spd,
      crit ? dmgBase * 2.5 : dmgBase,
      wd.radius,
      wd.life,
      wd.id,
      wd.rarity,
      wd.pierce + S.pierceAdd,
      wd.bounce + S.bounceAdd,
      wd.knock,
      wd.aoe,
    );
    if (b >= 0) {
      if (crit) w.bullets.crit[b] = 1;
      w.bullets.h0[b] = 0.6;
    }
  }
}

const railHits = new Int32Array(128);
const railT = new Float32Array(128);

/** Hitscan rail: pierces every enemy on the line until it hits a wall/pillar. */
function fireRail(w: World, x: number, y: number, a: number, dmg: number, rarity: number, knock: number, maxHits: number, weapon: number): void {
  const dx = dcos(a);
  const dy = dsin(a);
  // ray vs arena bounds
  let tMax = 200;
  if (dx > 0) tMax = Math.min(tMax, (ARENA_HW - x) / dx);
  if (dx < 0) tMax = Math.min(tMax, (-ARENA_HW - x) / dx);
  if (dy > 0) tMax = Math.min(tMax, (ARENA_HH - y) / dy);
  if (dy < 0) tMax = Math.min(tMax, (-ARENA_HH - y) / dy);
  // ray vs pillars
  const P = w.pillars;
  for (let k = 0; k < P.count; k++) {
    const ox = P.x[k]! - x;
    const oy = P.y[k]! - y;
    const t = ox * dx + oy * dy;
    if (t < 0) continue;
    const cx = ox - dx * t;
    const cy = oy - dy * t;
    const r = P.r[k]!;
    const d2 = cx * cx + cy * cy;
    if (d2 < r * r) {
      const th = t - Math.sqrt(r * r - d2);
      if (th < tMax) tMax = Math.max(0, th);
    }
  }
  const ex = x + dx * tMax;
  const ey = y + dy * tMax;
  // collect hits sorted by distance
  const E = w.enemies;
  let n = 0;
  for (let k = 0; k < E.activeCount; k++) {
    const i = E.active[k]!;
    if (!E.alive[i] || E.st[i] === AS.Underground || E.st[i] === AS.Spawning) continue;
    const rr = E.r[i]! + 0.35;
    if (segDist2(E.x[i]!, E.y[i]!, x, y, ex, ey) < rr * rr && n < railHits.length) {
      railHits[n] = i;
      railT[n] = (E.x[i]! - x) * dx + (E.y[i]! - y) * dy;
      n++;
    }
  }
  // insertion sort by t (n small)
  for (let i = 1; i < n; i++) {
    const hi = railHits[i]!;
    const ht = railT[i]!;
    let j = i - 1;
    while (j >= 0 && railT[j]! > ht) {
      railHits[j + 1] = railHits[j]!;
      railT[j + 1] = railT[j]!;
      j--;
    }
    railHits[j + 1] = hi;
    railT[j + 1] = ht;
  }
  // the arc rail stops in its 3rd target and shorts every machine it passes through
  let bx = ex;
  let by = ey;
  if (n > maxHits) {
    const last = railHits[maxHits - 1]!;
    const tl = (w.enemies.x[last]! - x) * dx + (w.enemies.y[last]! - y) * dy;
    bx = x + dx * tl;
    by = y + dy * tl;
    n = maxHits;
  }
  for (let k = 0; k < n; k++) {
    const crit = w.rng.chance(w.player.stats.crit);
    const e = railHits[k]!;
    if (weapon === WP.ArcRail && enemyDef(w.enemies.type[e]!).material === Mat.Machine) shortEnemy(w, e, 1.0);
    damageEnemy(w, e, crit ? dmg * 2.5 : dmg, a, knock, rarity, weapon, crit);
  }
  w.events.push(Ev.RailBeam, x, y, bx, by, rarity, n, weapon);
  w.events.push(Ev.Impact, bx, by, a + Math.PI, -1, Team.Player);
}

/** small util for AI */
export function playerAngleFrom(w: World, x: number, y: number): number {
  return datan2(w.player.y - y, w.player.x - x);
}
export function turnToward(cur: number, target: number, maxStep: number): number {
  const d = angDiff(cur, target);
  if (d > maxStep) return cur + maxStep;
  if (d < -maxStep) return cur - maxStep;
  return target;
}
