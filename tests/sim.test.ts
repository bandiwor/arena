import { describe, expect, it } from 'vitest';
import { Inputs, Scenario } from '../src/sim/scenario';
import { AS, Btn, ET } from '../src/sim/constants';
import { Sim, hashWorld } from '../src/sim/sim';
import { InputRecorder, makeCmd } from '../src/sim/input';
import { WavePhase } from '../src/sim/world';
import { packInputs, unpackInputs } from '../src/sim/replay';
import { Ev, EV_STRIDE } from '../src/core/events';

describe('determinism', () => {
  it('same seed + same inputs ⇒ same hash', () => {
    const run = () =>
      new Scenario(77, 1, 'campaign').input(Inputs.aimbot()).run(60 * 40).hash();
    expect(run()).toBe(run());
  });
  it('different seed ⇒ different hash', () => {
    const a = new Scenario(1, 1, 'campaign').input(Inputs.aimbot()).run(600).hash();
    const b = new Scenario(2, 1, 'campaign').input(Inputs.aimbot()).run(600).hash();
    expect(a).not.toBe(b);
  });
  it('replay pack/unpack reproduces the run exactly', () => {
    const rec = new InputRecorder(5000);
    const s = new Scenario(5, 2, 'campaign').input(Inputs.aimbot());
    // record by wrapping
    const sim = new Sim({ seed: 5, difficulty: 2, mode: 'campaign' });
    const cmd = makeCmd();
    const ai = Inputs.aimbot();
    for (let t = 0; t < 3000; t++) {
      cmd.mx = cmd.my = cmd.btn = 0;
      cmd.ax = sim.world.player.x;
      cmd.ay = sim.world.player.y - 5;
      ai(sim.world, t, cmd);
      if (sim.world.wave.phase === WavePhase.Upgrade) cmd.btn |= 1 << Btn.PickShift;
      sim.step(cmd);
      rec.push(cmd);
      sim.world.events.clear();
    }
    const h1 = hashWorld(sim.world);
    const packed = packInputs(rec);
    const rec2 = unpackInputs(packed, rec.length);
    const sim2 = new Sim({ seed: 5, difficulty: 2, mode: 'campaign' });
    for (let t = 0; t < rec2.length; t++) {
      sim2.step(rec2.read(t, cmd));
      sim2.world.events.clear();
    }
    expect(hashWorld(sim2.world)).toBe(h1);
    expect(s).toBeTruthy();
  });
});

