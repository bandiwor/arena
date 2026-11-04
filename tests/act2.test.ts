import { describe, expect, it } from 'vitest';
import { Inputs, Scenario } from '../src/sim/scenario';
import { AS, Btn, ET } from '../src/sim/constants';
import { Ev, EV_STRIDE } from '../src/core/events';
import { WavePhase } from '../src/sim/world';
import { WAVES } from '../src/sim/content/waves';
import { TRANS_DUR } from '../src/sim/systems/waves';
import { damageEnemy } from '../src/sim/systems/entities';

const has = (w: { events: { count: number; data: Float32Array } }, t: number): boolean => {
  for (let k = 0; k < w.events.count; k++) if (w.events.data[k * EV_STRIDE] === t) return true;
  return false;
};

describe('Act II', () => {
  it('after the Monolith the archive decompiles and synthesises the flesh sector', () => {
    // start at the boss wave, kill it, pick an upgrade → transition
    const s = new Scenario(2, 0, 'campaign', 9).player({ god: true, weapons: ['rail', 'pulse'] });
    s.upgrade('dmg').upgrade('dmg').upgrade('rate').upgrade('rate').upgrade('dmg');
    const pillars0 = s.world.pillars.x[0];
    let sawTransition = false;
    let sawSynth = false;
    s.input(Inputs.aimbot()).run(60 * 150, (w) => {
      if (has(w, Ev.ActTransition)) sawTransition = true;
      if (has(w, Ev.ActSynth)) sawSynth = true;
    });
    expect(sawTransition).toBe(true);
    expect(sawSynth).toBe(true);
    const w = s.world;
    expect(w.act).toBe(1);
    expect(w.pools.count).toBeGreaterThan(0);
    expect(w.pillars.x[0]).not.toBe(pillars0);
    expect(WAVES[w.wave.index]!.act).toBe(1);
  });

  it('transition lasts TRANS_DUR and heals the player', () => {
    const s = new Scenario(1, 1, 'campaign', 9);
    const w = s.world;
    // fast-forward: fake a cleared boss wave
    w.wave.phase = WavePhase.Upgrade;
    w.wave.offerCount = 1;
    w.wave.offer[0] = 0;
    w.player.hp = 20;
    s.input((_w, _t, c) => (c.btn |= 1 << Btn.PickShift)).run(1);
    expect(w.wave.phase).toBe(WavePhase.Transition);
    s.input(() => {}).run(Math.round(TRANS_DUR * 60) + 2);
    expect(w.wave.phase).not.toBe(WavePhase.Transition);
    expect(w.player.hp).toBeGreaterThan(20);
  });

  it('worm is untouchable underground and erupts near where the player is heading', () => {
    const s = new Scenario(5).player({ x: 0, y: 0, god: true }).spawn('worm', 14, 0);
    const w = s.world;
    let underground = false;
    let immune = true;
    let emergeD = 99;
    s.input((_w, t, c) => {
      c.mx = t < 300 ? 1 : 0; // keep running right so lead aim matters
    }).run(60 * 8, (ww) => {
      if (ww.enemies.alive[0] && ww.enemies.st[0] === AS.Underground) {
        underground = true;
        if (damageEnemy(ww, 0, 999, 0, 0, 0, 0, false) || ww.enemies.hp[0]! < 30) immune = false;
      }
      for (let k = 0; k < ww.events.count; k++) {
        const o = k * EV_STRIDE;
        if (ww.events.data[o] === Ev.WormEmerge && emergeD === 99) {
          emergeD = Math.hypot(ww.events.data[o + 1]! - ww.player.x, ww.events.data[o + 2]! - ww.player.y);
        }
      }
    });
    expect(underground).toBe(true);
    expect(immune).toBe(true);
    expect(emergeD).toBeLessThan(6);
    expect(w.enemies.type[0]).toBe(ET.Worm);
  });

  it('parasite latches onto a host and hardens it', () => {
    const s = new Scenario(3).player({ x: 0, y: 12, god: true }).spawn('charger', 0, -8).spawn('parasite', 4, -8);
    s.world.noAI = false;
    let attached = false;
    s.run(60 * 4, (w) => {
      if (w.enemies.st[1] === AS.Attached) attached = true;
    });
    expect(attached).toBe(true);
    const w = s.world;
    expect(w.enemies.buff[0]).toBeGreaterThan(0);
    const hp = w.enemies.hp[0]!;
    damageEnemy(w, 0, 10, 0, 0, 0, 0, false);
    expect(hp - w.enemies.hp[0]!).toBeCloseTo(6, 3);
  });

  it('brood births new creatures and is tracked as mini-boss', () => {
    const s = new Scenario(4).player({ x: 0, y: 14, god: true }).spawn('brood', 0, -10);
    expect(s.world.miniBoss).toBe(0);
    let births = 0;
    s.run(60 * 10, (w) => {
      if (has(w, Ev.Birth)) births++;
    });
    expect(births).toBeGreaterThan(0);
    expect(s.world.enemies.count).toBeGreaterThan(1);
  });
});
