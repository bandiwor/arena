import { Ev } from '../../core/events';
import { DT, ET } from '../constants';
import { dexp } from '../../core/detmath';
import { MUTATORS, mutatorByKey } from '../content/mutators';
import { UPGRADES, ownsWeapon, stacksOf } from '../content/upgrades';
import { WAVES } from '../content/waves';
import { cmdPick, type InputCmd } from '../input';
import { defaultPhys, WavePhase, type Phys, type World } from '../world';
import { placeSpawn, spawnEnemy } from './entities';

const spawnPos = new Float32Array(2);

export function updateWaves(w: World, cmd: InputCmd): void {
  const W = w.wave;
  W.t += DT;
  if (!w.player.alive && W.phase !== WavePhase.Dead) {
    W.phase = WavePhase.Dead;
    W.t = 0;
    return;
  }
  switch (W.phase) {
    case WavePhase.Sandbox:
    case WavePhase.Dead:
    case WavePhase.Victory:
      return;
    case WavePhase.Intro: {
      if (W.t < DT * 1.5) beginWave(w);
      if (W.t >= 2.2) {
        W.phase = WavePhase.Fight;
        W.t = 0;
      }
      return;
    }
    case WavePhase.Fight: {
      const def = WAVES[W.index]!;
      let allDone = true;
      for (let g = 0; g < def.groups.length; g++) {
        const grp = def.groups[g]!;
        const total = groupCount(w, grp.type, grp.count);
        if (W.spawned[g]! >= total) continue;
        allDone = false;
        if (W.t >= grp.at && W.t >= W.groupNext[g]!) {
          placeSpawn(w, grp.place, W.spawned[g]!, spawnPos);
          let affix = grp.affix ?? 0;
          if (affix === 0 && grp.type !== ET.Boss && w.rng.chance(w.diff.eliteChance)) affix = 1 << w.rng.int(3);
          spawnEnemy(w, grp.type, spawnPos[0]!, spawnPos[1]!, { affix });
          W.spawned[g] = W.spawned[g]! + 1;
          W.groupNext[g] = W.t + grp.every;
        }
      }
      // early pressure valve: if the arena is empty, pull the next group forward
      if (!allDone && w.enemies.count === 0) {
        for (let g = 0; g < def.groups.length; g++) {
          const grp = def.groups[g]!;
          if (W.spawned[g]! < groupCount(w, grp.type, grp.count) && grp.at > W.t) {
            W.t = grp.at;
            break;
          }
        }
      }
      if (allDone && w.enemies.count === 0) {
        W.phase = WavePhase.Clear;
        W.t = 0;
        w.events.push(Ev.WaveClear, W.index + 1);
      }
      return;
    }
    case WavePhase.Clear: {
      if (W.t >= 1.6) {
        endMutator(w);
        if (W.index >= WAVES.length - 1) {
          W.phase = WavePhase.Victory;
          W.t = 0;
          w.events.push(Ev.Victory);
          return;
        }
        rollOffer(w);
        W.phase = WavePhase.Upgrade;
        W.t = 0;
        w.events.push(Ev.UpgradeOffer, W.offerCount);
      }
      return;
    }
    case WavePhase.Upgrade: {
      const pick = cmdPick(cmd);
      if (pick >= 1 && pick <= W.offerCount) {
        const up = UPGRADES[W.offer[pick - 1]!]!;
        applyUpgrade(w, up.id);
        W.index++;
        W.phase = WavePhase.Intro;
        W.t = 0;
      }
      return;
    }
  }
}

function groupCount(w: World, type: number, count: number): number {
  if (type === ET.Boss) return count;
  return Math.max(1, Math.round(count * w.diff.countMul * (1 + w.director.adapt)));
}

function beginWave(w: World): void {
  const W = w.wave;
  const def = WAVES[W.index]!;
  W.spawned.fill(0);
  W.groupNext.fill(0);
  W.killedThisWave = 0;
  let total = 0;
  for (const g of def.groups) total += groupCount(w, g.type, g.count);
  W.totalThisWave = total;
  w.events.push(Ev.WaveStart, W.index + 1, WAVES.length, def.boss ? 1 : 0);
  if (def.mutator) setMutator(w, mutatorByKey(def.mutator).id, true);
}

function endMutator(w: World): void {
  for (let m = 0; m < MUTATORS.length; m++) if (w.mutators & (1 << m)) setMutator(w, m, false);
}

