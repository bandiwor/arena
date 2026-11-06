import './ui/style.css';
import './ui/kit.css';
import { Game } from './game';
import { Menus } from './ui/menu';
import { installPwa } from './pwa';
import { Shell } from './ui/shell';
import { Inputs, Scenario } from './sim/scenario';
import { Btn } from './sim/constants';
import type { Sim } from './sim/sim';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const game = new Game(canvas, ui);
const menus = new Menus(game, ui);
if (__DEV__) (window as unknown as { __game: Game }).__game = game;
const params = new URLSearchParams(location.search);
// boot screen: one gesture → audio unlock + synthesis progress (+ fullscreen/landscape on touch devices)
const shell = new Shell(game, ui, () => menus.ensureAudio());
const skipBoot = ['scene', 'wave', 'autostart', 'selfplay', 'nosplash'].some((k) => params.has(k));
void shell.boot(skipBoot).then(() => {
  // ?watch=<model id> — opened from the training page: watch the trained model play
  const watch = params.get('watch');
  if (!watch) return;
  void import('./train/models').then(({ modelSkills }) => {
    const skill = modelSkills().find((b) => b.key === `model:${watch}`);
    if (skill) game.startBot({ seed: (Date.now() % 1_000_000) >>> 0 || 1, difficulty: parseInt(params.get('diff') ?? '1', 10) }, skill);
  });
});

function attractSim(): Sim {
  const s = new Scenario(Date.now() >>> 0, 1, 'sandbox').player({ god: true, weapons: ['pulse', 'scatter', 'rail'] });
  s.ring('swarmer', 14, 13, 0, 4).spawn('gunner', -12, -12).spawn('gunner', 12, -12).spawn('archer', 0, -16).spawn('charger', 16, 10);
  return s.sim;
}
const bot = Inputs.aimbot();
let respawnT = 0;
const attractFn = (w: Parameters<typeof bot>[0], t: number, c: Parameters<typeof bot>[2]): void => {
  bot(w, t, c);
  if (t % 240 === 0) c.btn |= ((t / 240) % 3 === 0 ? 1 : 0) * Btn.Next;
  // keep the menu fight alive
  if (w.enemies.count < 6 && ++respawnT % 60 === 0) {
    const sim = attractSim();
    game.startAttract(sim, attractFn);
  }
};
menus.onMenu = () => game.startAttract(attractSim(), attractFn);
game.startAttract(attractSim(), attractFn);

/** Debug tools are lazy-loaded: in dev / with ?debug at startup, otherwise on first use (menu button or F1). */
let debugP: Promise<import('./debug/panel').DebugPanel> | null = null;
function ensureDebug(): Promise<import('./debug/panel').DebugPanel> {
  if (!debugP) {
    debugP = Promise.all([import('./debug/dbg'), import('./debug/panel')]).then(([d, p]) => {
      const { api, overlay } = d.installDebug(game);
      return new p.DebugPanel(game, api, overlay);
    });
  }
  return debugP;
}
menus.onDebug = () => void ensureDebug().then((p) => p.show());
window.addEventListener('keydown', (e) => {
  if (e.code === 'F1' && !debugP) {
    e.preventDefault();
    void ensureDebug().then((p) => p.show());
  }
});

if (__DEV__ || params.has('debug')) {
  void ensureDebug().then(async () => {
    const { buildScene } = await import('./debug/dbg');
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
installPwa();
game.run();
