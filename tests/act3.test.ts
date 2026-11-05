import { describe, expect, it } from 'vitest';
import { Inputs, Scenario } from '../src/sim/scenario';
import { AS, Btn, ET } from '../src/sim/constants';
import { Ev, EV_STRIDE } from '../src/core/events';
import { buildArenaLayout, WavePhase, type World } from '../src/sim/world';
import { PAD_CYCLE, padPhase, PAD_HOT, PAD_RETRACT } from '../src/sim/systems/foundry';
import { DT } from '../src/sim/constants';

const count = (w: World, t: number): number => {
  let n = 0;
  for (let k = 0; k < w.events.count; k++) if (w.events.data[k * EV_STRIDE] === t) n++;
  return n;
};
/** sandbox already in the Foundry */
const foundry = (seed = 1): Scenario => {
  const s = new Scenario(seed);
  s.world.act = 2;
  buildArenaLayout(s.world);
  return s;
};

describe('Act III · Foundry mechanics', () => {
  it('conveyor carries the player and reverses after a warning', () => {
    const s = foundry();
    const w = s.world;
    const L = w.lanes;
    s.player({ x: L.cx[0]!, y: L.cy[0]! });
    const x0 = w.player.x;
    let warns = 0;
    let flips = 0;
    s.run(30);
    expect(w.player.x - x0).toBeGreaterThan(0.5); // lane 0 pushes +x
    s.run(60 * 13, (ww) => {
      warns += count(ww, Ev.LaneWarn);
      flips += count(ww, Ev.LaneFlip);
    });
    expect(warns).toBeGreaterThan(0);
    expect(flips).toBeGreaterThan(0);
  });

  it('stamp pads only hurt during stamp frames; lock-step keeps ≥2 s of idle', () => {
    const s = foundry();
    const w = s.world;
    w.phys.lockstep = 1;
    // measure the longest stretch where no pad is hot or marking
    let safe = 0;
    let best = 0;
    for (let t = 0; t < PAD_CYCLE * 3; t += DT) {
      w.time = t;
      let busy = false;
      for (let k = 0; k < w.pads.count; k++) if (padPhase(w, k) >= 2.0) busy = true;
      safe = busy ? 0 : safe + DT;
      best = Math.max(best, safe);
    }
    expect(best).toBeGreaterThanOrEqual(2.0 - DT * 2);
    // standing on a pad: hurt exactly during the hot window
    const s2 = foundry();
    const w2 = s2.world;
    s2.player({ x: w2.pads.x[0]!, y: w2.pads.y[0]! });
    let hurtOutside = false;
    let hurt = false;
    s2.input((ww, _t, c) => {
      c.ax = ww.player.x;
      c.ay = ww.player.y - 5;
    }).run(60 * 8, (ww) => {
      if (count(ww, Ev.PlayerHurt)) {
        const ph = padPhase(ww, 0);
        if (ph >= PAD_HOT - DT && ph < PAD_RETRACT + DT) hurt = true;
        else hurtOutside = true;
      }
      ww.player.x = ww.pads.x[0]!; // hold still on the pad (cancel knockback)
      ww.player.y = ww.pads.y[0]!;
    });
    expect(hurt).toBe(true);
    expect(hurtOutside).toBe(false);
  });

  it('a shot pylon arcs into whoever stands in coolant; insulation protects the player', () => {
    const s = foundry();
    const w = s.world;
    const pool = 0;
    const pyl = w.pylons.pillar[0]!;
    s.noAI().spawn('gunner', w.pools.x[pool]!, w.pools.y[pool]!);
    s.player({ x: w.pillars.x[pyl]! + 6, y: w.pillars.y[pyl]! });
    let arcs = 0;
    s.input((ww, _t, c) => {
      c.ax = ww.pillars.x[pyl]!;
      c.ay = ww.pillars.y[pyl]!;
      c.btn = _t < 10 ? Btn.Fire : 0;
    }).run(120, (ww) => (arcs += count(ww, Ev.Arc)));
    expect(arcs).toBeGreaterThan(0);
    expect(w.enemies.hp[0]!).toBeLessThan(w.enemies.maxHp[0]!);
    // insulated player standing in coolant is not hurt by the pylon
    const s2 = foundry().upgrade('insulated');
    const w2 = s2.world;
    s2.player({ x: w2.pools.x[0]!, y: w2.pools.y[0]! });
    const hp = w2.player.hp;
    s2.input((ww, t, c) => {
      c.ax = ww.pillars.x[ww.pylons.pillar[0]!]!;
      c.ay = ww.pillars.y[ww.pylons.pillar[0]!]!;
      c.btn = t < 10 ? Btn.Fire : 0;
    }).run(120);
    expect(w2.player.hp).toBe(hp);
  });

  it('gear mite spins up, rolls, bounces and gets dizzy', () => {
    const s = foundry().player({ god: true, x: 0, y: 10 }).spawn('mite', 0, -4);
    const seen = new Set<number>();
    s.run(60 * 6, (w) => seen.add(w.enemies.st[0]!));
    expect(seen.has(AS.Windup)).toBe(true);
    expect(seen.has(AS.Dash)).toBe(true);
    expect(seen.has(AS.Stunned)).toBe(true);
  });

  it('stamper drops three predicted marks that go hot together', () => {
    const s = foundry().player({ x: 20, y: 6, god: true }).spawn('stamper', 14, 6);
    let marks = 0;
    let hits = 0;
    s.run(60 * 5, (w) => {
      let n = 0;
      for (let i = 0; i < w.marks.alive.length; i++) if (w.marks.alive[i] && w.marks.src[i] === ET.Stamper) n++;
      marks = Math.max(marks, n);
      hits += count(w, Ev.MarkHit);
    });
    expect(marks).toBe(3);
    expect(hits).toBe(3);
  });

  it('arc drone locks its bolt: moving after the lock dodges it', () => {
    const run = (dodge: boolean): number => {
      const s = foundry(4).player({ x: 0, y: 0 }).spawn('arcdrone', 0, -6);
      const w = s.world;
      s.input((ww, _t, c) => {
        if (dodge && ww.enemies.st[0] === AS.Windup && ww.enemies.charge[0]! > 0.8) c.mx = 1;
      }).run(60 * 4);
      return w.stats.dmgTaken;
    };
    expect(run(false)).toBeGreaterThan(0);
    expect(run(true)).toBe(0);
  });

  it('clamp hauler hook pulls the player; a dash snaps the cable', () => {
    const s = foundry().player({ x: 0, y: 4 }).spawn('hauler', 0, -5);
    let pulled = false;
    s.run(60 * 5, (w) => {
      if (w.player.pullT > 0) pulled = true;
    });
    expect(pulled).toBe(true);
    const s2 = foundry().player({ x: 0, y: 4 }).spawn('hauler', 0, -5);
    let cancelled = false;
    s2.input((w, _t, c) => {
      if (w.player.pullT > 0) c.btn |= Btn.Dash;
    }).run(60 * 5, (w) => {
      if (w.player.dashT > 0 && w.player.pullT === 0) cancelled = true;
    });
    expect(cancelled).toBe(true);
  });

  it('sawblade skiff leaves burning tracks', () => {
    const s = foundry().player({ x: 20, y: 0, god: true }).spawn('skiff', -20, 0);
    let tracks = 0;
    s.run(60 * 4, (w) => {
      tracks = Math.max(tracks, w.tracks.alive.reduce((a, b) => a + b, 0));
    });
    expect(tracks).toBeGreaterThan(5);
  });

  it('overseer shortens lane warnings; its death freezes the belts', () => {
    const s = foundry().player({ x: 0, y: 20, god: true }).spawn('overseer', -18, -6);
    let warns = 0;
    s.run(60 * 8, (w) => (warns += count(w, Ev.LaneWarn)));
    expect(warns).toBeGreaterThan(0);
    const w = s.world;
    w.enemies.hp[0] = 1;
    s.input((ww, _t, c) => {
      c.ax = ww.enemies.x[0]!;
      c.ay = ww.enemies.y[0]!;
      c.btn = Btn.Fire;
    }).run(120);
    expect(w.enemies.count).toBe(0);
    expect(Math.max(...Array.from(w.lanes.frozen))).toBeGreaterThan(0);
  });
});

