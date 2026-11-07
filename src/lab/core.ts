import { signal } from '@preact/signals';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { AudioEngine } from '../audio/audio';
import { SFX, type SfxId } from '../audio/sfx';
import { GameRenderer } from '../render/renderer';
import { MODELS, modelByKey, modelOverrides, paramsFor, type ModelDef } from '../render/models/defs';
import type { InstancedModel } from '../render/entities';
import { AS, ET, Mat, Team, WP } from '../sim/constants';
import { ENEMIES, enemyDef } from '../sim/content/enemies';
import { WEAPONS } from '../sim/content/weapons';
import { MUTATORS } from '../sim/content/mutators';
import { spawnEnemy } from '../sim/systems/entities';
import { setMutator } from '../sim/systems/waves';
import { World } from '../sim/world';

/**
 * NULL//ARENA Lab engine — inspect & tweak every procedural asset with the real render pipeline.
 * Created once on the first visit of #/lab (its own canvas + renderer), then only paused while
 * other pages are open. The UI (./page.tsx) reads the signals below; window.lab is the
 * programmatic API (screenshots / automation).
 */
const LS = 'null-arena:model-overrides';
try {
  Object.assign(modelOverrides, JSON.parse(localStorage.getItem(LS) ?? '{}'));
} catch {
  /* ignore */
}

export const canvas = document.createElement('canvas');
canvas.className = 'lab-canvas';
const audio = new AudioEngine();
const R = new GameRenderer(canvas, audio);
R.camera.manual = true;
const cam = R.camera.cam;
const controls = new OrbitControls(cam, canvas);
controls.enableDamping = true;
controls.target.set(0, 0.8, 0);
cam.position.set(4, 3.5, 5);
let world = new World({ seed: 1, difficulty: 1, mode: 'sandbox' });
world.noAI = true;
world.god = true;

type Anim = { state: number; charge: number; walk: number; speed: number; flash: number; elite: boolean; spin: boolean; loopFx: string };
const anim: Anim = { state: AS.Move, charge: 0, walk: 0, speed: 0, flash: 0, elite: false, spin: true, loopFx: '' };
let current: ModelDef = modelByKey('archer');
/** UI state */
export const ui = {
  model: signal('archer'),
  state: signal<number>(AS.Move),
  loopFx: signal(''),
  elite: signal(false),
  spin: signal(true),
  spawnLoop: signal(false),
  postOn: signal(true),
  info: signal(''),
  /** bumps when the model's params were rebuilt / reset */
  paramsRev: signal(0),
};
let enemyId = -1;
let fxTimer = 0;
let spawnLoop = false;

function meshFor(def: ModelDef): InstancedModel {
  if (def.key === 'player') return R.entities.player;
  if (def.key === 'pillar') return R.entities.pillars;
  if (def.key === 'growth') return R.entities.growths;
  if (def.key === 'block') return R.entities.blocks;
  if (def.key === 'pylon') return R.entities.pylons;
  if (def.key === 'piston') return R.entities.pistons;
  const t = ENEMIES.findIndex((e) => e.key === def.key);
  return R.entities.enemies[t]!;
}

function resetWorld(): void {
  world = new World({ seed: 1, difficulty: 1, mode: 'sandbox' });
  world.noAI = true;
  world.god = true;
  world.pillars.count = 0;
  world.player.x = world.player.px = 0;
  world.player.y = world.player.py = 0;
  world.player.alive = false;
  enemyId = -1;
}

function showModel(key: string): void {
  resetWorld();
  current = modelByKey(key);
  // arena props are not enemies: the renderer picks the pillar model by the world's act
  const PROPS: Record<string, () => void> = {
    pillar: () => world.pillars.add(0, 0, 1),
    growth: () => {
      world.act = 1;
      world.pillars.add(0, 0, 1);
    },
    block: () => {
      world.act = 2;
      world.pillars.add(0, 0, 0.8);
    },
    pylon: () => {
      world.act = 2;
      world.pillars.add(0, 0, 0.8);
      world.pylons.count = 1;
      world.pylons.pillar[0] = 0;
    },
    piston: () => {
      world.act = 2;
      world.pads.add(0, 0, 0);
    },
  };
  if (key === 'player') world.player.alive = true;
  else if (PROPS[key]) PROPS[key]!();
  else {
    const t = ENEMIES.findIndex((e) => e.key === key);
    if (t < 0) throw new Error(`lab: model '${key}' is neither an enemy nor a known prop`);
    enemyId = spawnEnemy(world, t as 0, 0, 0, { instant: true });
    world.enemies.face[enemyId] = 0;
  }
  const h = current.height;
  controls.target.set(0, h * 0.5, 0);
  const d = Math.max(3.2, h * 2.2);
  cam.position.set(d * 0.8, h * 0.9 + d * 0.35, d);
  ui.model.value = key;
  ui.paramsRev.value++;
  info();
}

