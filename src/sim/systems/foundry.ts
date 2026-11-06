import { Ev } from '../../core/events';
import { ARENA_HH, ARENA_HW, AS, BK, DT, ET, Mat, MAX_MARKS, MAX_TRACKS } from '../constants';
import { datan2 } from '../../core/detmath';
import { enemyDef } from '../content/enemies';
import type { World } from '../world';
import { damageEnemy, hurtPlayer, killEnemy } from './entities';

/**
 * Литейный цех (Act III) arena machinery. Pure, deterministic per-tick rules:
 *  - conveyor lanes carry ground entities and reverse on a seeded cycle (with a warning window);
 *  - stamp pads cycle idle → mark → stamp (hot) → retract; only stamp frames hurt;
 *  - coolant pools + arc pylons: a shot pylon charges, then arcs into whatever stands in coolant
 *    and chains through conductive targets;
 *  - telegraphed impact marks (stampers, PRESS) and saw tracks.
 */
export const LANE_WARN = 1.5;
/** belt speed: about half the player's run — you feel it, a dash still outruns it */
export const LANE_SPEED = 4.6;
export const PAD_CYCLE = 3.9;
export const PAD_MARK = 2.0;
export const PAD_HOT = 2.8;
export const PAD_RETRACT = 3.1;
export const PAD_DMG = 35;
export const TRACK_ARM = 0.3;
export const TRACK_LIFE = 2.0;
/** pylon accumulator: shots fill it (bullet damage / FILL), it leaks LEAK/s; full → OVERLOAD s → discharge → COOL s */
export const PYLON = { fill: 110, leak: 0.035, overload: 0.8, cool: 5, radius: 11, strikes: 4, dmg: 40, poolRadius: 14, live: 2.5, liveTick: 0.5, liveDmg: 8 } as const;
export const ARC_RANGE = 14;
export const ARC_CHAIN = 6;

/** Ground entities ride conveyors; flyers and anchored giants don't. */
export function riesLanes(type: number): boolean {
  return !(type === ET.Gunner || type === ET.Dart || type === ET.ArcDrone || type === ET.Press || type === ET.Boss || type === ET.Brood || type === ET.Assembler || type === ET.Arm);
}

export function padPhase(w: World, k: number): number {
  const off = w.phys.lockstep ? 0 : w.pads.offset[k]!;
  const t = w.time + off;
  return t - PAD_CYCLE * Math.floor(t / PAD_CYCLE);
}

const visited = new Int32Array(8);

export function updateFoundry(w: World): void {
  updateLanes(w);
  updatePads(w);
  updatePylons(w);
  updateMarks(w);
  updateTracks(w);
  updatePools(w);
}

function updateLanes(w: World): void {
  const L = w.lanes;
  if (L.count === 0) return;
  const period = w.phys.lanePeriod;
  for (let k = 0; k < L.count; k++) {
    if (L.frozen[k]! > 0) {
      L.frozen[k] = L.frozen[k]! - DT;
      continue;
    }
    const t0 = L.t[k]!;
    const t1 = t0 + DT;
    if (t0 < period - LANE_WARN && t1 >= period - LANE_WARN) w.events.push(Ev.LaneWarn, k);
    if (t1 >= period) {
      L.dx[k] = -L.dx[k]!;
      L.dy[k] = -L.dy[k]!;
      L.t[k] = 0;
      w.events.push(Ev.LaneFlip, k);
    } else L.t[k] = t1;
    if (L.inward[k]! > 0) L.inward[k] = L.inward[k]! - DT;
  }
  const step = LANE_SPEED * DT;
  // player (a dash outruns the belt)
  const p = w.player;
  if (p.alive && p.dashT <= 0) {
    const k = L.at(p.x, p.y);
    if (k >= 0) {
      laneDir(w, k, p.x, p.y);
      const dx = ld[0];
      const dy = ld[1];
      p.x = clampX(p.x + dx * step, 0.6);
      p.y = clampY(p.y + dy * step, 0.6);
    }
  }
  const E = w.enemies;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.st[i] === AS.Spawning || E.st[i] === AS.Underground || E.st[i] === AS.Attached) continue;
    if (!riesLanes(E.type[i]!)) continue;
    const k = L.at(E.x[i]!, E.y[i]!);
    if (k < 0) continue;
    laneDir(w, k, E.x[i]!, E.y[i]!);
    const dx = ld[0];
    const dy = ld[1];
    E.x[i] = clampX(E.x[i]! + dx * step, E.r[i]!);
    E.y[i] = clampY(E.y[i]! + dy * step, E.r[i]!);
  }
  // slow projectiles (mortar shells, singularity) ride the belt too; fast shots stay readable
  const B = w.bullets;
  for (let i = 0; i < B.hi; i++) {
    if (!B.alive[i] || (B.kind[i] !== BK.Grenade && B.kind[i] !== BK.Orb)) continue;
    const k = L.at(B.x[i]!, B.y[i]!);
    if (k < 0) continue;
    laneDir(w, k, B.x[i]!, B.y[i]!);
    const dx = ld[0];
    const dy = ld[1];
    B.x[i] = B.x[i]! + dx * step;
    B.y[i] = B.y[i]! + dy * step;
  }
}

