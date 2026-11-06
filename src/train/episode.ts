import { Ev, EV_STRIDE } from '../core/events';
import { decodeGenome, tactician } from '../sim/bot/tactician';
import { AS } from '../sim/constants';
import { WAVES } from '../sim/content/waves';
import { Scenario } from '../sim/scenario';
import { WavePhase } from '../sim/world';

/** what one training game looks like */
export interface EpisodeCfg {
  seed: number;
  difficulty: number;
  startWave: number;
  /** game-time limit, seconds */
  seconds: number;
}

/** raw outcome of one game (fitness is computed from these, so reward sliders can change live) */
export interface Metrics {
  /** waves cleared during the episode + fraction of the current wave */
  progress: number;
  alive: number;
  seconds: number;
  dmgTaken: number;
  dmgDealt: number;
  kills: number;
  shots: number;
  hits: number;
  dashes: number;
  /** mean distance to the nearest enemy (sampled) */
  avgDist: number;
  /** mean seconds an enemy lives after it finished spawning (how fast the bot kills) */
  ttk: number;
  score: number;
  victory: number;
}

/**
 * A fair loadout for a run that starts mid-campaign: roughly what a player picks up by then
 * (otherwise an Act III start with a bare pistol says nothing about the bot).
 */
const KIT = ['dmg', 'rate', 'hp', 'w_scatter', 'crit', 'dmg', 'w_launcher', 'rate', 'hp', 'w_rail', 'multi', 'dmg', 'crit', 'pierce', 'rate', 'hp', 'insulated', 'dmg'];
export function kitFor(startWave: number): string[] {
  return KIT.slice(0, Math.max(0, Math.min(KIT.length, startWave - 1)));
}

export function runEpisode(genome: ArrayLike<number>, cfg: EpisodeCfg): Metrics {
  const s = new Scenario(cfg.seed, cfg.difficulty, 'campaign', cfg.startWave);
  for (const k of kitFor(cfg.startWave)) {
    try {
      s.upgrade(k);
    } catch {
      /* upgrade not available in this build */
    }
  }
  s.input(tactician({ weights: decodeGenome(genome), reaction: 6 }));
  const w = s.world;
  const startIndex = w.wave.index;
  const maxT = Math.round(cfg.seconds * 60);
  let dashes = 0;
  let hits = 0;
  let shots = 0;
  let distSum = 0;
  let distN = 0;
  // time-to-kill: first tick each (slot, generation) was seen fighting → tick it vanished
  const seenAt = new Int32Array(w.enemies.alive.length).fill(-1);
  const seenGen = new Int32Array(w.enemies.alive.length).fill(-1);
  let ttkSum = 0;
  let ttkN = 0;
  let t = 0;
  for (; t < maxT; t++) {
    s.run(1, (ww) => {
      const D = ww.events.data;
      for (let k = 0; k < ww.events.count; k++) {
        const e = D[k * EV_STRIDE]!;
        if (e === Ev.PlayerDash) dashes++;
        else if (e === Ev.Hit) hits++;
        else if (e === Ev.Shoot) shots++;
      }
    });
    {
      const E = w.enemies;
      for (let i = 0; i < E.hi; i++) {
        if (seenAt[i]! >= 0 && (!E.alive[i] || E.gen[i] !== seenGen[i])) {
          ttkSum += (t - seenAt[i]!) / 60;
          ttkN++;
          seenAt[i] = -1;
        }
        if (E.alive[i] && seenAt[i]! < 0 && E.st[i] !== AS.Spawning) {
          seenAt[i] = t;
          seenGen[i] = E.gen[i]!;
        }
      }
    }
    if (t % 30 === 0) {
      const E = w.enemies;
      let best = 1e9;
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i] || E.st[i] === AS.Spawning || E.st[i] === AS.Underground) continue;
        const d = Math.hypot(E.x[i]! - w.player.x, E.y[i]! - w.player.y);
        if (d < best) best = d;
      }
      if (best < 1e8) {
        distSum += best;
        distN++;
      }
    }
    const ph = w.wave.phase;
    if (ph === WavePhase.Dead || ph === WavePhase.Victory) break;
  }
  const W = w.wave;
  const frac = W.totalThisWave > 0 ? Math.min(1, W.killedThisWave / W.totalThisWave) : 0;
  const cleared = W.index - startIndex + (W.phase === WavePhase.Victory ? 1 : 0);

  return {
    progress: Math.max(0, cleared + (W.phase === WavePhase.Victory ? 0 : frac)),
    alive: w.player.alive ? 1 : 0,
    seconds: (t + 1) / 60,
    dmgTaken: w.stats.dmgTaken,
    dmgDealt: w.stats.dmgDealt,
    kills: w.stats.kills,
    shots,
    hits,
    dashes,
    avgDist: distN ? distSum / distN : 0,
    ttk: ttkN ? ttkSum / ttkN : 30,
    score: w.stats.score,
    victory: W.phase === WavePhase.Victory ? 1 : 0,
  };
}

export const WAVE_COUNT = WAVES.length;