function applyAnim(dt: number): void {
  const E = world.enemies;
  if (enemyId >= 0 && E.alive[enemyId]) {
    E.st[enemyId] = anim.state;
    E.charge[enemyId] = anim.charge;
    anim.walk += dt * anim.speed * 4;
    E.walk[enemyId] = anim.walk;
    E.vx[enemyId] = anim.speed * enemyDef(E.type[enemyId]!).speed;
    E.vy[enemyId] = 0;
    E.flash[enemyId] = anim.flash;
    E.affix[enemyId] = anim.elite ? 1 : 0;
    E.aim[enemyId] = 0;
    E.stT[enemyId] = anim.charge * 1.2;
    if (anim.state === AS.Attached) E.tx[enemyId] = -1; // parasite: latched on the player
    if (E.type[enemyId] === ET.Parasite) E.fed[enemyId] = anim.state === AS.Attached || anim.state === AS.Retreat ? anim.charge : anim.state === AS.Guard ? 1 - anim.charge : 0;
    if (anim.spin) E.face[enemyId] = E.faceP[enemyId] = E.face[enemyId]! + dt * 0.5;
    E.px[enemyId] = E.x[enemyId]!;
    E.py[enemyId] = E.y[enemyId]!;
    if (E.st[enemyId] === AS.Spawning) {
      E.spawnT[enemyId] = E.spawnT[enemyId]! - dt;
      if (E.spawnT[enemyId]! <= 0) E.spawnT[enemyId] = enemyDef(E.type[enemyId]!).spawnTime;
    }
  }
  const p = world.player;
  if (p.alive) {
    p.recoil = anim.charge;
    p.walk += dt * anim.speed * 4;
    if (anim.spin) p.face = p.faceP = p.face + dt * 0.5;
    p.ax = Math.cos(p.face) * 6;
    p.ay = Math.sin(p.face) * 6;
    p.hurtT = anim.flash;
  }
  anim.flash = Math.max(0, anim.flash - dt * 4);
}

// ───────────── FX presets
const FX: Record<string, () => void> = {};
const mats = ['flesh', 'plant', 'machine', 'crystal', 'void'] as const;
mats.forEach((m, i) => {
  FX[`hit:${m}`] = () => R.fx.hitFx(i, 0, 0, 0.8, Math.PI * 0.25, 30, false, 0);
});
FX['hit:crit'] = () => R.fx.hitFx(Mat.Flesh, 0, 0, 0.8, 0, 40, true, 3);
ENEMIES.forEach((e) => {
  FX[`kill:${e.key}`] = () => R.fx.killFx(e.material, e.type, 0, 0, Math.PI * 0.25, e.r, 0, 30, 0, 0.5);
  FX[`spawn:${e.key}`] = () => {
    R.fx.spawnFx(0, 0, e.type, false);
    setTimeout(() => R.fx.spawnFx(0, 0, e.type, true), e.spawnTime * 1000);
  };
});
FX['kill:overkill-rail'] = () => R.fx.killFx(Mat.Flesh, ET.Charger, 0, 0, 0, 0.95, 2, 200, 0, 0.5);
FX['explode:small'] = () => R.fx.explosionFx(0, 0, 2.5, 1, Team.Player);
FX['explode:grenade'] = () => R.fx.explosionFx(0, 0, 3.6, 2, Team.Player);
FX['explode:big'] = () => R.fx.explosionFx(0, 0, 8, 6, Team.Player);
FX['explode:enemy'] = () => R.fx.explosionFx(0, 0, 3, 2, Team.Enemy);
WEAPONS.forEach((w) => {
  FX[`muzzle:${w.key}`] = () => R.fx.muzzleFx(0, 0, 0, w.id, w.rarity);
});
const fakeEvent = (type: number, ...vals: number[]): void => {
  world.events.clear();
  world.events.push(type as 1, ...vals);
  R.fx.consume(world);
  world.events.clear();
};
FX['rail:beam'] = () => fakeEvent(11, -8, 0, 8, 0, 2, 3);
FX['implode'] = () => fakeEvent(24, 0, 0, 7);
FX['shockwave'] = () => fakeEvent(25, 0, 0, 3);
FX['boss:phase'] = () => fakeEvent(14, 0, 0, 2);
FX['boss:teleport'] = () => fakeEvent(26, -5, 0, 5, 0);
FX['player:hurt'] = () => fakeEvent(9, 0, 0, 20, 50, 0);
FX['player:dash'] = () => fakeEvent(10, 0, 0, 0);
FX['archer:release'] = () => fakeEvent(22, 0, 0, 0);
FX['shield:block'] = () => fakeEvent(28, 0, 0, Math.PI);
FX['telegraph:slam'] = () => fakeEvent(30, 0, 0, 4.2, 1);
FX['pickup'] = () => fakeEvent(29, 0, 0, 0);
FX['decal:sheet'] = () => decalSheet();

