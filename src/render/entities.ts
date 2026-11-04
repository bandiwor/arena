import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  PlaneGeometry,
  ShaderMaterial,
  type BufferGeometry,
  type Scene,
} from 'three';
import { AS, ENEMY_TYPE_COUNT, ET, MAX_ENEMIES } from '../sim/constants';
import { enemyDef } from '../sim/content/enemies';
import type { World } from '../sim/world';
import type { LightPool } from './lights';
import { ENEMY_MODELS, modelByKey, paramsFor, type ModelDef } from './models/defs';
import { makeEntityMaterial } from './shaders/entity';

const GHOSTS = 64;
const GHOST_TIME = 0.42;

export function writeMatrix(arr: Float32Array, o: number, x: number, h: number, y: number, face: number, s: number): void {
  // rotation around Y by -face (sim angle → three), uniform scale, translation
  const c = Math.cos(-face) * s;
  const sn = Math.sin(-face) * s;
  arr[o] = c;
  arr[o + 1] = 0;
  arr[o + 2] = -sn;
  arr[o + 3] = 0;
  arr[o + 4] = 0;
  arr[o + 5] = s;
  arr[o + 6] = 0;
  arr[o + 7] = 0;
  arr[o + 8] = sn;
  arr[o + 9] = 0;
  arr[o + 10] = c;
  arr[o + 11] = 0;
  arr[o + 12] = x;
  arr[o + 13] = h;
  arr[o + 14] = y;
  arr[o + 15] = 1;
}

