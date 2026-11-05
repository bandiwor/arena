import { Rng } from '../core/rng';
import { Buf, loopify, noise, osc, pluck } from './synth';

export const SFX = [
  'shoot_pulse',
  'shoot_scatter',
  'shoot_needle',
  'shoot_launcher',
  'shoot_rail',
  'shoot_sing',
  'hit_flesh',
  'hit_plant',
  'hit_machine',
  'hit_crystal',
  'hit_void',
  'kill_flesh',
  'kill_plant',
  'kill_machine',
  'kill_crystal',
  'explode',
  'explode_big',
  'implode',
  'enemy_shoot',
  'enemy_orb',
  'archer_charge',
  'archer_release',
  'gunner_charge',
  'charger_roar',
  'slam',
  'spawn',
  'spawn_done',
  'player_hurt',
  'dash',
  'pickup',
  'upgrade',
  'wave_start',
  'wave_clear',
  'boss_phase',
  'boss_death',
  'laser_warn',
  'laser_fire',
  'shield_block',
  'weapon_switch',
  'legendary',
  'glitch',
  'ui_hover',
  'ui_click',
  'impact_wall',
  'crit',
  'mutator',
  'teleport',
  'shell',
  'bloat',
  'dart_dive',
  'combo',
  'combo_end',
  'hum_gunner',
  'hum_dart',
  'hum_boss',
  'hum_bloater',
  'player_hover',
  'heartbeat',
  'tinnitus',
  'riser',
  'decompile',
  'synth_boom',
  'worm_dig',
  'worm_burst',
  'brood_birth',
  'hum_worm',
  // Акт III · Литейный цех
  'lane_warn',
  'lane_flip',
  'stamp',
  'stamp_whine',
  'arc_zap',
  'pylon_charge',
  'hook_fire',
  'hook_hit',
  'shorted',
  'mite_spin',
  'arm_down',
  'hub_shield',
  'shunt',
  'shoot_arcrail',
  'hum_saw',
  'hum_assembler',
  'hum_arcdrone',
] as const;

/** Seamless loops (enemy hums, engine, heartbeat) — rendered with loopify. */
export const LOOPS: ReadonlySet<SfxId> = new Set<SfxId>(['hum_gunner', 'hum_dart', 'hum_boss', 'hum_bloater', 'hum_worm', 'hum_saw', 'hum_assembler', 'hum_arcdrone', 'player_hover', 'heartbeat']);
/** Frequent sounds get several takes so rapid repeats never sound like a machine gun of clones. */
export const VARIANTS: Partial<Record<SfxId, number>> = {
  worm_dig: 2, worm_burst: 2, stamp: 2, arc_zap: 3, shorted: 2, mite_spin: 2,
  shoot_pulse: 4, shoot_needle: 3, shoot_scatter: 2, hit_flesh: 4, hit_plant: 3, hit_machine: 3, hit_crystal: 3, hit_void: 2,
  kill_flesh: 3, kill_plant: 2, kill_machine: 2, kill_crystal: 2, shell: 4, impact_wall: 3, enemy_shoot: 3, explode: 2, crit: 2,
};
/** Mix category per sound: weapon (player), impact, enemy, world, ui */
export type Cat = 'weapon' | 'impact' | 'enemy' | 'world' | 'ui';
export function categoryOf(id: SfxId): Cat {
  if (id.startsWith('shoot_') || id === 'shell' || id === 'weapon_switch' || id === 'dash') return 'weapon';
  if (id.startsWith('hit_') || id.startsWith('kill_') || id === 'crit' || id === 'impact_wall' || id === 'shield_block') return 'impact';
  if (id.startsWith('ui_') || id === 'upgrade' || id === 'legendary' || id === 'combo' || id === 'combo_end' || id === 'wave_start' || id === 'wave_clear' || id === 'mutator') return 'ui';
  if (id === 'mite_spin' || id === 'hook_fire' || id === 'hook_hit') return 'enemy';
  if (id.startsWith('enemy_') || id.startsWith('archer') || id.startsWith('gunner') || id.startsWith('charger') || id === 'bloat' || id === 'dart_dive' || id.startsWith('hum_') || id === 'spawn' || id === 'spawn_done') return 'enemy';
  return 'world';
}
export type SfxId = (typeof SFX)[number];
export const SFX_INDEX: Record<SfxId, number> = Object.fromEntries(SFX.map((k, i) => [k, i])) as Record<SfxId, number>;

