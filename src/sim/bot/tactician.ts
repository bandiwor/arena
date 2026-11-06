import { AS, Btn, ET, Mat, MAX_MARKS, MAX_TRACKS, Team, WP } from '../constants';
import { enemyDef } from '../content/enemies';
import { UPGRADES } from '../content/upgrades';
import { weaponDef } from '../content/weapons';
import { hasLOS } from '../systems/physics';
import { PAD_CYCLE, PAD_HOT, PAD_MARK, PAD_RETRACT, padPhase, PYLON, TRACK_ARM, TRACK_LIFE } from '../systems/foundry';
import type { InputCmd } from '../input';
import { WavePhase, type World } from '../world';

/**
 * «Тактик» — a deliberate bot. Every `reaction` ticks it re-reads the arena and decides; between
 * decisions it keeps its plan (human-like). It never cheats: everything it uses is visible on screen.
 *
 *  MOVE    a danger map: 16 directions + standing still are rolled forward 0.15 / 0.3 / 0.5 s and
 *          scored against predicted bullets, telegraphed zones (marks, pads, mounds, swells, sweeps),
 *          attack lanes (charges, dives, arrows, hooks, arcs), lasers, saw tracks, live coolant,
 *          melee bodies, walls and belts — plus a range preference set by the current weapon.
 *  DASH    a resource: kept for unavoidable hits (the best step still lands in danger), escapes
 *          (hook pull, latched parasite, mound under the feet, being surrounded). Never wasted on
 *          travel while hurt; dashes through the safest direction, not just away.
 *  TARGET  threat-ranked: enemies winding up a shot, parasites, the Overseer, bloaters closing in,
 *          then whatever dies fastest; sticky (switches only for a clearly better target); flanks a
 *          raised shield; feeds a charged pylon when a crowd stands around it.
 *  WEAPON  scored for the situation (crowd close/far, clusters, armour, bosses, machines, lines)
 *          with hysteresis: holds a weapon ≥ `hold` s and switches only for a ≥ 25% better fit;
 *          the 0.12 s switch penalty and the shared fire cooldown are respected.
 */
export interface TacticianOpts {
  /** decision interval in ticks (≈ reaction time) */
  reaction?: number;
  /** aim error in radians (σ-ish) */
  aimJitter?: number;
  /** minimum seconds between weapon switches */
  hold?: number;
}

const DIRS = 16;
const TAUS = [0.15, 0.3, 0.5] as const;
const CAND_X = new Float32Array(DIRS + 1);
const CAND_Y = new Float32Array(DIRS + 1);
for (let k = 0; k < DIRS; k++) {
  CAND_X[k] = Math.cos((k / DIRS) * Math.PI * 2);
  CAND_Y[k] = Math.sin((k / DIRS) * Math.PI * 2);
}
CAND_X[DIRS] = 0;
CAND_Y[DIRS] = 0;

const MELEE = new Set<number>([ET.Swarmer, ET.Charger, ET.Bloater, ET.Dart, ET.Parasite, ET.Worm, ET.GearMite, ET.Skiff, ET.Stamper, ET.Arm, ET.Brood, ET.Assembler]);
const SMALL = new Set<number>([ET.Swarmer, ET.Dart, ET.Parasite, ET.GearMite, ET.Worm]);

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + dx * t - px;
  const cy = ay + dy * t - py;
  return cx * cx + cy * cy;
}

