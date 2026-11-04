import './ui/style.css';
import { Game } from './game';
import { Menus } from './ui/menu';
import { installPwa } from './pwa';
import { Inputs, Scenario } from './sim/scenario';
import { Btn } from './sim/constants';
import type { Sim } from './sim/sim';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const game = new Game(canvas, ui);
const menus = new Menus(game, ui);
const params = new URLSearchParams(location.search);

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

const debug = __DEV__ || params.has('debug');
if (debug) {
  void import('./debug/dbg').then(({ installDebug, buildScene }) => {
    installDebug(game);
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
