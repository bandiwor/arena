import { batch, effect, signal } from '@preact/signals';
import { route } from './router';
import { Game, type Mode } from '../game';
import { installPwa } from '../pwa';
import { Btn } from '../sim/constants';
import type { ReplayData } from '../sim/replay';
import { Inputs, Scenario, type BotSkill } from '../sim/scenario';
import type { Sim } from '../sim/sim';
import { applySettings, loadSettings, saveSettings, type Settings } from '../ui/settings';
import { Shell } from '../ui/shell';

/**
 * The game lives for the whole app session: created once (first visit of #/), then only hidden and
 * suspended while another page is open — coming back is instant, the run is still there (paused).
 * Its state reaches the Preact menus as signals; the per-frame HUD and touch sticks stay plain DOM
 * (they update every frame and must not go through any framework).
 */
export type MenuScreen = 'main' | 'bots' | 'settings';
const LS_REPLAY = 'null-arena:last-replay';

export function loadReplay(): ReplayData | null {
  try {
    const s = localStorage.getItem(LS_REPLAY);
    return s ? (JSON.parse(s) as ReplayData) : null;
  } catch {
    return null;
  }
}

export class GameHost {
  readonly game: Game;
  readonly shell: Shell;
  private readonly layers: HTMLElement[];
  readonly mode = signal<Mode>('menu');
  readonly screen = signal<MenuScreen>('main');
  /** where the settings screen returns to */
  settingsFrom: 'main' | 'pause' = 'main';
  readonly booted = signal(false);
  readonly settings = signal<Settings>(loadSettings());
  readonly seed = signal((Date.now() % 1_000_000) >>> 0);
  readonly botKey = signal('skilled');
  readonly botDiff = signal(1);
  readonly hasReplay = signal(!!loadReplay());
  /** bumps when the over screen should re-read world stats */
  readonly overTick = signal(0);
  readonly params = new URLSearchParams(location.search);

