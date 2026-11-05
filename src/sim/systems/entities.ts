import { Ev } from '../../core/events';
import { dcos, dsin, datan2 } from '../../core/detmath';
import { AS, Affix, ARENA_HH, ARENA_HW, BK, ET, Mat, Team, type EnemyType } from '../constants';
import { enemyDef } from '../content/enemies';
import type { World } from '../world';
import type { Placement } from '../content/waves';

export const SHIELD_HP = 70;

/** vulnerability windows: punish the recovery, reward reading the pattern */
export function vulnMul(t: number, st: number): number {
  if (t === ET.GearMite && st === AS.Stunned) return 1.25;
  if (t === ET.Stamper && st === AS.Recover) return 1.3;
  if (t === ET.ArcDrone && st === AS.Windup) return 1.4;
  if (t === ET.Hauler && st === AS.Recover) return 1.3;
  if (t === ET.Skiff && st === AS.Stunned) return 1.2;
  return 1;
}
export const SHIELD_DOWN = 4;

export interface SpawnOpts {
  affix?: number;
  /** skip telegraph */
  instant?: boolean;
  hpMul?: number;
}

/**
 * Act progression: by Act II/III the player carries 8–15 upgrades, so ordinary enemies grow
 * tougher and hit harder per act (bosses are tuned directly in the enemy table).
 */
export const ACT_HP = [1, 1.2, 1.5] as const;
export const ACT_DMG = [1, 1.06, 1.18] as const;
export const ACT_ELITE = [0, 0.06, 0.1] as const;
export function actHpMul(w: World, type: number): number {
  if (type === ET.Boss || type === ET.Brood || type === ET.Press || type === ET.Assembler || type === ET.Arm) return 1;
  return actRamp(w, ACT_HP[w.act] ?? 1);
}
/** blend an act multiplier toward 1 by the difficulty's actRamp */
export function actRamp(w: World, m: number): number {
  return 1 + (m - 1) * w.diff.actRamp;
}

export function spawnEnemy(w: World, type: EnemyType, x: number, y: number, opts?: SpawnOpts): number {
  const E = w.enemies;
  const i = E.free.alloc();
  if (i < 0) return -1;
  if (i + 1 > E.hi) E.hi = i + 1;
  const def = enemyDef(type);
  const affix = opts?.affix ?? 0;
  let hp = def.hp * w.diff.hpMul * (opts?.hpMul ?? 1) * actHpMul(w, type);
  if (affix & Affix.Armored) hp *= 1.8;
  if (affix & Affix.Volatile) hp *= 1.2;
  E.alive[i] = 1;
  E.type[i] = type;
  E.st[i] = AS.Spawning;
  E.token[i] = 0;
  E.affix[i] = affix;
  E.gen[i] = (E.gen[i]! + 1) & 0xffff;
  E.x[i] = x;
  E.y[i] = y;
  E.px[i] = x;
  E.py[i] = y;
  E.vx[i] = 0;
  E.vy[i] = 0;
  E.kx[i] = 0;
  E.ky[i] = 0;
  E.hp[i] = hp;
  E.maxHp[i] = hp;
  E.r[i] = def.r;
  const toP = datan2(w.player.y - y, w.player.x - x);
  E.face[i] = toP;
  E.faceP[i] = toP;
  E.spawnT[i] = opts?.instant ? 0 : def.spawnTime;
  E.stT[i] = 0;
  E.cd[i] = w.rng.range(0.5, 1.5);
  E.think[i] = w.rng.range(0, 0.2);
  E.aim[i] = toP;
  E.charge[i] = 0;
  E.flash[i] = 0;
  E.walk[i] = w.rng.range(0, 6.28);
  E.seed[i] = w.rng.float();
  E.tx[i] = x;
  E.ty[i] = y;
  E.speedMul[i] = affix & Affix.Fast ? 1.4 : 1;
  E.dmgTaken[i] = 0;
  E.burst[i] = 0;
  E.aux[i] = type === ET.Parasite ? -1 : 0; // parasite: no host chosen yet (never 'slot 0')
  E.aux2[i] = w.rng.sign();
  E.util.fill(0, i * 6, i * 6 + 6);
  E.count++;
  if (opts?.instant) E.st[i] = AS.Move;
  else w.events.push(Ev.SpawnTelegraph, x, y, type, def.spawnTime, affix);
  if (type === ET.Boss) w.boss.id = i;
  if (type === ET.Brood || type === ET.Press || type === ET.Assembler) w.miniBoss = i;
  E.shortT[i] = 0;
  E.haste[i] = 0;
  E.buff[i] = 0;
  E.shield[i] = type === ET.Shielder ? SHIELD_HP * w.diff.hpMul : 0;
  return i;
}