/** danger of standing at (x, y) τ seconds from now */
function danger(w: World, x: number, y: number, tau: number): number {
  const p = w.player;
  const pr = p.r;
  let c = 0;
  // ── enemy projectiles (where each will be at τ)
  const B = w.bullets;
  for (let b = 0; b < B.hi; b++) {
    if (!B.alive[b] || B.team[b] !== Team.Enemy) continue;
    const bx = B.x[b]! + B.vx[b]! * tau;
    const by = B.y[b]! + B.vy[b]! * tau;
    const dx = bx - x;
    const dy = by - y;
    const rr = B.r[b]! + pr + 0.45;
    const d2 = dx * dx + dy * dy;
    if (d2 < rr * rr) c += 70 * (1 - Math.sqrt(d2) / rr) + 25;
    else if (d2 < (rr + 1) * (rr + 1)) c += 4;
  }
  // ── telegraphed marks (stampers, PRESS, overseer) and stamp pads
  const M = w.marks;
  for (let i = 0; i < Math.min(M.hi, MAX_MARKS); i++) {
    if (!M.alive[i]) continue;
    const tHit = M.fill[i]! - M.t[i]!; // <0: hot now
    if (tHit > tau + 0.35) continue;
    const pad = 0.5;
    if (M.inside(i, x, y, pad)) c += tHit <= 0 ? 90 : 70;
  }
  const D = w.pads;
  for (let k = 0; k < D.count; k++) {
    if (Math.abs(x - D.x[k]!) > 1.6 || Math.abs(y - D.y[k]!) > 1.6) continue;
    const ph = padPhase(w, k) + tau;
    const cyc = ph % PAD_CYCLE;
    if (cyc >= PAD_MARK - 0.2 && cyc < PAD_RETRACT + 0.1) c += cyc >= PAD_HOT - 0.15 ? 90 : 25;
  }
  // ── saw tracks (armed or arming soon)
  const T = w.tracks;
  for (let i = 0; i < MAX_TRACKS; i++) {
    if (!T.alive[i]) continue;
    const a = T.age[i]! + tau;
    if (a < TRACK_ARM - 0.1 || a >= TRACK_LIFE) continue;
    if (segDist2(x, y, T.x0[i]!, T.y0[i]!, T.x1[i]!, T.y1[i]!) < 1.0) c += 35;
  }
  // ── live coolant / coolant next to an overloading pylon
  const PO = w.pools;
  if (!p.stats.insulated) {
    for (let k = 0; k < PO.count; k++) {
      const dx = x - PO.x[k]!;
      const dy = y - PO.y[k]!;
      const r = PO.r[k]! + 0.4;
      if (dx * dx + dy * dy > r * r) continue;
      if (PO.live[k]! > tau) c += 45;
      else if (w.act === 2) {
        for (let q = 0; q < w.pylons.count; q++) if (w.pylons.state[q] === 1) c += 30;
      }
    }
  }
  // ── lasers
  const L = w.lasers;
  for (let k = 0; k < L.alive.length; k++) {
    if (!L.alive[k]) continue;
    const a = L.ang[k]! + L.angVel[k]! * tau;
    const ex = L.x[k]! + Math.cos(a) * L.len[k]!;
    const ey = L.y[k]! + Math.sin(a) * L.len[k]!;
    const wdt = L.width[k]! + pr + 0.6;
    if (segDist2(x, y, L.x[k]!, L.y[k]!, ex, ey) < wdt * wdt) c += L.warm[k]! > tau + 0.2 ? 15 : 110;
  }
  // ── enemies: bodies, wind-ups and attack lanes
  const E = w.enemies;
  for (let i = 0; i < E.hi; i++) {
    if (!E.alive[i] || E.st[i] === AS.Spawning) continue;
    const t = E.type[i]!;
    const st = E.st[i]!;
    const ex = E.x[i]! + E.vx[i]! * tau * 0.7;
    const ey = E.y[i]! + E.vy[i]! * tau * 0.7;
    const dx = x - ex;
    const dy = y - ey;
    const d = Math.sqrt(dx * dx + dy * dy);
    const ch = E.charge[i]!;
    // underground worm: the mound bites from below
    if (t === ET.Worm && st === AS.Windup) {
      if (d < 2.4) c += 30 + ch * 70;
      continue;
    }
    if (st === AS.Underground) continue;
    // swelling bloater
    if (t === ET.Bloater && st === AS.Windup && d < 4.0) c += 40 + ch * 50;
    // area sweeps (arm, brood contraction, hauler clamp)
    if (t === ET.Arm && st === AS.Windup && d < E.r[i]! + 3.6) c += 60;
    if (t === ET.Brood && E.ty[i]! > 0 && d < E.r[i]! + 3) c += 60;
    if (t === ET.Hauler && E.burst[i] === 2 && d < 2.9) c += 70;
    // attack lanes: charges, dives, arrows, hooks, arcs, gunner bursts
    if (st === AS.Windup || st === AS.Dash || st === AS.Leap) {
      let len = 0;
      let wid = 0;
      let a = E.aim[i]!;
      if (t === ET.Charger) [len, wid] = [15, E.r[i]! + 1.2];
      else if (t === ET.Dart) [len, wid] = [10, 1.1];
      else if (t === ET.Archer && ch > 0.5) [len, wid] = [26, 0.9];
      else if (t === ET.Hauler) [len, wid] = [9.5, 1.2];
      else if (t === ET.GearMite) [len, wid, a] = [9, 0.9, E.face[i]!];
      else if (t === ET.Gunner) [len, wid, a] = [20, 0.9, E.face[i]!];
      else if (t === ET.Swarmer || t === ET.Parasite) [len, wid, a] = [5, 0.9, E.face[i]!];
      else if (t === ET.ArcDrone) {
        a = Math.atan2(E.ty[i]! - E.y[i]!, E.tx[i]! - E.x[i]!);
        [len, wid] = [10, 1.1];
      }
      if (len > 0) {
        const lx = Math.cos(a);
        const ly = Math.sin(a);
        const rx = x - E.x[i]!;
        const ry = y - E.y[i]!;
        const along = rx * lx + ry * ly;
        const side = Math.abs(rx * -ly + ry * lx);
        if (along > -0.5 && along < len && side < wid + pr) c += 30 + ch * 45;
      }
    }
    // bodies: melee creatures want contact — keep a buffer, more for heavy hitters
    if (MELEE.has(t)) {
      const buf = E.r[i]! + pr + (t === ET.Charger || t === ET.Skiff ? 2.4 : 1.6);
      if (d < buf) c += (buf - d) * (t === ET.Brood || t === ET.Assembler ? 30 : 16);
    } else if (d < E.r[i]! + pr + 0.6) c += 10;
  }
  return c;
}