function decalSheet(): void {
  R.floor.decals.clear();
  const g = [
    [0.09, 0.0015, 0.005, 0.92],
    [0.11, 0.57, 0.03, 0.8],
    [0.004, 0.004, 0.007, 0.9],
    [0.08, 0.12, 0.38, 0.5],
    [0.14, 0.02, 0.3, 0.6],
  ];
  for (let m = 0; m < 5; m++) {
    for (let s = 0; s < 3; s++) {
      const c = g[m]!;
      R.floor.decals.add(-8 + m * 4, -4 + s * 4, 2.5, m + s, c[0]!, c[1]!, c[2]!, c[3]!, s, m * 10 + s, s === 2 ? 1 : 0);
    }
  }
  cam.position.set(0, 22, 0.01);
  controls.target.set(0, 0, 0);
}

export function runFx(name: string): void {
  const f = FX[name];
  if (!f) throw new Error(`fx: ${Object.keys(FX).join(', ')}`);
  f();
  info(`fx: ${name}`);
}

// ───────────── controls (called by the UI)
// the charge slider scrubs through timed states (stT = charge × 1.2 s)
export const STATES: Record<string, number> = {
  idle: AS.Move,
  windup: AS.Windup,
  attack: AS.Attack,
  bite: AS.Attack,
  dash: AS.Dash,
  leap: AS.Leap,
  stunned: AS.Stunned,
  burrow: AS.Burrow,
  emerge: AS.Emerge,
  latched: AS.Attached,
  hop: AS.Retreat,
  sated: AS.Guard,
  spawn: AS.Spawning,
};
export function setState(k: string): void {
  anim.state = STATES[k]!;
  ui.state.value = anim.state;
  if (k === 'spawn' && enemyId >= 0) world.enemies.spawnT[enemyId] = enemyDef(world.enemies.type[enemyId]!).spawnTime;
}
export function action(k: string): void {
  if (k === 'hit-flash') anim.flash = 1;
  if (k === 'elite') ui.elite.value = anim.elite = !anim.elite;
  if (k === 'turntable') ui.spin.value = anim.spin = !anim.spin;
  if (k === 'respawn-loop') ui.spawnLoop.value = spawnLoop = !spawnLoop;
  if (k === 'death' && enemyId >= 0) {
    const t = world.enemies.type[enemyId]!;
    const d = enemyDef(t);
    R.fx.killFx(d.material, t, 0, 0, 0.6, d.r, 0, 0, world.enemies.face[enemyId]!, 0.5);
    world.enemies.alive[enemyId] = 0;
    setTimeout(() => showModel(current.key), 1300);
  }
}
export function setLoopFx(k: string): void {
  ui.loopFx.value = anim.loopFx = k === 'off' ? '' : k;
}
export function setMutatorKey(k: string): void {
  for (const m of MUTATORS) setMutator(world, m.id, m.key === k);
}
export function playSound(k: string): void {
  audio.playUi(k as SfxId);
}
/** first click in the lab unlocks audio */
export function unlockAudio(): void {
  void audio.init(7).then(() => audio.resume());
}
export function setAnim(k: 'charge' | 'speed', v: number): void {
  anim[k] = v;
}
export const currentModel = (): ModelDef => current;
export function setParam(k: string, v: number): void {
  modelOverrides[current.key] = { ...(modelOverrides[current.key] ?? {}), [k]: v };
  meshFor(current).rebuild();
  persist();
  info();
}
export function copyParams(): void {
  const s = JSON.stringify(paramsFor(current));
  void navigator.clipboard?.writeText(s);
  info('скопировано: ' + s);
}
export function resetParams(): void {
  delete modelOverrides[current.key];
  persist();
  meshFor(current).rebuild();
  ui.paramsRev.value++;
}
function persist(): void {
  try {
    localStorage.setItem(LS, JSON.stringify(modelOverrides));
  } catch {
    /* ignore */
  }
}
export const post = (): typeof R.post.settings => R.post.settings;
export function setPost(k: 'bloom' | 'threshold' | 'exposure' | 'scan' | 'grain' | 'vignette', v: number): void {
  R.post.settings[k] = v;
}
export function setGlitch(v: number): void {
  R.juice.glitchBase = v;
}
export function setCorruption(v: number): void {
  world.boss.corruption = v;
}
export function postAction(k: string): void {
  const S = R.post.settings;
  if (k === 'post on/off') ui.postOn.value = S.enabled = !S.enabled;
  if (k === 'shake') R.juice.addTrauma(0.6);
  if (k === 'chroma') R.juice.addChroma(1.5);
  if (k === 'flash') R.juice.doFlash(0.6);
}
export const FX_KEYS = (): string[] => Object.keys(FX);
export { MODELS, SFX, MUTATORS };