/** One instanced mesh per model with per-instance fx/anim attributes. */
export class InstancedModel {
  readonly mesh: InstancedMesh;
  readonly fx: InstancedBufferAttribute;
  readonly anim: InstancedBufferAttribute;
  readonly material: ShaderMaterial;
  count = 0;
  constructor(
    public def: ModelDef,
    lights: LightPool,
    readonly capacity: number,
  ) {
    const geo = def.build(paramsFor(def));
    this.material = makeEntityMaterial(lights, def.rim, def.height);
    this.fx = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.anim = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.fx.setUsage(DynamicDrawUsage);
    this.anim.setUsage(DynamicDrawUsage);
    geo.setAttribute('iFx', this.fx);
    geo.setAttribute('iAnim', this.anim);
    this.mesh = new InstancedMesh(geo, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** Rebuild geometry from (possibly edited) params — used by the lab and hot-reload. */
  rebuild(): void {
    const old = this.mesh.geometry;
    const geo: BufferGeometry = this.def.build(paramsFor(this.def));
    geo.setAttribute('iFx', this.fx);
    geo.setAttribute('iAnim', this.anim);
    this.mesh.geometry = geo;
    old.dispose();
  }

  begin(): void {
    this.count = 0;
  }
  push(x: number, h: number, y: number, face: number, scale: number, flash: number, spawn: number, charge: number, seed: number, walk: number, speed: number, state: number, elite: number): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    writeMatrix(this.mesh.instanceMatrix.array as Float32Array, i * 16, x, h, y, face, scale);
    const f = this.fx.array as Float32Array;
    f[i * 4] = flash;
    f[i * 4 + 1] = spawn;
    f[i * 4 + 2] = charge;
    f[i * 4 + 3] = seed;
    const a = this.anim.array as Float32Array;
    a[i * 4] = walk;
    a[i * 4 + 1] = speed;
    a[i * 4 + 2] = state;
    a[i * 4 + 3] = elite;
  }
  end(time: number): void {
    this.mesh.count = this.count;
    if (this.count > 0) {
      this.mesh.instanceMatrix.clearUpdateRanges();
      this.mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
      this.fx.clearUpdateRanges();
      this.fx.addUpdateRange(0, this.count * 4);
      this.fx.needsUpdate = true;
      this.anim.clearUpdateRanges();
      this.anim.addUpdateRange(0, this.count * 4);
      this.anim.needsUpdate = true;
    }
    this.material.uniforms['uTime']!.value = time;
  }
}

const SHADOW_VERT = /* glsl */ `
attribute vec4 iShadow; // x, y, radius, alpha
varying vec2 vUv; varying float vA;
void main(){
  vUv = uv * 2.0 - 1.0; vA = iShadow.w;
  vec3 p = vec3(position.x * iShadow.z * 2.0 + iShadow.x, 0.015, -position.y * iShadow.z * 2.0 + iShadow.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const SHADOW_FRAG = /* glsl */ `
varying vec2 vUv; varying float vA;
void main(){ float d = length(vUv); float a = smoothstep(1.0, 0.2, d) * vA; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`;

export class EntityRenderer {
  readonly enemies: InstancedModel[] = [];
  readonly player: InstancedModel;
  readonly pillars: InstancedModel;
  private readonly shadowMesh: InstancedMesh;
  private readonly shadowAttr: InstancedBufferAttribute;
  private shadowCount = 0;
  // death ghosts
  private readonly gType = new Uint8Array(GHOSTS);
  private readonly gX = new Float32Array(GHOSTS);
  private readonly gY = new Float32Array(GHOSTS);
  private readonly gFace = new Float32Array(GHOSTS);
  private readonly gT = new Float32Array(GHOSTS);
  private readonly gSeed = new Float32Array(GHOSTS);
  private gCursor = 0;

  constructor(scene: Scene, lights: LightPool) {
    for (let t = 0; t < ENEMY_TYPE_COUNT; t++) {
      const m = new InstancedModel(ENEMY_MODELS[t]!, lights, t === ET.Boss ? 4 : MAX_ENEMIES + GHOSTS);
      this.enemies.push(m);
      scene.add(m.mesh);
    }
    this.player = new InstancedModel(modelByKey('player'), lights, 2);
    scene.add(this.player.mesh);
    this.pillars = new InstancedModel(modelByKey('pillar'), lights, 16);
    scene.add(this.pillars.mesh);
    const sg = new PlaneGeometry(1, 1);
    this.shadowAttr = new InstancedBufferAttribute(new Float32Array((MAX_ENEMIES + 8) * 4), 4);
    this.shadowAttr.setUsage(DynamicDrawUsage);
    sg.setAttribute('iShadow', this.shadowAttr);
    this.shadowMesh = new InstancedMesh(
      sg,
      new ShaderMaterial({ vertexShader: SHADOW_VERT, fragmentShader: SHADOW_FRAG, transparent: true, depthWrite: false }),
      MAX_ENEMIES + 8,
    );
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.renderOrder = 1;
    scene.add(this.shadowMesh);
  }

  addGhost(type: number, x: number, y: number, face: number, seed: number): void {
    const i = this.gCursor;
    this.gCursor = (this.gCursor + 1) % GHOSTS;
    this.gType[i] = type;
    this.gX[i] = x;
    this.gY[i] = y;
    this.gFace[i] = face;
    this.gT[i] = GHOST_TIME;
    this.gSeed[i] = seed;
  }

  private shadow(x: number, y: number, r: number, a: number): void {
    if (this.shadowCount >= this.shadowMesh.count) return;
    const o = this.shadowCount++ * 4;
    const s = this.shadowAttr.array as Float32Array;
    s[o] = x;
    s[o + 1] = y;
    s[o + 2] = r;
    s[o + 3] = a;
  }

  update(w: World, alpha: number, dt: number, time: number, corruption: number): void {
    for (const m of this.enemies) m.begin();
    this.shadowCount = 0;
    const E = w.enemies;
    for (let k = 0; k < E.hi; k++) {
      if (!E.alive[k]) continue;
      const t = E.type[k]!;
      const m = this.enemies[t]!;
      const def = enemyDef(t);
      const x = E.px[k]! + (E.x[k]! - E.px[k]!) * alpha;
      const y = E.py[k]! + (E.y[k]! - E.py[k]!) * alpha;
      let face = E.faceP[k]!;
      let df = E.face[k]! - face;
      df = df - Math.PI * 2 * Math.floor((df + Math.PI) / (Math.PI * 2));
      face += df * alpha;
      const st = E.st[k]!;
      const spawn = st === AS.Spawning ? Math.max(0, 1 - E.spawnT[k]! / def.spawnTime) : 1;
      let h = 0;
      if (st === AS.Leap) h = Math.sin(Math.min(1, E.stT[k]! / 0.22) * Math.PI) * 0.9;
      const sp = Math.sqrt(E.vx[k]! * E.vx[k]! + E.vy[k]! * E.vy[k]!);
      const scale = (def.r / (ENEMY_BASE_R[t] ?? def.r)) * (E.affix[k] ? 1.12 : 1);
      m.push(x, h, y, face, scale, E.flash[k]!, spawn, E.charge[k]!, E.seed[k]!, E.walk[k]!, Math.min(1, sp / def.speed), st, E.affix[k] ? 1 : 0);
      if (spawn > 0.2) this.shadow(x + 0.25, y + 0.2, def.r * 1.4 * scale, 0.6 * spawn);
    }
    // ghosts (death dissolve)
    for (let g = 0; g < GHOSTS; g++) {
      if (this.gT[g]! <= 0) continue;
      this.gT[g] = this.gT[g]! - dt;
      const d = 1 - Math.max(0, this.gT[g]!) / GHOST_TIME;
      const m = this.enemies[this.gType[g]!]!;
      m.push(this.gX[g]!, 0, this.gY[g]!, this.gFace[g]!, 1, d < 0.2 ? 1 - d * 5 : 0, -Math.max(0.001, d), 0, this.gSeed[g]!, 0, 0, 0, 0);
    }
    for (const m of this.enemies) m.end(time);
    this.enemies[ET.Boss]!.material.uniforms['uCorrupt']!.value = corruption;

    // player
    const p = w.player;
    const pl = this.player;
    pl.begin();
    if (p.alive) {
      const x = p.px + (p.x - p.px) * alpha;
      const y = p.py + (p.y - p.py) * alpha;
      let face = p.faceP;
      let df = p.face - face;
      df = df - Math.PI * 2 * Math.floor((df + Math.PI) / (Math.PI * 2));
      face += df * alpha;
      const blink = p.inv > 0 && Math.floor(time * 30) % 2 === 0 ? 0.6 : 0;
      pl.push(x, 0.05 + Math.sin(time * 3) * 0.05, y, face, 1, Math.max(p.hurtT * 0.8, blink), 1, p.recoil, 0.3, p.walk, 0, p.dashT > 0 ? 8 : 0, 0);
      this.shadow(x + 0.25, y + 0.2, 0.75, 0.7);
    }
    pl.end(time);
    // pillars (static, but re-pushed for uTime/simplicity)
    const P = w.pillars;
    const pm = this.pillars;
    pm.begin();
    for (let k = 0; k < P.count; k++) pm.push(P.x[k]!, 0, P.y[k]!, k * 0.5, P.r[k]!, 0, 1, 0, k * 0.13, 0, 0, 0, 0);
    pm.end(time);
    this.shadowMesh.count = this.shadowCount;
    this.shadowAttr.clearUpdateRanges();
    this.shadowAttr.addUpdateRange(0, this.shadowCount * 4);
    this.shadowAttr.needsUpdate = true;
  }
}

/** Models are authored at the sim radius of each type; scale = 1 at default radius. */
const ENEMY_BASE_R = [0.45, 0.6, 0.95, 0.6, 0.85, 2.6];
