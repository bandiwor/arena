import '../ui/style.css';
import './lab.css';
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
 * NULL//ARENA Lab — inspect & tweak every procedural asset with the real render pipeline.
 * Programmatic API on window.lab (used for screenshots/automation).
 */
const LS = 'null-arena:model-overrides';
try {
  Object.assign(modelOverrides, JSON.parse(localStorage.getItem(LS) ?? '{}'));
} catch {
  /* ignore */
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const root = document.getElementById('lab-ui') as HTMLElement;
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
let enemyId = -1;
let fxTimer = 0;
let spawnLoop = false;

function meshFor(def: ModelDef): InstancedModel {
  if (def.key === 'player') return R.entities.player;
  if (def.key === 'pillar') return R.entities.pillars;
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
  if (key === 'player') world.player.alive = true;
  else if (key === 'pillar') world.pillars.add(0, 0, 1);
  else {
    const t = ENEMIES.findIndex((e) => e.key === key);
    enemyId = spawnEnemy(world, t as 0, 0, 0, { instant: true });
    world.enemies.face[enemyId] = 0;
  }
  const h = current.height;
  controls.target.set(0, h * 0.5, 0);
  const d = Math.max(3.2, h * 2.2);
  cam.position.set(d * 0.8, h * 0.9 + d * 0.35, d);
  buildParams();
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

function runFx(name: string): void {
  const f = FX[name];
  if (!f) throw new Error(`fx: ${Object.keys(FX).join(', ')}`);
  f();
  info(`fx: ${name}`);
}

// ───────────── UI
const left = document.createElement('div');
left.className = 'lab-side';
const right = document.createElement('div');
right.className = 'lab-side right';
root.append(left, right);

function btns(title: string, items: string[], onClick: (k: string) => void, isOn?: (k: string) => boolean): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<h2>${title}</h2>`;
  const b = document.createElement('div');
  b.className = 'lab-btns';
  for (const k of items) {
    const e = document.createElement('button');
    e.textContent = k;
    if (isOn?.(k)) e.classList.add('on');
    e.onclick = () => {
      void audio.init(7).then(() => audio.resume());
      onClick(k);
      if (isOn) b.querySelectorAll('button').forEach((x) => x.classList.toggle('on', isOn(x.textContent ?? '')));
    };
    b.appendChild(e);
  }
  wrap.appendChild(b);
  return wrap;
}

function slider(parent: HTMLElement, label: string, min: number, max: number, step: number, value: number, on: (v: number) => void): void {
  const row = document.createElement('label');
  row.className = 'lab-param';
  row.innerHTML = `<span>${label}</span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}"><output>${value}</output>`;
  const inp = row.querySelector('input')!;
  const out = row.querySelector('output')!;
  inp.oninput = () => {
    const v = parseFloat(inp.value);
    out.textContent = String(v);
    on(v);
  };
  parent.appendChild(row);
}

const STATES: Record<string, number> = { idle: AS.Move, windup: AS.Windup, attack: AS.Attack, dash: AS.Dash, stunned: AS.Stunned, spawn: AS.Spawning };
left.innerHTML = '<h1>NULL<span>//</span>LAB</h1><div class="lab-info">процедурные ассеты · тот же рендер, что в игре</div>';
left.appendChild(btns('Модели', MODELS.map((m) => m.key), showModel, (k) => k === current.key));
left.appendChild(btns('Состояние', Object.keys(STATES), (k) => {
  anim.state = STATES[k]!;
  if (k === 'spawn' && enemyId >= 0) world.enemies.spawnT[enemyId] = enemyDef(world.enemies.type[enemyId]!).spawnTime;
}, (k) => STATES[k] === anim.state));
left.appendChild(btns('Действия', ['hit-flash', 'death', 'elite', 'turntable', 'respawn-loop'], (k) => {
  if (k === 'hit-flash') anim.flash = 1;
  if (k === 'elite') anim.elite = !anim.elite;
  if (k === 'turntable') anim.spin = !anim.spin;
  if (k === 'respawn-loop') spawnLoop = !spawnLoop;
  if (k === 'death' && enemyId >= 0) {
    const t = world.enemies.type[enemyId]!;
    const d = enemyDef(t);
    R.fx.killFx(d.material, t, 0, 0, 0.6, d.r, 0, 0, world.enemies.face[enemyId]!, 0.5);
    world.enemies.alive[enemyId] = 0;
    setTimeout(() => showModel(current.key), 1300);
  }
}));
const animBox = document.createElement('div');
animBox.innerHTML = '<h2>Анимация</h2>';
slider(animBox, 'charge', 0, 1, 0.01, 0, (v) => (anim.charge = v));
slider(animBox, 'walk speed', 0, 1, 0.01, 0, (v) => (anim.speed = v));
left.appendChild(animBox);
left.appendChild(btns('Камера', ['iso', 'game', 'top', 'front', 'close'], (k) => camPreset(k)));
left.appendChild(btns('FX', Object.keys(FX), runFx));
left.appendChild(btns('FX loop', ['off', ...Object.keys(FX).filter((k) => !k.startsWith('decal'))], (k) => (anim.loopFx = k === 'off' ? '' : k), (k) => (k === 'off' ? !anim.loopFx : anim.loopFx === k)));
left.appendChild(btns('Звуки', [...SFX], (k) => audio.playUi(k as SfxId)));
left.appendChild(btns('Мутатор (пол)', ['none', ...MUTATORS.map((m) => m.key)], (k) => {
  for (const m of MUTATORS) setMutator(world, m.id, m.key === k);
}));