describe('gameplay', () => {
  it('player bullets kill a swarmer', () => {
    const s = new Scenario(1).player({ x: 0, y: 0 }).noAI().spawn('swarmer', 0, -6);
    s.input((_w, _t, c) => {
      c.ax = 0;
      c.ay = -6;
      c.btn = Btn.Fire;
    }).run(60);
    expect(s.world.enemies.count).toBe(0);
    expect(s.world.stats.kills).toBe(1);
  });
  it('shielder: front shield absorbs fire, cracks under focus, then the body takes damage', () => {
    const front = new Scenario(1).player({ x: 0, y: 0 }).noAI().spawn('shielder', 0, -8);
    front.world.enemies.face[0] = Math.PI / 2; // facing the player (+y)
    const hp0 = front.world.enemies.hp[0]!;
    let broke = false;
    front
      .input((_w, _t, c) => {
        c.ax = 0;
        c.ay = -8;
        c.btn = Btn.Fire;
      })
      .run(30, (w) => {
        for (let k = 0; k < w.events.count; k++) if (w.events.data[k * EV_STRIDE] === Ev.ShieldBreak) broke = true;
      });
    // half a second of pulse fire: all absorbed by the shield
    expect(front.world.enemies.hp[0]).toBe(hp0);
    front.run(240, (w) => {
      for (let k = 0; k < w.events.count; k++) if (w.events.data[k * EV_STRIDE] === Ev.ShieldBreak) broke = true;
    });
    expect(broke).toBe(true);
    expect(front.world.enemies.count).toBe(0);
    const back = new Scenario(1).player({ x: 0, y: 0 }).noAI().spawn('shielder', 0, -8);
    back.world.enemies.face[0] = -Math.PI / 2; // facing away: no shield in the way
    back.input((_w, _t, c) => {
      c.ax = 0;
      c.ay = -8;
      c.btn = Btn.Fire;
    }).run(30);
    expect(back.world.enemies.hp[0]!).toBeLessThan(hp0);
  });
  it('archer telegraphs before releasing', () => {
    const s = new Scenario(3).player({ x: 0, y: 0, god: true }).spawn('archer', 0, -14);
    let sawWindup = false;
    let releasedAfterWindup = false;
    s.run(60 * 6, (w) => {
      if (w.enemies.st[0] === AS.Windup) sawWindup = true;
      for (let k = 0; k < w.events.count; k++)
        if (w.events.data[k * EV_STRIDE] === Ev.ArcherRelease && sawWindup) releasedAfterWindup = true;
    });
    expect(sawWindup).toBe(true);
    expect(releasedAfterWindup).toBe(true);
  });
  it('attack tokens cap simultaneous attackers', () => {
    const s = new Scenario(4, 1).player({ x: 0, y: 0, god: true });
    for (let k = 0; k < 10; k++) s.spawn('gunner', -12 + k * 2.5, -12);
    let maxAttackers = 0;
    s.run(60 * 8, (w) => {
      let n = 0;
      for (let i = 0; i < w.enemies.hi; i++) if (w.enemies.alive[i] && w.enemies.token[i]) n++;
      maxAttackers = Math.max(maxAttackers, n);
      expect(w.director.tokensUsed).toBe(n);
    });
    expect(maxAttackers).toBeLessThanOrEqual(s.world.director.tokensMax);
    expect(maxAttackers).toBeGreaterThan(0);
  });
  it('ricochet mutator makes bullets bounce off walls', () => {
    const s = new Scenario(1).player({ x: 30, y: 0 }).mutator('ricochet');
    s.run(5).input((_w, _t, c) => {
      c.ax = 40;
      c.ay = 0;
      c.btn = Btn.Fire;
    });
    let bounces = 0;
    s.run(60, (w) => {
      for (let k = 0; k < w.events.count; k++)
        if (w.events.data[k * EV_STRIDE] === Ev.Impact && w.events.data[k * EV_STRIDE + 6] === 1) bounces++;
    });
    expect(bounces).toBeGreaterThan(0);
  });
  it('campaign progresses through waves with an aimbot on easy', () => {
    const s = new Scenario(11, 0, 'campaign').player({ god: true }).input(Inputs.aimbot()).upgrade('w_rail');
    s.run(60 * 150);
    expect(s.world.wave.index).toBeGreaterThanOrEqual(2);
    expect(s.world.stats.kills).toBeGreaterThan(30);
  });
  it('boss goes through phases and dies', () => {
    const s = new Scenario(2, 1, 'campaign', 9).player({ god: true, weapons: ['rail', 'pulse'] });
    s.upgrade('dmg').upgrade('dmg').upgrade('rate').upgrade('rate');
    const phases = new Set<number>();
    let killed = false;
    s.input(Inputs.aimbot()).run(60 * 120, (w) => {
      phases.add(w.boss.phase);
      if (w.wave.index > 8 || w.wave.phase === WavePhase.Upgrade) killed = true;
    });
    expect(phases.has(3)).toBe(true);
    // the run continues into Act II instead of ending
    expect(killed).toBe(true);
    expect(s.world.wave.phase).not.toBe(WavePhase.Victory);
  });
  it('spawns respect type table', () => {
    const s = new Scenario(1).spawn('charger', 5, 5);
    expect(s.world.enemies.type[0]).toBe(ET.Charger);
  });
});

describe('zero-GC steady state', () => {
  it('heap does not grow over a long busy sim', () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (!gc) return; // requires --expose-gc
    const s = new Scenario(9, 3, 'campaign').player({ god: true }).input(Inputs.aimbot());
    s.run(60 * 20); // warm up JIT, fill pools
    gc();
    const before = process.memoryUsage().heapUsed;
    s.run(60 * 60);
    gc();
    const after = process.memoryUsage().heapUsed;
    expect(after - before).toBeLessThan(1_500_000);
  });
});
