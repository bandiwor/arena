export interface DifficultyDef {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  readonly hpMul: number;
  /** how strongly later acts ramp enemy HP/damage (0 = flat, 1 = full ramp) */
  readonly actRamp: number;
  readonly dmgMul: number;
  readonly countMul: number;
  readonly bulletSpeedMul: number;
  readonly aimErr: number;
  readonly tokens: number;
  readonly cdMul: number;
  /** wind-up / telegraph duration multiplier (< 1 = faster, never below 0.85) */
  readonly teleMul: number;
  /** max share of player max HP a single hit can take (no one-shots) */
  readonly maxHit: number;
  /** share of max HP restored when a wave is cleared (archive restores the process) */
  readonly waveHeal: number;
  readonly eliteChance: number;
  readonly playerHp: number;
  readonly dropMul: number;
}

/**
 * Design rule: higher difficulty = faster tempo and denser patterns that demand reaction and
 * decisions — NOT damage sponges or one-shots. Enemy HP and damage barely scale; what scales is
 * how many enemies attack at once, how fast they wind up, how accurately they lead, and how
 * often elites appear. Every telegraph stays readable (teleMul ≥ 0.85) and no single hit can
 * take more than `maxHit` of the player's health.
 */
export const DIFFICULTIES: readonly DifficultyDef[] = [
  { id: 0, key: 'easy', actRamp: 0.35, name: 'Сигнал', desc: 'Мягкий вход: медленные замахи, неточные враги, много лечения.', hpMul: 0.8, dmgMul: 0.7, countMul: 0.85, bulletSpeedMul: 0.9, aimErr: 1.6, tokens: 2, cdMul: 1.25, teleMul: 1.2, eliteChance: 0, playerHp: 120, dropMul: 1.5, maxHit: 0.2, waveHeal: 0.25 },
  { id: 1, key: 'normal', actRamp: 1, name: 'Шум', desc: 'Задуманный баланс.', hpMul: 1, dmgMul: 0.9, countMul: 1, bulletSpeedMul: 1, aimErr: 1, tokens: 3, cdMul: 1, teleMul: 1, eliteChance: 0.05, playerHp: 100, dropMul: 1, maxHit: 0.25, waveHeal: 0.18 },
  { id: 2, key: 'hard', actRamp: 1, name: 'Помехи', desc: 'Плотнее и быстрее: больше врагов атакуют разом, замахи короче, элиты.', hpMul: 1.08, dmgMul: 1.1, countMul: 1.15, bulletSpeedMul: 1.06, aimErr: 0.85, tokens: 3, cdMul: 0.9, teleMul: 0.92, eliteChance: 0.1, playerHp: 100, dropMul: 0.95, maxHit: 0.25, waveHeal: 0.12 },
  { id: 3, key: 'nightmare', actRamp: 0.9, name: 'NULL', desc: 'Темп на пределе реакции. Читай телеграфы — каждый удар можно избежать.', hpMul: 1.1, dmgMul: 1.15, countMul: 1.22, bulletSpeedMul: 1.12, aimErr: 0.72, tokens: 4, cdMul: 0.8, teleMul: 0.85, eliteChance: 0.13, playerHp: 100, dropMul: 0.9, maxHit: 0.25, waveHeal: 0.1 },
];

export function difficulty(id: number): DifficultyDef {
  return DIFFICULTIES[id] ?? DIFFICULTIES[1]!;
}