const ld: [number, number] = [0, 0];
/** lane push direction (inward mode points along the lane axis toward the arena centre) */
export function laneDir(w: World, k: number, x: number, y: number): [number, number] {
  const L = w.lanes;
  if (L.inward[k]! > 0) {
    if (L.hw[k]! > L.hh[k]!) {
      ld[0] = x > 0 ? -1 : 1;
      ld[1] = 0;
    } else {
      ld[0] = 0;
      ld[1] = y > 0 ? -1 : 1;
    }
    return ld;
  }
  ld[0] = L.dx[k]!;
  ld[1] = L.dy[k]!;
  return ld;
}

function updatePads(w: World): void {
  const D = w.pads;
  const p = w.player;
  const E = w.enemies;
  for (let k = 0; k < D.count; k++) {
    const ph = padPhase(w, k);
    const prev = ph - DT;
    if (prev < PAD_MARK && ph >= PAD_MARK) w.events.push(Ev.PadWarn, D.x[k]!, D.y[k]!);
    const hot = ph >= PAD_HOT && ph < PAD_RETRACT;
    if (!hot) continue;
    const entering = prev < PAD_HOT;
    const x = D.x[k]!;
    const y = D.y[k]!;
    if (entering) {
      w.events.push(Ev.PadStamp, x, y);
      // crush: lethal to Gear Mites, a heavy hit for other walkers
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i] || E.st[i] === AS.Spawning || E.st[i] === AS.Underground) continue;
        if (Math.abs(E.x[i]! - x) > 1 + E.r[i]! * 0.5 || Math.abs(E.y[i]! - y) > 1 + E.r[i]! * 0.5) continue;
        const t = E.type[i]!;
        if (t === ET.GearMite || t === ET.Swarmer || t === ET.Parasite) killEnemy(w, i, 0, 0, 255, 50);
        else if (riesLanes(t) && t !== ET.Stamper) damageEnemy(w, i, 30, 0, 0, 0, 255, false);
      }
    }
    if (p.alive && Math.abs(p.x - x) < 1 + p.r * 0.6 && Math.abs(p.y - y) < 1 + p.r * 0.6) hurtPlayer(w, PAD_DMG, x, y, 50);
  }
}

function updatePylons(w: World): void {
  const Y = w.pylons;
  const P = w.pillars;
  for (let k = 0; k < Y.count; k++) {
    const pi = Y.pillar[k]!;
    const x = P.x[pi]!;
    const y = P.y[pi]!;
    if (Y.state[k] === 0) {
      if (Y.charge[k]! >= 1) {
        Y.state[k] = 1;
        Y.timer[k] = PYLON.overload;
        w.events.push(Ev.Overload, x, y, PYLON.radius, PYLON.overload);
      } else Y.charge[k] = Math.max(0, Y.charge[k]! - PYLON.leak * DT);
    } else if (Y.state[k] === 1) {
      Y.timer[k] = Y.timer[k]! - DT;
      if (Y.timer[k]! <= 0) {
        dischargePylon(w, x, y);
        Y.state[k] = 2;
        Y.timer[k] = PYLON.cool;
        Y.charge[k] = 0;
      }
    } else {
      Y.timer[k] = Y.timer[k]! - DT;
      if (Y.timer[k]! <= 0) Y.state[k] = 0;
    }
  }
}

