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
    const pr = this.pixelRatio * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(Math.floor(w * pr), Math.floor(h * pr));
    this.camera.setAspect(w / h);
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
    let tr = w.act === 1 ? 1.5 : 1;
    let tg = w.act === 1 ? 0.45 : 1;
    let tb = w.act === 1 ? 0.6 : 1;
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
    FU['uActMix']!.value = w.act === 1 ? 1 : 0;
    const inTrans = w.wave.phase === WavePhase.Transition;
    const tt = w.wave.t + alpha / 60;
    FU['uScanR']!.value = inTrans && tt < TRANS_SYNTH ? tt * 24 : -1;
    FU['uSynthR']!.value = inTrans && tt >= TRANS_SYNTH ? (tt - TRANS_SYNTH) * SYNTH_SPEED : -1;
    const PU = FU['uPools']!.value as { set(a: number, b: number, c: number): void }[];
    for (let k = 0; k < w.pools.count; k++) PU[k]!.set(w.pools.x[k]!, w.pools.y[k]!, w.pools.r[k]!);
    FU['uPoolCount']!.value = w.pools.count;

    // post uniforms
    const J = this.juice;
    const C = this.post.composite.uniforms;
    C['uTime']!.value = this.realTime;
    C['uChroma']!.value = J.chroma;
    C['uGlitch']!.value = J.glitch + J.glitchBase;
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
    this.stats.particles = this.particles.emitted;
    this.stats.quads = this.quads.count;
  }
}
