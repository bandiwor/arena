import { StateHasher } from '../core/hash';
import { updateEnemies } from '../ai/behaviors';
import { updateLasers } from '../ai/boss';
import { updateFlowField } from '../ai/flowfield';
import { quantizeCmd, type InputCmd } from './input';
import { collideBullets, updateBullets } from './systems/bullets';
import { updatePlayer } from './systems/player';
import { updatePickups } from './systems/pickups';
import { updateDirector, updatePhys, updateWaves } from './systems/waves';
import { DT } from './constants';
import { World, type WorldOptions } from './world';

/**
 * Pure, deterministic fixed-step simulation. No DOM, no wall clock, no Math.random.
 * Runs identically in the browser and in vitest.
 */
export class Sim {
  readonly world: World;
  constructor(opts: WorldOptions) {
    this.world = new World(opts);
  }

  step(cmd: InputCmd): void {
    const w = this.world;
    quantizeCmd(cmd);
    const E = w.enemies;
    E.rebuildActive();
    w.grid.build(E.active, E.activeCount, E.x, E.y);
    updatePlayer(w, cmd);
    updateFlowField(w);
    updateWaves(w, cmd);
    updatePhys(w);
    updateDirector(w);
    E.rebuildActive();
    updateEnemies(w);
    updateLasers(w);
    updateBullets(w);
    E.rebuildActive();
    w.grid.build(E.active, E.activeCount, E.x, E.y);
    collideBullets(w);
    updatePickups(w);
    w.tick++;
    w.time += DT;
    w.stats.ticks = w.tick;
  }
}

const hasher = new StateHasher();
/** Hash of all gameplay-relevant state; identical inputs ⇒ identical hash. */
export function hashWorld(w: World): string {
  const E = w.enemies;
  const B = w.bullets;
  const p = w.player;
  hasher.reset();
  hasher.view(E.alive, E.hi).view(E.x, E.hi).view(E.y, E.hi).view(E.hp, E.hi).view(E.st, E.hi);
  hasher.view(B.alive, B.hi).view(B.x, B.hi).view(B.y, B.hi);
  hasher.num(p.x).num(p.y).num(p.hp).num(w.tick).num(w.stats.kills).num(w.wave.index).num(w.wave.phase);
  return hasher.hex();
}