/** a shot fed pylon `pillarIndex` (called from bullet / rail collision) */
export function chargePylon(w: World, pillarIndex: number, dmg = 10): void {
  const Y = w.pylons;
  for (let k = 0; k < Y.count; k++) {
    if (Y.pillar[k] !== pillarIndex || Y.state[k] !== 0) continue;
    Y.charge[k] = Math.min(1, Y.charge[k]! + dmg / PYLON.fill);
    w.events.push(Ev.PylonCharge, w.pillars.x[pillarIndex]!, w.pillars.y[pillarIndex]!, Y.charge[k]!);
  }
}

const strikeIdx = new Int32Array(16);
const strikeD = new Float32Array(16);
/**
 * Discharge: arcs strike the nearest enemies within PYLON.radius (4 + Дуговая цепь, each may chain
 * once to a machine), and every coolant pool within PYLON.poolRadius goes live for PYLON.live s.
 */
function dischargePylon(w: World, x: number, y: number): void {
  const E = w.enemies;
  const n0 = PYLON.strikes + w.player.stats.arcChain;
  let n = 0;
  const R2 = PYLON.radius * PYLON.radius;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.st[i] === AS.Spawning || E.st[i] === AS.Underground) continue;
    const dx = E.x[i]! - x;
    const dy = E.y[i]! - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > R2) continue;
    // keep the n0 nearest (insertion into a tiny sorted list)
    let at = n < n0 ? n : -1;
    if (at < 0 && d2 < strikeD[n0 - 1]!) at = n0 - 1;
    if (at < 0) continue;
    while (at > 0 && strikeD[at - 1]! > d2) {
      strikeD[at] = strikeD[at - 1]!;
      strikeIdx[at] = strikeIdx[at - 1]!;
      at--;
    }
    strikeD[at] = d2;
    strikeIdx[at] = i;
    if (n < n0) n++;
  }
  for (let s = 0; s < n; s++) {
    const i = strikeIdx[s]!;
    if (!E.alive[i]) continue;
    w.events.push(Ev.Arc, x, y, E.x[i]!, E.y[i]!, 0);
    const ex = E.x[i]!;
    const ey = E.y[i]!;
    shortEnemy(w, i);
    damageEnemy(w, i, PYLON.dmg, datan2(ey - y, ex - x), 4, 1, 255, false);
    // chain once to the nearest other machine
    let best = -1;
    let bd = ARC_CHAIN * ARC_CHAIN;
    for (let j = 0; j < E.hi; j++) {
      if (j === i || !E.alive[j] || E.st[j] === AS.Spawning || E.st[j] === AS.Underground) continue;
      if (enemyDef(E.type[j]!).material !== Mat.Machine) continue;
      const dx = E.x[j]! - ex;
      const dy = E.y[j]! - ey;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) {
        bd = d2;
        best = j;
      }
    }
    if (best >= 0) {
      w.events.push(Ev.Arc, ex, ey, E.x[best]!, E.y[best]!, 0);
      shortEnemy(w, best);
      damageEnemy(w, best, PYLON.dmg * 0.5, 0, 0, 1, 255, false);
    }
  }
  // electrify nearby coolant
  const PO = w.pools;
  for (let k = 0; k < PO.count; k++) {
    const dx = PO.x[k]! - x;
    const dy = PO.y[k]! - y;
    if (dx * dx + dy * dy > PYLON.poolRadius * PYLON.poolRadius) continue;
    PO.live[k] = PYLON.live;
    w.events.push(Ev.Arc, x, y, PO.x[k]!, PO.y[k]!, 0);
    w.events.push(Ev.PoolLive, PO.x[k]!, PO.y[k]!, PO.r[k]!);
  }
  w.events.push(Ev.Discharge, x, y, PYLON.radius, n);
}

