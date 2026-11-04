import { bossForcePattern, BOSS_PATTERN_NAMES } from '../ai/boss';
import { AS, ET, WP, type EnemyType } from '../sim/constants';
import { ENEMIES, enemyDef, enemyTypeByKey } from '../sim/content/enemies';
import { MUTATORS, mutatorByKey } from '../sim/content/mutators';
import { UPGRADES, upgradeByKey } from '../sim/content/upgrades';
import { WEAPONS } from '../sim/content/weapons';
import { Inputs, Scenario } from '../sim/scenario';
import { hashWorld, Sim } from '../sim/sim';
import { killEnemy, spawnEnemy, type SpawnOpts } from '../sim/systems/entities';
import { applyUpgrade, setMutator } from '../sim/systems/waves';
import { WavePhase, type World } from '../sim/world';
import type { Game } from '../game';
import type { ReplayData } from '../sim/replay';
import { DebugOverlay, type OverlayKind } from './overlay';

const STATE_NAMES = Object.fromEntries(Object.entries(AS).map(([k, v]) => [v, k])) as Record<number, string>;
const OVERLAYS: OverlayKind[] = ['off', 'hitbox', 'ai', 'flow', 'grid', 'all'];

export type SceneName = string;

/** Named setups for quick iteration (also reachable via ?scene=name). */
export const SCENES: Record<string, string> = {
  arena: 'Пустая песочница',
  gallery: 'Все враги в ряд (без ИИ, god)',
  swarm: '30 роевиков по кругу',
  archers: '4 Терновника + щит',
  gunners: '6 дронов (токены атак)',
  chargers: '3 Тарана',
  shield: 'Призма охраняет лучников — обход с фланга',
  weapons: 'Всё оружие + манекены',
  boss: 'Босс, фаза 1',
  boss2: 'Босс, фаза 2',
  boss3: 'Босс, фаза 3',
  stress: '300 врагов, нагрузочный тест',
  'mutator:overclock': 'Мутатор РАЗГОН',
  'mutator:cryo': 'Мутатор КРИОПОЛ',
  'mutator:gravity': 'Мутатор ГРАВИКОЛОДЦЫ',
  'mutator:ricochet': 'Мутатор ЗЕРКАЛА',
  'mutator:drift': 'Мутатор ДРЕЙФ',
  'mutator:stasis': 'Мутатор СТАЗИС',
};

export function buildScene(name: string, seed: number, difficulty: number): Sim {
  const sc = (mode: 'sandbox' | 'campaign' = 'sandbox', wave = 1): Scenario => new Scenario(seed, difficulty, mode, wave);
  let s: Scenario;
  switch (name) {
    case 'gallery': {
      s = sc().player({ x: 0, y: 8, god: true }).noAI();
      ENEMIES.forEach((e, i) => s.spawn(e.key, -15 + i * 6, 0));
      break;
    }
    case 'swarm':
      s = sc().player({ god: true }).ring('swarmer', 30, 14, 0, 6);
      break;
    case 'archers':
      s = sc().player({ god: true }).spawn('archer', -12, -10).spawn('archer', 12, -10).spawn('archer', -14, 12).spawn('archer', 14, 12).spawn('shielder', 0, -8);
      break;
    case 'gunners':
      s = sc().player({ god: true });
      for (let k = 0; k < 6; k++) s.spawn('gunner', -15 + k * 6, -12);
      break;
    case 'chargers':
      s = sc().player({ god: true }).spawn('charger', -12, -10).spawn('charger', 12, -10).spawn('charger', 0, 14);
      break;
    case 'shield':
      s = sc().player({ god: true }).spawn('archer', 0, -16).spawn('archer', 4, -17).spawn('shielder', 1, -12);
      break;
    case 'weapons': {
      s = sc().player({ god: true, weapons: ['pulse', 'scatter', 'needler', 'launcher', 'rail', 'singularity'] }).noAI();
      for (let k = 0; k < 12; k++) s.spawn(k % 3 === 0 ? 'charger' : k % 3 === 1 ? 'gunner' : 'archer', -14 + (k % 6) * 5.6, -8 - Math.floor(k / 6) * 5);
      break;
    }
    case 'boss':
    case 'boss2':
    case 'boss3': {
      s = sc('campaign', 9).player({ god: true, weapons: ['pulse', 'rail', 'singularity'] });
      s.run(200);
      const w = s.world;
      if (w.boss.id >= 0 && name !== 'boss') {
        w.enemies.hp[w.boss.id] = w.enemies.maxHp[w.boss.id]! * (name === 'boss2' ? 0.6 : 0.3);
      }
      break;
    }
    case 'stress': {
      s = sc().player({ god: true, weapons: ['needler', 'scatter', 'pulse'] });
      for (let k = 0; k < 300; k++) {
        const a = (k / 300) * Math.PI * 2 * 7;
        const r = 8 + (k % 13) * 1.6;
        s.spawn(k % 5 === 0 ? 'gunner' : 'swarmer', Math.cos(a) * r, Math.sin(a) * r * 0.65);
      }
      break;
    }
    default: {
      if (name.startsWith('mutator:')) {
        s = sc().player({ god: true, weapons: ['pulse', 'scatter', 'launcher', 'rail'] }).mutator(name.slice(8));
        s.spawn('gunner', -10, -10).spawn('gunner', 10, -10).spawn('archer', 0, -16).spawn('swarmer', -6, 8).spawn('swarmer', 6, 8).spawn('charger', 14, 10);
      } else s = sc().player({});
    }
  }
  return s.sim;
}

