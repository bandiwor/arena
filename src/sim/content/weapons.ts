import { BK, WP, type BulletKind, type WeaponId } from '../constants';

export const Rarity = { Common: 0, Rare: 1, Epic: 2, Legendary: 3 } as const;
export const RARITY_NAMES = ['обычное', 'редкое', 'эпическое', 'легендарное'] as const;

export interface WeaponDef {
  readonly id: WeaponId;
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  readonly rarity: number;
  readonly cooldown: number;
  readonly count: number;
  readonly spread: number;
  readonly speed: number;
  readonly speedJitter: number;
  readonly dmg: number;
  readonly radius: number;
  readonly life: number;
  readonly pierce: number;
  readonly bounce: number;
  readonly kind: BulletKind | -1; // -1 = hitscan
  readonly knock: number;
  /** presentation hints */
  readonly shake: number;
  readonly hitstop: number;
  readonly recoil: number;
  readonly aoe: number;
}

export const WEAPONS: readonly WeaponDef[] = [
  { id: WP.Pulse, key: 'pulse', name: 'Пульсар', desc: 'Надёжная импульсная винтовка.', rarity: 0, cooldown: 0.105, count: 1, spread: 0.035, speed: 42, speedJitter: 0, dmg: 10, radius: 0.16, life: 0.9, pierce: 0, bounce: 0, kind: BK.Pulse, knock: 2.2, shake: 0.07, hitstop: 0, recoil: 0.12, aoe: 0 },
  { id: WP.Scatter, key: 'scatter', name: 'Дробь-9', desc: '9 дробин, мощный откид вблизи.', rarity: 0, cooldown: 0.55, count: 9, spread: 0.42, speed: 36, speedJitter: 0.18, dmg: 8, radius: 0.13, life: 0.38, pierce: 0, bounce: 0, kind: BK.Pellet, knock: 5.5, shake: 0.28, hitstop: 0.02, recoil: 0.45, aoe: 0 },
  { id: WP.Needler, key: 'needler', name: 'Игольник', desc: 'Шквал игл, каждая пробивает цель.', rarity: 1, cooldown: 0.045, count: 1, spread: 0.11, speed: 50, speedJitter: 0.08, dmg: 5, radius: 0.1, life: 0.6, pierce: 1, bounce: 0, kind: BK.Needle, knock: 0.8, shake: 0.04, hitstop: 0, recoil: 0.06, aoe: 0 },
  { id: WP.Launcher, key: 'launcher', name: 'Мортира', desc: 'Гранаты с отскоком. Взрыв по площади.', rarity: 1, cooldown: 0.7, count: 1, spread: 0.02, speed: 22, speedJitter: 0, dmg: 55, radius: 0.3, life: 1.1, pierce: 0, bounce: 3, kind: BK.Grenade, knock: 9, shake: 0.4, hitstop: 0.03, recoil: 0.5, aoe: 3.6 },
  { id: WP.Rail, key: 'rail', name: 'Рельса', desc: 'Мгновенный луч, пробивает всё насквозь.', rarity: 2, cooldown: 0.9, count: 1, spread: 0, speed: 0, speedJitter: 0, dmg: 140, radius: 0.35, life: 0, pierce: 99, bounce: 0, kind: -1, knock: 12, shake: 0.55, hitstop: 0.06, recoil: 0.9, aoe: 0 },
  { id: WP.Singularity, key: 'singularity', name: 'Сингулярность', desc: 'Медленная чёрная дыра. Затягивает и схлопывается.', rarity: 3, cooldown: 2.2, count: 1, spread: 0, speed: 9, speedJitter: 0, dmg: 320, radius: 0.55, life: 1.6, pierce: 99, bounce: 0, kind: BK.Orb, knock: 0, shake: 0.7, hitstop: 0.1, recoil: 1.2, aoe: 7 },
  { id: WP.ArcRail, key: 'arcrail', name: 'Дуговой рельс', desc: 'Луч пробивает до 3 целей и замыкает машины на 1 с.', rarity: 2, cooldown: 0.8, count: 1, spread: 0, speed: 0, speedJitter: 0, dmg: 60, radius: 0.35, life: 0, pierce: 3, bounce: 0, kind: -1, knock: 6, shake: 0.4, hitstop: 0.04, recoil: 0.6, aoe: 0 },
];
// keep id order == array order
WEAPONS.forEach((w, i) => {
  if (w.id !== i) throw new Error('weapon table order mismatch');
});

export function weaponDef(id: number): WeaponDef {
  const w = WEAPONS[id];
  if (!w) throw new Error(`unknown weapon ${id}`);
  return w;
}
