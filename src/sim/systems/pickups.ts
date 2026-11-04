import { Ev } from '../../core/events';
import { ARENA_HH, ARENA_HW, DT } from '../constants';
import type { World } from '../world';

export function updatePickups(w: World): void {
  const P = w.pickups;
  const p = w.player;
  for (let i = 0; i < P.hi; i++) {
    if (!P.alive[i]) continue;
    P.px[i] = P.x[i]!;
    P.py[i] = P.y[i]!;
    P.life[i] = P.life[i]! - DT;
    if (P.life[i]! <= 0) {
      P.alive[i] = 0;
      P.free.free(i);
      continue;
    }
    const dx = p.x - P.x[i]!;
    const dy = p.y - P.y[i]!;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (p.alive && d < 4.5) {
      const f = (1 - d / 4.5) * 60 + 8;
      P.vx[i] = P.vx[i]! + (dx / (d + 0.01)) * f * DT;
      P.vy[i] = P.vy[i]! + (dy / (d + 0.01)) * f * DT;
    }
    P.vx[i] = P.vx[i]! * 0.94;
    P.vy[i] = P.vy[i]! * 0.94;
    P.x[i] = Math.max(-ARENA_HW + 0.5, Math.min(ARENA_HW - 0.5, P.x[i]! + P.vx[i]! * DT));
    P.y[i] = Math.max(-ARENA_HH + 0.5, Math.min(ARENA_HH - 0.5, P.y[i]! + P.vy[i]! * DT));
    if (p.alive && d < p.r + 0.5 && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + P.value[i]!);
      w.events.push(Ev.Pickup, P.x[i]!, P.y[i]!, P.kind[i]!);
      P.alive[i] = 0;
      P.free.free(i);
    }
  }
}