/**
 * window.dbg — console API for precise scene modelling and debugging.
 * Everything here goes through the same sim functions as gameplay.
 */
export function installDebug(game: Game): DebugOverlay {
  const overlay = new DebugOverlay(game);
  let ovIdx = 0;
  const w = (): World => game.world;
  const api = {
    game,
    get world(): World {
      return w();
    },
    help(): string {
      const h = `dbg.pause() / resume() / step(n) / timeScale(s)
dbg.scene(name)            ${Object.keys(SCENES).join(', ')}
dbg.start({seed,difficulty,startWave,sandbox})
dbg.spawn(type, x, y, {affix, instant})   types: ${ENEMIES.map((e) => e.key).join(', ')}
dbg.ring(type, n, radius)  dbg.kill(id|'all')   dbg.god(on)   dbg.noAI(on)
dbg.weapon(key)  dbg.upgrade(key)  dbg.mutator(key, on)   dbg.wave(n)
dbg.boss.pattern(name)     ${BOSS_PATTERN_NAMES.join(', ')}
dbg.inspect(id)  dbg.list()   dbg.overlay(kind)  ${OVERLAYS.join(', ')}
dbg.hash()  dbg.replay.save() / load(data) / download()
dbg.fx.hit(material, x, y) / kill(type, x, y) / explode(x, y, r) / muzzle(weapon)
dbg.shake(v) dbg.post({bloom, threshold, exposure, scan, grain, vignette, enabled})
dbg.shot() → dataURL`;
      console.log(h);
      return h;
    },
    pause(): void {
      game.paused = true;
    },
    resume(): void {
      game.paused = false;
    },
    step(n = 1): void {
      game.paused = true;
      game.stepQueue += n;
    },
    timeScale(s: number): void {
      game.timeScale = s;
    },
    start(cfg: { seed?: number; difficulty?: number; startWave?: number; sandbox?: boolean }): void {
      game.start({ seed: cfg.seed ?? 1, difficulty: cfg.difficulty ?? 1, ...(cfg.startWave ? { startWave: cfg.startWave } : {}), ...(cfg.sandbox ? { sandbox: true } : {}) });
    },
    scene(name: string, seed = 1, difficulty = 1): void {
      game.start({ seed, difficulty, sandbox: true });
      game.sim = buildScene(name, seed, difficulty);
      game.renderer.camera.snap(game.world.player.x, game.world.player.y);
      game.hud.reset();
    },
    spawn(type: string, x?: number, y?: number, opts?: SpawnOpts): number {
      const p = w().player;
      return spawnEnemy(w(), enemyTypeByKey(type), x ?? p.x, y ?? p.y - 8, opts);
    },
    ring(type: string, n: number, radius = 10): void {
      const p = w().player;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        spawnEnemy(w(), enemyTypeByKey(type), p.x + Math.cos(a) * radius, p.y + Math.sin(a) * radius);
      }
    },
    kill(id: number | 'all'): void {
      const E = w().enemies;
      if (id === 'all') {
        for (let i = 0; i < E.hi; i++) if (E.alive[i] && E.type[i] !== ET.Boss) killEnemy(w(), i, 0, 0, 0, 0);
      } else if (E.alive[id]) killEnemy(w(), id, 0, 0, 0, 0);
    },
    god(on = true): void {
      w().god = on;
    },
    noAI(on = true): void {
      w().noAI = on;
    },
    weapon(key: string): void {
      const wd = WEAPONS.find((x) => x.key === key);
      if (!wd) throw new Error(`weapons: ${WEAPONS.map((x) => x.key).join(', ')}`);
      const up = UPGRADES.find((u) => u.weapon === wd.id);
      if (up) applyUpgrade(w(), up.id);
      else {
        const p = w().player;
        p.slots[p.slotCount++] = wd.id;
      }
    },
    upgrade(key: string): void {
      applyUpgrade(w(), upgradeByKey(key).id);
    },
    mutator(key: string, on = true): void {
      setMutator(w(), mutatorByKey(key).id, on);
    },
    wave(n: number): void {
      game.start({ seed: game.config.seed, difficulty: game.config.difficulty, startWave: n });
    },
    boss: {
      pattern(name: string): void {
        const i = BOSS_PATTERN_NAMES.indexOf(name as (typeof BOSS_PATTERN_NAMES)[number]);
        if (i < 0) throw new Error(BOSS_PATTERN_NAMES.join(', '));
        bossForcePattern(w(), i);
      },
      hp(frac: number): void {
        const b = w().boss.id;
        if (b >= 0) w().enemies.hp[b] = w().enemies.maxHp[b]! * frac;
      },
    },
    inspect(id: number): Record<string, unknown> {
      const E = w().enemies;
      if (!E.alive[id]) return { alive: false };
      return {
        type: enemyDef(E.type[id]!).key,
        state: STATE_NAMES[E.st[id]!],
        stT: E.stT[id],
        hp: E.hp[id],
        pos: [E.x[id], E.y[id]],
        vel: [E.vx[id], E.vy[id]],
        face: E.face[id],
        charge: E.charge[id],
        cd: E.cd[id],
        token: !!E.token[id],
        target: [E.tx[id], E.ty[id]],
        utility: Array.from(E.util.subarray(id * 6, id * 6 + 6)),
        affix: E.affix[id],
      };
    },
    list(): string[] {
      const E = w().enemies;
      const out: string[] = [];
      for (let i = 0; i < E.hi; i++) if (E.alive[i]) out.push(`#${i} ${enemyDef(E.type[i]!).key} ${STATE_NAMES[E.st[i]!]} hp=${E.hp[i]!.toFixed(0)}`);
      return out;
    },
    overlay(kind?: OverlayKind): OverlayKind {
      if (kind) overlay.kind = kind;
      else {
        ovIdx = (OVERLAYS.indexOf(overlay.kind) + 1) % OVERLAYS.length;
        overlay.kind = OVERLAYS[ovIdx]!;
      }
      return overlay.kind;
    },
    hash(): string {
      return hashWorld(w());
    },
    replay: {
      save(): ReplayData {
        const r = game.makeReplay();
        game.lastReplay = r;
        return r;
      },
      load(data: ReplayData): void {
        game.playReplay(data);
      },
      speed(s: number): void {
        game.replaySpeed = s;
      },
      download(): void {
        const r = game.lastReplay ?? game.makeReplay();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
        a.download = `null-arena-${r.seed}-${r.ticks}.json`;
        a.click();
      },
    },
    fx: {
      hit(mat = 0, x?: number, y?: number): void {
        const p = w().player;
        game.renderer.fx.hitFx(mat, x ?? p.x, y ?? p.y - 4, 0.8, -Math.PI / 2, 30, false, 0);
      },
      kill(type: string, x?: number, y?: number): void {
        const p = w().player;
        const t = enemyTypeByKey(type) as EnemyType;
        const d = enemyDef(t);
        game.renderer.fx.killFx(d.material, t, x ?? p.x, y ?? p.y - 5, -Math.PI / 2, d.r, 0, 30, 0, 0.5);
      },
      explode(x?: number, y?: number, r = 3.6): void {
        const p = w().player;
        game.renderer.fx.explosionFx(x ?? p.x, y ?? p.y - 6, r, 2, 0);
      },
      muzzle(weapon = 'rail'): void {
        const p = w().player;
        const wd = WEAPONS.find((x) => x.key === weapon) ?? WEAPONS[0]!;
        game.renderer.fx.muzzleFx(p.x, p.y, p.face, wd.id, wd.rarity);
      },
    },
    shake(v = 0.5): void {
      game.renderer.juice.addTrauma(v);
    },
    post(s: Partial<typeof game.renderer.post.settings>): typeof game.renderer.post.settings {
      Object.assign(game.renderer.post.settings, s);
      return game.renderer.post.settings;
    },
    shot(): string {
      return game.canvas.toDataURL('image/png');
    },
    selfPlay(on = true): void {
      game.attract = on ? Inputs.aimbot() : null;
      game.setMode(on ? 'demo' : 'play');
    },
    constants: { WP, ET, AS, WavePhase, MUTATORS: MUTATORS.map((m) => m.key), UPGRADES: UPGRADES.map((u) => u.key) },
  };
  (window as unknown as { dbg: typeof api }).dbg = api;
  game.input.onKey = (code) => {
    if (code === 'Backquote') api.overlay();
    if (code === 'F2') game.paused = !game.paused;
    if (code === 'F3') api.step(1);
    if (code === 'F4') w().god = !w().god;
  };
  game.onFrame = () => overlay.draw();
  return overlay;
}
