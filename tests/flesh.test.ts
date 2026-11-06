import { describe, expect, it } from 'vitest';
import { Scenario } from '../src/sim/scenario';
import { AS, BK, Btn, ET } from '../src/sim/constants';
import { Ev, EV_STRIDE } from '../src/core/events';
import type { World } from '../src/sim/world';
import { damageEnemy } from '../src/sim/systems/entities';
import { PARA, WORM } from '../src/ai/behaviors';

const has = (w: World, t: number): boolean => {
  for (let k = 0; k < w.events.count; k++) if (w.events.data[k * EV_STRIDE] === t) return true;
  return false;
};
const acid = (w: World): number => {
  let n = 0;
  for (let i = 0; i < w.bullets.hi; i++) if (w.bullets.alive[i] && w.bullets.kind[i] === BK.Acid) n++;
  return n;
};

describe('Плоть · Роевик', () => {
  it('pounces from mid range and lands', () => {
    const s = new Scenario(1).player({ x: 0, y: 0, god: true }).spawn('swarmer', 9, 0);
    let leap = false;
    let land = false;
    let bite = false;
    s.run(60 * 2, (w) => {
      if (w.enemies.st[0] === AS.Leap) leap = true;
      if (has(w, Ev.Land)) land = true;
      if (has(w, Ev.Bite) && !leap) bite = true;
    });
    expect(leap).toBe(true);
    expect(land).toBe(true);
    expect(bite).toBe(false);
  });
  it('bites up close instead of leaping, and the bite hurts', () => {
    const s = new Scenario(1).player({ x: 0, y: 0 }).spawn('swarmer', 1.3, 0);
    let first = -1;
    s.run(60 * 1.5, (w) => {
      const st = w.enemies.st[0]!;
      if (first < 0 && (st === AS.Attack || st === AS.Windup)) first = st;
    });
    expect(first).toBe(AS.Attack);
    expect(s.world.stats.dmgBy[ET.Swarmer]).toBeGreaterThan(0);
  });
});

describe('Плоть · Гнойник', () => {
  it('a hit squirts 2–3 pus globs; several hits in one instant squirt once', () => {
    const s = new Scenario(2).player({ x: 0, y: 10, god: true }).spawn('bloater', 0, -6);
    s.run(2);
    const w = s.world;
    const before = acid(w);
    damageEnemy(w, 0, 3, 0, 0, 0, 0, false);
    damageEnemy(w, 0, 3, 0, 0, 0, 0, false);
    const n = acid(w) - before;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);
    s.run(30);
    damageEnemy(w, 0, 3, 0, 0, 0, 0, false);
    expect(acid(w)).toBeGreaterThan(before + n);
  });
});

describe('Плоть · Червь', () => {
  it('crawls while far, dives only from mid range', () => {
    const s = new Scenario(3).player({ x: -20, y: 0, god: true }).spawn('worm', 14, 0);
    let diveD = -1;
    s.run(60 * 10, (w) => {
      if (diveD < 0 && w.enemies.st[0] === AS.Burrow) diveD = Math.hypot(w.enemies.x[0]! - w.player.x, w.enemies.y[0]! - w.player.y);
    });
    expect(diveD).toBeGreaterThan(WORM.diveMin - 1);
    expect(diveD).toBeLessThan(WORM.diveMax + 1);
  });
  it('standing still gets bitten from below; moving after the lock makes it miss and get stuck', () => {
    const still = new Scenario(4).player({ x: 0, y: 0 }).spawn('worm', 9, 0);
    still.run(60 * 6);
    expect(still.world.stats.dmgBy[ET.Worm]).toBeGreaterThan(0);

    const dodge = new Scenario(4).player({ x: 0, y: 0 }).spawn('worm', 9, 0);
    let stuck = false;
    let lockedAt = -1;
    dodge
      .input((w, t, c) => {
        const E = w.enemies;
        // wait for the mound to lock, then step away
        if (E.st[0] === AS.Windup && E.stT[0]! > 0.4 && lockedAt < 0) lockedAt = t;
        if (lockedAt >= 0 && t - lockedAt < 40) c.my = 1;
      })
      .run(60 * 6, (w) => {
        if (w.enemies.st[0] === AS.Stunned) stuck = true;
      });
    expect(lockedAt).toBeGreaterThan(0);
    expect(stuck).toBe(true);
  });
  it('a dash through the eruption makes the bite miss', () => {
    const s = new Scenario(4).player({ x: 0, y: 0 }).spawn('worm', 9, 0);
    let emerged = false;
    s.input((w, _t, c) => {
      const E = w.enemies;
      if (E.st[0] === AS.Windup && E.charge[0]! > 0.8) c.btn |= Btn.Dash;
    }).run(60 * 5, (w) => {
      if (has(w, Ev.WormEmerge)) emerged = true;
    });
    expect(emerged).toBe(true);
    expect(s.world.stats.dmgBy[ET.Worm]).toBe(0);
  });
});

