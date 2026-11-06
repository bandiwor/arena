/**
 * NULL//ARENA palette. Colour carries gameplay meaning — never break these rules:
 *  cyan = player & friendly · magenta/pink = hostile · amber = hazard/explosion
 *  violet = energy/elite/boss (boss & mini-boss rims) · lime = pickups & plant sap · crimson = flesh
 *  electricity = violet · floor hazards & impact marks = amber · enemy projectiles/aim lines = magenta
 * Values are sRGB hex; use lin() to get linear floats for shaders.
 */
export const PAL = {
  void: 0x06050b,
  floor: 0x0d0b17,
  floorLine: 0x1c1830,
  wall: 0x141026,
  player: 0x2ef2ff,
  playerCore: 0xe8ffff,
  enemy: 0xff2d7a,
  enemyBullet: 0xff4fd8,
  hazard: 0xffa126,
  hazardHot: 0xff5a1f,
  energy: 0x9b5cff,
  pickup: 0xb6ff3b,
  white: 0xffffff,
  // materials
  flesh: 0x8a0f1e,
  fleshBright: 0xff2a3a,
  plant: 0x2f6b1f,
  plantSap: 0xb6ff3b,
  /** flesh pus / acid: sulphur yellow — must never read as a lime pickup */
  pus: 0xffd84a,
  machine: 0x2a2d3a,
  machineHot: 0xffa126,
  // Линия 9 steel tones (all machines share them)
  steelDark: 0x232833,
  steel: 0x3a4252,
  steelLight: 0x5a6478,
  crystal: 0x6e8bff,
  crystalBright: 0xc9d4ff,
  voidMat: 0x120a22,
  /** elite affix aura: violet = empowered (never lime — lime means pickups) */
  elite: 0xc77dff,
} as const;

/** Rarity colours (common → legendary). */
export const RARITY_HEX = [0x2ef2ff, 0x5cff9b, 0xb36bff, 0xffb02e] as const;

export function srgbToLinear(c: number): number {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/** hex → linear rgb into out[o..o+2], scaled */
export function lin(hex: number, out: Float32Array | number[], o = 0, scale = 1): void {
  out[o] = srgbToLinear(((hex >> 16) & 255) / 255) * scale;
  out[o + 1] = srgbToLinear(((hex >> 8) & 255) / 255) * scale;
  out[o + 2] = srgbToLinear((hex & 255) / 255) * scale;
}

export function linArr(hex: number, scale = 1): [number, number, number] {
  const a: [number, number, number] = [0, 0, 0];
  lin(hex, a, 0, scale);
  return a;
}

export function hexCss(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}
