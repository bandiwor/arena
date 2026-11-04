export interface DifficultyDef {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  readonly hpMul: number;
  readonly dmgMul: number;
  readonly countMul: number;
  readonly bulletSpeedMul: number;
  readonly aimErr: number;
  readonly tokens: number;
  readonly cdMul: number;
  readonly eliteChance: number;
  readonly playerHp: number;
  readonly dropMul: number;
}

export const DIFFICULTIES: readonly DifficultyDef[] = [
  { id: 0, key: 'easy', name: 'Сигнал', desc: 'Мягкий вход. Враги медленнее целятся, лечилки чаще.', hpMul: 0.75, dmgMul: 0.6, countMul: 0.8, bulletSpeedMul: 0.85, aimErr: 1.7, tokens: 2, cdMul: 1.3, eliteChance: 0, playerHp: 120, dropMul: 1.5 },
  { id: 1, key: 'normal', name: 'Шум', desc: 'Задуманный баланс.', hpMul: 1, dmgMul: 1, countMul: 1, bulletSpeedMul: 1, aimErr: 1, tokens: 3, cdMul: 1, eliteChance: 0.05, playerHp: 100, dropMul: 1 },
  { id: 2, key: 'hard', name: 'Помехи', desc: 'Больше врагов, точнее стрельба, элиты.', hpMul: 1.3, dmgMul: 1.3, countMul: 1.2, bulletSpeedMul: 1.1, aimErr: 0.7, tokens: 4, cdMul: 0.85, eliteChance: 0.12, playerHp: 100, dropMul: 0.8 },
  { id: 3, key: 'nightmare', name: 'NULL', desc: 'Для тех, кто читает паттерны во сне.', hpMul: 1.6, dmgMul: 1.6, countMul: 1.4, bulletSpeedMul: 1.2, aimErr: 0.45, tokens: 6, cdMul: 0.7, eliteChance: 0.22, playerHp: 90, dropMul: 0.6 },
];

export function difficulty(id: number): DifficultyDef {
  return DIFFICULTIES[id] ?? DIFFICULTIES[1]!;
}
