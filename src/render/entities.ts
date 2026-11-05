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
import { TRANS_SYNTH } from '../sim/systems/waves';
import { WavePhase } from '../sim/world';

/** speed of the synthesis wave front across the floor (units / s) */
export const SYNTH_SPEED = 15;
import { enemyDef } from '../sim/content/enemies';
import type { World } from '../sim/world';
import type { LightPool } from './lights';
import { ENEMY_MODELS, modelByKey, paramsFor, type ModelDef } from './models/defs';
import { makeEntityMaterial } from './shaders/entity';

const GHOSTS = 64;
const GHOST_TIME = 0.42;
const PGHOSTS = 8;
const PGHOST_TIME = 0.3;

/**
 * Yaw (sim angle) + optional lean: (lx, ly) is a sim-space vector whose length is the tilt angle in
 * radians; the model's top tips toward it (hit stagger, leaning into motion, recoil).
 */
export function writeMatrixLean(arr: Float32Array, o: number, x: number, h: number, y: number, face: number, s: number, lx: number, ly: number): void {
  const ang = Math.sqrt(lx * lx + ly * ly);
  if (ang < 1e-4) return writeMatrix(arr, o, x, h, y, face, s);
  // axis = up × lean (three coords: lean = (lx, 0, ly)) → (ly, 0, -lx), normalised
  const ax = ly / ang;
  const az = -lx / ang;
  const c = Math.cos(ang);
  const sn = Math.sin(ang);
  const t = 1 - c;
  // Rodrigues rotation T (axis has no y component)
  const t00 = t * ax * ax + c, t01 = -sn * az, t02 = t * ax * az;
  const t10 = sn * az, t11 = c, t12 = -sn * ax;
  const t20 = t * ax * az, t21 = sn * ax, t22 = t * az * az + c;
  // yaw Y (column-major columns)
  const cy = Math.cos(-face);
  const sy = Math.sin(-face);
  // M = T * Ry * s ; Ry columns: (cy,0,-sy), (0,1,0), (sy,0,cy)
  arr[o] = (t00 * cy - t02 * sy) * s;
  arr[o + 1] = (t10 * cy - t12 * sy) * s;
  arr[o + 2] = (t20 * cy - t22 * sy) * s;
  arr[o + 3] = 0;
  arr[o + 4] = t01 * s;
  arr[o + 5] = t11 * s;
  arr[o + 6] = t21 * s;
  arr[o + 7] = 0;
  arr[o + 8] = (t00 * sy + t02 * cy) * s;
  arr[o + 9] = (t10 * sy + t12 * cy) * s;
  arr[o + 10] = (t20 * sy + t22 * cy) * s;
  arr[o + 11] = 0;
  arr[o + 12] = x;
  arr[o + 13] = h;
  arr[o + 14] = y;
  arr[o + 15] = 1;
}

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
  push(x: number, h: number, y: number, face: number, scale: number, flash: number, spawn: number, charge: number, seed: number, walk: number, speed: number, state: number, elite: number, lx = 0, ly = 0): void {
    if (this.count >= this.capacity) return;
    const i = this.count++;
    writeMatrixLean(this.mesh.instanceMatrix.array as Float32Array, i * 16, x, h, y, face, scale, lx, ly);
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
  /** Act II flesh growths */
  readonly growths: InstancedModel;
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
  private readonly pgX = new Float32Array(PGHOSTS);
  private readonly pgY = new Float32Array(PGHOSTS);
  private readonly pgF = new Float32Array(PGHOSTS);
  private readonly pgT = new Float32Array(PGHOSTS);
  private pgCursor = 0;

  constructor(scene: Scene, lights: LightPool) {
    for (let t = 0; t < ENEMY_TYPE_COUNT; t++) {
      const m = new InstancedModel(ENEMY_MODELS[t]!, lights, t === ET.Boss || t === ET.Brood ? 4 : MAX_ENEMIES + GHOSTS);
      this.enemies.push(m);
      scene.add(m.mesh);
    }
    this.player = new InstancedModel(modelByKey('player'), lights, 2 + PGHOSTS);
    scene.add(this.player.mesh);
    this.pillars = new InstancedModel(modelByKey('pillar'), lights, 16);
    scene.add(this.pillars.mesh);
    this.growths = new InstancedModel(modelByKey('growth'), lights, 16);
    scene.add(this.growths.mesh);
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

  /** dash afterimage of the player model (pixel-dissolves out) */
  addPlayerGhost(x: number, y: number, face: number): void {
    const i = this.pgCursor;
    this.pgCursor = (this.pgCursor + 1) % PGHOSTS;
    this.pgX[i] = x;
    this.pgY[i] = y;
    this.pgF[i] = face;
    this.pgT[i] = PGHOST_TIME;
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
      if (t === ET.Worm) {
        // under the floor: no model (the FX director draws the moving bulge)
        if (st === AS.Underground || st === AS.Windup) continue;
        if (st === AS.Burrow) h = -Math.min(1, E.stT[k]! / 0.45) * 1.3;
        else if (st === AS.Emerge) {
          const e = Math.min(1, E.stT[k]! / 0.25);
          h = -1.3 + e * 1.3 + Math.sin(e * Math.PI) * 0.9; // bursts up past the surface, settles
        }
      } else if (t === ET.Parasite && st === AS.Attached) {
        const host = E.tx[k]! | 0;
        h = enemyDef(E.type[host] ?? 0).height * 0.72;
      }
      const sp = Math.sqrt(E.vx[k]! * E.vx[k]! + E.vy[k]! * E.vy[k]!);
      // per-individual size variety (swarms read as a population, not clones)
      const vari = t === ET.Boss ? 1 : t === ET.Swarmer ? 0.82 + E.seed[k]! * 0.4 : 0.93 + E.seed[k]! * 0.14;
      const scale = (def.r / (ENEMY_BASE_R[t] ?? def.r)) * (E.affix[k] ? 1.12 : 1) * vari;
      // stagger: tip away from knockback; lean into motion
      const kx = E.kx[k]!;
      const ky = E.ky[k]!;
      const km = Math.sqrt(kx * kx + ky * ky);
      const kk = Math.min(0.55, km * 0.07) / (km || 1);
      const lean = t === ET.Boss ? 0 : 0.035;
      m.push(x, h, y, face, scale, E.flash[k]! * (def.r >= 1.5 ? 0.3 : 1), spawn, E.charge[k]!, E.seed[k]!, E.walk[k]!, Math.min(1, sp / Math.max(0.1, def.speed)), t === ET.Shielder && E.shield[k]! <= 0 ? 20 : st, E.affix[k] || E.buff[k] ? 1 : 0, kx * kk + E.vx[k]! * lean, ky * kk + E.vy[k]! * lean);
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

    for (let g = 0; g < PGHOSTS; g++) if (this.pgT[g]! > 0) this.pgT[g] = this.pgT[g]! - dt;
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
      // recoil: body slides back and tips backward; lean into strafing
      const rc = p.recoil * p.recoil;
      const bx = x - Math.cos(face) * rc * 0.28;
      const by = y - Math.sin(face) * rc * 0.28;
      const lx = -Math.cos(face) * rc * 0.22 + p.vx * 0.012;
      const ly = -Math.sin(face) * rc * 0.22 + p.vy * 0.012;
      pl.push(bx, 0.05 + Math.sin(time * 3) * 0.05, by, face, 1, Math.max(p.hurtT * 0.8, blink), 1, p.recoil, 0.3, p.walk, 0, p.dashT > 0 ? 8 : 0, 0, lx, ly);
      for (let g = 0; g < PGHOSTS; g++) {
        if (this.pgT[g]! <= 0) continue;
        const d = 1 - this.pgT[g]! / PGHOST_TIME;
        pl.push(this.pgX[g]!, 0.05, this.pgY[g]!, this.pgF[g]!, 1, 0.6 * (1 - d), -Math.max(0.05, d * 0.9), 0, 0.3, 0, 0, 8, 0);
      }
      this.shadow(x + 0.25, y + 0.2, 0.75, 0.7);
    }
    pl.end(time);
    // pillars (static, but re-pushed for uTime/simplicity)
    const P = w.pillars;
    const pm = w.act === 0 ? this.pillars : this.growths;
    const other = w.act === 0 ? this.growths : this.pillars;
    other.begin();
    other.end(time);
    pm.begin();
    // act transition: before the synthesis the old pillars decompile (dissolve upward into pixels);
    // after it, new growths sprout as the synthesis wave front passes over them
    let tr = -1;
    if (w.wave.phase === WavePhase.Transition) tr = w.wave.t + alpha * (1 / 60);
    for (let k = 0; k < P.count; k++) {
      let spawn = 1;
      let flash = 0;
      if (tr >= 0 && tr < TRANS_SYNTH) {
        const d = Math.max(0, Math.min(1, (tr - 0.5 - k * 0.12) / 1.3));
        if (d > 0) spawn = -Math.max(0.001, d);
        flash = d > 0 && d < 0.15 ? 1 : 0;
      } else if (tr >= TRANS_SYNTH) {
        const front = (tr - TRANS_SYNTH) * SYNTH_SPEED;
        const dist = Math.sqrt(P.x[k]! * P.x[k]! + P.y[k]! * P.y[k]!);
        spawn = Math.max(0, Math.min(0.999, (front - dist) / 6));
        if (spawn <= 0) continue;
      }
      pm.push(P.x[k]!, 0, P.y[k]!, k * 0.5, P.r[k]!, flash, spawn, 0, k * 0.13, 0, 0, 0, 0);
    }
    pm.end(time);
    this.shadowMesh.count = this.shadowCount;
    this.shadowAttr.clearUpdateRanges();
    this.shadowAttr.addUpdateRange(0, this.shadowCount * 4);
    this.shadowAttr.needsUpdate = true;
  }
}

/** Models are authored at the sim radius of each type; scale = 1 at default radius. */
const ENEMY_BASE_R = [0.45, 0.6, 0.95, 0.6, 0.85, 2.6, 0.75, 0.42, 0.6, 0.36, 2.3];