export function removeEnemy(w: World, i: number): void {
  const E = w.enemies;
  if (!E.alive[i]) return;
  releaseToken(w, i);
  E.alive[i] = 0;
  E.count--;
  E.free.free(i);
}

export function acquireToken(w: World, i: number): boolean {
  const E = w.enemies;
  if (E.token[i]) return true;
  const D = w.director;
  if (D.tokensUsed >= D.tokensMax + (w.act >= 1 ? 1 : 0)) return false;
  D.tokensUsed++;
  E.token[i] = 1;
  return true;
}

export function releaseToken(w: World, i: number): void {
  const E = w.enemies;
  if (!E.token[i]) return;
  E.token[i] = 0;
  w.director.tokensUsed--;
}

export function spawnBullet(
  w: World,
  team: number,
  kind: number,
  x: number,
  y: number,
  angle: number,
  speed: number,
  dmg: number,
  r: number,
  life: number,
  weapon: number,
  rarity: number,
  pierce: number,
  bounce: number,
  knock: number,
  aoe: number,
): number {
  const B = w.bullets;
  const i = B.free.alloc();
  if (i < 0) return -1;
  if (i + 1 > B.hi) B.hi = i + 1;
  const sm = team === Team.Player ? w.phys.playerBulletSpeed : w.phys.enemyBulletSpeed;
  B.alive[i] = 1;
  B.team[i] = team;
  B.kind[i] = kind;
  B.weapon[i] = weapon;
  B.rarity[i] = rarity;
  B.pierce[i] = pierce;
  // mirrors favour the player: your shots ricochet fully, hostile ones at most once and die sooner
  const enemy = team !== Team.Player;
  B.bounce[i] = bounce + (enemy ? Math.min(1, w.phys.wallBounce) : w.phys.wallBounce);
  B.lastHit[i] = -1;
  B.x[i] = x;
  B.y[i] = y;
  B.px[i] = x;
  B.py[i] = y;
  B.vx[i] = dcos(angle) * speed * sm;
  B.vy[i] = dsin(angle) * speed * sm;
  B.life[i] = life * (enemy && w.phys.wallBounce > 0 ? Math.min(1.15, w.phys.bulletLife) : w.phys.bulletLife);
  B.age[i] = 0;
  B.dmg[i] = dmg;
  B.r[i] = r;
  B.knock[i] = knock;
  B.aoe[i] = aoe;
  B.crit[i] = 0;
  B.homing[i] = -1;
  B.h0[i] = 0.8;
  B.count++;
  return i;
}

export function removeBullet(w: World, i: number): void {
  const B = w.bullets;
  if (!B.alive[i]) return;
  B.alive[i] = 0;
  B.count--;
  B.free.free(i);
}

export function spawnPickup(w: World, kind: number, x: number, y: number, value: number): void {
  const P = w.pickups;
  const i = P.free.alloc();
  if (i < 0) return;
  if (i + 1 > P.hi) P.hi = i + 1;
  const a = w.rng.range(0, 6.283);
  const s = w.rng.range(2, 5);
  P.alive[i] = 1;
  P.kind[i] = kind;
  P.x[i] = x;
  P.y[i] = y;
  P.px[i] = x;
  P.py[i] = y;
  P.vx[i] = dcos(a) * s;
  P.vy[i] = dsin(a) * s;
  P.life[i] = 14;
  P.value[i] = value;
}

/**
 * Apply damage to an enemy. Returns true if killed.
 * `angle` is the direction the hit travels (used for knockback + gore direction).
 */
export function damageEnemy(
  w: World,
  i: number,
  dmg: number,
  angle: number,
  knock: number,
  rarity: number,
  weapon: number,
  crit: boolean,
): boolean {
  const E = w.enemies;
  if (!E.alive[i] || E.st[i] === AS.Spawning || E.st[i] === AS.Underground) return false;
  const t = E.type[i]! as EnemyType;
  const def = enemyDef(t);
  // a feeding parasite hardens its host
  if (E.buff[i]! > 0) dmg *= 0.6;
  // the assembler hub is untouchable while closed / shielded
  if (t === ET.Assembler && E.shield[i]! > 0) {
    w.events.push(Ev.ShieldBlock, E.x[i]!, E.y[i]!, angle, i);
    return false;
  }
  dmg *= vulnMul(t, E.st[i]!);
  if (E.affix[i]! & Affix.Armored) dmg *= 0.75;
  if (t === ET.Boss && w.boss.dying > 0) return false;
  E.hp[i] = E.hp[i]! - dmg;
  E.flash[i] = 1;
  E.dmgTaken[i] = E.dmgTaken[i]! + dmg;
  w.stats.dmgDealt += dmg;
  const km = knock / def.mass;
  E.kx[i] = E.kx[i]! + dcos(angle) * km;
  E.ky[i] = E.ky[i]! + dsin(angle) * km;
  w.events.push(Ev.Hit, E.x[i]!, E.y[i]!, angle, def.material, dmg, t, rarity, crit ? 1 : 0);
  if (E.hp[i]! <= 0) {
    if (t === ET.Boss) {
      E.hp[i] = 1;
      w.boss.dying = 3.2;
      w.events.push(Ev.BossDeath, E.x[i]!, E.y[i]!);
      return false;
    }
    killEnemy(w, i, angle, rarity, weapon, -E.hp[i]!);
    return true;
  }
  return false;
}

