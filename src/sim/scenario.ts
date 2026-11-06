import { WEAPONS } from './content/weapons';
import { AS, ARENA_HH, ARENA_HW, Btn, ET, Team, type EnemyType } from './constants';
import { enemyTypeByKey } from './content/enemies';
import { mutatorByKey } from './content/mutators';
import { upgradeByKey, UPGRADES } from './content/upgrades';
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
        const id = WEAPONS.find((d) => d.key === k)?.id ?? (WP as Record<string, number>)[k[0]!.toUpperCase() + k.slice(1)];
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

import { tactician } from './bot/tactician';

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
  /**
   * A "skilled human" bot used to balance difficulties: decisions are re-evaluated only every
   * `reaction` ticks (≈ human reaction time); it reads telegraphs, side-steps bullets, dashes
   * through unavoidable hits, kites melee and leads its shots.
   */
  skilled(o: { reaction?: number } = {}): InputFn {
    const reaction = o.reaction ?? 8;
    let last = -1e9;
    let hx = 0;
    let hy = 0;
    let dash = false;
    let orbit = 1;
    return (w, tick, c) => {
      const p = w.player;
      const E = w.enemies;
      // ── aim: nearest valid target with lead (continuous, like a mouse)
      let best = -1;
      let bd = 1e9;
      let shieldFront = false;
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i] || E.st[i] === AS.Spawning || E.st[i] === AS.Underground) continue;
        const dx = E.x[i]! - p.x;
        const dy = E.y[i]! - p.y;
        let d = dx * dx + dy * dy;
        // a shielder facing us is a bad target: prefer anything else, otherwise flank it
        let front = false;
        if (E.type[i] === ET.Shielder) {
          const f = E.face[i]!;
          front = Math.cos(f) * -dx + Math.sin(f) * -dy > 0.35 * Math.sqrt(d);
          if (front) d += 900;
        }
        if (d < bd) {
          bd = d;
          best = i;
          shieldFront = front;
        }
      }
      if (best >= 0) {
        const t = Math.sqrt(bd > 900 && shieldFront ? bd - 900 : bd) / 42;
        c.ax = E.x[best]! + E.vx[best]! * t;
        c.ay = E.y[best]! + E.vy[best]! * t;
        c.btn |= Btn.Fire;
      }
      if (tick - last >= reaction) {
        last = tick;
        if (tick % 240 === 0 && !shieldFront) orbit = -orbit;
        let vx = 0;
        let vy = 0;
        dash = false;
        // bullets about to hit → step perpendicular to their path
        const B = w.bullets;
        for (let b = 0; b < B.hi; b++) {
          if (!B.alive[b] || B.team[b] !== Team.Enemy) continue;
          const rx = p.x - B.x[b]!;
          const ry = p.y - B.y[b]!;
          if (rx * rx + ry * ry > 100) continue;
          const bvx = B.vx[b]!;
          const bvy = B.vy[b]!;
          const v2 = bvx * bvx + bvy * bvy;
          if (v2 < 0.01) continue;
          const t = (rx * bvx + ry * bvy) / v2;
          if (t < 0 || t > 0.7) continue;
          const mx = rx - bvx * t;
          const my = ry - bvy * t;
          const miss = Math.sqrt(mx * mx + my * my);
          if (miss > 1.5) continue;
          const l = Math.sqrt(v2);
          let px = -bvy / l;
          let py = bvx / l;
          if (px * mx + py * my < 0) {
            px = -px;
            py = -py;
          }
          const wgt = ((1.5 - miss) / 1.5) * (1.2 - t);
          vx += px * wgt * 3;
          vy += py * wgt * 3;
          if (t < 0.18 && miss < 0.75) dash = true;
        }
        const away = (x: number, y: number, r: number, k: number): void => {
          const dx = p.x - x;
          const dy = p.y - y;
          const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
          if (d < r) {
            vx += (dx / d) * k * (1 - d / r + 0.3);
            vy += (dy / d) * k * (1 - d / r + 0.3);
          }
        };
        let nearD = 1e9;
        let nx = 0;
        let ny = 0;
        for (let i = 0; i < E.hi; i++) {
          if (!E.alive[i] || E.st[i] === AS.Spawning) continue;
          const t = E.type[i]!;
          const st = E.st[i]!;
          const ex = E.x[i]!;
          const ey = E.y[i]!;
          // telegraphed zones
          if (t === ET.Bloater && st === AS.Windup) away(ex, ey, 4.4, 4);
          if (t === ET.Worm && st === AS.Windup) {
            away(ex, ey, 3, 5);
            const dx = p.x - ex;
            const dy = p.y - ey;
            if (dx * dx + dy * dy < 2.2 * 2.2 && E.charge[i]! > 0.6) dash = true;
          }
          if ((t === ET.Charger || t === ET.Dart) && st === AS.Windup) {
            // step out of the dash lane
            const a = E.aim[i]!;
            const lx = Math.cos(a);
            const ly = Math.sin(a);
            const rx = p.x - ex;
            const ry = p.y - ey;
            const along = rx * lx + ry * ly;
            const side = rx * -ly + ry * lx;
            if (along > 0 && along < 16 && Math.abs(side) < 2.4) {
              const s = side >= 0 ? 1 : -1;
              vx += -ly * s * 4;
              vy += lx * s * 4;
            }
          }
          if (st === AS.Underground) continue;
          const dx = ex - p.x;
          const dy = ey - p.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          const melee = t === ET.Swarmer || t === ET.Charger || t === ET.Bloater || t === ET.Dart || t === ET.Parasite || t === ET.Worm;
          if (melee) away(ex, ey, 4.5, 2.2);
          if (d < nearD) {
            nearD = d;
            nx = dx;
            ny = dy;
          }
        }
        // boss slam & lasers
        const BS = w.boss;
        if (BS.id >= 0 && BS.pattern === 4 && BS.patternT < 1.1) away(BS.slamX, BS.slamY, 5.2, 5);
        const L = w.lasers;
        for (let k = 0; k < L.alive.length; k++) {
          if (!L.alive[k] || L.warm[k]! > 0.5) continue;
          const a = L.ang[k]!;
          const lx = Math.cos(a);
          const ly = Math.sin(a);
          const rx = p.x - L.x[k]!;
          const ry = p.y - L.y[k]!;
          const side = rx * -ly + ry * lx;
          if (rx * lx + ry * ly > 0 && Math.abs(side) < 3) {
            // move with the sweep's trailing side (away from the beam's travel direction)
            const s = (L.angVel[k]! > 0 ? -1 : 1);
            vx += -ly * s * 4;
            vy += lx * s * 4;
          }
        }
        // kite: keep a comfortable range and orbit
        if (nearD < 1e8) {
          const d = nearD || 1;
          const rx = nx / d;
          const ry = ny / d;
          const radial = d < 8 ? -0.9 : d > 14 ? 0.5 : 0;
          const ow = shieldFront ? 1.8 : 0.7; // circle hard around a raised shield
          vx += rx * radial + -ry * orbit * ow;
          vy += ry * radial + rx * orbit * ow;
        }
        // stay out of corners / walls and flesh pools
        vx -= Math.sign(p.x) * Math.max(0, Math.abs(p.x) / ARENA_HW - 0.65) * 4;
        vy -= Math.sign(p.y) * Math.max(0, Math.abs(p.y) / ARENA_HH - 0.6) * 4;
        const PL = w.pools;
        for (let k = 0; k < PL.count; k++) away(PL.x[k]!, PL.y[k]!, PL.r[k]! + 0.5, 1.5);
        hx = vx > 0.35 ? 1 : vx < -0.35 ? -1 : 0;
        hy = vy > 0.35 ? 1 : vy < -0.35 ? -1 : 0;
      }
      // upgrade choice like a sensible player: heal when hurt, else damage / fire rate / weapons
      if (w.wave.phase === WavePhase.Upgrade && w.wave.t > 0.3) {
        let bestK = 0;
        let bestS = -1;
        for (let k = 0; k < w.wave.offerCount; k++) {
          const u = UPGRADES[w.wave.offer[k]!]!;
          let sc = 1;
          if (u.key === 'heal') sc = p.hp < p.maxHp * 0.55 ? 10 : 0.5;
          else if (u.key === 'hp') sc = p.hp < p.maxHp * 0.7 ? 6 : 3;
          else if (u.key === 'dmg' || u.key === 'rate') sc = 5;
          else if (u.weapon >= 0) sc = 4 + u.rarity;
          else if (u.key === 'multi' || u.key === 'crit' || u.key === 'pierce') sc = 4;
          if (sc > bestS) {
            bestS = sc;
            bestK = k;
          }
        }
        c.btn |= (bestK + 1) << Btn.PickShift;
      }
      c.mx = hx;
      c.my = hy;
      if (dash) {
        c.btn |= Btn.Dash;
        dash = false;
      }
    };
  },
};

