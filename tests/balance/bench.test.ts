import { it } from 'vitest';
import { updateEnemies } from '../../src/ai/behaviors';
import { updateLasers } from '../../src/ai/boss';
import { updateFlowField } from '../../src/ai/flowfield';
import { quantizeCmd } from '../../src/sim/input';
import { collideBullets, updateBullets } from '../../src/sim/systems/bullets';
import { updatePlayer } from '../../src/sim/systems/player';
import { updatePickups } from '../../src/sim/systems/pickups';
import { updateFoundry } from '../../src/sim/systems/foundry';
import { updateDirector, updatePhys, updateWaves } from '../../src/sim/systems/waves';
import { DT } from '../../src/sim/constants';
import { Scenario, BOT_SKILLS } from '../../src/sim/scenario';
import { makeCmd } from '../../src/sim/input';

/**
 * Sim performance profile (not part of the normal suite):
 *   BENCH=1 npx vitest run tests/balance/bench
 * Plays the heaviest stretches of each act on ПЕРЕГРУЗ (Тактик, god mode so the fight lasts) and
 * reports ms per tick split by system, plus the bot's own cost.
 */
it.skipIf(!process.env['BENCH'])('sim perf by system', () => {
  const rows: string[] = [];
  for (const wave of [7, 9, 12, 13, 17, 19]) {
    const s = new Scenario(4242 + wave, 4, 'campaign', wave).player({ god: true });
    const bot = BOT_SKILLS.find((b) => b.key === 'tactician')!.make();
    const w = s.world;
    const sim = s.sim;
    const T: Record<string, number> = {};
    const t = (k: string, f: () => void): void => {
      const a = performance.now();
      f();
      T[k] = (T[k] ?? 0) + performance.now() - a;
    };
    const cmd = makeCmd();
    let maxE = 0;
    let maxB = 0;
    const N = 60 * 40;
    for (let i = 0; i < N; i++) {
      t('bot', () => {
        cmd.btn = 0;
        cmd.mx = cmd.my = 0;
        bot(w, w.tick, cmd);
      });
      quantizeCmd(cmd);
      const E = w.enemies;
      t('grid', () => {
        E.rebuildActive();
        w.grid.build(E.active, E.activeCount, E.x, E.y);
      });
      t('player', () => updatePlayer(w, cmd));
      t('flow', () => updateFlowField(w));
      t('waves', () => {
        updateWaves(w, cmd);
        updatePhys(w);
        updateDirector(w);
      });
      t('enemies', () => {
        E.rebuildActive();
        updateEnemies(w);
      });
      t('lasers+foundry', () => {
        updateLasers(w);
        updateFoundry(w);
      });
      t('bullets', () => updateBullets(w));
      t('grid', () => {
        E.rebuildActive();
        w.grid.build(E.active, E.activeCount, E.x, E.y);
      });
      t('collide', () => collideBullets(w));
      t('pickups', () => updatePickups(w));
      w.tick++;
      w.time += DT;
      w.events.clear();
      maxE = Math.max(maxE, E.count);
      maxB = Math.max(maxB, w.bullets.count);
    }
    void sim;
    const tot = Object.values(T).reduce((a, b) => a + b, 0);
    rows.push(`wave ${String(wave).padStart(2)} | ${(tot / N).toFixed(3)} ms/tick | maxE ${maxE} maxB ${maxB} | ` + Object.entries(T).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / N).toFixed(3)}`).join(' · '));
  }
  require('node:fs').writeFileSync(process.env['BENCH_OUT'] ?? '/dev/stdout', rows.join('\n') + '\n');
}, 600_000);
