import { Ev } from '../../core/events';
import { angDiff, datan2 } from '../../core/detmath';
import { AS, ARENA_HH, ARENA_HW, BK, DT, ET, Team, WP } from '../constants';
import type { World } from '../world';
import { damageEnemy, explode, hurtPlayer, removeBullet } from './entities';
import { enemyDef } from '../content/enemies';
import { weaponDef } from '../content/weapons';

const PLAYER_HITBOX = 0.34;

export function updateBullets(w: World): void {
  const B = w.bullets;
  const ph = w.phys;
  const W = w.wells;
  for (let i = 0; i < B.hi; i++) {
    if (!B.alive[i]) continue;
    B.px[i] = B.x[i]!;
    B.py[i] = B.y[i]!;
    const kind = B.kind[i]!;
    let vx = B.vx[i]!;
    let vy = B.vy[i]!;
    // wind
    vx += ph.windX * DT;
    vy += ph.windY * DT;
    // gravity wells bend everything except orbs
    if (W.count > 0 && kind !== BK.Orb) {
      for (let k = 0; k < W.count; k++) {
        const dx = W.x[k]! - B.x[i]!;
        const dy = W.y[k]! - B.y[i]!;
        const d2 = dx * dx + dy * dy;
        const R = W.radius[k]!;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) + 0.5;
          const f = (W.strength[k]! * 220) / (d * d + 4);
          vx += (dx / d) * f * DT;
          vy += (dy / d) * f * DT;
        }
      }
    }
    if (kind === BK.Grenade) {
      vx *= 0.982;
      vy *= 0.982;
    }
    B.vx[i] = vx;
    B.vy[i] = vy;
    let x = B.x[i]! + vx * DT;
    let y = B.y[i]! + vy * DT;
    B.age[i] = B.age[i]! + DT;
    B.life[i] = B.life[i]! - DT;

    // walls
    let hitWall = false;
    if (x < -ARENA_HW || x > ARENA_HW) {
      hitWall = true;
      if (B.bounce[i]! > 0) {
        B.vx[i] = -vx;
        x = x < 0 ? -2 * ARENA_HW - x : 2 * ARENA_HW - x;
      }
    }
    if (y < -ARENA_HH || y > ARENA_HH) {
      hitWall = true;
      if (B.bounce[i]! > 0) {
        B.vy[i] = -vy;
        y = y < 0 ? -2 * ARENA_HH - y : 2 * ARENA_HH - y;
      }
    }
    // pillars
    const P = w.pillars;
    for (let k = 0; k < P.count; k++) {
      const dx = x - P.x[k]!;
      const dy = y - P.y[k]!;
      const r = P.r[k]! + B.r[i]!;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        hitWall = true;
        if (B.bounce[i]! > 0) {
          const d = Math.sqrt(d2) || 0.001;
          const nx = dx / d;
          const ny = dy / d;
          const dot = B.vx[i]! * nx + B.vy[i]! * ny;
          B.vx[i] = B.vx[i]! - 2 * dot * nx;
          B.vy[i] = B.vy[i]! - 2 * dot * ny;
          x = P.x[k]! + nx * (r + 0.01);
          y = P.y[k]! + ny * (r + 0.01);
        }
        break;
      }
    }
    B.x[i] = x;
    B.y[i] = y;
    if (hitWall) {
      const a = datan2(B.vy[i]!, B.vx[i]!);
      if (B.bounce[i]! > 0) {
        B.bounce[i] = B.bounce[i]! - 1;
        B.lastHit[i] = -1;
        w.events.push(Ev.Impact, x, y, a, kind, B.team[i]!, 1);
      } else if (kind === BK.Grenade) {
        detonate(w, i);
        continue;
      } else if (kind !== BK.Orb) {
        w.events.push(Ev.Impact, x, y, a, kind, B.team[i]!, 0);
        removeBullet(w, i);
        continue;
      }
    }
    if (B.life[i]! <= 0) {
      if (kind === BK.Grenade) detonate(w, i);
      else if (kind === BK.Orb) implode(w, i);
      else removeBullet(w, i);
      continue;
    }
    if (kind === BK.Orb) orbPull(w, i);
  }
}

function detonate(w: World, i: number): void {
  const B = w.bullets;
  explode(w, B.x[i]!, B.y[i]!, B.aoe[i]!, B.dmg[i]!, B.knock[i]!, B.rarity[i]!, B.weapon[i]!);
  removeBullet(w, i);
}

function implode(w: World, i: number): void {
  const B = w.bullets;
  const x = B.x[i]!;
  const y = B.y[i]!;
  w.events.push(Ev.Implode, x, y, B.aoe[i]!);
  explode(w, x, y, B.aoe[i]! * 0.75, B.dmg[i]!, -14, B.rarity[i]!, B.weapon[i]!);
  removeBullet(w, i);
}