export function applyUpgrade(w: World, id: number): void {
  const up = UPGRADES[id];
  if (!up) return;
  stacksOf(w)[id] = (stacksOf(w)[id] ?? 0) + 1;
  up.apply(w);
  w.stats.upgrades++;
  w.events.push(Ev.UpgradePicked, id, up.weapon, up.rarity);
  if (up.weapon >= 0) w.events.push(Ev.WeaponGained, up.weapon, up.rarity);
}

const weights = new Float32Array(64);
export function rollOffer(w: World): void {
  const W = w.wave;
  const stacks = stacksOf(w);
  let total = 0;
  for (let k = 0; k < UPGRADES.length; k++) {
    const u = UPGRADES[k]!;
    let ok = u.minWave <= W.index && (stacks[k] ?? 0) < u.maxStacks;
    if (u.weapon >= 0 && ownsWeapon(w, u.weapon)) ok = false;
    // heal only valuable if hurt
    if (u.key === 'heal' && w.player.hp > w.player.maxHp * 0.7) ok = false;
    weights[k] = ok ? u.weight : 0;
    total += weights[k]!;
  }
  W.offerCount = 0;
  for (let n = 0; n < 3 && total > 0; n++) {
    let r = w.rng.float() * total;
    let chosen = -1;
    for (let k = 0; k < UPGRADES.length; k++) {
      r -= weights[k]!;
      if (r < 0 && weights[k]! > 0) {
        chosen = k;
        break;
      }
    }
    if (chosen < 0) break;
    W.offer[W.offerCount++] = chosen;
    total -= weights[chosen]!;
    weights[chosen] = 0;
  }
}

// ───────────────────────── mutators / physics easing

export function setMutator(w: World, id: number, on: boolean): void {
  const bit = 1 << id;
  const was = (w.mutators & bit) !== 0;
  if (was === on) return;
  const def = MUTATORS[id];
  if (!def) return;
  if (on) {
    w.mutators |= bit;
    w.mutatorT[id] = 0;
  } else {
    w.mutators &= ~bit;
    def.exit?.(w);
  }
  recomputePhysTarget(w);
  w.events.push(Ev.Mutator, id, on ? 1 : 0);
}

function recomputePhysTarget(w: World): void {
  const t: Phys = w.physTarget;
  const d = defaultPhys();
  Object.assign(t, d);
  for (let m = 0; m < MUTATORS.length; m++) if (w.mutators & (1 << m)) MUTATORS[m]!.apply(t, w);
  w.phys.wallBounce = t.wallBounce;
}

export function updatePhys(w: World): void {
  for (let m = 0; m < MUTATORS.length; m++) {
    if (!(w.mutators & (1 << m))) continue;
    const def = MUTATORS[m]!;
    w.mutatorT[m] = w.mutatorT[m]! + DT;
    def.tick?.(w, DT, w.mutatorT[m]!);
  }
  const k = Math.min(1, DT * 1.8);
  const c = w.phys;
  const t = w.physTarget;
  c.playerBulletSpeed += (t.playerBulletSpeed - c.playerBulletSpeed) * k;
  c.enemyBulletSpeed += (t.enemyBulletSpeed - c.enemyBulletSpeed) * k;
  c.friction += (t.friction - c.friction) * k;
  c.enemySpeed += (t.enemySpeed - c.enemySpeed) * k;
  c.playerSpeed += (t.playerSpeed - c.playerSpeed) * k;
  c.windX += (t.windX - c.windX) * k;
  c.windY += (t.windY - c.windY) * k;
  c.windWalkers += (t.windWalkers - c.windWalkers) * k;
  c.bulletLife += (t.bulletLife - c.bulletLife) * k;
}

// ───────────────────────── director: tension + mild dynamic difficulty

const DECAY = dexp((-0.6931471805599453 * DT) / 6);

export function updateDirector(w: World): void {
  const D = w.director;
  const p = w.player;
  const decay = DECAY;
  D.dmgRecent *= decay;
  D.killsRecent *= decay;
  const hpR = p.hp / p.maxHp;
  const alive = w.enemies.count;
  D.tension = Math.min(1, alive / 24 + D.dmgRecent / 45 + (1 - hpR) * 0.4);
  // performance in [-1, 1]: healthy & untouched → positive (slightly harder)
  const perf = (hpR - 0.55) * 1.6 - D.dmgRecent / 30;
  const target = Math.max(-0.12, Math.min(0.12, perf * 0.12));
  const rate = 0.015 * DT; // very slow: max swing in ~8s
  D.adapt += Math.max(-rate, Math.min(rate, target - D.adapt));
}
