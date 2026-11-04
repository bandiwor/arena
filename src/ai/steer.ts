import { datan2 } from '../core/detmath';
import { AS, ARENA_HH, ARENA_HW, DT, ET } from '../sim/constants';
import { enemyDef } from '../sim/content/enemies';
import { collidePillars, hasLOS, pushOut } from '../sim/systems/physics';
import type { World } from '../sim/world';
import { flowDir } from './flowfield';

export const dir = new Float32Array(2);

/** Direction toward (tx,ty): straight if LOS, else follow flow field (only valid when target ≈ player). */
export function pathTo(w: World, i: number, tx: number, ty: number, viaFlow: boolean): Float32Array {
  const E = w.enemies;
  const x = E.x[i]!;
  const y = E.y[i]!;
  const dx = tx - x;
  const dy = ty - y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.001) {
    dir[0] = 0;
    dir[1] = 0;
    return dir;
  }
  if (!viaFlow || hasLOS(w, x, y, tx, ty)) {
    dir[0] = dx / d;
    dir[1] = dy / d;
  } else {
    const f = flowDir(w, x, y);
    dir[0] = f[0]!;
    dir[1] = f[1]!;
    if (dir[0] === 0 && dir[1] === 0) {
      dir[0] = dx / d;
      dir[1] = dy / d;
    }
  }
  return dir;
}

/**
 * Steering integration: accelerate toward desired velocity, separation from neighbours,
 * knockback decay, wind, collisions. Friction from arena physics (ice!).
 */
export function integrate(w: World, i: number, dvx: number, dvy: number): void {
  const E = w.enemies;
  const def = enemyDef(E.type[i]!);
  const x = E.x[i]!;
  const y = E.y[i]!;
  const r = E.r[i]!;
  // separation
  let sx = 0;
  let sy = 0;
  if (E.type[i] !== ET.Boss && E.st[i] !== AS.Underground) {
    const n = w.grid.query(x, y, r + 1.6, w.qbuf);
    for (let k = 0; k < n; k++) {
      const j = w.qbuf[k]!;
      if (j === i || !E.alive[j] || E.st[j] === AS.Spawning || E.st[j] === AS.Underground || E.st[j] === AS.Attached) continue;
      const ox = x - E.x[j]!;
      const oy = y - E.y[j]!;
      const rr = r + E.r[j]! + 0.25;
      const d2 = ox * ox + oy * oy;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const push = (rr - d) / rr;
        sx += (ox / d) * push;
        sy += (oy / d) * push;
      }
    }
  }
  const sepW = 9;
  dvx += sx * sepW;
  dvy += sy * sepW;
  const ph = w.phys;
  const iceF = Math.min(1, ph.friction / 14) * 0.85 + 0.15;
  const acc = def.accel * iceF * DT;
  let ax = dvx - E.vx[i]!;
  let ay = dvy - E.vy[i]!;
  const al = Math.sqrt(ax * ax + ay * ay);
  if (al > acc) {
    ax = (ax / al) * acc;
    ay = (ay / al) * acc;
  }
  E.vx[i] = E.vx[i]! + ax + ph.windX * ph.windWalkers * DT;
  E.vy[i] = E.vy[i]! + ay + ph.windY * ph.windWalkers * DT;
  // knockback decays faster on normal ground than on ice
  const kd = 1 - Math.min(1, (3 + ph.friction * 0.5) * DT);
  let nx = x + (E.vx[i]! + E.kx[i]!) * DT;
  let ny = y + (E.vy[i]! + E.ky[i]!) * DT;
  E.kx[i] = E.kx[i]! * kd;
  E.ky[i] = E.ky[i]! * kd;
  const lim = r;
  if (nx < -ARENA_HW + lim) { nx = -ARENA_HW + lim; E.kx[i] = Math.abs(E.kx[i]!) * 0.4; }
  if (nx > ARENA_HW - lim) { nx = ARENA_HW - lim; E.kx[i] = -Math.abs(E.kx[i]!) * 0.4; }
  if (ny < -ARENA_HH + lim) { ny = -ARENA_HH + lim; E.ky[i] = Math.abs(E.ky[i]!) * 0.4; }
  if (ny > ARENA_HH - lim) { ny = ARENA_HH - lim; E.ky[i] = -Math.abs(E.ky[i]!) * 0.4; }
  if (collidePillars(w, nx, ny, r)) {
    nx = pushOut[0]!;
    ny = pushOut[1]!;
  }
  E.x[i] = nx;
  E.y[i] = ny;
  const sp = Math.sqrt(E.vx[i]! * E.vx[i]! + E.vy[i]! * E.vy[i]!);
  E.walk[i] = E.walk[i]! + sp * DT * 2.2;
}

export function faceToward(w: World, i: number, ang: number, rate: number): void {
  const E = w.enemies;
  let d = ang - E.face[i]!;
  d = d - 6.283185307179586 * Math.floor((d + 3.141592653589793) / 6.283185307179586);
  const m = rate * DT;
  E.face[i] = E.face[i]! + (d > m ? m : d < -m ? -m : d);
}

export function angleToPlayer(w: World, i: number): number {
  return datan2(w.player.y - w.enemies.y[i]!, w.player.x - w.enemies.x[i]!);
}

export function distToPlayer(w: World, i: number): number {
  const dx = w.player.x - w.enemies.x[i]!;
  const dy = w.player.y - w.enemies.y[i]!;
  return Math.sqrt(dx * dx + dy * dy);
}