  constructor() {
    const canvas = document.createElement('canvas');
    canvas.id = 'game';
    const ui = document.createElement('div');
    ui.id = 'ui';
    document.body.prepend(canvas, ui);
    this.layers = [canvas, ui];
    const game = new Game(canvas, ui);
    this.game = game;
    if (__DEV__) (window as unknown as { __game: Game }).__game = game;
    this.shell = new Shell(game, ui, () => this.ensureAudio());
    applySettings(game, this.settings.value);

    game.onModeChange = (m) =>
      batch(() => {
        this.mode.value = m;
        if (m !== 'menu' && m !== 'pause' && this.screen.value === 'settings') this.screen.value = 'main';
        if (m !== 'menu' && this.screen.value === 'bots') this.screen.value = 'main';
        if (m === 'over') {
          this.saveReplay();
          this.overTick.value++;
        }
      });

    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape' || game.suspended) return;
      const scr = this.screen.value;
      if (scr === 'settings') this.closeSettings();
      else if (game.mode === 'play') game.setMode('pause');
      else if (game.mode === 'pause') game.setMode('play');
      else if (game.mode === 'replay' || (game.mode === 'demo' && game.bot)) this.toMenu();
      else if (scr === 'bots') this.screen.value = 'main';
    });

    this.startAttract();
    this.installDebug();
    installPwa();
    game.run();
    // shown exactly while the route is the game: synchronous with the route signal (component
    // effects would run a frame later — after the page swap's snapshot)
    effect(() => (route.value.name === 'game' ? this.show() : this.hide()));
  }

  // ───────────── page lifecycle
  show(): void {
    for (const l of this.layers) l.style.display = '';
    document.body.classList.remove('off-game');
    this.game.resume();
  }
  hide(): void {
    this.game.suspend();
    for (const l of this.layers) l.style.display = 'none';
    // debug overlay / drawer / pwa toasts belong to the game page
    document.body.classList.add('off-game');
  }

  // ───────────── boot
  get skipBoot(): boolean {
    return ['scene', 'wave', 'autostart', 'selfplay', 'nosplash'].some((k) => this.params.has(k));
  }

  /** audio boots on the first gesture; synthesis continues in the background */
  ensureAudio(): void {
    const a = this.game.audio;
    if (!a.ctx) {
      void a.init(7);
      applySettings(this.game, this.settings.value);
    }
    a.resume();
  }

  // ───────────── settings
  updateSettings(fn: (s: Settings) => void): void {
    const s = structuredClone(this.settings.value);
    fn(s);
    saveSettings(s);
    applySettings(this.game, s);
    this.settings.value = s;
  }
  openSettings(): void {
    this.settingsFrom = this.game.mode === 'pause' ? 'pause' : 'main';
    this.screen.value = 'settings';
  }
  closeSettings(): void {
    this.screen.value = 'main';
  }

  // ───────────── runs
  start(): void {
    const seed = this.seed.value || 1;
    this.game.start({ seed, difficulty: this.settings.value.difficulty });
  }
  startBot(skill: BotSkill, difficulty: number): void {
    this.game.startBot({ seed: (Date.now() % 1_000_000) >>> 0 || 1, difficulty }, skill);
  }
  toMenu(): void {
    batch(() => {
      this.seed.value = (Date.now() % 1_000_000) >>> 0;
      this.screen.value = 'main';
      this.hasReplay.value = !!loadReplay();
    });
    this.startAttract();
  }
  openBots(): void {
    if (this.game.mode !== 'menu') this.startAttract();
    batch(() => {
      this.botDiff.value = this.settings.value.difficulty;
      this.screen.value = 'bots';
    });
  }

  private saveReplay(): void {
    const g = this.game;
    if (!g.lastReplay || g.replay !== null) return;
    try {
      localStorage.setItem(LS_REPLAY, JSON.stringify(g.lastReplay));
      this.hasReplay.value = true;
    } catch {
      /* too large / unavailable */
    }
  }

  // ───────────── menu background fight
  private attractSim(): Sim {
    const s = new Scenario(Date.now() >>> 0, 1, 'sandbox').player({ god: true, weapons: ['pulse', 'scatter', 'rail'] });
    s.ring('swarmer', 14, 13, 0, 4).spawn('gunner', -12, -12).spawn('gunner', 12, -12).spawn('archer', 0, -16).spawn('charger', 16, 10);
    return s.sim;
  }
  private readonly attractBot = Inputs.aimbot();
  private respawnT = 0;
  private readonly attractFn = (w: Parameters<ReturnType<typeof Inputs.aimbot>>[0], t: number, c: Parameters<ReturnType<typeof Inputs.aimbot>>[2]): void => {
    this.attractBot(w, t, c);
    if (t % 240 === 0) c.btn |= ((t / 240) % 3 === 0 ? 1 : 0) * Btn.Next;
    // keep the menu fight alive
    if (w.enemies.count < 6 && ++this.respawnT % 60 === 0) this.game.startAttract(this.attractSim(), this.attractFn);
  };
  startAttract(): void {
    this.game.startAttract(this.attractSim(), this.attractFn);
  }

  // ───────────── debug tools: lazy (dev / ?debug at startup, otherwise first use: menu button or F1)
  private debugP: Promise<import('../debug/panel').DebugPanel> | null = null;
  ensureDebug(): Promise<import('../debug/panel').DebugPanel> {
    if (!this.debugP) {
      this.debugP = Promise.all([import('../debug/dbg'), import('../debug/panel')]).then(([d, p]) => {
        const { api, overlay } = d.installDebug(this.game);
        return new p.DebugPanel(this.game, api, overlay);
      });
    }
    return this.debugP;
  }
  private installDebug(): void {
    const game = this.game;
    const params = this.params;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1' && !this.debugP && !game.suspended) {
        e.preventDefault();
        void this.ensureDebug().then((p) => p.show());
      }
    });
    if (!(__DEV__ || params.has('debug'))) return;
    void this.ensureDebug().then(async () => {
      const { buildScene } = await import('../debug/dbg');
      const scene = params.get('scene');
      const seed = parseInt(params.get('seed') ?? '1', 10);
      const diff = parseInt(params.get('diff') ?? '1', 10);
      if (scene) {
        game.start({ seed, difficulty: diff, sandbox: true });
        game.sim = buildScene(scene, seed, diff);
        game.renderer.camera.snap(game.world.player.x, game.world.player.y);
      } else if (params.has('wave') || params.has('autostart')) {
        game.start({ seed, difficulty: diff, startWave: parseInt(params.get('wave') ?? '1', 10) });
      }
      if (params.has('god')) game.world.god = true;
      if (params.has('selfplay')) {
        game.attract = Inputs.aimbot();
        game.setMode('demo');
      }
    });
  }
}

let host: GameHost | null = null;
export function gameHost(): GameHost {
  host ??= new GameHost();
  return host;
}
