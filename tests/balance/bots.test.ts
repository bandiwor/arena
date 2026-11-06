import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { BOT_SKILLS, Scenario } from '../../src/sim/scenario';
import { DIFFICULTIES } from '../../src/sim/content/difficulty';
import { WavePhase } from '../../src/sim/world';

/**
 * Bot comparison (not part of the normal suite):
 *   BOTS=1 [BOTS_DIFF=0,1,4] [BOTS_LIST=master,tactician] [BOTS_SEEDS=12] [BOTS_OUT=file] npx vitest run tests/balance/bots
 * Full campaigns, no god mode, each bot plays its own upgrade picks (the novice takes the first).
 */
it.skipIf(!process.env['BOTS'])('bot comparison', () => {
  const diffs = (process.env['BOTS_DIFF'] ?? DIFFICULTIES.map((d) => d.id).join(',')).split(',').map(Number);
  const keys = process.env['BOTS_LIST']?.split(',') ?? BOT_SKILLS.map((b) => b.key);
  const nSeeds = Number(process.env['BOTS_SEEDS'] ?? 12);
  const seeds = Array.from({ length: nSeeds }, (_, k) => 1000 + k * 37);
  for (const di of diffs) {
    const d = DIFFICULTIES[di]!;
    for (const key of keys) {
      const bot = BOT_SKILLS.find((b) => b.key === key)!;
      let wins = 0;
      let waves = 0;
      let dmg = 0;
      let mins = 0;
      const deaths: number[] = [];
      for (const seed of seeds) {
        const s = new Scenario(seed, d.id, 'campaign');
        s.input(bot.make());
        s.autoPick = 0;
        const w = s.world;
        let t = 0;
        while (t < 60 * 60 * 30) {
          s.run(600);
          t += 600;
          if (w.wave.phase === WavePhase.Dead || w.wave.phase === WavePhase.Victory) break;
        }
        if (w.wave.phase === WavePhase.Victory) wins++;
        else deaths.push(w.wave.index + 1);
        waves += w.wave.index + 1;
        dmg += w.stats.dmgTaken;
        mins += w.tick / 3600;
      }
      const line = `${d.key}|${d.name}|${bot.key}|${bot.name}|${wins}|${nSeeds}|${(waves / nSeeds).toFixed(1)}|${(dmg / mins).toFixed(0)}|${deaths.join(',')}`;
      console.log(line);
      if (process.env['BOTS_OUT']) appendFileSync(process.env['BOTS_OUT'], line + '\n');
    }
  }
}, 3_600_000);
