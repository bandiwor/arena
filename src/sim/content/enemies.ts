import { ET, Mat, type EnemyType, type MatId } from '../constants';

export interface EnemyDef {
  readonly type: EnemyType;
  readonly key: string;
  readonly name: string;
  readonly hp: number;
  readonly r: number;
  readonly speed: number;
  readonly accel: number;
  readonly mass: number;
  readonly material: MatId;
  readonly contactDmg: number;
  readonly score: number;
  /** spawn telegraph time, s */
  readonly spawnTime: number;
  /** drop chance for health orb */
  readonly drop: number;
  /** visual height used by renderer for spawn dissolve, hit points, etc. */
  readonly height: number;
}

export const ENEMIES: readonly EnemyDef[] = [
  { type: ET.Swarmer, key: 'swarmer', name: 'Роевик', hp: 18, r: 0.45, speed: 6.8, accel: 40, mass: 0.6, material: Mat.Flesh, contactDmg: 8, score: 10, spawnTime: 0.7, drop: 0.04, height: 0.7 },
  { type: ET.Gunner, key: 'gunner', name: 'Дрон-стрелок', hp: 40, r: 0.6, speed: 5.2, accel: 22, mass: 1, material: Mat.Machine, contactDmg: 6, score: 25, spawnTime: 0.9, drop: 0.08, height: 1.4 },
  { type: ET.Charger, key: 'charger', name: 'Таран', hp: 130, r: 0.95, speed: 3.6, accel: 14, mass: 4, material: Mat.Flesh, contactDmg: 22, score: 50, spawnTime: 1.1, drop: 0.2, height: 1.5 },
  { type: ET.Archer, key: 'archer', name: 'Терновник', hp: 32, r: 0.6, speed: 4.6, accel: 26, mass: 0.9, material: Mat.Plant, contactDmg: 5, score: 30, spawnTime: 1.0, drop: 0.1, height: 1.6 },
  { type: ET.Shielder, key: 'shielder', name: 'Призма', hp: 95, r: 0.85, speed: 3.4, accel: 16, mass: 3, material: Mat.Crystal, contactDmg: 12, score: 45, spawnTime: 1.0, drop: 0.15, height: 1.7 },
  { type: ET.Boss, key: 'boss', name: 'МОНОЛИТ', hp: 5200, r: 2.6, speed: 3.2, accel: 8, mass: 60, material: Mat.Void, contactDmg: 30, score: 2000, spawnTime: 2.5, drop: 0, height: 5 },
];

export function enemyDef(t: number): EnemyDef {
  const d = ENEMIES[t];
  if (!d) throw new Error(`unknown enemy type ${t}`);
  return d;
}

export function enemyTypeByKey(key: string): EnemyType {
  const d = ENEMIES.find((e) => e.key === key);
  if (!d) throw new Error(`unknown enemy key '${key}'`);
  return d.type;
}