interface Ctx {
  close: number;
  mid: number;
  small: number;
  machines: number;
  heavy: number;
  boss: boolean;
  cluster: number;
  lineHits: number;
  shieldFront: boolean;
  total: number;
}

/** how good is weapon `id` right now (1 = average) */
function weaponScore(id: number, c: Ctx, targetD: number): number {
  if (c.total === 0) return id === WP.Pulse ? 1 : 0.8;
  switch (id) {
    case WP.Pulse:
      return 1;
    case WP.Scatter:
      return targetD < 6.5 || c.close >= 3 ? 1.75 : targetD > 10 ? 0.45 : 0.95;
    case WP.Needler:
      return c.small >= 5 ? 1.45 : c.total >= 6 ? 1.2 : 0.95;
    case WP.Launcher:
      return targetD < 4 ? 0.4 : c.cluster >= 3 ? 1.8 : c.cluster >= 2 ? 1.25 : 0.75;
    case WP.Rail:
      return c.boss ? 1.9 : c.lineHits >= 3 ? 1.85 : c.shieldFront || c.heavy >= 2 ? 1.6 : c.small >= 6 ? 0.8 : 1.15;
    case WP.ArcRail:
      return c.machines >= 3 ? 1.75 : c.machines >= 1 ? 1.3 : 0.9;
    case WP.Singularity:
      return c.cluster >= 5 || (c.boss && c.total >= 4) ? 2.2 : c.cluster >= 3 ? 1.3 : 0.5;
  }
  return 1;
}

