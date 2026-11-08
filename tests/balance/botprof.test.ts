import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { it } from 'vitest';
import { runEpisode } from '../../src/train/episode';

/** CPU profile of training episodes (BOTPROF=1 BOTPROF_OUT=file.cpuprofile). */
it.skipIf(!process.env['BOTPROF'])('profile training episodes', async () => {
  const s = new Session();
  s.connect();
  await s.post('Profiler.enable');
  await s.post('Profiler.setSamplingInterval', { interval: 100 });
  await s.post('Profiler.start');
  const g = Array(36).fill(0);
  const t0 = performance.now();
  let ticks = 0;
  for (const w of [2, 6, 11, 15, 17]) for (let k = 0; k < 2; k++) ticks += runEpisode(g, { seed: 100 + k * 7 + w, difficulty: 4, startWave: w, seconds: 60 }).seconds * 60;
  const ms = performance.now() - t0;
  const { profile } = await s.post('Profiler.stop');
  writeFileSync(process.env['BOTPROF_OUT'] ?? 'bot.cpuprofile', JSON.stringify(profile));
  writeFileSync((process.env['BOTPROF_OUT'] ?? 'bot') + '.txt', `${ticks} ticks in ${ms.toFixed(0)} ms → ${((ms / ticks) * 1000).toFixed(1)} µs/tick\n`);
}, 600_000);