/** Singularity: drags enemies in, eats enemy bullets, grinds what it touches. */
function orbPull(w: World, i: number): void {
  const B = w.bullets;
  const E = w.enemies;
  const x = B.x[i]!;
  const y = B.y[i]!;
  const R = B.aoe[i]!;
  const n = w.grid.query(x, y, R, w.qbuf2);
  const ramp = Math.min(1, B.age[i]! * 2);
  for (let k = 0; k < n; k++) {
    const e = w.qbuf2[k]!;
    if (!E.alive[e] || E.type[e] === ET.Boss) continue;
    const dx = x - E.x[e]!;
    const dy = y - E.y[e]!;
    const d = Math.sqrt(dx * dx + dy * dy) + 0.01;
    if (d > R) continue;
    const f = ((1 - d / R) * 38 * ramp) / enemyDef(E.type[e]!).mass;
    E.kx[e] = E.kx[e]! + (dx / d) * f * DT;
    E.ky[e] = E.ky[e]! + (dy / d) * f * DT;
    if (d < 1.2 + E.r[e]! && (w.tick & 7) === 0) {
      damageEnemy(w, e, 6 * w.player.stats.dmgMul, datan2(-dy, -dx), 0, 3, WP.Singularity, false);
    }
  }
  // eat enemy bullets
  for (let j = 0; j < B.hi; j++) {
    if (!B.alive[j] || B.team[j] !== Team.Enemy) continue;
    const dx = B.x[j]! - x;
    const dy = B.y[j]! - y;
    if (dx * dx + dy * dy < 4) removeBullet(w, j);
  }
}

/** Collision pass. Enemies grid must be built. */
export function collideBullets(w: World): void {
  const B = w.bullets;
  const E = w.enemies;
  const p = w.player;
  for (let i = 0; i < B.hi; i++) {
    if (!B.alive[i]) continue;
    const x0 = B.px[i]!;
    const y0 = B.py[i]!;
    const x1 = B.x[i]!;
    const y1 = B.y[i]!;
    const br = B.r[i]!;
    if (B.team[i] === Team.Enemy) {
      if (!p.alive) continue;
      const rr = PLAYER_HITBOX + br;
      if (segHit(p.x, p.y, x0, y0, x1, y1, rr)) {
        if (p.dashT > 0 || p.inv > 0) continue; // dodge through
        hurtPlayer(w, B.dmg[i]!, x0, y0);
        w.events.push(Ev.Impact, x1, y1, datan2(B.vy[i]!, B.vx[i]!), B.kind[i]!, Team.Enemy, 0);
        removeBullet(w, i);
      }
      continue;
    }
    const kind = B.kind[i]!;
    if (kind === BK.Orb) continue;
    const mx = (x0 + x1) * 0.5;
    const my = (y0 + y1) * 0.5;
    const hl = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)) * 0.5;
    const n = w.grid.query(mx, my, hl + br + 3, w.qbuf);
    let best = -1;
    let bestT = 2;
    for (let k = 0; k < n; k++) {
      const e = w.qbuf[k]!;
      if (!E.alive[e] || e === B.lastHit[i] || E.st[e] === AS.Spawning || E.st[e] === AS.Underground) continue;
      const rr = E.r[e]! + br;
      const t = segHitT(E.x[e]!, E.y[e]!, x0, y0, x1, y1, rr);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = e;
      }
    }
    if (best < 0) continue;
    const a = datan2(B.vy[i]!, B.vx[i]!);
    // crystal shield: front arc deflects
    if (E.type[best] === ET.Shielder && shieldBlocks(w, best, a)) {
      const hx = x0 + (x1 - x0) * bestT;
      const hy = y0 + (y1 - y0) * bestT;
      w.events.push(Ev.ShieldBlock, hx, hy, a, best);
      E.flash[best] = Math.max(E.flash[best]!, 0.35);
      if (kind === BK.Grenade) {
        detonate(w, i);
      } else {
        removeBullet(w, i);
      }
      continue;
    }
    if (kind === BK.Grenade) {
      B.x[i] = x0 + (x1 - x0) * bestT;
      B.y[i] = y0 + (y1 - y0) * bestT;
      detonate(w, i);
      continue;
    }
    damageEnemy(w, best, B.dmg[i]!, a, B.knock[i]!, B.rarity[i]!, B.weapon[i]!, B.crit[i] === 1);
    if (B.pierce[i]! > 0) {
      B.pierce[i] = B.pierce[i]! - 1;
      B.lastHit[i] = best;
      B.dmg[i] = B.dmg[i]! * 0.85;
    } else {
      removeBullet(w, i);
    }
  }
}

export function shieldBlocks(w: World, e: number, bulletAngle: number): boolean {
  // bullet must travel against the shielder's facing (hit the front)
  const d = angDiff(w.enemies.face[e]! + Math.PI, bulletAngle);
  return d > -1.05 && d < 1.05;
}

function segHit(cx: number, cy: number, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  return segHitT(cx, cy, ax, ay, bx, by, r) >= 0;
}

/** param t in [0,1] of closest approach if within r, else -1 */
function segHitT(cx: number, cy: number, ax: number, ay: number, bx: number, by: number, r: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((cx - ax) * abx + (cy - ay) * aby) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + abx * t - cx;
  const dy = ay + aby * t - cy;
  return dx * dx + dy * dy <= r * r ? t : -1;
}

/** Used by renderer/tools: describe weapon of a bullet */
export function bulletWeapon(w: World, i: number): string {
  return weaponDef(w.bullets.weapon[i]!).key;
}
