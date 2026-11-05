import { writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Inputs, Scenario } from '../../src/sim/scenario';
import { WAVES } from '../../src/sim/content/waves';
import { WavePhase } from '../../src/sim/world';

/**
 * Per-wave pressure report (not part of the normal suite):
 *   PERWAVE=1 [PERWAVE_DIFF=1] [PERWAVE_OUT=file] npx vitest run tests/balance/perwave
 * An immortal (HP topped up) skilled bot plays the whole campaign so every wave is measured. For each wave:
 * duration, damage the player would have taken per minute, total enemy HP spawned ("mass"),
 * peak concurrent enemies, and the player's damage output per second (to see power growth).
 */
const SEEDS = [11, 22, 33, 44];
it.skipIf(!process.env['PERWAVE'])('per-wave pressure', () => {
  const diff = Number(process.env['PERWAVE_DIFF'] ?? 1);
  const n = WAVES.length;
  const dur = new Float64Array(n);
  const dmg = new Float64Array(n);
  const mass = new Float64Array(n);
  const peak = new Float64Array(n);
  const dps = new Float64Array(n);
  const cnt = new Float64Array(n);
  const byAct = [new Float64Array(64), new Float64Array(64), new Float64Array(64)];
  let lastBy = new Float32Array(64);
  for (const seed of SEEDS) {
    const s = new Scenario(seed, diff, 'campaign');
    s.input(Inputs.skilled({ reaction: 8 }));
    s.autoPick = 0;
    const w = s.world;
    let idx = -1;
    let t0 = 0;
    let d0 = 0;
    let out0 = 0;
    let pk = 0;
    const seen = new Uint8Array(4096);
    const gens = new Int32Array(4096).fill(-1);
    let m = 0;
    const flush = (): void => {
      if (idx < 0) return;
      const t = (w.tick - t0) / 60;
      dur[idx] = dur[idx]! + t;
      dmg[idx] = dmg[idx]! + ((w.stats.dmgTaken - d0) / Math.max(1, t)) * 60;
      mass[idx] = mass[idx]! + m;
      peak[idx] = peak[idx]! + pk;
      dps[idx] = dps[idx]! + (w.stats.dmgDealt - out0) / Math.max(1, t);
      cnt[idx] = cnt[idx]! + 1;
      const A = byAct[WAVES[idx]!.act ?? 0]!;
      for (let k = 0; k < w.stats.dmgBy.length; k++) A[k] = A[k]! + w.stats.dmgBy[k]! - (lastBy[k] ?? 0);
      lastBy = Float32Array.from(w.stats.dmgBy);
    };
    for (let tick = 0; tick < 60 * 60 * 40; tick++) {
      s.run(1);
      // immortal but honest: damage is still taken and counted, HP is topped up instead of dying
      if (w.player.hp < w.player.maxHp * 0.5) w.player.hp = w.player.maxHp;
      const ph = w.wave.phase;
      if (ph === WavePhase.Victory) break;
      const fighting = ph === WavePhase.Fight;
      if (fighting && w.wave.index !== idx) {
        flush();
        idx = w.wave.index;
        t0 = w.tick;
        d0 = w.stats.dmgTaken;
        out0 = w.stats.dmgDealt;
        pk = 0;
        m = 0;
        seen.fill(0);
      }
      if (!fighting) continue;
      const E = w.enemies;
      let alive = 0;
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i]) continue;
        alive++;
        if (!seen[i] || gens[i] !== E.gen[i]) {
          seen[i] = 1;
          gens[i] = E.gen[i]!;
          m += E.maxHp[i]!;
        }
      }
      pk = Math.max(pk, alive);
    }
    flush();
  }
  const rows = ['wave                    act  dur s  dmg/min   mass  peak  playerDPS'];
  for (let i = 0; i < n; i++) {
    const c = Math.max(1, cnt[i]!);
    rows.push(
      `${String(i + 1).padStart(2)} ${WAVES[i]!.name.padEnd(20)} ${String(WAVES[i]!.act ?? 0).padStart(2)} ${(dur[i]! / c).toFixed(0).padStart(6)} ${(dmg[i]! / c).toFixed(0).padStart(8)} ${(mass[i]! / c).toFixed(0).padStart(6)} ${(peak[i]! / c).toFixed(0).padStart(5)} ${(dps[i]! / c).toFixed(0).padStart(10)}`,
    );
  }
  rows.push('damage by source per act (src id: total over all seeds; enemy type id, 50 pads, 51 pylon arc, 53 saw track)');
  for (let a = 0; a < 3; a++) {
    const A = byAct[a]!;
    const top = [...A.keys()].filter((k) => A[k]! > 0).sort((x, y) => A[y]! - A[x]!).slice(0, 10);
    rows.push(`act ${a}: ` + top.map((k) => `${k}:${A[k]!.toFixed(0)}`).join('  '));
  }
  const out = rows.join('\n');
  console.log('\n' + out);
  if (process.env['PERWAVE_OUT']) writeFileSync(process.env['PERWAVE_OUT'], out + '\n');
}, 900_000);
