export interface DifficultyDef {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  readonly hpMul: number;
  /** UI accent */
  readonly color: string;
  /** short tag on the menu card */
  readonly tag: string;
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
  { id: 0, key: 'easy', color: '#5cff9b', tag: 'мягко', actRamp: 0.35, name: 'Сигнал', desc: 'Мягкий вход: медленные замахи, неточные враги, много лечения.', hpMul: 0.9, dmgMul: 0.9, countMul: 1.05, bulletSpeedMul: 0.9, aimErr: 1.15, tokens: 3, cdMul: 1.0, teleMul: 1.1, eliteChance: 0.04, playerHp: 100, dropMul: 1.2, maxHit: 0.2, waveHeal: 0.16 },
  { id: 1, key: 'normal', color: '#2ef2ff', tag: 'задумано', actRamp: 1, name: 'Шум', desc: 'Задуманный баланс.', hpMul: 1.08, dmgMul: 1.1, countMul: 1.25, bulletSpeedMul: 1, aimErr: 0.8, tokens: 4, cdMul: 0.84, teleMul: 1, eliteChance: 0.12, playerHp: 100, dropMul: 0.95, maxHit: 0.25, waveHeal: 0.1 },
  { id: 2, key: 'hard', color: '#ffa126', tag: 'жёстко', actRamp: 1, name: 'Помехи', desc: 'Плотнее и быстрее: больше врагов атакуют разом, замахи короче, элиты.', hpMul: 1.16, dmgMul: 1.24, countMul: 1.33, bulletSpeedMul: 1.06, aimErr: 0.68, tokens: 5, cdMul: 0.76, teleMul: 0.92, eliteChance: 0.18, playerHp: 100, dropMul: 0.85, maxHit: 0.25, waveHeal: 0.07 },
  { id: 3, key: 'nightmare', color: '#ff2d7a', tag: 'предел', actRamp: 0.9, name: 'NULL', desc: 'Темп на пределе реакции. Читай телеграфы — каждый удар можно избежать.', hpMul: 1.24, dmgMul: 1.3, countMul: 1.42, bulletSpeedMul: 1.12, aimErr: 0.58, tokens: 5, cdMul: 0.7, teleMul: 0.85, eliteChance: 0.23, playerHp: 100, dropMul: 0.76, maxHit: 0.28, waveHeal: 0.05 },
  // above NULL: built to train and test bots. Telegraphs stay as fair as on NULL — the extra
  // pressure comes from numbers, aggression, elites and almost no healing.
  { id: 4, key: 'overload', color: '#b14bff', tag: 'для ботов', actRamp: 1.1, name: 'ПЕРЕГРУЗ', desc: 'Для ботов и безумцев: больше врагов, чаще атаки, элиты повсюду, почти без лечения. Телеграфы честные, как на NULL.', hpMul: 1.3, dmgMul: 1.35, countMul: 1.48, bulletSpeedMul: 1.22, aimErr: 0.5, tokens: 6, cdMul: 0.68, teleMul: 0.85, eliteChance: 0.27, playerHp: 100, dropMul: 0.7, maxHit: 0.32, waveHeal: 0.05 },
];

export function difficulty(id: number): DifficultyDef {
  return DIFFICULTIES[id] ?? DIFFICULTIES[1]!;
}