function info(extra = ''): void {
  const geo = meshFor(current).mesh.geometry;
  const tris = (geo.getAttribute('position')?.count ?? 0) / 3;
  ui.info.value = `треугольников: ${tris}\nвысота: ${current.height}${extra ? '\n' + extra : ''}`;
}

export function camPreset(k: string): void {
  const h = current.height;
  const t = controls.target;
  t.set(0, h * 0.5, 0);
  if (k === 'iso') cam.position.set(h * 2, h * 1.6 + 1, h * 2.2 + 1);
  if (k === 'game') cam.position.set(0, 26, 12.5);
  if (k === 'top') cam.position.set(0, h * 4 + 4, 0.01);
  if (k === 'front') cam.position.set(Math.max(3, h * 2.2), h * 0.5, 0);
  if (k === 'close') cam.position.set(h * 1.1 + 0.6, h * 0.8, h * 1.1 + 0.6);
  if (k === 'game') t.set(0, 0, 0);
}

// ───────────── loop
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  controls.update();
  R.juice.update(dt);
  applyAnim(dt);
  if (anim.loopFx) {
    fxTimer -= dt;
    if (fxTimer <= 0) {
      fxTimer = 1.3;
      FX[anim.loopFx]?.();
    }
  }
  if (spawnLoop && enemyId >= 0 && Math.floor(now / 2000) !== Math.floor((now - dt * 1000) / 2000)) {
    world.enemies.st[enemyId] = AS.Spawning;
    world.enemies.spawnT[enemyId] = enemyDef(world.enemies.type[enemyId]!).spawnTime;
    R.fx.spawnFx(0, 0, world.enemies.type[enemyId]!, false);
  }
  R.render(world, 1, dt, dt * R.juice.simScale);
  raf = requestAnimationFrame(frame);
}
let raf = 0;
window.addEventListener('resize', () => R.resize());
showModel('archer');
/** the page is shown: (re)start the loop on the page's canvas size */
export function start(): void {
  cancelAnimationFrame(raf);
  last = performance.now();
  R.resize();
  raf = requestAnimationFrame(frame);
}
export function stop(): void {
  cancelAnimationFrame(raf);
}

/** Automation API */
export const api = {
  models: () => MODELS.map((m) => m.key),
  fxList: () => Object.keys(FX),
  model(key: string, o: Partial<Anim> & { cam?: string } = {}): void {
    showModel(key);
    Object.assign(anim, o);
    if (o.cam) camPreset(o.cam);
  },
  fx: runFx,
  cam: camPreset,
  set(param: string, v: number): void {
    modelOverrides[current.key] = { ...(modelOverrides[current.key] ?? {}), [param]: v };
    meshFor(current).rebuild();
  },
  params: () => paramsFor(current),
  hideUi(h = true): void {
    document.querySelectorAll<HTMLElement>('.lab-side,.pg-lab .pg-nav').forEach((e) => (e.style.display = h ? 'none' : ''));
  },
  anim,
  renderer: R,
  get world(): World {
    return world;
  },
  WP,
};
(window as unknown as { lab: typeof api }).lab = api;