export function killEnemy(w: World, i: number, angle: number, rarity: number, _weapon: number, overkill: number): void {
  const E = w.enemies;
  const t = E.type[i]! as EnemyType;
  const def = enemyDef(t);
  const x = E.x[i]!;
  const y = E.y[i]!;
  w.events.push(Ev.Kill, x, y, angle, def.material, t, def.r, rarity, overkill);
  w.stats.kills++;
  w.stats.score += def.score;
  w.director.killsRecent += 1;
  w.wave.killedThisWave++;
  const p = w.player;
  if (p.stats.lifesteal > 0 && p.alive) p.hp = Math.min(p.maxHp, p.hp + p.stats.lifesteal);
  if (w.rng.chance(def.drop * w.diff.dropMul)) spawnPickup(w, 0, x, y, 12);
  if (t === ET.Overseer) for (let k = 0; k < w.lanes.count; k++) w.lanes.frozen[k] = 3; // a deliberate gift
  if (t === ET.Press) for (let k = 0; k < w.lanes.count; k++) w.lanes.frozen[k] = 5;
  if (t === ET.Arm) {
    w.events.push(Ev.ArmDown, x, y);
    // the hub raises a shield ring for 3 s whenever it loses an arm (phase 2+)
    for (let k = 0; k < E.hi; k++) {
      if (!E.alive[k] || E.type[k] !== ET.Assembler) continue;
      if (E.hp[k]! / E.maxHp[k]! <= 0.7 && E.shield[k]! <= 0) {
        E.shield[k] = 3;
        w.events.push(Ev.HubShield, E.x[k]!, E.y[k]!, 1);
      }
    }
  }
  const P = w.player;
  if (P.stats.shrapnel > 0 && def.material === Mat.Machine) {
    const n = 2 * P.stats.shrapnel;
    for (let k = 0; k < n; k++) {
      const b = spawnBullet(w, Team.Player, BK.Pellet, x, y, w.rng.range(0, 6.283), 22, 4 * P.stats.dmgMul, 0.12, 0.35, 255, 0, 0, 0, 1, 0);
      if (b >= 0) w.bullets.h0[b] = 0.5;
    }
  }
  if (t === ET.Bloater) {
    // ruptures into a ring of slow acid globs
    const n = 10;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.283185307179586 + E.seed[i]! * 3;
      const b = spawnBullet(w, Team.Enemy, BK.Acid, x, y, a, 6.5 * w.diff.bulletSpeedMul, 9, 0.3, 2.2, 0, 0, 0, 0, 0, 0);
      if (b >= 0) w.bullets.h0[b] = 0.6;
    }
  }
  if (E.affix[i]! & Affix.Volatile) {
    // death nova: ring of slow enemy bullets
    const n = 10;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * 6.283185307179586 + E.seed[i]!;
      spawnBullet(w, Team.Enemy, BK.Acid, x, y, a, 7 * w.diff.bulletSpeedMul, 10, 0.3, 2.5, 0, 0, 0, 0, 0, 0);
    }
    w.events.push(Ev.Explosion, x, y, 2.5, 0.6, Team.Enemy);
  }
  if (w.boss.id === i) w.boss.id = -1;
  if (w.miniBoss === i) w.miniBoss = -1;
  removeEnemy(w, i);
}

