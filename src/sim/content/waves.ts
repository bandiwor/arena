import { Affix, ET, type EnemyType } from '../constants';

export type Placement = 'edge' | 'ring' | 'random' | 'far' | 'corners' | 'lanes';

export interface SpawnGroup {
  readonly type: EnemyType;
  readonly count: number;
  /** seconds after wave start */
  readonly at: number;
  /** seconds between spawns */
  readonly every: number;
  readonly place: Placement;
  readonly affix?: number;
}

export interface WaveDef {
  readonly name: string;
  readonly groups: readonly SpawnGroup[];
  /** mutator key or undefined */
  readonly mutator?: string;
  readonly boss?: boolean;
  /** 0 = Акт I «Карантин», 1 = Акт II «Плоть» */
  readonly act?: number;
  /** short archive line shown under the wave banner */
  readonly lore?: string;
}

export const WAVES: readonly WaveDef[] = [
  {
    name: 'Пробуждение',
    groups: [
      { type: ET.Swarmer, count: 7, at: 0.5, every: 0.35, place: 'edge' },
      { type: ET.Bloater, count: 2, at: 3.5, every: 1.5, place: 'far' },
      { type: ET.Swarmer, count: 6, at: 8, every: 0.3, place: 'far' },
      { type: ET.Bloater, count: 2, at: 11, every: 1.2, place: 'corners' },
    ],
  },
  {
    name: 'Жала',
    groups: [
      { type: ET.Swarmer, count: 8, at: 0.5, every: 0.3, place: 'edge' },
      { type: ET.Dart, count: 4, at: 2.5, every: 0.6, place: 'ring' },
      { type: ET.Gunner, count: 2, at: 7, every: 1.2, place: 'ring' },
      { type: ET.Bloater, count: 3, at: 10, every: 1, place: 'far' },
      { type: ET.Swarmer, count: 6, at: 13, every: 0.25, place: 'corners' },
    ],
  },
  {
    name: 'Шипы',
    groups: [
      { type: ET.Archer, count: 3, at: 0.5, every: 0.8, place: 'far' },
      { type: ET.Swarmer, count: 10, at: 2, every: 0.25, place: 'edge' },
      { type: ET.Dart, count: 3, at: 5, every: 0.6, place: 'ring' },
      { type: ET.Charger, count: 1, at: 8, every: 0, place: 'far' },
      { type: ET.Bloater, count: 2, at: 11, every: 1, place: 'edge' },
      { type: ET.Gunner, count: 2, at: 13, every: 1, place: 'ring' },
    ],
    mutator: 'overclock',
  },
  {
    name: 'Холодная стена',
    groups: [
      { type: ET.Shielder, count: 2, at: 0.5, every: 1.5, place: 'ring' },
      { type: ET.Archer, count: 4, at: 1.5, every: 0.6, place: 'far' },
      { type: ET.Swarmer, count: 12, at: 5, every: 0.22, place: 'edge' },
      { type: ET.Bloater, count: 3, at: 9, every: 0.8, place: 'corners' },
    ],
    mutator: 'cryo',
  },
  {
    name: 'Притяжение',
    groups: [
      { type: ET.Charger, count: 3, at: 0.5, every: 3, place: 'far' },
      { type: ET.Gunner, count: 4, at: 2, every: 0.8, place: 'ring' },
      { type: ET.Swarmer, count: 14, at: 4, every: 0.2, place: 'edge' },
      { type: ET.Dart, count: 4, at: 9, every: 0.5, place: 'ring' },
    ],
    mutator: 'gravity',
  },
  {
    name: 'Эхо',
    groups: [
      { type: ET.Gunner, count: 5, at: 0.5, every: 0.6, place: 'ring' },
      { type: ET.Shielder, count: 2, at: 1, every: 1, place: 'ring' },
      { type: ET.Archer, count: 4, at: 6, every: 0.7, place: 'far' },
      { type: ET.Swarmer, count: 12, at: 9, every: 0.2, place: 'corners' },
      { type: ET.Bloater, count: 3, at: 12, every: 0.8, place: 'edge' },
    ],
    mutator: 'ricochet',
  },
  {
    name: 'Элита',
    groups: [
      { type: ET.Charger, count: 2, at: 0.5, every: 2, place: 'far', affix: Affix.Armored },
      { type: ET.Gunner, count: 4, at: 2, every: 0.8, place: 'ring', affix: Affix.Fast },
      { type: ET.Swarmer, count: 16, at: 4, every: 0.18, place: 'edge' },
      { type: ET.Dart, count: 4, at: 7, every: 0.4, place: 'ring', affix: Affix.Fast },
      { type: ET.Archer, count: 3, at: 10, every: 0.6, place: 'far', affix: Affix.Volatile },
    ],
    mutator: 'drift',
  },
  {
    name: 'Шторм',
    groups: [
      { type: ET.Swarmer, count: 24, at: 0.5, every: 0.15, place: 'edge' },
      { type: ET.Shielder, count: 3, at: 2, every: 1, place: 'ring' },
      { type: ET.Gunner, count: 5, at: 4, every: 0.6, place: 'ring' },
      { type: ET.Charger, count: 2, at: 8, every: 2, place: 'far' },
      { type: ET.Archer, count: 5, at: 12, every: 0.5, place: 'far' },
      { type: ET.Dart, count: 4, at: 15, every: 0.4, place: 'ring' },
      { type: ET.Bloater, count: 4, at: 16, every: 0.6, place: 'corners' },
    ],
    mutator: 'overclock',
  },
  {
    name: 'МОНОЛИТ',
    groups: [{ type: ET.Boss, count: 1, at: 1.5, every: 0, place: 'ring' }],
    boss: true,
  },
  // ─────────────── Акт II · ПЛОТЬ (denser than late Act I: the player carries ~8 upgrades now)
  {
    name: 'Под кожей',
    act: 1,
    groups: [
      { type: ET.Swarmer, count: 14, at: 0.5, every: 0.2, place: 'edge' },
      { type: ET.Worm, count: 3, at: 2, every: 1.2, place: 'far' },
      { type: ET.Bloater, count: 4, at: 6, every: 0.7, place: 'corners' },
      { type: ET.Gunner, count: 3, at: 9, every: 0.7, place: 'ring' },
      { type: ET.Worm, count: 3, at: 12, every: 0.9, place: 'ring' },
      { type: ET.Swarmer, count: 14, at: 14, every: 0.18, place: 'far' },
      { type: ET.Dart, count: 5, at: 17, every: 0.4, place: 'ring' },
    ],
  },
  {
    name: 'Паразиты',
    act: 1,
    groups: [
      { type: ET.Charger, count: 2, at: 0.5, every: 2, place: 'far' },
      { type: ET.Gunner, count: 4, at: 1.5, every: 0.7, place: 'ring' },
      { type: ET.Parasite, count: 6, at: 4, every: 0.4, place: 'edge' },
      { type: ET.Swarmer, count: 16, at: 6, every: 0.18, place: 'edge' },
      { type: ET.Worm, count: 3, at: 9, every: 0.9, place: 'far' },
      { type: ET.Archer, count: 3, at: 11, every: 0.6, place: 'far' },
      { type: ET.Parasite, count: 5, at: 13, every: 0.35, place: 'corners' },
      { type: ET.Charger, count: 2, at: 16, every: 1.5, place: 'far', affix: Affix.Armored },
    ],
  },
  {
    name: 'Глубина',
    act: 1,
    groups: [
      { type: ET.Worm, count: 6, at: 0.5, every: 1, place: 'ring' },
      { type: ET.Archer, count: 4, at: 2, every: 0.5, place: 'far' },
      { type: ET.Shielder, count: 3, at: 4, every: 0.9, place: 'ring' },
      { type: ET.Parasite, count: 6, at: 6, every: 0.35, place: 'edge' },
      { type: ET.Swarmer, count: 18, at: 8, every: 0.15, place: 'edge' },
      { type: ET.Bloater, count: 5, at: 10, every: 0.5, place: 'corners' },
      { type: ET.Dart, count: 6, at: 12, every: 0.4, place: 'ring' },
      { type: ET.Charger, count: 2, at: 15, every: 1.5, place: 'far', affix: Affix.Fast },
      { type: ET.Worm, count: 3, at: 18, every: 0.8, place: 'far' },
    ],
  },
  {
    name: 'МАТКА',
    act: 1,
    groups: [
      { type: ET.Brood, count: 1, at: 1.5, every: 0, place: 'far' },
      { type: ET.Swarmer, count: 10, at: 4, every: 0.25, place: 'edge' },
      { type: ET.Worm, count: 2, at: 15, every: 1, place: 'ring' },
      { type: ET.Gunner, count: 3, at: 25, every: 0.8, place: 'ring' },
    ],
    boss: true,
  },
  // ─────────────── Акт III · ЛИТЕЙНЫЙ ЦЕХ (the line runs at full output: mass, not just variety)
  {
    name: 'Ленты',
    act: 2,
    lore: 'Конвейер 3 несёт старую маршрутизацию. Не останавливать.',
    groups: [
      { type: ET.GearMite, count: 12, at: 0.5, every: 0.2, place: 'lanes' },
      { type: ET.Gunner, count: 3, at: 5, every: 0.7, place: 'ring' },
      { type: ET.GearMite, count: 10, at: 9, every: 0.2, place: 'edge' },
      { type: ET.Swarmer, count: 14, at: 13, every: 0.18, place: 'far' },
      { type: ET.Dart, count: 5, at: 16, every: 0.4, place: 'ring' },
      { type: ET.GearMite, count: 12, at: 19, every: 0.2, place: 'lanes' },
    ],
  },
  {
    name: 'Пресс',
    act: 2,
    lore: 'Цикл пресса 2.0 с. Удары записаны как уплотнение, а не урон.',
    groups: [
      { type: ET.Stamper, count: 3, at: 0.5, every: 1.2, place: 'corners' },
      { type: ET.GearMite, count: 10, at: 3, every: 0.2, place: 'lanes' },
      { type: ET.Gunner, count: 4, at: 7, every: 0.6, place: 'ring' },
      { type: ET.Shielder, count: 2, at: 10, every: 1, place: 'ring' },
      { type: ET.GearMite, count: 12, at: 13, every: 0.2, place: 'edge' },
      { type: ET.Stamper, count: 2, at: 16, every: 1, place: 'far', affix: Affix.Armored },
      { type: ET.Charger, count: 2, at: 19, every: 1.5, place: 'far' },
    ],
    mutator: 'lockstep',
  },
  {
    name: 'Ток',
    act: 2,
    lore: 'Охлаждающая жидкость проводит ток. Ток проводит Вектор.',
    groups: [
      { type: ET.ArcDrone, count: 4, at: 0.5, every: 0.6, place: 'ring' },
      { type: ET.GearMite, count: 12, at: 3, every: 0.2, place: 'lanes' },
      { type: ET.Stamper, count: 2, at: 7, every: 1, place: 'far' },
      { type: ET.Gunner, count: 3, at: 10, every: 0.7, place: 'ring' },
      { type: ET.ArcDrone, count: 3, at: 14, every: 0.6, place: 'ring' },
      { type: ET.Swarmer, count: 16, at: 16, every: 0.15, place: 'edge' },
      { type: ET.Hauler, count: 1, at: 19, every: 0, place: 'far' },
    ],
    mutator: 'flood',
  },
  {
    name: 'Полная линия',
    act: 2,
    lore: 'Первый пресс строили под старый корпус. Корпус всё ещё в направляющей.',
    groups: [
      { type: ET.Hauler, count: 2, at: 0.5, every: 2, place: 'far' },
      { type: ET.Skiff, count: 2, at: 1, every: 1.5, place: 'edge' },
      { type: ET.GearMite, count: 12, at: 4, every: 0.2, place: 'lanes' },
      { type: ET.ArcDrone, count: 3, at: 9, every: 0.6, place: 'ring' },
      { type: ET.Overseer, count: 1, at: 12, every: 0, place: 'far' },
      { type: ET.Stamper, count: 2, at: 14, every: 1, place: 'corners' },
      { type: ET.GearMite, count: 14, at: 18, every: 0.18, place: 'lanes' },
      { type: ET.Dart, count: 6, at: 20, every: 0.35, place: 'ring' },
      { type: ET.Hauler, count: 1, at: 24, every: 0, place: 'far', affix: Affix.Fast },
    ],
    mutator: 'reverse',
  },
  {
    name: 'ПРЕСС',
    act: 2,
    lore: 'Гидравлика помнит каждый корпус, который сплющила.',
    groups: [
      { type: ET.Press, count: 1, at: 1.5, every: 0, place: 'far' },
      { type: ET.GearMite, count: 8, at: 8, every: 0.3, place: 'lanes' },
      { type: ET.GearMite, count: 8, at: 20, every: 0.3, place: 'lanes' },
      { type: ET.ArcDrone, count: 2, at: 30, every: 0.8, place: 'ring' },
    ],
    mutator: 'magnetic',
    boss: true,
  },
  {
    name: 'СБОРЩИК',
    act: 2,
    lore: 'Сборка 9.3. Компоненты: Вектор (устаревший).',
    groups: [{ type: ET.Assembler, count: 1, at: 2, every: 0, place: 'random' }],
    boss: true,
  },
];

export const ACT_NAMES = ['КАРАНТИН', 'ПЛОТЬ', 'ЛИТЕЙНЫЙ ЦЕХ'] as const;
/** index of wave i within its act, and act length */
export function actWave(i: number): { act: number; n: number; total: number } {
  const act = WAVES[i]?.act ?? 0;
  let n = 0;
  let total = 0;
  for (let k = 0; k < WAVES.length; k++) {
    if ((WAVES[k]!.act ?? 0) !== act) continue;
    total++;
    if (k <= i) n++;
  }
  return { act, n, total };
}

export const WAVE_COUNT = WAVES.length;