export function arcFrom(w: World, x: number, y: number, range: number, chain: number, dmg: number, poolOnlyFirst: boolean): number {
  const E = w.enemies;
  const p = w.player;
  let cx = x;
  let cy = y;
  let n = 0;
  let hitPlayer = false;
  for (let link = 0; link <= chain; link++) {
    const r = link === 0 ? range : ARC_CHAIN;
    let best = -2;
    let bd = r * r;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.st[i] === AS.Spawning || E.st[i] === AS.Underground) continue;
      let seen = false;
      for (let v = 0; v < n; v++) if (visited[v] === i) seen = true;
      if (seen) continue;
      const inPool = w.pools.at(E.x[i]!, E.y[i]!) >= 0;
      const conductive = inPool || (!(link === 0 && poolOnlyFirst) && enemyDef(E.type[i]!).material === Mat.Machine);
      if (!conductive) continue;
      const dx = E.x[i]! - cx;
      const dy = E.y[i]! - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) {
        bd = d2;
        best = i;
      }
    }
    if (!hitPlayer && p.alive && w.pools.at(p.x, p.y) >= 0) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      if (dx * dx + dy * dy < bd) best = -1;
    }
    if (best === -2) break;
    if (best === -1) {
      w.events.push(Ev.Arc, cx, cy, p.x, p.y, 1);
      cx = p.x;
      cy = p.y;
      hitPlayer = true;
      if (!p.stats.insulated) hurtPlayer(w, 12, cx, cy, 51);
      continue;
    }
    w.events.push(Ev.Arc, cx, cy, E.x[best]!, E.y[best]!, 0);
    cx = E.x[best]!;
    cy = E.y[best]!;
    if (n < visited.length) visited[n++] = best;
    shortEnemy(w, best);
    damageEnemy(w, best, dmg, 0, 0, 1, 255, false);
  }
  if (n === 0 && !hitPlayer) w.events.push(Ev.Arc, x, y, x, y, 0); // fizzle
  return n;
}

export function shortEnemy(w: World, i: number, seconds?: number): void {
  const E = w.enemies;
  if (!E.alive[i]) return;
  const t = E.type[i]!;
  if (t === ET.Press || t === ET.Assembler || t === ET.Boss) return;
  const machine = enemyDef(t).material === Mat.Machine;
  E.shortT[i] = Math.max(E.shortT[i]!, seconds ?? (machine ? 1.2 : 0.6));
  E.charge[i] = 0;
  w.events.push(Ev.Shorted, E.x[i]!, E.y[i]!);
}

function updateMarks(w: World): void {
  const M = w.marks;
  const p = w.player;
  const E = w.enemies;
  for (let i = 0; i < Math.min(M.hi, MAX_MARKS); i++) {
    if (!M.alive[i]) continue;
    const t0 = M.t[i]!;
    const t1 = t0 + DT;
    M.t[i] = t1;
    const fill = M.fill[i]!;
    if (t1 >= fill + M.hot[i]!) {
      M.alive[i] = 0;
      continue;
    }
    if (t1 < fill) continue;
    if (t0 < fill) {
      w.events.push(Ev.MarkHit, M.x[i]!, M.y[i]!, M.r[i]!, M.square[i]!);
      for (let e = 0; e < E.hi; e++) {
        if (!E.alive[e] || E.st[e] === AS.Spawning || E.st[e] === AS.Underground) continue;
        const t = E.type[e]!;
        if (t !== ET.GearMite && t !== ET.Swarmer) continue;
        if (M.inside(i, E.x[e]!, E.y[e]!)) killEnemy(w, e, 0, 0, 255, 30);
      }
    }
    if (p.alive && M.inside(i, p.x, p.y, p.r * 0.5)) hurtPlayer(w, M.dmg[i]!, M.x[i]!, M.y[i]!, M.src[i]!);
  }
}

function updateTracks(w: World): void {
  const T = w.tracks;
  const p = w.player;
  for (let i = 0; i < MAX_TRACKS; i++) {
    if (!T.alive[i]) continue;
    const a = (T.age[i] = T.age[i]! + DT);
    if (a >= TRACK_LIFE) {
      T.alive[i] = 0;
      continue;
    }
    if (a < TRACK_ARM || !p.alive) continue;
    const ax = T.x0[i]!;
    const ay = T.y0[i]!;
    const bx = T.x1[i]!;
    const by = T.y1[i]!;
    const abx = bx - ax;
    const aby = by - ay;
    const l2 = abx * abx + aby * aby;
    let t = l2 > 0 ? ((p.x - ax) * abx + (p.y - ay) * aby) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = ax + abx * t - p.x;
    const dy = ay + aby * t - p.y;
    if (dx * dx + dy * dy < 0.8 * 0.8) hurtPlayer(w, 10, p.x, p.y, 53);
  }
}

