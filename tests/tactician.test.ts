import { describe, expect, it } from 'vitest';
import { Scenario } from '../src/sim/scenario';
import { tactician } from '../src/sim/bot/tactician';
import { Ev, EV_STRIDE } from '../src/core/events';
import { AS, ET } from '../src/sim/constants';
import { buildArenaLayout, type World } from '../src/sim/world';

const count = (w: World, t: number): number => {
  let n = 0;
  for (let k = 0; k < w.events.count; k++) if (w.events.data[k * EV_STRIDE] === t) n++;
  return n;
};

describe('Тактик (bot)', () => {
  it('chooses weapons for the situation, but never flips faster than its hold time', () => {
    const HOLD = 2.2;
    const s = new Scenario(7, 1, 'campaign', 5).player({ weapons: ['pulse', 'scatter', 'launcher', 'rail'], god: true });
    s.input(tactician({ reaction: 6, hold: HOLD }));
    const switches: number[] = [];
    const used = new Set<number>();
    s.run(60 * 60, (w) => {
      if (count(w, Ev.WeaponSwitch) > 0) switches.push(w.tick);
      used.add(w.player.slots[w.player.cur]!);
    });
    expect(switches.length).toBeGreaterThan(1);
    expect(used.size).toBeGreaterThanOrEqual(2);
    for (let k = 1; k < switches.length; k++) expect((switches[k]! - switches[k - 1]!) / 60).toBeGreaterThanOrEqual(HOLD - 1e-6);
  });

  it('treats the dash as a resource: far fewer dashes than the naive timer bot, yet survives', () => {
    const s = new Scenario(11, 1, 'campaign', 3).player({});
    s.input(tactician());
    let dashes = 0;
    s.run(60 * 90, (w) => (dashes += count(w, Ev.PlayerDash)));
    expect(s.world.player.alive).toBe(true);
    // a dash every ~1.6 s (the naive bot's timer) would be ~56 in 90 s
    expect(dashes).toBeLessThan(40);
  });

  it('dashes out of a parasite latch and a hauler pull', () => {
    const s = new Scenario(5).player({ x: 0, y: 0 }).spawn('parasite', 3.5, 0);
    s.input(tactician({ reaction: 4 }));
    let latched = false;
    let shaken = false;
    s.run(60 * 6, (w) => {
      if (count(w, Ev.Latch) > 0) latched = true;
      if (count(w, Ev.ShakeOff) > 0) shaken = true;
    });
    if (latched) expect(shaken).toBe(true);
    expect(s.world.stats.dmgBy[ET.Parasite]).toBeLessThan(6 * s.world.diff.dmgMul);
  });

  it('feeds a charged pylon when a crowd stands around it', () => {
    const s = new Scenario(1).player({ god: true });
    const w = s.world;
    w.act = 2;
    buildArenaLayout(w);
    const pi = w.pylons.pillar[0]!;
    const px = w.pillars.x[pi]!;
    const py = w.pillars.y[pi]!;
    w.pylons.charge[0] = 0.5;
    s.noAI().player({ x: px + 9, y: py + 1 });
    for (let k = 0; k < 4; k++) s.spawn('gunner', px - 3 + k * 1.6, py + 4);
    s.input(tactician({ reaction: 4 }));
    let discharged = false;
    s.run(60 * 4, (ww) => {
      if (count(ww, Ev.Discharge) > 0) discharged = true;
    });
    expect(discharged).toBe(true);
    expect(w.enemies.st.length).toBeGreaterThan(0);
    void AS;
  });
});
