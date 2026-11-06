import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Inputs, Scenario } from '../../src/sim/scenario';
import { tactician } from '../../src/sim/bot/tactician';
import { DIFFICULTIES } from '../../src/sim/content/difficulty';
import { WavePhase } from '../../src/sim/world';

/**
 * Balance report (not part of the normal suite): BALANCE=1 npx vitest run tests/balance
 * Runs full campaigns without god mode for each difficulty with a skilled bot (human-like
 * reaction) and a naive bot, and prints how far they get and how much damage they take.
 */
const SEEDS = [11, 22, 33, 44, 55, 66, 77, 88];
it.skipIf(!process.env['BALANCE'])('balance report', () => {
  const rows: string[] = [];
  for (const d of DIFFICULTIES) {
    for (const [bot, mk] of [['fast83', () => Inputs.skilled({ reaction: 5 })], ['skill133', () => Inputs.skilled({ reaction: 8 })], ['slow200', () => Inputs.skilled({ reaction: 12 })], ['naive', () => Inputs.aimbot()], ['tactic', () => tactician({ reaction: 6 })]] as const) {
      const waves: number[] = [];
      let wins = 0;
      let dead = 0;
      let stall = 0;
      let dmgPerMin = 0;
      for (const seed of SEEDS) {
        const s = new Scenario(seed, d.id, 'campaign');
        s.input(mk());
        if (bot !== 'naive') s.autoPick = 0; // skilled bots choose their own upgrades
        const w = s.world;
        let t = 0;
        while (t < 60 * 60 * 25) {
          s.run(600);
          t += 600;
          if (w.wave.phase === WavePhase.Dead || w.wave.phase === WavePhase.Victory) break;
        }
        waves.push(w.wave.index + 1);
        if (w.wave.phase === WavePhase.Victory) wins++;
        else if (w.wave.phase === WavePhase.Dead) dead++;
        else stall++;
        dmgPerMin += w.stats.dmgTaken / (w.tick / 3600);
      }
      const avg = waves.reduce((a, b) => a + b, 0) / waves.length;
      rows.push(`${d.key.padEnd(10)} ${bot.padEnd(8)} waves avg ${avg.toFixed(1).padStart(4)}  [${waves.join(',')}]  wins ${wins} dead ${dead} stall ${stall}  dmg/min ${(dmgPerMin / SEEDS.length).toFixed(0)}`);
    }
  }
  const out = rows.join('\n');
  console.log('\n' + out);
  if (process.env['BALANCE_OUT']) writeFileSync(process.env['BALANCE_OUT'], out + '\n');
}, 600_000);
