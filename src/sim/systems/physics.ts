import { ARENA_HH, ARENA_HW } from '../constants';
import type { World } from '../world';

export const pushOut = new Float32Array(2);

/** Push a circle out of pillars. Writes result to pushOut, returns true if moved. */
export function collidePillars(w: World, x: number, y: number, r: number): boolean {
  const P = w.pillars;
  let moved = false;
  for (let k = 0; k < P.count; k++) {
    const dx = x - P.x[k]!;
    const dy = y - P.y[k]!;
    const rr = P.r[k]! + r;
    const d2 = dx * dx + dy * dy;
    if (d2 < rr * rr) {
      const d = Math.sqrt(d2) || 0.0001;
      x = P.x[k]! + (dx / d) * rr;
      y = P.y[k]! + (dy / d) * rr;
      moved = true;
    }
  }
  pushOut[0] = x;
  pushOut[1] = y;
  return moved;
}

/** Line of sight between two points (pillars only). */
export function hasLOS(w: World, ax: number, ay: number, bx: number, by: number): boolean {
  const P = w.pillars;
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  for (let k = 0; k < P.count; k++) {
    let t = l2 > 0 ? ((P.x[k]! - ax) * dx + (P.y[k]! - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + dx * t - P.x[k]!;
    const cy = ay + dy * t - P.y[k]!;
    const r = P.r[k]! + 0.15;
    if (cx * cx + cy * cy < r * r) return false;
  }
  return true;
}

export function inArena(x: number, y: number, margin: number): boolean {
  return x > -ARENA_HW + margin && x < ARENA_HW - margin && y > -ARENA_HH + margin && y < ARENA_HH - margin;
}
