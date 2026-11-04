import { Affix, ET, type EnemyType } from '../constants';

export type Placement = 'edge' | 'ring' | 'random' | 'far' | 'corners';

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
}

export const WAVES: readonly WaveDef[] = [
  {
    name: 'Пробуждение',
    groups: [
      { type: ET.Swarmer, count: 8, at: 0.5, every: 0.35, place: 'edge' },
      { type: ET.Swarmer, count: 6, at: 6, every: 0.3, place: 'far' },
    ],
  },
  {
    name: 'Наблюдатели',
    groups: [
      { type: ET.Swarmer, count: 10, at: 0.5, every: 0.3, place: 'edge' },
      { type: ET.Gunner, count: 3, at: 2, every: 1.2, place: 'ring' },
      { type: ET.Swarmer, count: 8, at: 10, every: 0.25, place: 'corners' },
    ],
  },
  {
    name: 'Шипы',
    groups: [
      { type: ET.Archer, count: 3, at: 0.5, every: 0.8, place: 'far' },
      { type: ET.Swarmer, count: 12, at: 2, every: 0.25, place: 'edge' },
      { type: ET.Charger, count: 1, at: 8, every: 0, place: 'far' },
      { type: ET.Gunner, count: 2, at: 12, every: 1, place: 'ring' },
    ],
    mutator: 'overclock',
  },
  {
    name: 'Холодная стена',
    groups: [
      { type: ET.Shielder, count: 2, at: 0.5, every: 1.5, place: 'ring' },
      { type: ET.Archer, count: 4, at: 1.5, every: 0.6, place: 'far' },
      { type: ET.Swarmer, count: 14, at: 5, every: 0.22, place: 'edge' },
    ],
    mutator: 'cryo',
  },
  {
    name: 'Притяжение',
    groups: [
      { type: ET.Charger, count: 3, at: 0.5, every: 3, place: 'far' },
      { type: ET.Gunner, count: 4, at: 2, every: 0.8, place: 'ring' },
      { type: ET.Swarmer, count: 18, at: 4, every: 0.2, place: 'edge' },
    ],
    mutator: 'gravity',
  },
  {
    name: 'Эхо',
    groups: [
      { type: ET.Gunner, count: 5, at: 0.5, every: 0.6, place: 'ring' },
      { type: ET.Shielder, count: 2, at: 1, every: 1, place: 'ring' },
      { type: ET.Archer, count: 4, at: 6, every: 0.7, place: 'far' },
      { type: ET.Swarmer, count: 16, at: 9, every: 0.2, place: 'corners' },
    ],
    mutator: 'ricochet',
  },
  {
    name: 'Элита',
    groups: [
      { type: ET.Charger, count: 2, at: 0.5, every: 2, place: 'far', affix: Affix.Armored },
      { type: ET.Gunner, count: 4, at: 2, every: 0.8, place: 'ring', affix: Affix.Fast },
      { type: ET.Swarmer, count: 20, at: 4, every: 0.18, place: 'edge' },
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
    ],
    mutator: 'overclock',
  },
  {
    name: 'МОНОЛИТ',
    groups: [{ type: ET.Boss, count: 1, at: 1.5, every: 0, place: 'ring' }],
    boss: true,
  },
];

export const WAVE_COUNT = WAVES.length;
