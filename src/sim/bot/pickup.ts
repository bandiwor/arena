import type { World } from '../world';

/**
 * The health pickup worth walking to: nearest by value / distance, reachable before it expires.
 * Returns -1 when the player is at full HP (pickups are only taken when hurt) or none is around.
 */
export function bestPickup(w: World, speed: number): number {
  const p = w.player;
  if (p.hp >= p.maxHp) return -1;
  const P = w.pickups;
  let best = -1;
  let bs = 0;
  for (let i = 0; i < P.hi; i++) {
    if (!P.alive[i]) continue;
    const dx = P.x[i]! - p.x;
    const dy = P.y[i]! - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    // the magnet grabs it at ~4 u: we only have to get that close
    if (Math.max(0, d - 4) > P.life[i]! * speed * 0.8) continue;
    const s = P.value[i]! / (d + 3);
    if (s > bs) {
      bs = s;
      best = i;
    }
  }
  return best;
}

/** how much the bot wants HP now: 0 at full, 1 at ≤ 60 % */
export function healNeed(w: World): number {
  const p = w.player;
  return Math.min(1, Math.max(0, (1 - p.hp / p.maxHp) * 2.5));
}