describe('Act III · bosses and flow', () => {
  it('PRESS cycles its phases and can be destroyed', () => {
    const s = foundry(3).player({ god: true, weapons: ['rail', 'pulse'] }).upgrade('dmg').upgrade('dmg').upgrade('rate');
    s.spawn('press', 0, -14);
    const phases = new Set<number>();
    s.input(Inputs.skilled()).run(60 * 120, (w) => {
      if (w.enemies.alive[0] && w.enemies.type[0] === ET.Press) phases.add(w.enemies.burst[0]!);
    });
    expect(phases.has(3)).toBe(true);
    expect(s.world.miniBoss).toBe(-1);
  });

  it('ASSEMBLER builds four arms and the run ends in victory', () => {
    const s = new Scenario(7, 1, 'campaign', 19).player({ god: true, weapons: ['rail', 'scatter'] });
    s.upgrade('dmg').upgrade('dmg').upgrade('rate').upgrade('rate').upgrade('dmg');
    let arms = 0;
    s.input(Inputs.skilled()).run(60 * 240, (w) => {
      let n = 0;
      for (let i = 0; i < w.enemies.hi; i++) if (w.enemies.alive[i] && w.enemies.type[i] === ET.Arm) n++;
      arms = Math.max(arms, n);
    });
    expect(arms).toBe(4);
    expect(s.world.wave.phase).toBe(WavePhase.Victory);
  });

  it('Act II → III transition builds the Foundry, and its waves never stall', () => {
    const s = new Scenario(5, 1, 'campaign', 13).player({ god: true, weapons: ['pulse', 'scatter', 'rail'] });
    s.upgrade('dmg').upgrade('dmg').upgrade('rate').upgrade('rate');
    s.autoPick = 0;
    let reachedAct3 = false;
    s.input(Inputs.skilled()).run(60 * 60 * 9, (w) => {
      if (w.act === 2) reachedAct3 = true;
    });
    expect(reachedAct3).toBe(true);
    expect(s.world.lanes.count).toBe(4);
    expect(s.world.wave.index).toBeGreaterThanOrEqual(17); // reached at least PRESS
  });
});