/** damage source ids for stats: enemy type for melee/explosions, 20 + bullet kind for shots, 40 laser, 41 slam */
export function hurtPlayer(w: World, dmg: number, fromX: number, fromY: number, src = -1): void {
  const p = w.player;
  if (!p.alive || p.inv > 0 || p.dashT > 0 || w.god) return;
  dmg = Math.min(dmg * w.diff.dmgMul * actRamp(w, ACT_DMG[w.act] ?? 1), p.maxHp * w.diff.maxHit);
  p.hp -= dmg;
  p.inv = 0.6;
  p.hurtT = 1;
  w.stats.dmgTaken += dmg;
  if (src >= 0 && src < w.stats.dmgBy.length) w.stats.dmgBy[src] = w.stats.dmgBy[src]! + dmg;
  w.director.dmgRecent += dmg;
  const a = datan2(p.y - fromY, p.x - fromX);
  p.vx += dcos(a) * 9;
  p.vy += dsin(a) * 9;
  w.events.push(Ev.PlayerHurt, p.x, p.y, dmg, p.hp, a);
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    w.events.push(Ev.PlayerDeath, p.x, p.y);
  }
}

/** Area damage to enemies (player explosions). */
export function explode(w: World, x: number, y: number, radius: number, dmg: number, knock: number, rarity: number, weapon: number): void {
  const E = w.enemies;
  w.events.push(Ev.Explosion, x, y, radius, dmg / 60, Team.Player);
  const n = w.grid.query(x, y, radius + 3, w.qbuf2);
  for (let k = 0; k < n; k++) {
    const i = w.qbuf2[k]!;
    if (!E.alive[i]) continue;
    const dx = E.x[i]! - x;
    const dy = E.y[i]! - y;
    const d = Math.sqrt(dx * dx + dy * dy) - E.r[i]!;
    if (d > radius) continue;
    const f = 1 - Math.max(0, d) / radius;
    damageEnemy(w, i, dmg * (0.4 + 0.6 * f), datan2(dy, dx), knock * f, rarity, weapon, false);
  }
}

/** Pick a spawn position according to placement rule, away from the player. */
export function placeSpawn(w: World, place: Placement, idx: number, out: Float32Array): void {
  const p = w.player;
  const r = w.rng;
  for (let attempt = 0; attempt < 12; attempt++) {
    let x = 0;
    let y = 0;
    switch (place) {
      case 'edge': {
        const side = r.int(4);
        const t = r.range(-0.9, 0.9);
        x = side < 2 ? (side === 0 ? -1 : 1) * (ARENA_HW - 2.5) : t * ARENA_HW;
        y = side >= 2 ? (side === 2 ? -1 : 1) * (ARENA_HH - 2.5) : t * ARENA_HH;
        break;
      }
      case 'corners': {
        const c = (idx + r.int(4)) & 3;
        x = (c & 1 ? 1 : -1) * (ARENA_HW - 4 - r.range(0, 4));
        y = (c & 2 ? 1 : -1) * (ARENA_HH - 4 - r.range(0, 4));
        break;
      }
      case 'ring': {
        const a = r.range(0, 6.283185307179586);
        const d = r.range(11, 16);
        x = p.x + dcos(a) * d;
        y = p.y + dsin(a) * d;
        break;
      }
      case 'lanes': {
        // drop onto a conveyor (falls back to the edge outside the Foundry)
        const L = w.lanes;
        if (L.count === 0) {
          x = r.sym() * (ARENA_HW - 3);
          y = (r.chance(0.5) ? -1 : 1) * (ARENA_HH - 2.5);
          break;
        }
        const k = (idx + r.int(L.count)) % L.count;
        x = L.cx[k]! + r.sym() * L.hw[k]! * 0.8;
        y = L.cy[k]! + r.sym() * L.hh[k]! * 0.8;
        break;
      }
      case 'far': {
        // opposite half of arena from the player
        x = (p.x > 0 ? -1 : 1) * r.range(ARENA_HW * 0.35, ARENA_HW - 3);
        y = r.range(-ARENA_HH + 3, ARENA_HH - 3);
        break;
      }
      default: {
        x = r.range(-ARENA_HW + 3, ARENA_HW - 3);
        y = r.range(-ARENA_HH + 3, ARENA_HH - 3);
      }
    }
    x = Math.max(-ARENA_HW + 2, Math.min(ARENA_HW - 2, x));
    y = Math.max(-ARENA_HH + 2, Math.min(ARENA_HH - 2, y));
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy < 49) continue;
    let blocked = false;
    const P = w.pillars;
    for (let k = 0; k < P.count; k++) {
      const ex = x - P.x[k]!;
      const ey = y - P.y[k]!;
      const rr = P.r[k]! + 1.5;
      if (ex * ex + ey * ey < rr * rr) blocked = true;
    }
    if (blocked) continue;
    out[0] = x;
    out[1] = y;
    return;
  }
  out[0] = 0;
  out[1] = -ARENA_HH + 4;
}
