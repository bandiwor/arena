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

describe('Линия 9 · review fixes', () => {
  it('belts push hard enough to feel (≥4 u/s) and are long', () => {
    const s = foundry();
    const w = s.world;
    const L = w.lanes;
    expect(L.hw[0]! * 2).toBeGreaterThanOrEqual(15);
    s.player({ x: L.cx[0]! - 5, y: L.cy[0]! });
    const x0 = w.player.x;
    s.run(60);
    expect(w.player.x - x0).toBeGreaterThan(4);
  });

  it('overseer commands nearby mites (+30% speed), orders a pulse, opens up, and its death dazes them', async () => {
    const { OVERSEER } = await import('../src/ai/behaviors');
    const { killEnemy, damageEnemy } = await import('../src/sim/systems/entities');
    const s = foundry().player({ x: 0, y: 14, god: true }).spawn('overseer', -18, -3).spawn('mite', -16, -3).spawn('mite', 10, 10);
    const orders: number[][] = [];
    let commandedNear = false;
    let commandedFar = false;
    s.run(60 * 8, (w) => {
      events(w, Ev.Order, orders);
      const E = w.enemies;
      for (const k of [1, 2]) {
        if (!E.alive[k] || E.st[k] === AS.Spawning) continue;
        const d = Math.hypot(E.x[k]! - E.x[0]!, E.y[k]! - E.y[0]!);
        if (d < OVERSEER.radius - 1 && E.haste[k]! > 0) commandedNear = true;
        if (d > OVERSEER.radius + 1 && E.haste[k]! > 0.26) commandedFar = true; // only lapses after leaving
      }
    });
    const w = s.world;
    expect(commandedNear).toBe(true);
    expect(commandedFar).toBe(false);
    expect(orders.length).toBeGreaterThan(0);
    // 40% damage → exposed (+50% damage)
    damageEnemy(w, 0, w.enemies.maxHp[0]! * 0.41, 0, 0, 0, 0, false);
    s.run(2);
    expect(w.enemies.st[0]).toBe(AS.Guard);
    const hp = w.enemies.hp[0]!;
    damageEnemy(w, 0, 10, 0, 0, 0, 0, false);
    expect(hp - w.enemies.hp[0]!).toBeCloseTo(15, 3);
    // death: tethers snap
    expect(OVERSEER.haste).toBeGreaterThan(1.2);
    // put a mite next to it, then kill it
    w.enemies.x[1] = w.enemies.x[0]! + 3;
    w.enemies.y[1] = w.enemies.y[0]!;
    killEnemy(w, 0, 0, 0, 0, 0);
    expect(w.enemies.st[1]).toBe(AS.Stunned);
  });

  it('stamper marks remember who placed them (for the aim beam)', () => {
    const s = foundry().player({ x: 0, y: 6, god: true }).spawn('stamper', 0, -4);
    let owned = false;
    s.run(60 * 4, (w) => {
      for (let k = 0; k < MAX_MARKS; k++) if (w.marks.alive[k] && w.marks.src[k] === ET.Stamper && w.marks.own[k] === 0) owned = true;
    });
    expect(owned).toBe(true);
  });
});
