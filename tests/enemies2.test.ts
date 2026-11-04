import { describe, expect, it } from 'vitest';
import { Scenario } from '../src/sim/scenario';
import { AS, Btn, ET } from '../src/sim/constants';
import { Ev, EV_STRIDE } from '../src/core/events';
import { MUZZLE_FWD, MUZZLE_SIDE } from '../src/sim/systems/player';
import { WAVES } from '../src/sim/content/waves';

const events = (w: { events: { count: number; data: Float32Array } }, type: number): number[] => {
  const out: number[] = [];
  for (let k = 0; k < w.events.count; k++) if (w.events.data[k * EV_STRIDE] === type) out.push(k * EV_STRIDE);
  return out;
};

describe('new archetypes', () => {
  it('bloater swells next to the player, ruptures, hurts and leaves acid', () => {
    const s = new Scenario(3).player({ x: 0, y: 0 }).spawn('bloater', 0, -5);
    let windup = false;
    let exploded = false;
    s.run(60 * 5, (w) => {
      if (w.enemies.alive[0] && w.enemies.st[0] === AS.Windup) windup = true;
      if (events(w, Ev.Explosion).length) exploded = true;
    });
    expect(windup).toBe(true);
    expect(exploded).toBe(true);
    expect(s.world.player.hp).toBeLessThan(s.world.player.maxHp);
    expect(s.world.enemies.count).toBe(0);
  });
  it('dart orbits, then telegraphs and dives', () => {
    const s = new Scenario(4).player({ x: 0, y: 0, god: true }).spawn('dart', 10, 0);
    const seen = new Set<number>();
    s.run(60 * 8, (w) => {
      if (w.enemies.alive[0]) seen.add(w.enemies.st[0]!);
    });
    expect(seen.has(AS.Windup)).toBe(true);
    expect(seen.has(AS.Dash)).toBe(true);
  });
  it('early waves are not mono-species', () => {
    for (const idx of [0, 1, 2]) {
      const types = new Set(WAVES[idx]!.groups.map((g) => g.type));
      expect(types.size).toBeGreaterThanOrEqual(2);
    }
    expect(WAVES[0]!.groups.some((g) => g.type === ET.Bloater)).toBe(true);
    expect(WAVES[1]!.groups.some((g) => g.type === ET.Dart)).toBe(true);
  });
});

describe('shooting', () => {
  it('bullets leave from the gun muzzle and converge on the cursor; recoil pushes back', () => {
    const s = new Scenario(1).player({ x: 0, y: 0 }).noAI();
    let sx = NaN;
    let sy = NaN;
    let sa = NaN;
    s.input((_w, _t, c) => {
      c.ax = 0;
      c.ay = -10;
      c.btn = Btn.Fire;
    }).run(1, (w) => {
      const o = events(w, Ev.Shoot)[0]!;
      sx = w.events.data[o + 1]!;
      sy = w.events.data[o + 2]!;
      sa = w.events.data[o + 3]!;
    });
    // facing -y: forward = (0,-1), gun side = (1, 0)
    expect(sx).toBeCloseTo(MUZZLE_SIDE, 1);
    expect(sy).toBeCloseTo(-MUZZLE_FWD, 1);
    const tx = sx + Math.cos(sa) * (10 - MUZZLE_FWD);
    expect(Math.abs(tx)).toBeLessThan(0.15); // aimed back toward x=0 at the cursor
    expect(s.world.player.vy).toBeGreaterThan(0); // shoved backward (+y)
  });
});