/** picks the first offered upgrade (for bots that don't choose) */
function withAutoPick(fn: InputFn): InputFn {
  return (w, t, c) => {
    fn(w, t, c);
    if (w.wave.phase === WavePhase.Upgrade && w.wave.t > 0.4) c.btn |= 1 << Btn.PickShift;
  };
}

export interface BotSkill {
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  make(): InputFn;
}

/** Bot mastery levels (same bots the balance report uses). */
export const BOT_SKILLS: readonly BotSkill[] = [
  { key: 'novice', name: 'Новичок', desc: 'Стреляет в ближайшего, ходит по квадрату, рывок по таймеру. Телеграфов не читает.', make: () => withAutoPick(Inputs.aimbot()) },
  { key: 'casual', name: 'Средний', desc: 'Реакция ~200 мс. Уклоняется и кайтит, но часто опаздывает.', make: () => Inputs.skilled({ reaction: 12 }) },
  { key: 'skilled', name: 'Опытный', desc: 'Реакция ~133 мс. Читает телеграфы, обходит щиты, выбирает апгрейды.', make: () => Inputs.skilled({ reaction: 8 }) },
  { key: 'master', name: 'Мастер', desc: 'Реакция ~83 мс. Рывки сквозь пули в последний момент.', make: () => Inputs.skilled({ reaction: 5 }) },
  {
    key: 'tactician',
    name: 'Тактик',
    desc: 'Реакция ~100 мс. Карта опасности, бережёт рывок, выбирает цель по угрозе, меняет оружие под ситуацию, подрывает пилоны.',
    make: () => tactician({ reaction: 6 }),
  },
];
