import type { Metrics } from './episode';

/** reward sliders (0..2; style −1 close … +1 far) */
export interface Rewards {
  progress: number;
  survival: number;
  speed: number;
  damage: number;
  accuracy: number;
  dashEconomy: number;
  style: number;
}
export const DEFAULT_REWARDS: Rewards = { progress: 1, survival: 1, speed: 0.5, damage: 0.3, accuracy: 0.2, dashEconomy: 0.1, style: 0 };

export const REWARD_INFO: Record<keyof Rewards, { name: string; hint: string; min: number; max: number }> = {
  progress: { name: 'Прогресс', hint: 'сколько волн пройдено за эпизод', min: 0, max: 2 },
  survival: { name: 'Живучесть', hint: 'выжить и получать меньше урона в минуту', min: 0, max: 2 },
  speed: { name: 'Скорость', hint: 'как быстро умирает враг после появления (время до убийства)', min: 0, max: 2 },
  damage: { name: 'Урон', hint: 'нанесённый урон в минуту', min: 0, max: 2 },
  accuracy: { name: 'Точность', hint: 'попадания на выстрел', min: 0, max: 2 },
  dashEconomy: { name: 'Экономия рывка', hint: 'меньше рывков в минуту', min: 0, max: 2 },
  style: { name: 'Стиль: близко ↔ далеко', hint: '−1 — лезть в ближний бой, +1 — держаться на расстоянии', min: -1, max: 1 },
};

/**
 * Each term is a smooth 0..10 score (no hard caps: a cap that the bot already reaches gives the
 * optimiser nothing to climb). Calibrated on the hand-tuned bot so that it sits mid-range.
 */
export function terms(m: Metrics): Record<keyof Rewards, number> {
  const min = Math.max(1 / 60, m.seconds / 60);
  const dtpm = m.dmgTaken / min;
  return {
    progress: m.progress * 4 + m.victory * 4,
    survival: m.alive * 2 + 8 * Math.exp(-dtpm / 15),
    speed: 10 * Math.exp(-m.ttk / 3),
    damage: 10 * Math.min(1, Math.log10(1 + m.dmgDealt / min) / 4.5),
    accuracy: m.shots > 0 ? 10 * Math.min(1, m.hits / m.shots / 2) : 0,
    dashEconomy: 10 * Math.exp(-(m.dashes / min) / 4),
    style: m.avgDist > 0 ? Math.max(-10, Math.min(10, (m.avgDist - 14) * 1.2)) : 0,
  };
}

export function fitness(m: Metrics, r: Rewards): number {
  const t = terms(m);
  let f = 0;
  for (const k of Object.keys(r) as (keyof Rewards)[]) f += r[k] * t[k];
  return f;
}

/** average metrics over several episodes of one candidate */
export function meanMetrics(ms: readonly Metrics[]): Metrics {
  const out = { ...ms[0]! };
  for (const k of Object.keys(out) as (keyof Metrics)[]) out[k] = ms.reduce((a, m) => a + m[k], 0) / ms.length;
  return out;
}
