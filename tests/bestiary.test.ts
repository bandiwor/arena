import { describe, expect, it } from 'vitest';
import { Scenario } from '../src/sim/scenario';
import { AS, ET, MAX_MARKS } from '../src/sim/constants';
import { Ev, EV_STRIDE } from '../src/core/events';
import { buildArenaLayout, type World } from '../src/sim/world';
import { ENEMIES } from '../src/sim/content/enemies';
import { ENEMY_LORE, RACES } from '../src/sim/content/races';
import { WAVES } from '../src/sim/content/waves';
import { Mat } from '../src/sim/constants';

const events = (w: World, t: number, out: number[][]): void => {
  for (let k = 0; k < w.events.count; k++) {
    const o = k * EV_STRIDE;
    if (w.events.data[o] === t) out.push(Array.from(w.events.data.subarray(o + 1, o + 6)));
  }
};
const foundry = (seed = 1): Scenario => {
  const s = new Scenario(seed);
  s.world.act = 2;
  buildArenaLayout(s.world);
  return s;
};

describe('Bestiary · content consistency', () => {
  it('every enemy has a race and a codex line; every wave has an archive note', () => {
    for (const e of ENEMIES) {
      expect(RACES[e.material], e.key).toBeDefined();
      expect(ENEMY_LORE[e.key], e.key).toBeTruthy();
    }
    for (const wv of WAVES) expect(wv.lore, wv.name).toBeTruthy();
  });

  it('the Foundry rejects tissue: Act III waves spawn machines only', () => {
    for (const wv of WAVES) {
      if ((wv.act ?? 0) !== 2) continue;
      for (const g of wv.groups) expect(ENEMIES[g.type]!.material, `${wv.name}: ${ENEMIES[g.type]!.key}`).toBe(Mat.Machine);
    }
  });
});

describe('Bestiary · reworked behaviours', () => {
  it('ASSEMBLER arm telegraphs and sweeps an intruder, but not someone out of reach', () => {
    const s = foundry().player({ x: 0, y: 3 }).spawn('arm', 0, 0);
    const tele: number[][] = [];
    s.run(60 * 3, (w) => events(w, Ev.Telegraph, tele));
    expect(tele.length).toBeGreaterThan(0);
    expect(s.world.stats.dmgBy[ET.Arm]).toBeGreaterThan(0);
    const far = foundry().player({ x: 0, y: 9 }).spawn('arm', 0, 0);
    far.run(60 * 3);
    expect(far.world.stats.dmgBy[ET.Arm]).toBe(0);
  });

  it('clamp hauler closes its clamp on a hooked target (telegraphed shockwave)', () => {
    const s = foundry().player({ x: 0, y: 4 }).spawn('hauler', 0, -5);
    const shocks: number[][] = [];
    s.run(60 * 5, (w) => events(w, Ev.Shockwave, shocks));
    expect(shocks.some((e) => Math.abs(e[2]! - 2.4) < 1e-3)).toBe(true);
  });

  it('overseer calls a press mark on an intruder', () => {
    const s = foundry().player({ x: 0, y: -9, god: true }).spawn('overseer', 0, -14);
    let marked = false;
    s.run(60 * 3, (w) => {
      for (let k = 0; k < MAX_MARKS; k++) if (w.marks.alive[k] && w.marks.src[k] === ET.Overseer) marked = true;
    });
    expect(marked).toBe(true);
  });

  it('brood throws off a player who hugs it', () => {
    const s = new Scenario(4).player({ x: 0, y: -10 + 2.3 + 1.6 }).spawn('brood', 0, -10);
    const shocks: number[][] = [];
    s.run(60 * 3, (w) => events(w, Ev.Shockwave, shocks));
    expect(shocks.length).toBeGreaterThan(0);
    expect(s.world.stats.dmgBy[ET.Brood]).toBeGreaterThan(0);
  });

  it('parasite picks the sturdy host over the nearer fodder', () => {
    const s = new Scenario(3).player({ x: 0, y: 14, god: true }).spawn('swarmer', 3, -8).spawn('charger', -6, -8).spawn('parasite', 4.5, -8);
    let host = -1;
    s.run(60 * 4, (w) => {
      if (host < 0 && w.enemies.st[2] === AS.Attached) host = w.enemies.tx[2]! | 0;
    });
    expect(host).toBe(1);
    expect(s.world.enemies.type[host]).toBe(ET.Charger);
  });
});