export function tactician(o: TacticianOpts = {}): (w: World, tick: number, c: InputCmd) => void {
  const reaction = o.reaction ?? 6;
  const jitter = o.aimJitter ?? 0.03;
  const hold = o.hold ?? 2.2;
  let last = -1e9;
  let mx = 0;
  let my = 0;
  let prevK = DIRS;
  let target = -1;
  let targetGen = -1;
  let pylonAim = -1;
  let lastSwitch = -1e9;
  let wantSlot = -1;
  let orbit = 1;
  let dashQ = false;
  // tiny deterministic noise for aim error
  let seed = 0x9e3779b9;
  const rnd = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) / 4294967296) * 2 - 1;
  };

  return (w: World, tick: number, c: InputCmd): void => {
    const p = w.player;
    const E = w.enemies;
    if (!p.alive) return;
    // upgrades: decided like a player who knows the build
    if (w.wave.phase === WavePhase.Upgrade) {
      if (w.wave.t > 0.35) c.btn |= (pickUpgrade(w) + 1) << Btn.PickShift;
      return;
    }
    const wd = weaponDef(p.slots[p.cur]!);
    if (tick - last >= reaction) {
      last = tick;
      if (tick % 300 === 0) orbit = -orbit;
      // ── situation
      const ctx: Ctx = { close: 0, mid: 0, small: 0, machines: 0, heavy: 0, boss: false, cluster: 0, lineHits: 0, shieldFront: false, total: 0 };
      let best = -1;
      let bestS = -1;
      let curS = -1;
      for (let i = 0; i < E.hi; i++) {
        if (!E.alive[i] || E.st[i] === AS.Spawning || E.st[i] === AS.Underground) continue;
        const t = E.type[i]!;
        const dx = E.x[i]! - p.x;
        const dy = E.y[i]! - p.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        ctx.total++;
        if (d < 6) ctx.close++;
        else if (d < 14) ctx.mid++;
        if (SMALL.has(t)) ctx.small++;
        const def = enemyDef(t);
        if (def.material === Mat.Machine) ctx.machines++;
        if (E.maxHp[i]! >= 120) ctx.heavy++;
        if (t === ET.Boss || t === ET.Brood || t === ET.Press || t === ET.Assembler) ctx.boss = true;
        // threat ranking
        let s = 10 / (d + 3);
        const st = E.st[i]!;
        if (st === AS.Windup) s *= t === ET.Archer || t === ET.Gunner || t === ET.ArcDrone || t === ET.Hauler ? 3.2 : 1.8;
        if (t === ET.Parasite) s *= E.st[i] === AS.Attached && (E.tx[i]! | 0) === -1 ? 6 : 2;
        if (t === ET.Overseer) s *= 2.4;
        if (t === ET.Bloater && d < 7) s *= 1.8;
        if (t === ET.Arm || t === ET.Assembler) s *= E.shield[i]! > 0 && t === ET.Assembler ? 0.05 : 1.2;
        s *= 1 + (1 - E.hp[i]! / E.maxHp[i]!) * 0.6; // finish what's hurt
        if (!hasLOS(w, p.x, p.y, E.x[i]!, E.y[i]!)) s *= 0.25;
        if (t === ET.Shielder && E.shield[i]! > 0) {
          const f = E.face[i]!;
          if (Math.cos(f) * -dx + Math.sin(f) * -dy > 0.35 * d && wd.pierce < 3) s *= 0.3;
        }
        if (i === target && E.gen[i] === targetGen) curS = s;
        if (s > bestS) {
          bestS = s;
          best = i;
        }
      }
      // sticky target: only switch for a clearly better one
      if (!(curS > 0 && curS * 1.3 >= bestS)) {
        target = best;
        targetGen = best >= 0 ? E.gen[best]! : -1;
      }
      if (target >= 0) {
        const tx = E.x[target]!;
        const ty = E.y[target]!;
        for (let j = 0; j < E.hi; j++) {
          if (!E.alive[j] || E.st[j] === AS.Spawning || E.st[j] === AS.Underground) continue;
          const dx = E.x[j]! - tx;
          const dy = E.y[j]! - ty;
          if (dx * dx + dy * dy < 3.5 * 3.5) ctx.cluster++;
          if (segDist2(E.x[j]!, E.y[j]!, p.x, p.y, p.x + (tx - p.x) * 3, p.y + (ty - p.y) * 3) < 0.8) ctx.lineHits++;
        }
        const t = E.type[target]!;
        if (t === ET.Shielder && E.shield[target]! > 0) ctx.shieldFront = true;
      }
      // ── feed a charged pylon when a crowd stands around it
      pylonAim = -1;
      const Y = w.pylons;
      for (let k = 0; k < Y.count; k++) {
        if (Y.state[k] !== 0 || Y.charge[k]! < 0.35) continue;
        const pi = Y.pillar[k]!;
        const px = w.pillars.x[pi]!;
        const py = w.pillars.y[pi]!;
        let n = 0;
        for (let j = 0; j < E.hi; j++) {
          if (!E.alive[j] || E.st[j] === AS.Spawning) continue;
          const dx = E.x[j]! - px;
          const dy = E.y[j]! - py;
          if (dx * dx + dy * dy < PYLON.radius * PYLON.radius * 0.7) n++;
        }
        const dx = px - p.x;
        const dy = py - p.y;
        if (n >= 3 && dx * dx + dy * dy < 20 * 20 && hasLOS(w, p.x, p.y, px - Math.sign(dx) * 0.9, py - Math.sign(dy) * 0.9)) pylonAim = pi;
      }
      // ── weapon choice (with hysteresis and hold time)
      const td = target >= 0 ? Math.hypot(E.x[target]! - p.x, E.y[target]! - p.y) : 99;
      const curScore = weaponScore(p.slots[p.cur]!, ctx, td);
      let bestSlot = p.cur;
      let bestW = curScore;
      for (let s = 0; s < p.slotCount; s++) {
        const sc = weaponScore(p.slots[s]!, ctx, td);
        if (sc > bestW) {
          bestW = sc;
          bestSlot = s;
        }
      }
      const held = (tick - lastSwitch) / 60;
      wantSlot = bestSlot !== p.cur && bestW >= curScore * 1.25 && held >= hold && p.dashT <= 0 ? bestSlot : -1;

      // ── movement: score candidates on the danger map
      const speed = 9.5 * p.stats.speedMul * w.phys.playerSpeed;
      // preferred range for this weapon
      const want = wd.id === WP.Scatter ? 5 : wd.id === WP.Rail || wd.id === WP.ArcRail ? 13 : wd.id === WP.Launcher ? 10 : 9;
      let bk = DIRS;
      let bc = 1e9;
      for (let k = 0; k <= DIRS; k++) {
        let cost = 0;
        for (let q = 0; q < TAUS.length; q++) {
          const tau = TAUS[q]!;
          let x = p.x + CAND_X[k]! * speed * tau;
          let y = p.y + CAND_Y[k]! * speed * tau;
          // belts carry us
          const ln = w.lanes.at(x, y);
          if (ln >= 0) {
            x += w.lanes.dx[ln]! * 4.6 * tau;
            y += w.lanes.dy[ln]! * 4.6 * tau;
          }
          cost += danger(w, x, y, tau) * (q === 0 ? 1.4 : q === 1 ? 1 : 0.6);
        }
        // walls and corners (also: pinned against a wall = no escape)
        const ex = p.x + CAND_X[k]! * speed * 0.5;
        const ey = p.y + CAND_Y[k]! * speed * 0.5;
        const wx = Math.max(0, Math.abs(ex) - 30);
        const wy = Math.max(0, Math.abs(ey) - 18);
        cost += (wx * wx + wy * wy) * 6;
        // range preference + orbit around the target
        if (target >= 0) {
          const dx = E.x[target]! - ex;
          const dy = E.y[target]! - ey;
          const d = Math.sqrt(dx * dx + dy * dy);
          cost += Math.abs(d - want) * 1.2;
          const tx = -dy * orbit;
          const ty = dx * orbit;
          cost -= ((CAND_X[k]! * tx + CAND_Y[k]! * ty) / (d || 1)) * 1.5;
          if (!hasLOS(w, ex, ey, E.x[target]!, E.y[target]!)) cost += 6;
        }
        // stability: keep the current plan unless something is clearly better
        if (k === prevK) cost -= 2.5;
        if (cost < bc) {
          bc = cost;
          bk = k;
        }
      }
      prevK = bk;
      mx = CAND_X[bk]!;
      my = CAND_Y[bk]!;

      // ── dash economy
      dashQ = false;
      if (p.dashCd <= 0 && p.dashT <= 0) {
        const nowDanger = danger(w, p.x + CAND_X[bk]! * speed * 0.15, p.y + CAND_Y[bk]! * speed * 0.15, 0.15);
        let surrounded = 0;
        let latched = false;
        for (let i = 0; i < E.hi; i++) {
          if (!E.alive[i]) continue;
          if (E.type[i] === ET.Parasite && E.st[i] === AS.Attached && (E.tx[i]! | 0) === -1) latched = true;
          if (!MELEE.has(E.type[i]!) || E.st[i] === AS.Spawning || E.st[i] === AS.Underground) continue;
          const dx = E.x[i]! - p.x;
          const dy = E.y[i]! - p.y;
          if (dx * dx + dy * dy < 9) surrounded++;
        }
        const must = nowDanger >= 60 || p.pullT > 0 || latched || surrounded >= 4;
        if (must) {
          // dash where the landing (~5 u away, after 0.17 s) is safest
          let dk = bk;
          let dc = 1e9;
          for (let k = 0; k < DIRS; k++) {
            const x = p.x + CAND_X[k]! * 5.1;
            const y = p.y + CAND_Y[k]! * 5.1;
            let cost = danger(w, x, y, 0.2) + danger(w, x, y, 0.45) * 0.6;
            const wx = Math.max(0, Math.abs(x) - 31);
            const wy = Math.max(0, Math.abs(y) - 19);
            cost += (wx + wy) * 40;
            if (p.pullT > 0 && p.pullBy >= 0) {
              // away from the hauler reeling us in
              const hx = E.x[p.pullBy]! - p.x;
              const hy = E.y[p.pullBy]! - p.y;
              cost += (CAND_X[k]! * hx + CAND_Y[k]! * hy) * 3;
            }
            if (cost < dc) {
              dc = cost;
              dk = k;
            }
          }
          mx = CAND_X[dk]!;
          my = CAND_Y[dk]!;
          dashQ = true;
        }
      }
    }

    // ── aim & fire (continuous between decisions, like a mouse)
    let fire = false;
    if (pylonAim >= 0) {
      c.ax = w.pillars.x[pylonAim]!;
      c.ay = w.pillars.y[pylonAim]!;
      fire = true;
    } else if (target >= 0 && E.alive[target] && E.gen[target] === targetGen) {
      const tx = E.x[target]!;
      const ty = E.y[target]!;
      const d = Math.hypot(tx - p.x, ty - p.y);
      const bs = wd.speed * p.stats.bulletSpeedMul * w.phys.playerBulletSpeed;
      const t = wd.kind === -1 || bs <= 0 ? 0 : d / bs;
      const a = Math.atan2(ty + E.vy[target]! * t - p.y, tx + E.vx[target]! * t - p.x) + rnd() * jitter;
      c.ax = p.x + Math.cos(a) * d;
      c.ay = p.y + Math.sin(a) * d;
      fire = hasLOS(w, p.x, p.y, tx, ty);
      // don't lob grenades at our own feet, don't waste a singularity on a lone swarmer
      if (wd.id === WP.Launcher && d < 3) fire = false;
      if (wd.id === WP.Singularity && d < 4) fire = false;
    }
    if (fire) c.btn |= Btn.Fire;
    // ── weapon switch: only between shots (the switch adds 0.12 s to the cooldown)
    if (wantSlot >= 0 && p.fireCd <= 0.05) {
      c.btn |= (wantSlot + 1) << Btn.SlotShift;
      lastSwitch = tick;
      wantSlot = -1;
    }
    c.mx = mx;
    c.my = my;
    if (dashQ) {
      c.btn |= Btn.Dash;
      dashQ = false;
    }
  };
}

