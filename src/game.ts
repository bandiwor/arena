import { AudioEngine } from './audio/audio';
import { AudioDirector } from './audio/director';
import { Ev, EV_STRIDE } from './core/events';
import { InputDevice } from './input';
import { GameRenderer } from './render/renderer';
import { DT, ET } from './sim/constants';
import { makeCmd, InputRecorder, type InputCmd } from './sim/input';
import { packInputs, unpackInputs, type ReplayData } from './sim/replay';
import { hashWorld, Sim } from './sim/sim';
import { WavePhase, type World } from './sim/world';
import { Hud } from './ui/hud';
import type { BotSkill, InputFn } from './sim/scenario';

export type Mode = 'menu' | 'play' | 'pause' | 'over' | 'replay' | 'demo';

export interface RunConfig {
  seed: number;
  difficulty: number;
  startWave?: number;
  sandbox?: boolean;
}

const MAX_STEPS = 8;

/**
 * Owns the sim, renderer, audio, input and the fixed-step loop.
 * Rendering interpolates between the last two ticks; hitstop/slow-mo only scale how fast
 * the accumulator fills — the sim itself never knows.
 */
export class Game {
  sim: Sim;
  readonly renderer: GameRenderer;
  readonly audio = new AudioEngine();
  readonly audioDirector = new AudioDirector(this.audio);
  private readonly audioInfo = { mode: 'menu', combo: 0, comboTier: 0, timeScale: 1, corruption: 0 };
  readonly input: InputDevice;
  readonly hud: Hud;
  readonly recorder = new InputRecorder();
  mode: Mode = 'menu';
  config: RunConfig = { seed: 1, difficulty: 1 };
  private readonly cmd: InputCmd = makeCmd();
  private acc = 0;
  private last = 0;
  /** dev controls */
  paused = false;
  stepQueue = 0;
  timeScale = 1;
  replay: InputRecorder | null = null;
  replayTick = 0;
  replaySpeed = 1;
  lastReplay: ReplayData | null = null;
  /** frame timings (ms) for the perf overlay */
  readonly perf = { sim: 0, render: 0, frame: 0, steps: 0, fps: 0 };
  private fpsAcc = 0;
  private fpsN = 0;
  onModeChange: ((m: Mode) => void) | null = null;
  onTick: ((w: World) => void) | null = null;
  onFrame: ((dt: number) => void) | null = null;
  /** scripted input used in menu attract mode */
  attract: InputFn | null = null;
  /** bot currently playing a watched run (null = none) */
  bot: BotSkill | null = null;
  demoSpeed = 1;
  private noReplay = false;
  private overShown = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    uiRoot: HTMLElement,
  ) {
    this.sim = new Sim({ seed: 1, difficulty: 1, mode: 'sandbox' });
    this.renderer = new GameRenderer(canvas, this.audio);
    this.input = new InputDevice(canvas);
    this.hud = new Hud(uiRoot);
    this.hud.onPick = (n) => this.input.queuePick(n);
    this.renderer.fx.onEvent = (t, d, o) => this.hud.onEvent(t, d, o);
    window.addEventListener('resize', () => this.renderer.resize());
    this.renderer.camera.snap(0, 0);
  }

  get world(): World {
    return this.sim.world;
  }

  setMode(m: Mode): void {
    this.mode = m;
    this.hud.show(m === 'play' || m === 'pause' || m === 'replay' || m === 'demo');
    this.input.enabled = m === 'play';
    this.canvas.style.cursor = m === 'play' ? 'none' : 'default';
    this.onModeChange?.(m);
    window.dispatchEvent(new CustomEvent('null-arena:mode', { detail: m }));
  }

  /** Menu background: a self-playing sandbox skirmish. */
  startAttract(sim: Sim, fn: InputFn): void {
    this.sim = sim;
    this.attract = fn;
    this.replay = null;
    this.renderer.camera.snap(sim.world.player.x, sim.world.player.y);
    this.setMode('menu');
  }

  start(cfg: RunConfig): void {
    this.config = cfg;
    this.bot = null;
    this.noReplay = false;
    this.sim = new Sim({ seed: cfg.seed, difficulty: cfg.difficulty, mode: cfg.sandbox ? 'sandbox' : 'campaign', startWave: cfg.startWave ?? 1 });
    this.recorder.reset();
    this.replay = null;
    this.acc = 0;
    this.overShown = false;
    this.hud.reset();
    this.renderer.floor.decals.clear();
    this.renderer.camera.snap(this.world.player.x, this.world.player.y);
    this.setMode('play');
  }

  /** Watch a bot play a full campaign. */
  startBot(cfg: RunConfig, skill: BotSkill): void {
    this.start(cfg);
    this.bot = skill;
    this.attract = skill.make();
    this.demoSpeed = 1;
    this.setMode('demo');
  }

  /** Take over a bot's run mid-game (the run continues under your control). */
  takeOver(): void {
    if (this.mode !== 'demo' || !this.bot) return;
    this.bot = null;
    this.attract = null;
    this.recorder.reset(); // replay can't be reproduced from a half-bot run
    this.noReplay = true;
    this.setMode('play');
  }

  playReplay(data: ReplayData): void {
    this.config = { seed: data.seed, difficulty: data.difficulty, startWave: data.startWave };
    this.sim = new Sim({ seed: data.seed, difficulty: data.difficulty, mode: 'campaign', startWave: data.startWave });
    this.replay = unpackInputs(data.inputs, data.ticks);
    this.replayTick = 0;
    this.replaySpeed = 1;
    this.acc = 0;
    this.overShown = false;
    this.hud.reset();
    this.renderer.floor.decals.clear();
    this.renderer.camera.snap(this.world.player.x, this.world.player.y);
    this.setMode('replay');
  }

  makeReplay(): ReplayData {
    return {
      version: 1,
      seed: this.config.seed,
      difficulty: this.config.difficulty,
      startWave: this.config.startWave ?? 1,
      ticks: this.recorder.length,
      hash: hashWorld(this.world),
      inputs: packInputs(this.recorder),
      date: new Date().toISOString(),
    };
  }

  run(): void {
    this.last = performance.now();
    const loop = (now: number): void => {
      this.frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private stepOnce(): void {
    const w = this.world;
    const c = this.cmd;
    if (this.mode === 'replay' && this.replay) {
      if (this.replayTick >= this.replay.length) return;
      this.replay.read(this.replayTick++, c);
    } else if ((this.mode === 'menu' || this.mode === 'demo') && this.attract) {
      c.mx = c.my = c.btn = 0;
      c.ax = w.player.x;
      c.ay = w.player.y - 5;
      this.attract(w, w.tick, c);
    } else {
      this.input.upgradeMode = w.wave.phase === WavePhase.Upgrade;
      this.input.sample(c, this.renderer.camera);
    }
    this.sim.step(c);
    if (this.mode === 'play') this.recorder.push(c);
    this.renderer.fx.consume(w);
    this.onTick?.(w);
    w.events.clear();
  }

  private frame(now: number): void {
    const realDt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const t0 = performance.now();
    const J = this.renderer.juice;
    J.update(realDt);
    const running = this.mode !== 'pause';
    let steps = 0;
    const simT0 = performance.now();
    if (running && !this.paused) {
      const speed = this.mode === 'replay' ? this.replaySpeed : this.mode === 'demo' && this.bot ? this.demoSpeed : 1;
      this.renderer.fx.quiet = speed > 2;
      this.acc += realDt * J.simScale * this.timeScale * speed;
      const maxSteps = MAX_STEPS * Math.max(1, speed);
      while (this.acc >= DT && steps < maxSteps) {
        this.stepOnce();
        this.acc -= DT;
        steps++;
      }
      if (steps >= maxSteps) this.acc = 0;
    } else if (this.paused && this.stepQueue > 0) {
      while (this.stepQueue > 0) {
        this.stepOnce();
        this.stepQueue--;
        steps++;
      }
    }
    const simMs = performance.now() - simT0;
    const alpha = this.paused ? 1 : Math.min(1, this.acc / DT);
    const fxDt = this.paused ? 0 : realDt * J.simScale * this.timeScale;
    const w = this.world;
    // adaptive mix: tension, combo, slow-mo, HP, mutators, boss corruption
    const bossAlive = w.boss.id >= 0 && w.enemies.type[w.boss.id] === ET.Boss;
    const fxd = this.renderer.fx;
    this.audioInfo.mode = this.mode;
    this.audioInfo.combo = fxd.combo;
    this.audioInfo.comboTier = fxd.comboTier;
    this.audioInfo.timeScale = J.simScale;
    this.audioInfo.corruption = w.boss.corruption;
    this.audioDirector.update(realDt, w, this.audioInfo);
    J.glitchBase = bossAlive ? w.boss.corruption * 0.15 : 0;
    const r0 = performance.now();
    this.renderer.render(w, alpha, realDt, fxDt);
    this.hud.update(w, realDt);
    const fx = this.renderer.fx;
    this.hud.setCombo(fx.combo, fx.comboT / 2.6, fx.comboTier);
    this.onFrame?.(realDt);
    const r1 = performance.now();
    // end states
    if ((this.mode === 'play' || this.mode === 'replay' || (this.mode === 'demo' && this.bot)) && !this.overShown) {
      const ph = w.wave.phase;
      if ((ph === WavePhase.Dead && w.wave.t > 2) || (ph === WavePhase.Victory && w.wave.t > 2.5) || (this.mode === 'replay' && this.replay && this.replayTick >= this.replay.length && steps === 0)) {
        this.overShown = true;
        if (this.mode === 'play' && !this.noReplay) this.lastReplay = this.makeReplay();
        this.setMode('over');
      }
    }
    this.perf.sim = this.perf.sim * 0.9 + simMs * 0.1;
    this.perf.render = this.perf.render * 0.9 + (r1 - r0) * 0.1;
    this.perf.frame = performance.now() - t0;
    this.perf.steps = steps;
    this.fpsAcc += realDt;
    this.fpsN++;
    if (this.fpsAcc >= 0.5) {
      this.perf.fps = this.fpsN / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
  }

  /** Count events of type in the current tick (debug helper). */
  static countEvents(w: World, type: number): number {
    let n = 0;
    for (let k = 0; k < w.events.count; k++) if (w.events.data[k * EV_STRIDE] === type) n++;
    return n;
  }
}

export { Ev };