/** Recipes: each returns a mono buffer. All deterministic via the seeded rng. */
export function renderSfx(id: SfxId, sr: number, seed: number): Buf {
  const r = new Rng(seed * 7919 + id.length * 31);
  const o = (dur: number, opts: Parameters<typeof osc>[2]): Buf => osc(sr, dur, opts, r);
  const n = (dur: number, amp = 1): Buf => noise(sr, dur, r, amp);
  switch (id) {
    case 'shoot_pulse': {
      const b = o(0.12, { wave: 'square', f0: 1400, f1: 260, pw: 0.3 }).lowpass(6000, 900).env(0.002, 2.5);
      b.mix(n(0.03, 0.6).highpass(3000).env(0.001, 2));
      b.mix(o(0.09, { wave: 'sine', f0: 180, f1: 60 }).env(0.002, 2), 0, 0.7);
      return b.drive(1.5).normalize(0.55);
    }
    case 'shoot_scatter': {
      const b = n(0.32).lowpass(5000, 300).env(0.002, 2.2);
      b.mix(o(0.25, { wave: 'sine', f0: 120, f1: 35 }).env(0.003, 2), 0, 1.4);
      b.mix(n(0.05).highpass(2000).env(0.001, 3), 0, 0.8);
      b.mix(o(0.06, { wave: 'square', f0: 900, f1: 1300 }).env(0.001, 2).lowpass(3000), 0.18, 0.12); // pump click
      return b.drive(3).normalize(0.85);
    }
    case 'shoot_needle': {
      const b = o(0.05, { wave: 'saw', f0: 3600, f1: 1600 }).highpass(900).env(0.001, 3);
      b.mix(n(0.02).highpass(6000).env(0.001, 2), 0, 0.4);
      return b.normalize(0.32);
    }
    case 'shoot_launcher': {
      const b = o(0.3, { wave: 'sine', f0: 90, f1: 40 }).env(0.003, 2).drive(2);
      b.mix(n(0.18).bandpass(800, 2500, 0.6).env(0.01, 2), 0, 0.6);
      b.mix(o(0.4, { wave: 'tri', f0: 600, f1: 1400 }).env(0.05, 2), 0.05, 0.15);
      return b.normalize(0.8);
    }
    case 'shoot_rail': {
      const b = new Buf(sr, 1.3);
      b.mix(o(0.12, { wave: 'saw', f0: 400, f1: 3200, detune: 12 }).env(0.1, 0.3).lowpass(5000), 0, 0.25);
      const crack = n(0.5).highpass(1500, 300).env(0.001, 4);
      b.mix(crack, 0.1, 1.2);
      b.mix(o(1.1, { wave: 'sine', f0: 2400, f1: 80, fmRatio: 1.5, fmIndex: 2, fmDecay: 6 }).env(0.001, 3), 0.1, 0.8);
      b.mix(o(0.9, { wave: 'sine', f0: 55, f1: 30 }).env(0.002, 1.5), 0.1, 1.5);
      return b.echo(0.11, 0.4, 0.5).drive(2.5).normalize(0.95);
    }
    case 'shoot_sing': {
      const b = new Buf(sr, 2.0);
      b.mix(n(0.6).lowpass(300, 3000).env(0.55, 0.5).reverse(), 0, 0.5);
      b.mix(o(1.8, { wave: 'sine', f0: 140, f1: 22, detune: 25 }).env(0.01, 1.2), 0.25, 1.6);
      b.mix(o(1.5, { wave: 'saw', f0: 70, f1: 30, detune: 30 }).lowpass(800, 80).env(0.02, 1.5), 0.25, 0.6);
      b.mix(o(0.8, { wave: 'sine', f0: 3000, f1: 200, fmRatio: 0.5, fmIndex: 4 }).env(0.01, 3), 0.25, 0.2);
      return b.drive(2).crush(10, 2).normalize(0.95);
    }
    case 'hit_flesh': {
      const b = n(0.16).lowpass(1400, 200, 0.5).env(0.002, 2.5);
      b.mix(o(0.12, { wave: 'sine', f0: 220, f1: 70 }).env(0.002, 2), 0, 0.8);
      return b.drive(1).normalize(0.45);
    }
    case 'hit_plant': {
      const b = n(0.08).highpass(1800).env(0.001, 3);
      b.mix(pluck(sr, 0.15, 420 + r.range(-40, 40), 0.96, r, 0.3).env(0.001, 2), 0, 0.7);
      return b.normalize(0.42);
    }
    case 'hit_machine': {
      const b = new Buf(sr, 0.25);
      for (const f of [523, 1187, 1790, 2633]) b.mix(o(0.25, { wave: 'sine', f0: f * r.range(0.95, 1.05), fmRatio: 1.41, fmIndex: 0.8, fmDecay: 10 }).env(0.001, 4), 0, 0.3);
      b.mix(n(0.03).highpass(4000).env(0.001, 2), 0, 0.6);
      return b.normalize(0.42);
    }
    case 'hit_crystal': {
      const b = new Buf(sr, 0.4);
      for (const f of [2400, 3710, 5120, 6300]) b.mix(o(0.4, { wave: 'sine', f0: f * r.range(0.97, 1.03) }).env(0.001, 5), 0, 0.25);
      b.mix(n(0.02).highpass(7000).env(0.001, 2), 0, 0.4);
      return b.normalize(0.38);
    }
    case 'hit_void': {
      const b = o(0.15, { wave: 'square', f0: 200, f1: 90 }).crush(4, 8).env(0.001, 2);
      b.mix(n(0.1).bandpass(500, 3000).env(0.001, 2), 0, 0.4);
      return b.normalize(0.45);
    }
    case 'kill_flesh': {
      const b = n(0.4).lowpass(2500, 150, 0.6).env(0.003, 2);
      b.mix(o(0.3, { wave: 'sine', f0: 160, f1: 40 }).env(0.002, 1.5), 0, 1);
      b.mix(n(0.2).bandpass(300, 900, 0.8).env(0.02, 2), 0.05, 0.6); // wet tail
      return b.drive(2).normalize(0.7);
    }
    case 'kill_plant': {
      const b = n(0.5).bandpass(3000, 800, 0.5).env(0.005, 2.5);
      b.mix(o(0.12, { wave: 'sine', f0: 900, f1: 300 }).env(0.001, 3), 0, 0.6); // pop
      b.mix(pluck(sr, 0.4, 180, 0.985, r, 0.6).env(0.001, 1.5), 0.02, 0.6);
      return b.normalize(0.65);
    }
    case 'kill_machine': {
      const b = n(0.6).lowpass(4000, 200).env(0.002, 2.5);
      b.mix(o(0.5, { wave: 'sine', f0: 100, f1: 35 }).env(0.002, 2), 0, 1.2);
      for (let k = 0; k < 6; k++) b.mix(n(0.02).highpass(5000).env(0.001, 2), 0.05 + r.float() * 0.4, 0.5);
      for (const f of [700, 1340]) b.mix(o(0.4, { wave: 'sine', f0: f, fmRatio: 2.3, fmIndex: 1.5, fmDecay: 8 }).env(0.001, 3), 0, 0.2);
      return b.drive(2).normalize(0.8);
    }
    case 'kill_crystal': {
      const b = new Buf(sr, 0.9);
      for (let k = 0; k < 14; k++) {
        const f = r.range(1800, 7000);
        b.mix(o(0.35, { wave: 'sine', f0: f }).env(0.001, 5), r.float() * 0.25, 0.18);
      }
      b.mix(n(0.3).highpass(3000).env(0.001, 3), 0, 0.7);
      b.mix(o(0.3, { wave: 'sine', f0: 140, f1: 60 }).env(0.002, 2), 0, 0.5);
      return b.echo(0.07, 0.4, 0.5).normalize(0.75);
    }
    case 'explode':
    case 'explode_big': {
      const big = id === 'explode_big';
      const L = big ? 2.2 : 1.1;
      const b = n(L).lowpass(big ? 6000 : 4500, 90, 0.3).env(0.002, 2.2);
      b.mix(o(L * 0.8, { wave: 'sine', f0: big ? 75 : 95, f1: 25 }).env(0.003, 1.6), 0, big ? 2.2 : 1.6);
      for (let k = 0; k < (big ? 30 : 12); k++) b.mix(n(0.015).highpass(3000).env(0.001, 2), 0.05 + r.float() * L * 0.6, 0.25);
      return b.drive(big ? 4 : 2.5).normalize(big ? 1 : 0.9);
    }
    case 'implode': {
      const b = n(1.0).lowpass(200, 5000).env(0.9, 0.4);
      b.mix(o(1.2, { wave: 'sine', f0: 30, f1: 160 }).env(0.9, 0.3), 0, 1);
      const boom = n(0.8).lowpass(3000, 80).env(0.001, 2);
      b.mix(boom, 0.95, 1.4);
      return b.drive(3).normalize(1);
    }
    case 'enemy_shoot': {
      const b = o(0.1, { wave: 'saw', f0: 950, f1: 380 }).lowpass(4000, 1200).env(0.001, 2);
      b.mix(n(0.03).bandpass(3000).env(0.001, 2), 0, 0.3);
      return b.normalize(0.32);
    }
    case 'enemy_orb': {
      const b = o(0.3, { wave: 'sine', f0: 300, f1: 140, fmRatio: 3, fmIndex: 2, fmDecay: 8 }).env(0.005, 2);
      b.mix(o(0.25, { wave: 'square', f0: 80, f1: 60 }).lowpass(600).env(0.003, 2), 0, 0.5);
      return b.normalize(0.5);
    }
    case 'archer_charge': {
      const b = o(1.15, { wave: 'tri', f0: 300, f1: 1400, vibrato: 0.02, vibRate: 14 }).env(0.6, 0.3, 0.3).lowpass(2000, 6000);
      b.mix(n(1.15).bandpass(1000, 6000, 0.7).env(1, 0.2), 0, 0.2);
      return b.normalize(0.32);
    }
    case 'archer_release': {
      const b = pluck(sr, 0.5, 110, 0.993, r, 0.5).env(0.001, 1.5);
      b.mix(n(0.25).bandpass(4000, 900, 0.6).env(0.005, 2), 0, 0.8); // whoosh
      return b.normalize(0.6);
    }
    case 'gunner_charge': {
      const b = o(0.45, { wave: 'square', f0: 400, f1: 1600, pw: 0.2 }).lowpass(2500).env(0.4, 0.2, 0.05);
      return b.crush(6, 3).normalize(0.18);
    }
    case 'charger_roar': {
      const b = o(0.8, { wave: 'saw', f0: 75, f1: 55, vibrato: 0.08, vibRate: 22, detune: 30 }).lowpass(900, 400, 0.5).env(0.08, 1.2, 0.2);
      b.mix(n(0.8).bandpass(500, 300, 0.5).env(0.1, 1.5), 0, 0.5);
      return b.drive(4).normalize(0.75);
    }
    case 'slam': {
      const b = o(0.6, { wave: 'sine', f0: 70, f1: 28 }).env(0.002, 1.5).drive(2);
      b.mix(n(0.5).lowpass(1500, 100).env(0.002, 2), 0, 1);
      return b.normalize(0.95);
    }
    case 'spawn': {
      const b = o(0.7, { wave: 'saw', f0: 80, f1: 900, detune: 20 }).lowpass(400, 5000, 0.6).env(0.5, 0.5).crush(6, 4);
      b.mix(n(0.7).bandpass(2000, 300, 0.7).env(0.6, 0.3), 0, 0.2);
      return b.normalize(0.3);
    }
    case 'spawn_done': {
      const b = o(0.2, { wave: 'square', f0: 1200, f1: 300 }).crush(5, 6).env(0.001, 2);
      return b.normalize(0.22);
    }
    case 'player_hurt': {
      const b = o(0.35, { wave: 'saw', f0: 140, f1: 60, detune: 40 }).drive(6).lowpass(3000, 400).env(0.002, 1.8);
      b.mix(n(0.2).bandpass(1500, 400).env(0.001, 2), 0, 0.6);
      return b.crush(7, 3).normalize(0.85);
    }
    case 'dash': {
      const b = n(0.28).bandpass(600, 4000, 0.7).env(0.03, 2);
      b.mix(o(0.2, { wave: 'sine', f0: 300, f1: 900 }).env(0.01, 3), 0, 0.3);
      return b.normalize(0.45);
    }
    case 'pickup': {
      const b = new Buf(sr, 0.45);
      [880, 1108, 1318, 1760].forEach((f, k) => b.mix(o(0.15, { wave: 'tri', f0: f }).env(0.002, 2.5), k * 0.05, 0.4));
      return b.echo(0.09, 0.4, 0.5).normalize(0.45);
    }
    case 'upgrade':
    case 'legendary': {
      const leg = id === 'legendary';
      const b = new Buf(sr, leg ? 3 : 1.6);
      const chord = leg ? [220, 277, 330, 440, 554, 660, 880] : [330, 415, 494, 660];
      for (const f of chord) b.mix(o(leg ? 2.8 : 1.4, { wave: 'saw', f0: f, detune: 14 }).lowpass(800, 5000).env(0.05, 1.5), 0, 0.2);
      if (leg) b.mix(o(2.5, { wave: 'sine', f0: 55, f1: 50 }).env(0.01, 1), 0, 1);
      b.mix(n(0.6).highpass(5000).env(0.3, 1), 0, 0.1);
      return b.echo(0.18, 0.45, 0.6).normalize(leg ? 0.9 : 0.6);
    }
    case 'wave_start': {
      const b = new Buf(sr, 1.4);
      b.mix(o(0.25, { wave: 'square', f0: 440, pw: 0.3 }).lowpass(2500).env(0.005, 1), 0, 0.3);
      b.mix(o(0.25, { wave: 'square', f0: 330, pw: 0.3 }).lowpass(2500).env(0.005, 1), 0.28, 0.3);
      b.mix(o(0.9, { wave: 'sine', f0: 60, f1: 30 }).env(0.002, 1.5), 0.56, 1.2);
      b.mix(n(0.6).lowpass(2000, 100).env(0.002, 2), 0.56, 0.5);
      return b.drive(1.5).normalize(0.7);
    }
    case 'wave_clear': {
      const b = new Buf(sr, 1.2);
      [523, 659, 784, 1046, 1318].forEach((f, k) => b.mix(o(0.4, { wave: 'tri', f0: f }).env(0.003, 2), k * 0.07, 0.35));
      return b.echo(0.12, 0.45, 0.6).normalize(0.55);
    }
    case 'boss_phase': {
      const b = new Buf(sr, 2.2);
      b.mix(o(2, { wave: 'saw', f0: 55, f1: 40, vibrato: 0.1, vibRate: 30, detune: 40 }).lowpass(1500, 200, 0.6).env(0.05, 1.2), 0, 1);
      b.mix(n(1.5).lowpass(5000, 200).env(0.002, 2), 0, 0.8);
      for (let k = 0; k < 8; k++) b.mix(o(0.06, { wave: 'square', f0: r.range(200, 2000) }).crush(3, 10).env(0.001, 1), 0.2 + k * 0.08, 0.2);
      return b.drive(5).normalize(1);
    }
    case 'boss_death': {
      const b = new Buf(sr, 4.5);
      b.mix(o(4, { wave: 'sine', f0: 90, f1: 18 }).env(0.01, 1.2), 0, 1.5);
      b.mix(n(4).lowpass(8000, 60, 0.2).env(0.002, 1.6), 0, 1.2);
      b.mix(o(3.5, { wave: 'saw', f0: 220, f1: 30, detune: 50 }).lowpass(3000, 100).env(0.01, 1.5), 0.1, 0.5);
      return b.drive(3).echo(0.23, 0.5, 0.5).normalize(1);
    }
    case 'laser_warn': {
      const b = o(1.1, { wave: 'saw', f0: 200, f1: 1800, detune: 15 }).lowpass(800, 6000, 0.5).env(0.8, 0.3);
      return b.normalize(0.35);
    }
    case 'laser_fire': {
      const b = o(1.5, { wave: 'saw', f0: 110, vibrato: 0.04, vibRate: 40, detune: 25 }).lowpass(2000).env(0.01, 0.6, 0.5);
      b.mix(n(1.5).bandpass(3000, 2000, 0.5).env(0.01, 0.7), 0, 0.3);
      return b.drive(3).normalize(0.55);
    }
    case 'shield_block': {
      const b = o(0.3, { wave: 'sine', f0: 1800, f1: 2600, fmRatio: 2.7, fmIndex: 1.5, fmDecay: 12 }).env(0.001, 4);
      b.mix(n(0.04).highpass(5000).env(0.001, 2), 0, 0.4);
      return b.normalize(0.4);
    }
    case 'weapon_switch': {
      const b = n(0.04).bandpass(2500).env(0.001, 2);
      b.mix(n(0.05).bandpass(1200).env(0.001, 2), 0.07, 0.8);
      b.mix(o(0.08, { wave: 'square', f0: 600, f1: 900 }).lowpass(2000).env(0.001, 2), 0.07, 0.15);
      return b.normalize(0.45);
    }
    case 'glitch': {
      const b = new Buf(sr, 0.5);
      for (let k = 0; k < 10; k++) b.mix(o(0.04, { wave: r.chance(0.5) ? 'square' : 'noise', f0: r.range(100, 3000) }).env(0.001, 0.5), k * 0.045, 0.4);
      return b.crush(3, 12).normalize(0.4);
    }
    case 'ui_hover':
      return o(0.04, { wave: 'sine', f0: 1800, f1: 2200 }).env(0.001, 2).normalize(0.12);
    case 'ui_click':
      return o(0.08, { wave: 'square', f0: 900, f1: 500, pw: 0.25 }).lowpass(3000).env(0.001, 2).normalize(0.25);
    case 'impact_wall': {
      const b = n(0.05).bandpass(2500, 800, 0.5).env(0.001, 2);
      return b.normalize(0.18);
    }
    case 'crit': {
      const b = o(0.2, { wave: 'square', f0: 1500, f1: 2400, pw: 0.15 }).env(0.001, 3).lowpass(6000);
      b.mix(o(0.15, { wave: 'sine', f0: 3000 }).env(0.001, 4), 0.02, 0.4);
      return b.normalize(0.35);
    }
    case 'mutator': {
      const b = new Buf(sr, 1.8);
      b.mix(o(1.6, { wave: 'saw', f0: 110, f1: 55, detune: 30 }).lowpass(300, 3000, 0.7).env(0.3, 1), 0, 0.6);
      b.mix(o(0.3, { wave: 'square', f0: 880, f1: 220 }).crush(4, 6).env(0.001, 1), 0, 0.3);
      return b.echo(0.2, 0.5, 0.5).normalize(0.6);
    }
    case 'shell': {
      // casing tink: two short inharmonic partials + tiny bounce
      const b = new Buf(sr, 0.35);
      const f = r.range(3800, 4600);
      b.mix(o(0.12, { wave: 'sine', f0: f }).env(0.001, 6), 0, 0.5);
      b.mix(o(0.1, { wave: 'sine', f0: f * 1.47 }).env(0.001, 7), 0, 0.3);
      b.mix(o(0.08, { wave: 'sine', f0: f * 0.97 }).env(0.001, 7), 0.11, 0.25);
      return b.normalize(0.3);
    }
    case 'bloat': {
      const b = o(0.95, { wave: 'saw', f0: 70, f1: 160, vibrato: 0.18, vibRate: 11 }).lowpass(300, 1200, 0.7).env(0.4, 0.5, 0.3);
      b.mix(n(0.95).bandpass(200, 700, 0.8).env(0.6, 0.4), 0, 0.5);
      return b.drive(2).normalize(0.55);
    }
    case 'dart_dive': {
      const b = o(0.55, { wave: 'square', f0: 900, f1: 2400, pw: 0.3, vibrato: 0.05, vibRate: 60 }).lowpass(5000).env(0.2, 0.6, 0.15);
      return b.normalize(0.25);
    }
    case 'combo': {
      const b = new Buf(sr, 0.6);
      [660, 880, 1320].forEach((f, k) => b.mix(o(0.25, { wave: 'square', f0: f, pw: 0.25 }).lowpass(4000).env(0.002, 2), k * 0.045, 0.3));
      return b.echo(0.08, 0.35, 0.5).normalize(0.45);
    }
    case 'combo_end': {
      const b = o(0.7, { wave: 'saw', f0: 880, f1: 110, detune: 20 }).lowpass(4000, 300).env(0.01, 2);
      b.mix(n(0.5).bandpass(3000, 300, 0.6).env(0.02, 2), 0, 0.3);
      return b.normalize(0.35);
    }
    case 'hum_gunner': {
      // hovering drone: rotor buzz with blade-rate AM + motor whine
      const b = o(2.5, { wave: 'saw', f0: 92, detune: 18 }).lowpass(700);
      for (let i = 0; i < b.n; i++) b.d[i] = b.d[i]! * (0.6 + 0.4 * Math.sin((i / sr) * Math.PI * 2 * 36));
      b.mix(o(2.5, { wave: 'sine', f0: 740, vibrato: 0.004, vibRate: 3 }), 0, 0.08);
      return loopify(b, 2, 0.4).normalize(0.5);
    }
    case 'hum_dart': {
      const b = o(2.4, { wave: 'square', f0: 210, pw: 0.15, vibrato: 0.03, vibRate: 13 }).lowpass(1800);
      for (let i = 0; i < b.n; i++) b.d[i] = b.d[i]! * (0.5 + 0.5 * Math.sin((i / sr) * Math.PI * 2 * 90));
      return loopify(b, 2, 0.4).normalize(0.45);
    }
    case 'hum_boss': {
      const b = o(4.5, { wave: 'saw', f0: 36.7, detune: 25, vibrato: 0.01, vibRate: 0.4 }).lowpass(220, 300, 0.5);
      b.mix(o(4.5, { wave: 'sine', f0: 73.4 }), 0, 0.5);
      b.mix(n(4.5).bandpass(900, 1200, 0.85), 0, 0.15);
      return loopify(b, 4, 0.5).drive(1.5).normalize(0.7);
    }
    case 'hum_bloater': {
      // wet gurgle: filtered noise bubbles + low wobble
      const b = n(2.5).lowpass(260).gain(0.6);
      for (let k = 0; k < 14; k++) b.mix(o(0.09, { wave: 'sine', f0: r.range(180, 420), f1: r.range(500, 900) }).env(0.005, 2), r.range(0, 2.3), 0.35);
      b.mix(o(2.5, { wave: 'sine', f0: 55, vibrato: 0.2, vibRate: 3 }), 0, 0.4);
      return loopify(b, 2, 0.4).normalize(0.45);
    }
    case 'player_hover': {
      const b = o(2.4, { wave: 'saw', f0: 110, detune: 6 }).lowpass(500);
      b.mix(n(2.4).bandpass(1200, 1200, 0.7), 0, 0.12);
      b.mix(o(2.4, { wave: 'sine', f0: 55 }), 0, 0.6);
      return loopify(b, 2, 0.4).normalize(0.4);
    }
    case 'heartbeat': {
      const b = new Buf(sr, 1.0);
      const thump = (): Buf => o(0.18, { wave: 'sine', f0: 62, f1: 38 }).env(0.004, 2.5).lowpass(200);
      b.mix(thump(), 0.0, 1);
      b.mix(thump(), 0.24, 0.7);
      return b.normalize(0.8);
    }
    case 'tinnitus': {
      const b = o(2.2, { wave: 'sine', f0: 4100 }).env(0.03, 1.4);
      b.mix(o(2.2, { wave: 'sine', f0: 4113 }).env(0.03, 1.4), 0, 0.6);
      return b.normalize(0.18);
    }
    case 'riser': {
      const b = n(1.2).bandpass(300, 6000, 0.8).env(1.1, 0.15);
      b.mix(o(1.2, { wave: 'saw', f0: 110, f1: 880, detune: 20 }).lowpass(800, 6000).env(1.1, 0.15), 0, 0.3);
      return b.normalize(0.4);
    }
    case 'decompile': {
      // the sector being taken apart: descending data-glitch sweep + granular stutter + sub fall
      const b = new Buf(sr, 4.5);
      b.mix(o(4, { wave: 'saw', f0: 1600, f1: 60, detune: 30 }).lowpass(6000, 200, 0.5).env(0.05, 1.2).crush(6, 3), 0, 0.35);
      for (let k = 0; k < 40; k++) b.mix(o(0.05, { wave: k % 2 ? 'square' : 'noise', f0: r.range(300, 4000) }).crush(3, 8).env(0.001, 1), (k / 40) * 3.2 + r.float() * 0.05, 0.12 * (1 - k / 50));
      b.mix(o(4.2, { wave: 'sine', f0: 80, f1: 28 }).env(0.3, 1), 0.2, 0.9);
      b.mix(n(4).bandpass(300, 3000, 0.7).env(2.5, 0.4), 0.3, 0.25);
      return b.echo(0.21, 0.45, 0.5).normalize(0.85);
    }
    case 'synth_boom': {
      // matter written into the world: huge low boom + rising chord bloom + wet spray
      const b = new Buf(sr, 5);
      b.mix(o(3.5, { wave: 'sine', f0: 70, f1: 24 }).env(0.002, 1.3), 0, 1.6);
      b.mix(n(2.5).lowpass(7000, 60, 0.3).env(0.001, 2), 0, 1);
      for (const f of [110, 164.8, 220, 233.1, 329.6]) b.mix(o(4.5, { wave: 'saw', f0: f, detune: 22 }).lowpass(300, 3000).env(0.4, 1.6), 0.05, 0.12);
      b.mix(n(1.2).bandpass(800, 300, 0.7).env(0.01, 2), 0.05, 0.5);
      return b.drive(3).echo(0.27, 0.5, 0.5).normalize(1);
    }
    case 'worm_dig': {
      const b = n(0.7).lowpass(900, 200, 0.5).env(0.02, 1.5);
      for (let k = 0; k < 8; k++) b.mix(n(0.03).bandpass(1500).env(0.001, 2), r.float() * 0.5, 0.4);
      b.mix(o(0.5, { wave: 'sine', f0: 90, f1: 40 }).env(0.01, 1.5), 0, 0.8);
      return b.normalize(0.6);
    }
    case 'worm_burst': {
      const b = n(0.9).lowpass(3500, 150, 0.4).env(0.002, 1.8);
      b.mix(o(0.6, { wave: 'sine', f0: 110, f1: 35 }).env(0.002, 1.6), 0, 1.4);
      b.mix(o(0.5, { wave: 'saw', f0: 220, f1: 90, vibrato: 0.15, vibRate: 30 }).lowpass(1500).env(0.01, 2), 0.02, 0.4); // shriek
      for (let k = 0; k < 12; k++) b.mix(n(0.04).bandpass(1200, 600).env(0.001, 2), 0.05 + r.float() * 0.6, 0.3); // debris
      return b.drive(2.5).normalize(0.9);
    }
    case 'brood_birth': {
      const b = n(1.6).lowpass(1200, 200, 0.6).env(0.05, 1.5);
      b.mix(o(1.4, { wave: 'saw', f0: 60, f1: 45, vibrato: 0.12, vibRate: 7, detune: 30 }).lowpass(500).env(0.2, 1.2), 0, 0.9);
      for (let k = 0; k < 16; k++) b.mix(o(0.1, { wave: 'sine', f0: r.range(150, 400), f1: r.range(400, 900) }).env(0.005, 2), 0.3 + r.float() * 1, 0.25); // wet pops
      return b.drive(2).normalize(0.9);
    }
    case 'hum_worm': {
      // subterranean grind: low rumble with grit
      const b = n(2.5).lowpass(160).gain(1.2);
      b.mix(n(2.5).bandpass(500, 500, 0.6), 0, 0.25);
      b.mix(o(2.5, { wave: 'saw', f0: 43, vibrato: 0.05, vibRate: 5 }).lowpass(200), 0, 0.5);
      return loopify(b, 2, 0.4).drive(1.5).normalize(0.6);
    }
    case 'lane_warn': {
      // two-tone klaxon blip + belt motor strain
      const b = new Buf(sr, 0.9);
      for (let k = 0; k < 3; k++) b.mix(o(0.14, { wave: 'square', f0: k % 2 ? 620 : 880, pw: 0.4 }).lowpass(2500).env(0.005, 1.5), k * 0.22, 0.4);
      b.mix(o(0.9, { wave: 'saw', f0: 60, f1: 48, detune: 12 }).lowpass(300).env(0.2, 0.8), 0, 0.4);
      return b.normalize(0.5);
    }
    case 'lane_flip': {
      const b = o(0.5, { wave: 'saw', f0: 45, f1: 70, detune: 20 }).lowpass(500, 200).env(0.01, 1.4);
      b.mix(n(0.35).bandpass(700, 400, 0.6).env(0.005, 2), 0, 0.5);
      for (let k = 0; k < 5; k++) b.mix(n(0.02).highpass(3000).env(0.001, 2), 0.02 + k * 0.05, 0.25); // chain clatter
      return b.drive(2).normalize(0.6);
    }
    case 'stamp': {
      // hydraulic slam: metal clang over a sub thump + hiss
      const b = o(0.7, { wave: 'sine', f0: 85, f1: 30 }).env(0.001, 1.6).drive(3);
      b.mix(n(0.4).lowpass(2500, 120).env(0.001, 2.5), 0, 1);
      for (const f of [310, 743, 1213]) b.mix(o(0.6, { wave: 'sine', f0: f * r.range(0.97, 1.03), fmRatio: 1.37, fmIndex: 1.2, fmDecay: 6 }).env(0.001, 3), 0, 0.25);
      b.mix(n(0.6).highpass(3500).env(0.05, 2), 0.12, 0.25); // steam
      return b.normalize(0.95);
    }
    case 'stamp_whine': {
      const b = o(2.0, { wave: 'saw', f0: 120, f1: 520, detune: 10 }).lowpass(1200, 3500).env(1.7, 0.2);
      b.mix(n(2.0).bandpass(2500, 1200, 0.8).env(1.6, 0.3), 0, 0.25);
      return b.normalize(0.32);
    }
    case 'arc_zap': {
      // electric crack: crushed noise bursts with a buzzing 120 Hz body
      const b = new Buf(sr, 0.5);
      for (let k = 0; k < 7; k++) b.mix(n(0.03).highpass(2500).crush(5, 3).env(0.001, 2), r.float() * 0.18, 0.7);
      b.mix(o(0.4, { wave: 'square', f0: 120, pw: 0.1 }).lowpass(3000, 400).env(0.002, 1.8), 0, 0.5);
      b.mix(o(0.25, { wave: 'saw', f0: 3400, f1: 900 }).env(0.001, 3), 0, 0.25);
      return b.drive(2).normalize(0.7);
    }
    case 'pylon_charge': {
      const b = o(1.0, { wave: 'saw', f0: 110, f1: 880, vibrato: 0.04, vibRate: 30 }).lowpass(800, 5000).env(0.9, 0.2);
      b.mix(n(1.0).bandpass(4000, 2000, 0.7).crush(6, 2).env(0.9, 0.2), 0, 0.2);
      return b.normalize(0.4);
    }
    case 'hook_fire': {
      const b = n(0.35).bandpass(2500, 700, 0.6).env(0.002, 2);
      b.mix(o(0.12, { wave: 'square', f0: 900, f1: 300 }).lowpass(2500).env(0.001, 2), 0, 0.4);
      for (let k = 0; k < 8; k++) b.mix(n(0.012).highpass(4000).env(0.001, 2), 0.04 + k * 0.035, 0.2); // chain links
      return b.normalize(0.55);
    }
    case 'hook_hit': {
      const b = new Buf(sr, 0.9);
      for (const f of [420, 1010, 1650]) b.mix(o(0.4, { wave: 'sine', f0: f, fmRatio: 1.7, fmIndex: 1, fmDecay: 8 }).env(0.001, 3), 0, 0.3);
      b.mix(o(0.8, { wave: 'saw', f0: 70, f1: 140, detune: 15 }).lowpass(600).env(0.02, 1.2), 0.05, 0.5); // winch
      return b.drive(1.5).normalize(0.7);
    }
    case 'shorted': {
      const b = new Buf(sr, 0.7);
      for (let k = 0; k < 10; k++) b.mix(o(0.04, { wave: 'square', f0: r.range(80, 240) }).crush(4, 4).env(0.001, 2), k * 0.06 + r.float() * 0.02, 0.4 * (1 - k / 12));
      b.mix(o(0.6, { wave: 'sine', f0: 900, f1: 120 }).env(0.002, 2), 0, 0.3);
      return b.normalize(0.5);
    }
    case 'mite_spin': {
      const b = o(0.35, { wave: 'saw', f0: 300, f1: 1200, detune: 8 }).lowpass(2000, 5000).env(0.25, 0.4);
      for (let i = 0; i < b.n; i++) b.d[i] = b.d[i]! * (0.6 + 0.4 * Math.sin((i / sr) * Math.PI * 2 * 60));
      return b.normalize(0.3);
    }
    case 'arm_down': {
      const b = n(1.4).lowpass(3000, 100, 0.4).env(0.002, 1.8);
      b.mix(o(1.2, { wave: 'sine', f0: 70, f1: 25 }).env(0.002, 1.4), 0, 1.5);
      for (const f of [210, 333, 517]) b.mix(o(1.2, { wave: 'saw', f0: f, f1: f * 0.5, detune: 10 }).lowpass(900).env(0.01, 1.5), 0.05, 0.15);
      for (let k = 0; k < 16; k++) b.mix(n(0.03).highpass(3000).env(0.001, 2), 0.1 + r.float() * 0.9, 0.3);
      return b.drive(3).normalize(0.95);
    }
    case 'hub_shield': {
      const b = o(0.8, { wave: 'sine', f0: 220, f1: 440, fmRatio: 2, fmIndex: 3, fmDecay: 3 }).env(0.05, 1.5);
      b.mix(o(0.8, { wave: 'square', f0: 55, pw: 0.3 }).lowpass(300).env(0.05, 1.5), 0, 0.5);
      return b.normalize(0.5);
    }
    case 'shunt': {
      const b = o(0.5, { wave: 'saw', f0: 40, f1: 110, detune: 25 }).lowpass(900, 200).env(0.003, 1.5).drive(3);
      b.mix(n(0.4).lowpass(2000, 150).env(0.001, 2), 0, 0.9);
      return b.normalize(0.85);
    }
    case 'shoot_arcrail': {
      const b = new Buf(sr, 1.0);
      b.mix(o(0.08, { wave: 'saw', f0: 600, f1: 3600, detune: 15 }).env(0.06, 0.2).lowpass(6000), 0, 0.3);
      for (let k = 0; k < 9; k++) b.mix(n(0.03).highpass(2000).crush(5, 3).env(0.001, 2), 0.08 + r.float() * 0.25, 0.6);
      b.mix(o(0.8, { wave: 'square', f0: 120, pw: 0.15 }).lowpass(2400, 200).env(0.002, 2.4), 0.08, 0.6);
      b.mix(o(0.7, { wave: 'sine', f0: 60, f1: 30 }).env(0.002, 1.6), 0.08, 1.2);
      return b.echo(0.09, 0.35, 0.5).drive(2).normalize(0.9);
    }
    case 'hum_saw': {
      // spinning blade: bright tooth whine with grinding noise
      const b = o(2.4, { wave: 'saw', f0: 380, detune: 9, vibrato: 0.01, vibRate: 6 }).bandpass(1400, 1500, 0.4);
      b.mix(n(2.4).bandpass(3500, 2500, 0.6), 0, 0.3);
      for (let i = 0; i < b.n; i++) b.d[i] = b.d[i]! * (0.75 + 0.25 * Math.sin((i / sr) * Math.PI * 2 * 48));
      return loopify(b, 2, 0.4).normalize(0.4);
    }
    case 'hum_assembler': {
      // factory heart: 55 Hz hum with harmonics + slow piston breathing
      const b = o(4.5, { wave: 'saw', f0: 55, detune: 14 }).lowpass(330, 200, 0.5);
      b.mix(o(4.5, { wave: 'sine', f0: 110 }), 0, 0.4);
      b.mix(o(4.5, { wave: 'square', f0: 165, pw: 0.3 }).lowpass(500), 0, 0.12);
      for (let i = 0; i < b.n; i++) b.d[i] = b.d[i]! * (0.7 + 0.3 * Math.sin((i / sr) * Math.PI * 2 * 0.9));
      return loopify(b, 4, 0.5).drive(1.5).normalize(0.7);
    }
    case 'hum_arcdrone': {
      const b = o(2.4, { wave: 'square', f0: 120, pw: 0.12 }).lowpass(1600, 300);
      for (let i = 0; i < b.n; i++) b.d[i] = b.d[i]! * (0.65 + 0.35 * Math.sin((i / sr) * Math.PI * 2 * 7));
      b.mix(n(2.4).highpass(5000).crush(6, 2), 0, 0.06);
      return loopify(b, 2, 0.4).normalize(0.4);
    }
    case 'teleport': {
      const b = o(0.4, { wave: 'saw', f0: 2000, f1: 60, detune: 40 }).crush(5, 4).env(0.001, 1.5);
      b.mix(n(0.3).bandpass(500, 4000).env(0.001, 2), 0, 0.5);
      return b.normalize(0.6);
    }
  }
}