/** upgrades for the current build: heal when hurt, weapons that fit, synergies */
function pickUpgrade(w: World): number {
  const p = w.player;
  const owned = new Set<number>();
  for (let s = 0; s < p.slotCount; s++) owned.add(p.slots[s]!);
  let bestK = 0;
  let bestS = -1;
  for (let k = 0; k < w.wave.offerCount; k++) {
    const u = UPGRADES[w.wave.offer[k]!]!;
    let sc = 2;
    const hpF = p.hp / p.maxHp;
    if (u.key === 'heal') sc = hpF < 0.5 ? 12 : hpF < 0.75 ? 4 : 0.3;
    else if (u.key === 'hp') sc = hpF < 0.7 ? 6 : 3.5;
    else if (u.key === 'dmg' || u.key === 'rate') sc = 5.5;
    else if (u.weapon >= 0) sc = owned.has(u.weapon) ? 0 : 3.5 + u.rarity * 1.5;
    else if (u.key === 'multi') sc = owned.has(WP.Scatter) || owned.has(WP.Needler) ? 5 : 4;
    else if (u.key === 'pierce') sc = owned.has(WP.Needler) ? 5 : 3.5;
    else if (u.key === 'crit') sc = 4.2;
    else if (u.key === 'dash') sc = 4.5; // the bot lives by its dash
    else if (u.key === 'speed') sc = 3.8;
    else if (u.key === 'leech') sc = 4;
    else if (u.key === 'insulated') sc = w.act === 2 ? 5 : 1;
    else if (u.key === 'arcchain') sc = w.act === 2 ? 3.5 : 0.5;
    else if (u.key === 'shrapnel') sc = w.act === 2 ? 3.8 : 0.5;
    if (sc > bestS) {
      bestS = sc;
      bestK = k;
    }
  }
  return bestK;
}