const paramsBox = document.createElement('div');
const postBox = document.createElement('div');
const infoBox = document.createElement('div');
infoBox.className = 'lab-info';
right.append(paramsBox, postBox, infoBox);

function buildParams(): void {
  paramsBox.innerHTML = `<h2>Параметры: ${current.name}</h2>`;
  const p = paramsFor(current);
  for (const [k, spec] of Object.entries(current.params)) {
    slider(paramsBox, k, spec.min, spec.max, spec.step, p[k] ?? spec.value, (v) => {
      modelOverrides[current.key] = { ...(modelOverrides[current.key] ?? {}), [k]: v };
      meshFor(current).rebuild();
      persist();
      info();
    });
  }
  const row = document.createElement('div');
  row.className = 'lab-btns';
  row.style.marginTop = '8px';
  const copy = document.createElement('button');
  copy.textContent = 'copy params JSON';
  copy.onclick = () => {
    const s = JSON.stringify(paramsFor(current));
    void navigator.clipboard?.writeText(s);
    console.log(current.key, s);
    info('скопировано: ' + s);
  };
  const reset = document.createElement('button');
  reset.textContent = 'reset';
  reset.onclick = () => {
    delete modelOverrides[current.key];
    persist();
    meshFor(current).rebuild();
    buildParams();
  };
  row.append(copy, reset);
  paramsBox.appendChild(row);
}
function persist(): void {
  try {
    localStorage.setItem(LS, JSON.stringify(modelOverrides));
  } catch {
    /* ignore */
  }
}

postBox.innerHTML = '<h2>Пост-обработка</h2>';
const S = R.post.settings;
slider(postBox, 'bloom', 0, 3, 0.05, S.bloom, (v) => (S.bloom = v));
slider(postBox, 'threshold', 0, 3, 0.05, S.threshold, (v) => (S.threshold = v));
slider(postBox, 'exposure', 0.2, 3, 0.05, S.exposure, (v) => (S.exposure = v));
slider(postBox, 'scanlines', 0, 0.2, 0.005, S.scan, (v) => (S.scan = v));
slider(postBox, 'grain', 0, 0.15, 0.005, S.grain, (v) => (S.grain = v));
slider(postBox, 'vignette', 0, 1.5, 0.05, S.vignette, (v) => (S.vignette = v));
slider(postBox, 'glitch', 0, 1.5, 0.05, 0, (v) => (R.juice.glitchBase = v));
slider(postBox, 'corruption', 0, 1, 0.05, 0, (v) => (world.boss.corruption = v));
postBox.appendChild(btns('', ['post on/off', 'shake', 'chroma', 'flash'], (k) => {
  if (k === 'post on/off') S.enabled = !S.enabled;
  if (k === 'shake') R.juice.addTrauma(0.6);
  if (k === 'chroma') R.juice.addChroma(1.5);
  if (k === 'flash') R.juice.doFlash(0.6);
}));

function info(extra = ''): void {
  const geo = meshFor(current).mesh.geometry;
  const tris = (geo.getAttribute('position')?.count ?? 0) / 3;
  infoBox.innerHTML = `<h2>Инфо</h2><b>${current.name}</b>\nтреугольников: ${tris}\nвысота: ${current.height}\n${extra}`;
}

function camPreset(k: string): void {
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
  requestAnimationFrame(frame);
}
window.addEventListener('resize', () => R.resize());
showModel('archer');
requestAnimationFrame(frame);

/** Automation API */
const api = {
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
    left.style.display = right.style.display = h ? 'none' : '';
  },
  anim,
  renderer: R,
  get world(): World {
    return world;
  },
  WP,
};
(window as unknown as { lab: typeof api }).lab = api;
