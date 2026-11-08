import { LANE_SPEED, LANE_WARN, PAD_CYCLE, PAD_HOT, PAD_MARK, PAD_RETRACT, padPhase } from '../sim/systems/foundry';
import { Color, Scene, Vector4, WebGLRenderer } from 'three';
import { MUTATORS } from '../sim/content/mutators';
import type { World } from '../sim/world';
import type { AudioEngine } from '../audio/audio';
import { CameraRig } from './camera';
import { EntityRenderer, SYNTH_SPEED } from './entities';
import { TRANS_SYNTH } from '../sim/systems/waves';
import { WavePhase } from '../sim/world';
import { Floor } from './floor';
import { FxDirector } from './fx';
import { Juice } from './juice';
import { LightPool } from './lights';
import { lin, PAL } from './palette';
import { Particles } from './particles';
import { MAX_WAVES, PostFX } from './post';
import { QuadBatch } from './quads';

const uv = new Float32Array(2);
const tint = new Float32Array(3);

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  particles: number;
  quads: number;
}

export class GameRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: CameraRig;
  readonly lights = new LightPool();
  readonly juice = new Juice();
  readonly floor: Floor;
  readonly entities: EntityRenderer;
  readonly particles: Particles;
  readonly quads: QuadBatch;
  readonly post: PostFX;
  readonly fx: FxDirector;
  /** seconds of fx-time (frozen during hitstop, scaled by slow-mo) */
  fxTime = 0;
  realTime = 0;
  pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  renderScale = 1;
  /** automatic factor on top of renderScale (DynamicResolution) */
  autoScale = 1;
  readonly stats: RenderStats = { drawCalls: 0, triangles: 0, particles: 0, quads: 0 };
  private tintR = 1;
  private tintG = 1;
  private tintB = 1;
  private ice = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    audio: AudioEngine | null,
  ) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
      preserveDrawingBuffer: import.meta.env.DEV,
    });
    this.renderer.setClearColor(new Color(PAL.void), 1);
    this.renderer.info.autoReset = false;
    this.camera = new CameraRig(canvas.clientWidth / Math.max(1, canvas.clientHeight));
    this.floor = new Floor(this.scene, this.lights);
    this.entities = new EntityRenderer(this.scene, this.lights);
    this.particles = new Particles(this.scene, 32768);
    this.quads = new QuadBatch(this.scene, 8192, 4);
    this.post = new PostFX(this.renderer);
    this.fx = new FxDirector({
      particles: this.particles,
      quads: this.quads,
      floor: this.floor,
      lights: this.lights,
      juice: this.juice,
      entities: this.entities,
      camera: this.camera,
      audio,
    });
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const pr = this.pixelRatio * this.renderScale * this.autoScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(Math.floor(w * pr), Math.floor(h * pr));
    this.camera.setAspect(w / h);
  }

  private curAct = 0;
  private prevAct = 0;
  private readonly laneScroll = new Float32Array(4);

  /** conveyor scroll / warning and stamp pad phases for the floor shader */
  private foundryUniforms(w: World, dt: number): void {
    const FU = this.floor.material.uniforms;
    const L = w.lanes;
    const LU = FU['uLanes']!.value as Vector4[];
    const LS = FU['uLaneS']!.value as Vector4[];
    const period = w.phys.lanePeriod;
    for (let k = 0; k < L.count; k++) {
      const horiz = L.hw[k]! > L.hh[k]!;
      const inward = L.inward[k]! > 0;
      const d = horiz ? L.dx[k]! : L.dy[k]!;
      if (!inward) this.laneScroll[k] = (this.laneScroll[k]! + d * LANE_SPEED * dt) % 1000;
      const lt = L.t[k]!;
      let warn = Math.max(0, (lt - (period - LANE_WARN)) / LANE_WARN);
      if (L.frozen[k]! > 0) warn = -1;
      if (inward) warn = 1;
      LU[k]!.set(L.cx[k]!, L.cy[k]!, L.hw[k]!, L.hh[k]!);
      LS[k]!.set(L.dx[k]!, L.dy[k]!, this.laneScroll[k]!, warn);
    }
    FU['uLaneCount']!.value = L.count;
    const D = w.pads;
    const PU = FU['uPads']!.value as Vector4[];
    for (let k = 0; k < D.count; k++) {
      const ph = padPhase(w, k);
      let state = 0;
      let f = 0;
      if (ph < PAD_MARK) state = 0;
      else if (ph < PAD_HOT) {
        state = 1;
        f = (ph - PAD_MARK) / (PAD_HOT - PAD_MARK);
      } else if (ph < PAD_RETRACT) state = 2;
      else {
        state = 3;
        f = (ph - PAD_RETRACT) / (PAD_CYCLE - PAD_RETRACT);
      }
      PU[k]!.set(D.x[k]!, D.y[k]!, state, f);
    }
    FU['uPadCount']!.value = D.count;
  }

  /** realDt: wall-clock frame delta; fxDt: scaled by slow-mo and 0 in hitstop */
  render(w: World, alpha: number, realDt: number, fxDt: number): void {
    this.realTime += realDt;
    this.fxTime += fxDt;
    const p = w.player;
    const px = p.px + (p.x - p.px) * alpha;
    const py = p.py + (p.y - p.py) * alpha;
    this.camera.update(realDt, px, py, p.ax, p.ay, this.juice);
    this.fx.frame(w, alpha, fxDt, this.fxTime);
    const corruption = w.boss.corruption;
    this.entities.update(w, alpha, fxDt, this.fxTime, corruption);
    this.particles.update(this.fxTime);
    this.floor.update(this.fxTime, fxDt, px, py);
    this.floor.decals.render(this.renderer, fxDt);

    // mutator tint + ice
    // sector base tint: Плоть bleeds the neon toward crimson
    // Литейный цех runs warm: amber-white sodium light
    let tr = w.act === 1 ? 1.5 : w.act === 2 ? 1.35 : 1;
    let tg = w.act === 1 ? 0.45 : w.act === 2 ? 0.85 : 1;
    let tb = w.act === 1 ? 0.6 : w.act === 2 ? 0.7 : 1;
    for (let m = 0; m < MUTATORS.length; m++) {
      if (!(w.mutators & (1 << m))) continue;
      lin(MUTATORS[m]!.color, tint);
      tr = tint[0]! * 1.2 + 0.45;
      tg = tint[1]! * 1.2 + 0.45;
      tb = tint[2]! * 1.2 + 0.45;
    }
    const k = Math.min(1, realDt * 2);
    this.tintR += (tr - this.tintR) * k;
    this.tintG += (tg - this.tintG) * k;
    this.tintB += (tb - this.tintB) * k;
    const ice = Math.max(0, Math.min(1, (14 - w.phys.friction) / 12));
    this.ice += (ice - this.ice) * k;
    const FU = this.floor.material.uniforms;
    (FU['uTint']!.value as { set(a: number, b: number, c: number): void }).set(this.tintR, this.tintG, this.tintB);
    (this.floor.wallMat.uniforms['uTint']!.value as { set(a: number, b: number, c: number): void }).set(this.tintR, this.tintG, this.tintB);
    FU['uIce']!.value = this.ice;
    FU['uCorrupt']!.value = corruption;
    // act transition timeline drives the decompile scan and synthesis front
    if (w.act !== this.curAct) {
      this.prevAct = this.curAct;
      this.curAct = w.act;
    }
    FU['uAct']!.value = w.act;
    FU['uPrevAct']!.value = this.prevAct;
    const inTrans = w.wave.phase === WavePhase.Transition;
    const tt = w.wave.t + alpha / 60;
    FU['uScanR']!.value = inTrans && tt < TRANS_SYNTH ? tt * 24 : -1;
    FU['uSynthR']!.value = inTrans && tt >= TRANS_SYNTH ? (tt - TRANS_SYNTH) * SYNTH_SPEED : -1;
    const PU = FU['uPools']!.value as Vector4[];
    for (let k = 0; k < Math.min(12, w.pools.count); k++) PU[k]!.set(w.pools.x[k]!, w.pools.y[k]!, w.pools.r[k]!, Math.min(1, w.pools.live[k]! * 2));
    FU['uPoolCount']!.value = Math.min(12, w.pools.count);
    this.foundryUniforms(w, fxDt);

    // post uniforms
    const J = this.juice;
    const C = this.post.composite.uniforms;
    C['uTime']!.value = this.realTime;
    C['uChroma']!.value = J.chroma;
    C['uGlitch']!.value = (J.glitch + J.glitchBase) * J.distortScale;
    C['uFlash']!.value = J.flash;
    (C['uFlashCol']!.value as number[])[0] = J.flashR;
    (C['uFlashCol']!.value as number[])[1] = J.flashG;
    (C['uFlashCol']!.value as number[])[2] = J.flashB;
    C['uDamage']!.value = J.damage;
    C['uSaturate']!.value = J.saturate;
    C['uCorrupt']!.value = corruption;
    const waves = C['uWaves']!.value as Vector4[];
    const aspect = this.camera.cam.aspect;
    for (let i = 0; i < MAX_WAVES; i++) {
      const o = i * 4;
      const s = this.fx.waves[o + 3]!;
      if (s <= 0 || !this.camera.toScreen(this.fx.waves[o]!, 0.5, this.fx.waves[o + 1]!, uv)) {
        waves[i]!.set(0, 0, 0, 0);
        continue;
      }
      const age = this.fx.waves[o + 2]!;
      const fade = 1 - age / 0.8;
      waves[i]!.set(uv[0]!, uv[1]!, age * 0.9, s * fade * fade);
    }
    const lens = C['uLens']!.value as Vector4;
    if (this.fx.lensS > 0 && this.camera.toScreen(this.fx.lensX, 0.8, this.fx.lensY, uv)) lens.set(uv[0]!, uv[1]!, 0.12, this.fx.lensS);
    else lens.set(0, 0, 0, 0);
    void aspect;

    this.renderer.info.reset();
    this.post.render(this.scene, this.camera.cam);
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    this.stats.particles = this.particles.drawn;
    this.stats.quads = this.quads.count;
  }
}
