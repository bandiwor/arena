import { ARENA_HH, ARENA_HW } from '../sim/constants';
import type { World } from '../sim/world';

const UNREACH = 65535;

/** BFS distance field toward the player; recomputed only when the player changes cell. */
export function updateFlowField(w: World): void {
  const F = w.flow;
  const p = w.player;
  const cx = clampi(Math.floor((p.x + ARENA_HW) / F.cell), 0, F.cols - 1);
  const cy = clampi(Math.floor((p.y + ARENA_HH) / F.cell), 0, F.rows - 1);
  const target = cy * F.cols + cx;
  if (target === F.targetCell) return;
  F.targetCell = target;
  const { cols, rows, dist, blocked, queue } = F;
  dist.fill(UNREACH);
  let head = 0;
  let tail = 0;
  dist[target] = 0;
  queue[tail++] = target;
  while (head < tail) {
    const c = queue[head++]!;
    const d = dist[c]! + 1;
    const x = c % cols;
    const y = (c - x) / cols;
    if (x > 0) tail = visit(c - 1, d, dist, blocked, queue, tail);
    if (x < cols - 1) tail = visit(c + 1, d, dist, blocked, queue, tail);
    if (y > 0) tail = visit(c - cols, d, dist, blocked, queue, tail);
    if (y < rows - 1) tail = visit(c + cols, d, dist, blocked, queue, tail);
  }
  // gradient → direction (8-neighbour, diagonal only if not cutting corners)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const c = y * cols + x;
      let best = dist[c]!;
      let bx = 0;
      let by = 0;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = y + oy;
        if (ny < 0 || ny >= rows) continue;
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = x + ox;
          if (nx < 0 || nx >= cols) continue;
          if (ox !== 0 && oy !== 0 && (blocked[y * cols + nx] || blocked[ny * cols + x])) continue;
          const dn = dist[ny * cols + nx]!;
          if (dn < best) {
            best = dn;
            bx = ox;
            by = oy;
          }
        }
      }
      const l = Math.sqrt(bx * bx + by * by) || 1;
      F.dirX[c] = bx / l;
      F.dirY[c] = by / l;
    }
  }
}

function visit(n: number, d: number, dist: Uint16Array, blocked: Uint8Array, queue: Int32Array, tail: number): number {
  if (blocked[n] || dist[n]! <= d) return tail;
  dist[n] = d;
  queue[tail] = n;
  return tail + 1;
}

function clampi(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export const flowOut = new Float32Array(2);
/** Direction toward the player along the flow field at world pos. */
export function flowDir(w: World, x: number, y: number): Float32Array {
  const F = w.flow;
  const cx = clampi(Math.floor((x + ARENA_HW) / F.cell), 0, F.cols - 1);
  const cy = clampi(Math.floor((y + ARENA_HH) / F.cell), 0, F.rows - 1);
  const c = cy * F.cols + cx;
  flowOut[0] = F.dirX[c]!;
  flowOut[1] = F.dirY[c]!;
  return flowOut;
}