describe('Плоть · Паразит', () => {
  it('latches on the player, drains exactly N ticks over ~1 s, hops away sated, then hunts again', () => {
    const s = new Scenario(5).player({ x: 0, y: 0, hp: 100 }).spawn('parasite', 3.5, 0);
    const w = s.world;
    let latches = 0;
    let latchT = -1;
    let fedT = -1;
    let sawGuard = false;
    let biteInGuard = false;
    s.run(60 * 14, (ww) => {
      if (has(ww, Ev.Latch)) {
        latches++;
        if (latchT < 0) latchT = ww.time;
      }
      const st = ww.enemies.st[0]!;
      if (st === AS.Retreat && fedT < 0) fedT = ww.time;
      if (st === AS.Guard) {
        sawGuard = true;
        if (has(ww, Ev.Drain)) biteInGuard = true;
      }
    });
    expect(latchT).toBeGreaterThan(0);
    expect(fedT - latchT).toBeGreaterThan(PARA.drainTime * 0.8);
    expect(fedT - latchT).toBeLessThan(PARA.drainTime * 1.3);
    expect(sawGuard).toBe(true);
    expect(biteInGuard).toBe(false);
    expect(latches).toBeGreaterThanOrEqual(2); // hungry again after digesting
    // 1 per tick before difficulty scaling: first feeding = N × dmgMul
    expect(w.stats.dmgBy[ET.Parasite]).toBeGreaterThanOrEqual(PARA.drainTicks * w.diff.dmgMul - 1e-3);
  });
  it('a dash shakes it off: dazed and vulnerable', () => {
    const s = new Scenario(5).player({ x: 0, y: 0 }).spawn('parasite', 3.5, 0);
    let shaken = false;
    s.input((w, _t, c) => {
      if (w.enemies.st[0] === AS.Attached && w.enemies.burst[0]! >= 2) c.btn |= Btn.Dash;
    }).run(60 * 4, (w) => {
      if (has(w, Ev.ShakeOff)) shaken = true;
    });
    expect(shaken).toBe(true);
    expect(s.world.stats.dmgBy[ET.Parasite]).toBeLessThan(PARA.drainTicks * s.world.diff.dmgMul);
  });
  it('never gets stuck: only known states, always inside the arena, keeps cycling', () => {
    const OK = new Set<number>([AS.Spawning, AS.Move, AS.Windup, AS.Leap, AS.Recover, AS.Attached, AS.Retreat, AS.Guard, AS.Stunned]);
    for (const seed of [1, 2, 3]) {
      const s = new Scenario(seed).player({ x: 0, y: 0, god: true }).spawn('parasite', 6, 2).spawn('parasite', -6, -2).spawn('charger', 10, -8);
      let bad = false;
      s.input((_w, t, c) => {
        c.mx = Math.sin(t * 0.013 + seed) > 0 ? 1 : -1;
        c.my = Math.cos(t * 0.021) > 0 ? 1 : -1;
        if (t % 97 === 0) c.btn |= Btn.Dash;
      }).run(60 * 30, (w) => {
        for (const i of [0, 1]) {
          if (!w.enemies.alive[i]) continue;
          if (!OK.has(w.enemies.st[i]!) || !Number.isFinite(w.enemies.x[i]!) || Math.abs(w.enemies.x[i]!) > 37) bad = true;
          if (w.enemies.st[i] === AS.Attached && (w.enemies.tx[i]! | 0) === i) bad = true;
        }
      });
      expect(bad).toBe(false);
    }
  });
});

describe('regression · ASSEMBLER', () => {
  it('its arms collapse together with the hub', async () => {
    const { buildArenaLayout } = await import('../src/sim/world');
    const { killEnemy } = await import('../src/sim/systems/entities');
    const s = new Scenario(1).player({ x: 0, y: 14, god: true });
    s.world.act = 2;
    buildArenaLayout(s.world);
    s.spawn('assembler', 0, -3).run(60 * 3);
    const w = s.world;
    const arms = (): number => {
      let n = 0;
      for (let i = 0; i < w.enemies.hi; i++) if (w.enemies.alive[i] && w.enemies.type[i] === ET.Arm) n++;
      return n;
    };
    expect(arms()).toBe(4);
    killEnemy(w, 0, 0, 0, 0, 0);
    expect(arms()).toBe(0);
  });
});
