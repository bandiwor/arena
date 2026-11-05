import { WP } from '../constants';
import type { World } from '../world';

export interface UpgradeDef {
  readonly id: number;
  readonly key: string;
  readonly name: string;
  readonly desc: string;
  readonly rarity: number;
  readonly weight: number;
  readonly minWave: number;
  readonly maxStacks: number;
  /** weapon unlock id or -1 */
  readonly weapon: number;
  readonly apply: (w: World) => void;
}

const u = (d: Omit<UpgradeDef, 'id'>, id: number): UpgradeDef => ({ ...d, id });

const defs: Omit<UpgradeDef, 'id'>[] = [
  { key: 'dmg', name: 'Перегретое ядро', desc: '+20% урона', rarity: 0, weight: 10, minWave: 0, maxStacks: 6, weapon: -1, apply: (w) => void (w.player.stats.dmgMul += 0.2) },
  { key: 'rate', name: 'Разгон затвора', desc: '+18% скорострельности', rarity: 0, weight: 10, minWave: 0, maxStacks: 6, weapon: -1, apply: (w) => void (w.player.stats.rateMul += 0.18) },
  { key: 'speed', name: 'Сервоприводы', desc: '+12% скорости движения', rarity: 0, weight: 7, minWave: 0, maxStacks: 4, weapon: -1, apply: (w) => void (w.player.stats.speedMul += 0.12) },
  {
    key: 'hp', name: 'Бронеплита', desc: '+25 к макс. здоровью и лечение на 25', rarity: 0, weight: 8, minWave: 0, maxStacks: 5, weapon: -1,
    apply: (w) => { w.player.maxHp += 25; w.player.hp = Math.min(w.player.maxHp, w.player.hp + 25); },
  },
  { key: 'heal', name: 'Наноремонт', desc: 'Восстановить 60% здоровья', rarity: 0, weight: 6, minWave: 1, maxStacks: 99, weapon: -1, apply: (w) => void (w.player.hp = Math.min(w.player.maxHp, w.player.hp + w.player.maxHp * 0.6)) },
  { key: 'pierce', name: 'Бронебой', desc: 'Снаряды пробивают +1 цель', rarity: 1, weight: 5, minWave: 1, maxStacks: 3, weapon: -1, apply: (w) => void (w.player.stats.pierceAdd += 1) },
  { key: 'multi', name: 'Расщепитель', desc: '+1 снаряд за выстрел', rarity: 1, weight: 4, minWave: 2, maxStacks: 3, weapon: -1, apply: (w) => void (w.player.stats.projAdd += 1) },
  { key: 'bounce', name: 'Рикошет', desc: 'Снаряды отскакивают от стен +1 раз', rarity: 1, weight: 5, minWave: 1, maxStacks: 3, weapon: -1, apply: (w) => void (w.player.stats.bounceAdd += 1) },
  { key: 'crit', name: 'Критическая масса', desc: '+10% шанс крита (x2.5 урон)', rarity: 1, weight: 6, minWave: 0, maxStacks: 5, weapon: -1, apply: (w) => void (w.player.stats.crit += 0.1) },
  { key: 'vel', name: 'Ускоритель', desc: '+25% скорость снарядов, +8% урон', rarity: 0, weight: 5, minWave: 0, maxStacks: 3, weapon: -1, apply: (w) => { w.player.stats.bulletSpeedMul += 0.25; w.player.stats.dmgMul += 0.08; } },
  { key: 'dash', name: 'Фазовый рывок', desc: 'Перезарядка рывка −30%, рывок бьёт врагов', rarity: 1, weight: 5, minWave: 1, maxStacks: 3, weapon: -1, apply: (w) => { w.player.stats.dashCdMul *= 0.7; w.player.stats.dashShock += 30; } },
  { key: 'leech', name: 'Паразит', desc: 'Каждое убийство лечит 1 HP', rarity: 2, weight: 3, minWave: 2, maxStacks: 3, weapon: -1, apply: (w) => void (w.player.stats.lifesteal += 1) },
  { key: 'insulated', name: 'Изоляция', desc: 'Охладитель и дуги пилонов больше не бьют тебя; +10% макс. здоровья', rarity: 1, weight: 6, minWave: 13, maxStacks: 1, weapon: -1, apply: (w) => { w.player.stats.insulated = 1; w.player.maxHp *= 1.1; w.player.hp *= 1.1; } },
  { key: 'arcchain', name: 'Дуговая цепь', desc: 'Дуги пилонов перескакивают на +1 цель', rarity: 1, weight: 5, minWave: 13, maxStacks: 3, weapon: -1, apply: (w) => void (w.player.stats.arcChain += 1) },
  { key: 'shrapnel', name: 'Шрапнель', desc: 'Убитые машины разлетаются 2 заклёпками (4 урона)', rarity: 0, weight: 6, minWave: 13, maxStacks: 3, weapon: -1, apply: (w) => void (w.player.stats.shrapnel += 1) },
  { key: 'w_arcrail', name: 'Дуговой рельс', desc: 'ЭПИК: луч пробивает 3 цели и замыкает машины', rarity: 2, weight: 4, minWave: 17, maxStacks: 1, weapon: WP.ArcRail, apply: (w) => giveWeapon(w, WP.ArcRail) },
  { key: 'w_scatter', name: 'Дробь-9', desc: 'Новое оружие: дробовик', rarity: 0, weight: 7, minWave: 0, maxStacks: 1, weapon: WP.Scatter, apply: (w) => giveWeapon(w, WP.Scatter) },
  { key: 'w_needler', name: 'Игольник', desc: 'Новое оружие: шквал пробивающих игл', rarity: 1, weight: 5, minWave: 1, maxStacks: 1, weapon: WP.Needler, apply: (w) => giveWeapon(w, WP.Needler) },
  { key: 'w_launcher', name: 'Мортира', desc: 'Новое оружие: гранатомёт', rarity: 1, weight: 5, minWave: 1, maxStacks: 1, weapon: WP.Launcher, apply: (w) => giveWeapon(w, WP.Launcher) },
  { key: 'w_rail', name: 'Рельса', desc: 'ЭПИК: мгновенный пробивающий луч', rarity: 2, weight: 3, minWave: 2, maxStacks: 1, weapon: WP.Rail, apply: (w) => giveWeapon(w, WP.Rail) },
  { key: 'w_sing', name: 'Сингулярность', desc: 'ЛЕГЕНДА: чёрная дыра, затягивает и схлопывается', rarity: 3, weight: 1.6, minWave: 4, maxStacks: 1, weapon: WP.Singularity, apply: (w) => giveWeapon(w, WP.Singularity) },
];

export const UPGRADES: readonly UpgradeDef[] = defs.map((d, i) => u(d, i));

export function upgradeByKey(key: string): UpgradeDef {
  const d = UPGRADES.find((x) => x.key === key);
  if (!d) throw new Error(`unknown upgrade ${key}`);
  return d;
}

export function giveWeapon(w: World, id: number): void {
  const p = w.player;
  for (let i = 0; i < p.slotCount; i++) if (p.slots[i] === id) return;
  if (p.slotCount >= p.slots.length) return;
  p.slots[p.slotCount] = id;
  p.cur = p.slotCount;
  p.slotCount++;
}

export function ownsWeapon(w: World, id: number): boolean {
  const p = w.player;
  for (let i = 0; i < p.slotCount; i++) if (p.slots[i] === id) return true;
  return false;
}

/** stack counts live outside defs: Uint8 array per world. */
export const upgradeStacks = new WeakMap<World, Uint8Array>();
export function stacksOf(w: World): Uint8Array {
  let s = upgradeStacks.get(w);
  if (!s) {
    s = new Uint8Array(UPGRADES.length);
    upgradeStacks.set(w, s);
  }
  return s;
}