function updatePools(w: World): void {
  const P = w.pools;
  // live (electrified) coolant: ticks damage + shorts on everything standing in it
  const E = w.enemies;
  const p = w.player;
  for (let k = 0; k < P.count; k++) {
    const L0 = P.live[k]!;
    if (L0 <= 0) continue;
    const L1 = Math.max(0, L0 - DT);
    P.live[k] = L1;
    const tick = Math.floor(L0 / PYLON.liveTick) !== Math.floor(L1 / PYLON.liveTick) || L1 === 0;
    if (!tick || L1 === 0) continue;
    const r2 = P.r[k]! * P.r[k]!;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.st[i] === AS.Spawning || E.st[i] === AS.Underground) continue;
      const dx = E.x[i]! - P.x[k]!;
      const dy = E.y[i]! - P.y[k]!;
      if (dx * dx + dy * dy > r2) continue;
      shortEnemy(w, i, 0.6);
      damageEnemy(w, i, PYLON.liveDmg, 0, 0, 1, 255, false);
    }
    if (p.alive && !p.stats.insulated) {
      const dx = p.x - P.x[k]!;
      const dy = p.y - P.y[k]!;
      if (dx * dx + dy * dy < r2) hurtPlayer(w, PYLON.liveDmg, P.x[k]!, P.y[k]!, 51);
    }
  }
  for (let k = P.count - 1; k >= 0; k--) {
    if (P.life[k]! < 0) continue;
    P.life[k] = P.life[k]! - DT;
    if (P.life[k]! <= 0) P.remove(k);
  }
  if (!w.phys.flood) return;
  w.floodT += DT;
  if (w.floodT < 8) return;
  w.floodT = 0;
  let dyn = 0;
  for (let k = 0; k < P.count; k++) if (P.life[k]! >= 0) dyn++;
  if (dyn >= 5) return;
  for (let tries = 0; tries < 8; tries++) {
    const x = w.rng.range(-ARENA_HW + 4, ARENA_HW - 4);
    const y = w.rng.range(-ARENA_HH + 4, ARENA_HH - 4);
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy < 6.5 * 6.5) continue; // never within 4 u (+radius) of the player
    P.add(x, y, 2.5, 6);
    return;
  }
}

/** Magnetic rounds: player shots lock onto the first machine within 6 u and curve ≤ 15°/s. */
export function magneticSteer(w: World, i: number): void {
  const B = w.bullets;
  const E = w.enemies;
  let tgt = B.homing[i]!;
  if (tgt < 0) {
    const n = w.grid.query(B.x[i]!, B.y[i]!, 6, w.qbuf2);
    let bd = 36;
    for (let k = 0; k < n; k++) {
      const e = w.qbuf2[k]!;
      if (!E.alive[e] || enemyDef(E.type[e]!).material !== Mat.Machine) continue;
      const dx = E.x[e]! - B.x[i]!;
      const dy = E.y[e]! - B.y[i]!;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) {
        bd = d2;
        tgt = e;
      }
    }
    if (tgt < 0) return;
    B.homing[i] = tgt;
  }
  if (!E.alive[tgt]) return;
  const vx = B.vx[i]!;
  const vy = B.vy[i]!;
  const sp = Math.sqrt(vx * vx + vy * vy);
  if (sp < 0.01) return;
  const tx = E.x[tgt]! - B.x[i]!;
  const ty = E.y[tgt]! - B.y[i]!;
  const cross = vx * ty - vy * tx;
  const maxTurn = (15 * Math.PI) / 180 * DT;
  const ang = cross > 0 ? maxTurn : -maxTurn;
  // rotate by ±maxTurn (small-angle exact rotation)
  const c = 1 - (ang * ang) / 2;
  const s = ang;
  B.vx[i] = vx * c - vy * s;
  B.vy[i] = vx * s + vy * c;
}

function clampX(x: number, m: number): number {
  return Math.max(-ARENA_HW + m, Math.min(ARENA_HW - m, x));
}
function clampY(y: number, m: number): number {
  return Math.max(-ARENA_HH + m, Math.min(ARENA_HH - m, y));
}

