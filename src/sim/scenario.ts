import { Btn, type EnemyType } from './constants';
import { enemyTypeByKey } from './content/enemies';
import { mutatorByKey } from './content/mutators';
import { upgradeByKey } from './content/upgrades';
import { WP } from './constants';
import { makeCmd, type InputCmd } from './input';
import { hashWorld, Sim } from './sim';
import { spawnEnemy, type SpawnOpts } from './systems/entities';
import { applyUpgrade, setMutator } from './systems/waves';
import { WavePhase, type World } from './world';

export type InputFn = (w: World, tick: number, out: InputCmd) => void;

/**
 * Fluent builder to set up a precise situation — used by tests, the dev console
 * (`dbg.scenario(...)`) and URL `?scenario=`.
 */
export class Scenario {
  readonly sim: Sim;
  private inputFn: InputFn | null = null;
  private readonly cmd = makeCmd();
  autoPick = 1;

  constructor(seed = 1, difficulty = 1, mode: 'campaign' | 'sandbox' = 'sandbox', startWave = 1) {
    this.sim = new Sim({ seed, difficulty, mode, startWave });
  }
  get world(): World {
    return this.sim.world;
  }
  player(o: { x?: number; y?: number; hp?: number; god?: boolean; weapons?: string[] }): this {
    const p = this.world.player;
    if (o.x !== undefined) p.x = p.px = o.x;
    if (o.y !== undefined) p.y = p.py = o.y;
    if (o.hp !== undefined) p.hp = o.hp;
    if (o.god !== undefined) this.world.god = o.god;
    if (o.weapons) {
      p.slotCount = 0;
      for (const k of o.weapons) {
        const id = (WP as Record<string, number>)[k[0]!.toUpperCase() + k.slice(1)];
        if (id === undefined) throw new Error(`unknown weapon ${k}`);
        p.slots[p.slotCount++] = id;
      }
      p.cur = 0;
    }
    return this;
  }
  spawn(type: string | EnemyType, x: number, y: number, opts?: SpawnOpts): this {
    const t = typeof type === 'string' ? enemyTypeByKey(type) : type;
    spawnEnemy(this.world, t, x, y, { instant: true, ...opts });
    return this;
  }
  ring(type: string, n: number, radius: number, cx = 0, cy = 0): this {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      this.spawn(type, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    }
    return this;
  }
  mutator(key: string, on = true): this {
    setMutator(this.world, mutatorByKey(key).id, on);
    return this;
  }
  upgrade(key: string): this {
    applyUpgrade(this.world, upgradeByKey(key).id);
    return this;
  }
  noAI(v = true): this {
    this.world.noAI = v;
    return this;
  }
  input(fn: InputFn): this {
    this.inputFn = fn;
    return this;
  }
  /** Run N ticks; events are consumed and discarded unless onEvents is supplied. */
  run(ticks: number, onTick?: (w: World) => void): this {
    const w = this.world;
    for (let t = 0; t < ticks; t++) {
      const c = this.cmd;
      c.mx = 0;
      c.my = 0;
      c.ax = w.player.x;
      c.ay = w.player.y - 5;
      c.btn = 0;
      this.inputFn?.(w, w.tick, c);
      if (w.wave.phase === WavePhase.Upgrade && this.autoPick > 0) c.btn |= this.autoPick << Btn.PickShift;
      this.sim.step(c);
      onTick?.(w);
      w.events.clear();
    }
    return this;
  }
  hash(): string {
    return hashWorld(this.world);
  }
}

/** Common scripted inputs for tests. */
export const Inputs = {
  /** aim and fire at the nearest enemy, strafe in a circle */
  aimbot(strafe = true): InputFn {
    return (w, tick, c) => {
      const E = w.enemies;
      let best = -1;
      let bd = 1e9;
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i] || E.st[i] === 0) continue;
        const dx = E.x[i]! - w.player.x;
        const dy = E.y[i]! - w.player.y;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      if (best >= 0) {
        c.ax = E.x[best]!;
        c.ay = E.y[best]!;
        c.btn |= Btn.Fire;
      }
      if (strafe) {
        const ph = Math.floor(tick / 50) % 4;
        c.mx = ph === 0 ? 1 : ph === 2 ? -1 : 0;
        c.my = ph === 1 ? 1 : ph === 3 ? -1 : 0;
      }
      if (tick % 97 === 0) c.btn |= Btn.Dash;
    };
  },
};
