import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  type BufferGeometry,
} from 'three';
import { ModelBuilder, Part } from './builder';
import { PAL } from '../palette';

export interface ParamSpec {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
}
export type Params = Record<string, number>;

export interface ModelDef {
  readonly key: string;
  readonly name: string;
  /** visual height (for dissolve normalisation & hit points) */
  readonly height: number;
  /** rim colour hex: team colour */
  readonly rim: number;
  readonly params: Readonly<Record<string, ParamSpec>>;
  build(p: Params): BufferGeometry;
}

const P = (value: number, min: number, max: number, step = 0.01): ParamSpec => ({ value, min, max, step });

export function defaults(def: ModelDef): Params {
  const o: Params = {};
  for (const [k, s] of Object.entries(def.params)) o[k] = s.value;
  return o;
}

const D2R = Math.PI / 180;

// ───────────────────────────────────────── player
const player: ModelDef = {
  key: 'player',
  name: 'Игрок — «Вектор»',
  height: 1.3,
  rim: PAL.player,
  params: { bodyLen: P(1.15, 0.6, 2), bodyW: P(0.75, 0.4, 1.4), gunLen: P(0.9, 0.3, 1.6), ring: P(0.62, 0.3, 1), stripes: P(1, 0, 1) },
  build(p) {
    const b = new ModelBuilder();
    const dark = 0x2a3248;
    const hull = 0x55617e;
    // hover ring (spins)
    b.add(new TorusGeometry(p['ring']!, 0.07, 4, 18), { color: PAL.player, emit: 1, part: Part.Spin, param: 4, pos: [0, 0.22, 0], rot: [Math.PI / 2, 0, 0], pivot: [0, 0.22, 0] });
    // wedge body: 4-sided cone pointing forward
    b.add(new ConeGeometry(0.5, 1, 4, 1), { color: hull, pos: [0.05, 0.62, 0], rot: [0, 0, -Math.PI / 2], scale: [p['bodyW']!, p['bodyLen']!, 0.62] });
    b.add(new BoxGeometry(0.7, 0.28, 0.62), { color: dark, pos: [-0.25, 0.48, 0] });
    // cockpit
    b.add(new OctahedronGeometry(0.2, 0), { color: PAL.playerCore, emit: 0.9, part: Part.Core, param: 0.25, pos: [0.15, 0.82, 0], scale: [1.4, 0.6, 0.9] });
    // shoulder pods
    for (const z of [-1, 1]) {
      b.add(new BoxGeometry(0.42, 0.24, 0.22), { color: hull, pos: [-0.25, 0.7, z * 0.42] });
      b.add(new BoxGeometry(0.44, 0.04, 0.24), { color: PAL.player, emit: p['stripes']!, pos: [-0.25, 0.83, z * 0.42] });
      b.add(new BoxGeometry(0.08, 0.14, 0.16), { color: PAL.hazard, emit: 0.8, pos: [-0.5, 0.66, z * 0.42] });
    }
    // gun (recoils)
    const gl = p['gunLen']!;
    b.add(new BoxGeometry(gl, 0.14, 0.14), { color: dark, part: Part.Recoil, param: 0.42, pos: [0.4 + gl / 2, 0.6, 0.2] });
    b.add(new BoxGeometry(0.1, 0.1, 0.1), { color: PAL.player, emit: 1, part: Part.Recoil, param: 0.42, pos: [0.42 + gl, 0.6, 0.2] });
    // thrusters
    b.add(new CylinderGeometry(0.12, 0.08, 0.2, 6), { color: PAL.player, emit: 1, pos: [-0.62, 0.48, 0], rot: [0, 0, Math.PI / 2] });
    return b.build();
  },
};

// ───────────────────────────────────────── swarmer (flesh crawler)
const swarmer: ModelDef = {
  key: 'swarmer',
  name: 'Роевик (плоть)',
  height: 0.75,
  rim: PAL.enemy,
  params: { size: P(0.5, 0.3, 0.8), spikes: P(5, 0, 9, 1), legLen: P(0.5, 0.2, 0.9), jitter: P(0.12, 0, 0.3) },
  build(p) {
    const b = new ModelBuilder();
    const s = p['size']!;
    b.add(new IcosahedronGeometry(s, 1), { color: PAL.flesh, pos: [0, 0.45, 0], scale: [1.25, 0.75, 1], jitter: p['jitter']!, jitterSeed: 1 });
    b.add(new IcosahedronGeometry(s * 0.45, 0), { color: 0x4a0812, pos: [s * 0.9, 0.42, 0], scale: [1, 0.8, 1], jitter: p['jitter']! * 0.5 });
    // eyes
    for (const z of [-1, 1]) b.add(new SphereGeometry(0.07, 5, 4), { color: PAL.enemy, emit: 1, part: Part.Core, param: 0.6, pos: [s * 1.12, 0.5, z * 0.11], pivot: [s * 1.12, 0.5, z * 0.11] });
    // mandibles
    for (const z of [-1, 1]) b.add(new ConeGeometry(0.05, 0.3, 4), { color: 0xd8c8b0, pos: [s * 1.2, 0.33, z * 0.12], rot: [0, 0, -Math.PI / 2 - 0.3], part: Part.Petal, param: 0.6, pivot: [s * 1.1, 0.33, z * 0.12] });
    // dorsal spikes
    const n = p['spikes']!;
    for (let k = 0; k < n; k++) {
      const t = n === 1 ? 0.5 : k / (n - 1);
      b.add(new ConeGeometry(0.07, 0.32, 4), { color: 0x2a0408, emit: 0, pos: [s * (0.6 - t * 1.3), 0.45 + s * 0.68, 0], rot: [0, 0, 0.5 + t * 0.4] });
    }
    // legs: 3 per side
    const L = p['legLen']!;
    const start = b.vertexCount;
    for (let k = 0; k < 3; k++) {
      const x = (k - 1) * s * 0.65;
      b.add(new ConeGeometry(0.05, L, 4), { color: 0x3a060c, part: Part.Leg, param: 1, pos: [x, 0.25, s * 0.85], rot: [-0.9, 0, 0], pivot: [x, 0.4, s * 0.6] });
    }
    b.mirrorZ(start);
    return b.build();
  },
};

// ───────────────────────────────────────── gunner drone (machine)
const gunner: ModelDef = {
  key: 'gunner',
  name: 'Дрон-стрелок (машина)',
  height: 1.5,
  rim: PAL.enemy,
  params: { hover: P(1.0, 0.5, 1.6), body: P(0.5, 0.3, 0.8), rotor: P(0.75, 0.4, 1.2), barrels: P(2, 1, 4, 1) },
  build(p) {
    const b = new ModelBuilder();
    const h = p['hover']!;
    const bs = p['body']!;
    const bob = { part: Part.Bob, param: 0.08 } as const;
    b.add(new CylinderGeometry(bs, bs * 0.85, 0.42, 6), { color: PAL.machine, pos: [0, h, 0], ...bob });
    b.add(new CylinderGeometry(bs * 0.85, bs * 0.4, 0.2, 6), { color: 0x1b1d26, pos: [0, h - 0.31, 0], ...bob });
    b.add(new CylinderGeometry(bs * 0.6, bs * 0.9, 0.16, 6), { color: 0x3a3e4e, pos: [0, h + 0.29, 0], ...bob });
    // hazard band
    b.add(new CylinderGeometry(bs * 1.01, bs * 1.01, 0.06, 6), { color: PAL.hazard, emit: 0.6, pos: [0, h + 0.08, 0], ...bob });
    // eye lens (charges up)
    b.add(new SphereGeometry(0.12, 8, 6), { color: PAL.enemy, emit: 1, part: Part.Core, param: 0.9, pos: [bs * 0.95, h, 0], pivot: [bs * 0.95, h, 0] });
    // barrels
    const nb = p['barrels']!;
    for (let k = 0; k < nb; k++) {
      const z = nb === 1 ? 0 : (k / (nb - 1) - 0.5) * 0.5;
      b.add(new BoxGeometry(0.55, 0.09, 0.09), { color: 0x14161e, part: Part.Recoil, param: 0.15, pos: [bs + 0.2, h - 0.15, z] });
      b.add(new BoxGeometry(0.06, 0.07, 0.07), { color: PAL.enemy, emit: 0.8, part: Part.Recoil, param: 0.15, pos: [bs + 0.48, h - 0.15, z] });
    }
    // rotor ring
    b.add(new TorusGeometry(p['rotor']!, 0.04, 3, 16), { color: PAL.enemy, emit: 0.7, part: Part.Spin, param: 9, pos: [0, h + 0.05, 0], rot: [Math.PI / 2, 0, 0], pivot: [0, h, 0] });
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      b.add(new BoxGeometry(p['rotor']!, 0.03, 0.08), { color: 0x3a3e4e, part: Part.Spin, param: 9, pos: [Math.cos(a) * p['rotor']! * 0.5, h + 0.05, Math.sin(a) * p['rotor']! * 0.5], rot: [0, -a, 0], pivot: [0, h, 0] });
    }
    b.add(new CylinderGeometry(0.015, 0.015, 0.5, 3), { color: 0x777777, pos: [-bs * 0.5, h + 0.55, 0], ...bob });
    b.add(new SphereGeometry(0.05, 4, 3), { color: PAL.enemy, emit: 1, pos: [-bs * 0.5, h + 0.82, 0], ...bob });
    return b.build();
  },
};

// ───────────────────────────────────────── charger (flesh brute)
const charger: ModelDef = {
  key: 'charger',
  name: 'Таран (плоть, броня)',
  height: 1.6,
  rim: PAL.enemy,
  params: { bulk: P(0.95, 0.6, 1.4), horn: P(0.7, 0.2, 1.2), plates: P(4, 0, 7, 1), jitter: P(0.16, 0, 0.35) },
  build(p) {
    const b = new ModelBuilder();
    const k = p['bulk']!;
    b.add(new IcosahedronGeometry(k, 1), { color: PAL.flesh, pos: [-0.15, 0.95, 0], scale: [1.3, 0.85, 1], jitter: p['jitter']!, jitterSeed: 4 });
    // armoured head
    b.add(new BoxGeometry(0.75, 0.6, 0.85), { color: 0xd8c8b0, pos: [k * 0.95, 0.78, 0], rot: [0, 0, -0.25] });
    b.add(new BoxGeometry(0.3, 0.12, 0.7), { color: PAL.enemy, emit: 1, part: Part.Core, param: 0.4, pos: [k * 1.3, 0.85, 0], pivot: [k * 1.3, 0.85, 0] });
    // horns
    for (const z of [-1, 1]) b.add(new ConeGeometry(0.13, p['horn']!, 5), { color: 0xeee2c8, pos: [k * 1.3, 1.05, z * 0.38], rot: [z * 0.4, 0, -Math.PI / 2 + 0.5] });
    // dorsal armour plates + glowing vents between
    const n = p['plates']!;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      b.add(new BoxGeometry(0.42, 0.14, 1.1 - t * 0.3), { color: 0xbfae93, pos: [k * (0.55 - t * 1.4), 1.62 - t * 0.25, 0], rot: [0, 0, 0.2 + t * 0.3] });
      if (i < n - 1) b.add(new BoxGeometry(0.1, 0.08, 0.7), { color: PAL.enemy, emit: 1, part: Part.Core, param: 0.3, pos: [k * (0.35 - t * 1.4), 1.6 - t * 0.25, 0], pivot: [k * (0.35 - t * 1.4), 1.6 - t * 0.25, 0] });
    }
    const start = b.vertexCount;
    for (const x of [0.45, -0.75]) b.add(new CylinderGeometry(0.2, 0.13, 0.75, 5), { color: 0x4a0812, part: Part.Leg, param: 1, pos: [x, 0.38, 0.55], pivot: [x, 0.75, 0.55] });
    b.mirrorZ(start);
    return b.build();
  },
};

// ───────────────────────────────────────── archer (plant)
const archer: ModelDef = {
  key: 'archer',
  name: 'Терновник (растение)',
  height: 1.7,
  rim: PAL.enemy,
  params: { stem: P(1.25, 0.8, 1.8), petals: P(6, 3, 10, 1), petalLen: P(0.6, 0.3, 1), thorns: P(7, 0, 14, 1), bloom: P(1, 0, 2) },
  build(p) {
    const b = new ModelBuilder();
    const H = p['stem']!;
    // roots
    const start = b.vertexCount;
    for (let i = 0; i < 2; i++) b.add(new ConeGeometry(0.08, 0.6, 4), { color: 0x23401a, part: Part.Leg, param: 0.6, pos: [i ? -0.25 : 0.25, 0.15, 0.25], rot: [-1.0, 0, i ? 0.4 : -0.4], pivot: [0, 0.3, 0] });
    b.mirrorZ(start);
    // stem segments (slight zigzag)
    for (let i = 0; i < 4; i++) {
      const y = 0.2 + (i + 0.5) * (H / 4);
      b.add(new CylinderGeometry(0.13 - i * 0.015, 0.16 - i * 0.015, H / 4 + 0.02, 5), { color: PAL.plant, pos: [Math.sin(i * 1.7) * 0.05, y, Math.cos(i * 1.3) * 0.05], jitter: 0.03, jitterSeed: i });
    }
    // thorns along stem
    const nt = p['thorns']!;
    for (let i = 0; i < nt; i++) {
      const a = i * 2.4;
      const y = 0.3 + (i / Math.max(1, nt)) * H;
      b.add(new ConeGeometry(0.035, 0.22, 3), { color: 0xd8e8a0, pos: [Math.cos(a) * 0.15, y, Math.sin(a) * 0.15], rot: [Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4] });
    }
    // thorn-bow: a partial torus arc held in front, bending back as it charges + glowing string
    const bowY = H * 0.78;
    b.add(new TorusGeometry(0.62, 0.045, 4, 14, 2.3), {
      color: 0x3f7a2a,
      part: Part.Petal,
      param: 0.35,
      pos: [0.05, bowY, 0],
      rot: [Math.PI / 2, 0, -2.3 / 2],
      pivot: [0.3, bowY, 0],
    });
    for (const z of [-1, 1]) b.add(new ConeGeometry(0.06, 0.28, 3), { color: 0xd8e8a0, pos: [0.05 + Math.cos(1.15) * 0.62, bowY, z * Math.sin(1.15) * 0.62], rot: [z * 1.3, 0, 0] });
    b.add(new BoxGeometry(0.02, 0.02, 1.15), { color: PAL.plantSap, emit: 0.8, part: Part.Recoil, param: 0.35, pos: [0.05 + Math.cos(1.15) * 0.62, bowY, 0] });
    // leaves along the stem
    for (const [y, a] of [[0.45, 0.3], [0.8, 2.6], [1.05, 4.4]] as const) {
      b.add(new SphereGeometry(0.22, 5, 3), { color: 0x356b22, pos: [Math.cos(a) * 0.28, y, Math.sin(a) * 0.28], scale: [1.4, 0.12, 0.55], rot: [0, -a, 0.35], part: Part.Bob, param: 0.02 });
    }
    // flower head: petals open with charge, core glows
    const top = H + 0.2;
    const np = p['petals']!;
    for (let i = 0; i < np; i++) {
      const a = (i / np) * Math.PI * 2;
      b.add(new ConeGeometry(0.12, p['petalLen']!, 3), {
        color: i % 2 ? 0x7a1b4a : 0x4d8a2a,
        emit: i % 2 ? 0.25 : 0,
        part: Part.Petal,
        param: p['bloom']!,
        pos: [Math.cos(a) * 0.18, top + 0.18, Math.sin(a) * 0.18],
        rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5],
        pivot: [0, top, 0],
      });
    }
    b.add(new IcosahedronGeometry(0.15, 0), { color: PAL.plantSap, emit: 0.8, part: Part.Core, param: 0.8, pos: [0.04, top + 0.1, 0], pivot: [0.04, top + 0.1, 0] });
    b.add(new SphereGeometry(0.06, 5, 4), { color: PAL.enemy, emit: 1, part: Part.Core, param: 0.8, pos: [0.18, top + 0.12, 0], pivot: [0.18, top + 0.12, 0] });
    return b.build();
  },
};

// ───────────────────────────────────────── shielder (crystal)
const shielder: ModelDef = {
  key: 'shielder',
  name: 'Призма (кристалл, щит)',
  height: 1.8,
  rim: PAL.enemy,
  params: { core: P(0.55, 0.3, 0.9), shards: P(4, 0, 8, 1), shieldArc: P(110, 40, 180, 1), shieldH: P(1.4, 0.6, 2) },
  build(p) {
    const b = new ModelBuilder();
    const c = p['core']!;
    b.add(new OctahedronGeometry(c, 0), { color: PAL.crystal, emit: 0.15, part: Part.Bob, param: 0.1, pos: [0, 1.05, 0], scale: [0.8, 1.5, 0.8] });
    b.add(new OctahedronGeometry(c * 0.45, 0), { color: PAL.crystalBright, emit: 1, part: Part.Core, param: 0.6, pos: [0, 1.05, 0], pivot: [0, 1.05, 0] });
    // base
    b.add(new CylinderGeometry(0.45, 0.6, 0.18, 6), { color: 0x262a40, pos: [0, 0.09, 0] });
    b.add(new CylinderGeometry(0.47, 0.47, 0.04, 6), { color: PAL.enemy, emit: 0.8, pos: [0, 0.2, 0] });
    // orbiting shards
    const ns = p['shards']!;
    for (let i = 0; i < ns; i++) {
      const a = (i / Math.max(1, ns)) * Math.PI * 2;
      b.add(new TetrahedronGeometry(0.14, 0), { color: PAL.crystalBright, emit: 0.5, part: Part.Spin, param: 2.2, pos: [Math.cos(a) * 0.9, 1.25 + Math.sin(a * 2) * 0.2, Math.sin(a) * 0.9], pivot: [0, 1, 0] });
    }
    // front shield: arc of panels centred on +x
    const arc = p['shieldArc']! * D2R;
    const n = 7;
    const R = 1.15;
    for (let i = 0; i < n; i++) {
      const a = (i / (n - 1) - 0.5) * arc;
      b.add(new BoxGeometry(0.06, p['shieldH']!, (arc * R) / n * 0.92), {
        color: 0x8fa6ff,
        emit: 0.55,
        part: Part.Shield,
        param: 1,
        pos: [Math.cos(a) * R, 0.25 + p['shieldH']! / 2, Math.sin(a) * R],
        rot: [0, -a, 0],
        pivot: [0, 1, 0],
      });
    }
    return b.build();
  },
};

// ───────────────────────────────────────── boss
const boss: ModelDef = {
  key: 'boss',
  name: 'МОНОЛИТ (босс)',
  height: 5.5,
  rim: PAL.energy,
  params: { height: P(4.2, 3, 6), width: P(1.5, 1, 2.4), rings: P(3, 1, 5, 1), shards: P(10, 0, 20, 1), eye: P(0.6, 0.3, 1) },
  build(p) {
    const b = new ModelBuilder();
    const H = p['height']!;
    const W = p['width']!;
    const lift = 1.0;
    // obelisk: stacked tapered hex prisms with glowing seams
    const seg = 5;
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg;
      const t1 = (i + 1) / seg;
      const r0 = W * (1 - t0 * 0.45);
      const r1 = W * (1 - t1 * 0.45);
      b.add(new CylinderGeometry(r1, r0, (H / seg) * 0.9, 6), { color: PAL.voidMat, part: Part.Jitter, param: 0.25, pos: [0, lift + (t0 + 0.5 / seg) * H, 0] });
      b.add(new CylinderGeometry(r1 * 1.02, r1 * 1.02, (H / seg) * 0.1, 6), { color: PAL.energy, emit: 1, part: Part.Jitter, param: 0.25, pos: [0, lift + t1 * H - (H / seg) * 0.05, 0] });
    }
    b.add(new ConeGeometry(W * 0.55, 1.2, 6), { color: PAL.voidMat, pos: [0, lift + H + 0.6, 0] });
    b.add(new ConeGeometry(W * 0.75, lift + 0.2, 6), { color: PAL.voidMat, pos: [0, (lift + 0.2) / 2, 0], rot: [Math.PI, 0, 0] });
    // eye
    b.add(new SphereGeometry(p['eye']!, 12, 8), { color: 0xffffff, emit: 1, part: Part.Core, param: 0.5, pos: [W * 0.7, lift + H * 0.62, 0], pivot: [W * 0.7, lift + H * 0.62, 0] });
    b.add(new TorusGeometry(p['eye']! * 1.25, 0.08, 4, 16), { color: PAL.enemy, emit: 1, pos: [W * 0.72, lift + H * 0.62, 0], rot: [0, Math.PI / 2, 0] });
    // rings
    const nr = p['rings']!;
    for (let i = 0; i < nr; i++) {
      const r = W * (1.6 + i * 0.45);
      b.add(new TorusGeometry(r, 0.09, 4, 32), {
        color: i % 2 ? PAL.enemy : PAL.energy,
        emit: 1,
        part: Part.Spin,
        param: (i % 2 ? -1 : 1) * (0.6 + i * 0.35),
        pos: [0, lift + H * (0.3 + i * 0.2), 0],
        rot: [Math.PI / 2 + 0.25 * (i - 1), 0, 0.2 * i],
        pivot: [0, lift + H * 0.5, 0],
      });
    }
    // orbiting shards
    const ns = p['shards']!;
    for (let i = 0; i < ns; i++) {
      const a = (i / Math.max(1, ns)) * Math.PI * 2;
      const r = W * 2.4 + (i % 3) * 0.4;
      b.add(new OctahedronGeometry(0.22, 0), { color: i % 3 ? PAL.voidMat : PAL.energy, emit: i % 3 ? 0.1 : 1, part: Part.Spin, param: 0.8 + (i % 3) * 0.2, pos: [Math.cos(a) * r, lift + 0.8 + (i % 4) * 0.9, Math.sin(a) * r], scale: [0.6, 1.6, 0.6], pivot: [0, 0, 0] });
    }
    return b.build();
  },
};

// ───────────────────────────────────────── arena props
const pillar: ModelDef = {
  key: 'pillar',
  name: 'Колонна арены',
  height: 1.7,
  rim: PAL.energy,
  params: { height: P(1.7, 0.6, 6), bands: P(2, 0, 6, 1) },
  build(p) {
    const b = new ModelBuilder();
    const H = p['height']!;
    b.add(new CylinderGeometry(1, 1.08, H, 6), { color: 0x181428, pos: [0, H / 2, 0] });
    b.add(new CylinderGeometry(0.85, 1, 0.3, 6), { color: 0x221c38, pos: [0, H + 0.15, 0] });
    const n = p['bands']!;
    for (let i = 0; i < n; i++) {
      const y = 0.35 + (i / Math.max(1, n)) * (H - 0.6);
      b.add(new CylinderGeometry(1.015, 1.015, 0.06, 6), { color: i === 0 ? PAL.player : PAL.energy, emit: 1, pos: [0, y, 0] });
    }
    b.add(new CylinderGeometry(0.4, 0.4, 0.05, 6), { color: PAL.energy, emit: 1, part: Part.Core, param: 0.2, pos: [0, H + 0.31, 0], pivot: [0, H + 0.31, 0] });
    return b.build();
  },
};

// ───────────────────────────────────────── bloater (flesh sac)
const bloater: ModelDef = {
  key: 'bloater',
  name: 'Гнойник (плоть, разрыв)',
  height: 1.3,
  rim: PAL.enemy,
  params: { sac: P(0.68, 0.4, 1), pustules: P(7, 0, 14, 1), jitter: P(0.1, 0, 0.3), legs: P(0.45, 0.2, 0.8) },
  build(p) {
    const b = new ModelBuilder();
    const R = p['sac']!;
    const cy = 0.35 + R;
    // the whole sac swells with charge (Core part around its centre)
    b.add(new IcosahedronGeometry(R, 2), { color: 0x9a6a5a, part: Part.Core, param: 0.38, pivot: [0, cy, 0], pos: [0, cy, 0], scale: [1, 0.92, 1], jitter: p['jitter']!, jitterSeed: 11 });
    b.add(new IcosahedronGeometry(R * 0.55, 1), { color: 0x5a1020, part: Part.Core, param: 0.38, pivot: [0, cy, 0], pos: [R * 0.15, cy - R * 0.62, 0], scale: [1.2, 0.6, 1.1] });
    const n = p['pustules']!;
    for (let k = 0; k < n; k++) {
      const a = k * 2.399;
      const el = 0.25 + ((k * 0.37) % 1) * 0.9;
      const px = Math.cos(a) * Math.cos(el) * R;
      const pz = Math.sin(a) * Math.cos(el) * R;
      const py = cy + Math.sin(el) * R * 0.92;
      b.add(new SphereGeometry(0.07 + (k % 3) * 0.025, 6, 4), { color: k % 2 ? PAL.enemy : 0xd8ff5a, emit: 0.9, part: Part.Core, param: 0.6, pos: [px, py, pz], pivot: [0, cy, 0] });
    }
    // tiny mouth and eye stalks at the front
    b.add(new TorusGeometry(0.12, 0.04, 4, 8), { color: 0x2a0408, pos: [R * 0.95, cy - 0.05, 0], rot: [0, Math.PI / 2, 0] });
    for (const z of [-1, 1]) b.add(new SphereGeometry(0.06, 5, 4), { color: PAL.enemy, emit: 1, pos: [R * 0.85, cy + 0.22, z * 0.16] });
    const start = b.vertexCount;
    for (const x of [0.3, -0.3]) b.add(new ConeGeometry(0.06, p['legs']!, 4), { color: 0x3a060c, part: Part.Leg, param: 0.8, pos: [x, 0.2, R * 0.6], rot: [-0.6, 0, 0], pivot: [x, 0.42, R * 0.45] });
    b.mirrorZ(start);
    return b.build();
  },
};

// ───────────────────────────────────────── dart (machine wasp)
const dart: ModelDef = {
  key: 'dart',
  name: 'Жало (машина, пикирование)',
  height: 1.2,
  rim: PAL.enemy,
  params: { length: P(1.0, 0.6, 1.4), wing: P(0.6, 0.3, 1.2), hover: P(0.9, 0.5, 1.4) },
  build(p) {
    const b = new ModelBuilder();
    const L = p['length']!;
    const h = p['hover']!;
    const bob = { part: Part.Bob, param: 0.06 } as const;
    b.add(new ConeGeometry(0.25, L, 5), { color: 0x4d546e, pos: [0.1, h, 0], rot: [0, 0, -Math.PI / 2], ...bob });
    b.add(new ConeGeometry(0.06, 0.45, 4), { color: PAL.enemy, emit: 1, part: Part.Core, param: 0.6, pos: [0.1 + L * 0.5 + 0.18, h, 0], rot: [0, 0, -Math.PI / 2], pivot: [0.1 + L * 0.5, h, 0] });
    b.add(new SphereGeometry(0.17, 6, 4), { color: 0x1b1d26, pos: [-L * 0.35, h + 0.02, 0], scale: [1.5, 0.9, 1], ...bob });
    b.add(new SphereGeometry(0.07, 5, 4), { color: PAL.enemy, emit: 1, pos: [0.05, h + 0.13, 0], ...bob });
    b.add(new BoxGeometry(0.12, 0.05, 0.14), { color: PAL.hazard, emit: 0.8, pos: [-L * 0.62, h, 0], ...bob });
    const start = b.vertexCount;
    // swept blade wings rooted at the body (Petal: fold back as it charges the dive)
    const span = p['wing']!;
    b.add(new ConeGeometry(0.16, span, 3), { color: 0x3c4258, part: Part.Petal, param: -0.6, pos: [-0.12, h + 0.06, 0.12 + span * 0.5], rot: [Math.PI / 2, 0.5, 0], scale: [1.6, 1, 0.18], pivot: [-0.05, h, 0.1] });
    b.add(new BoxGeometry(0.03, 0.025, span * 0.9), { color: PAL.enemy, emit: 0.9, part: Part.Petal, param: -0.6, pos: [-0.2, h + 0.08, 0.12 + span * 0.45], rot: [0, 0.5, 0], pivot: [-0.05, h, 0.1] });
    b.mirrorZ(start);
    return b.build();
  },
};

// ───────────────────────────────────────── worm (flesh burrower)
const worm: ModelDef = {
  key: 'worm',
  name: 'Червь (плоть, роет)',
  height: 1.0,
  rim: PAL.enemy,
  params: { segments: P(7, 4, 12, 1), girth: P(0.42, 0.25, 0.6), teeth: P(9, 5, 14, 1), wiggle: P(0.16, 0, 0.4) },
  build(p) {
    const b = new ModelBuilder();
    const n = p['segments']!;
    const R = p['girth']!;
    const cy = R + 0.05;
    let x = 0.15;
    for (let k = 0; k < n; k++) {
      const t = k / Math.max(1, n - 1);
      const r = R * (1 - t * 0.55);
      const wig = { part: Part.Wiggle, param: p['wiggle']! * (0.3 + t), pivot: [x, cy, 0] as const };
      b.add(new IcosahedronGeometry(r, 1), { color: k % 2 ? 0xb46a6e : 0x8a3a48, pos: [x, cy * (1 - t * 0.35), 0], scale: [0.85, 0.82, 1], jitter: 0.05, jitterSeed: k, ...wig });
      if (k > 0 && k < n - 1) b.add(new TorusGeometry(r * 0.92, 0.035, 3, 10), { color: PAL.enemy, emit: 0.35, pos: [x + r * 0.45, cy * (1 - t * 0.35), 0], rot: [0, Math.PI / 2, 0], ...wig });
      x -= r * 1.35;
    }
    // lamprey maw: ring of teeth that splays open with charge, glowing throat
    const mx = 0.15 + R * 0.75;
    const nt = p['teeth']!;
    for (let k = 0; k < nt; k++) {
      const a = (k / nt) * Math.PI * 2;
      b.add(new ConeGeometry(0.05, 0.28, 3), {
        color: 0xeadcc0,
        part: Part.Petal,
        param: 0.9,
        pos: [mx + 0.05, cy + Math.sin(a) * R * 0.62, Math.cos(a) * R * 0.62],
        rot: [a, 0, -Math.PI / 2 - 0.5],
        pivot: [mx - 0.1, cy, 0],
      });
    }
    b.add(new SphereGeometry(R * 0.45, 8, 6), { color: PAL.enemy, emit: 1, part: Part.Core, param: 0.6, pos: [mx - 0.05, cy, 0], pivot: [mx - 0.05, cy, 0] });
    return b.build();
  },
};

// ───────────────────────────────────────── parasite (tick)
const parasite: ModelDef = {
  key: 'parasite',
  name: 'Паразит (плоть, носитель)',
  height: 0.55,
  rim: PAL.enemy,
  params: { body: P(0.3, 0.2, 0.45), legs: P(0.42, 0.2, 0.7) },
  build(p) {
    const b = new ModelBuilder();
    const R = p['body']!;
    b.add(new SphereGeometry(R, 8, 6), { color: 0x4a1a1c, pos: [0.1, 0.28, 0], scale: [1.1, 0.55, 0.95] });
    // engorged abdomen: glows brighter as it feeds (charge/buff)
    b.add(new SphereGeometry(R * 1.05, 8, 6), { color: 0xd8ff5a, emit: 0.55, part: Part.Core, param: 0.4, pos: [-R * 0.9, 0.32, 0], scale: [1.2, 0.8, 1], pivot: [-R * 0.9, 0.32, 0] });
    b.add(new SphereGeometry(R * 0.08 + 0.03, 4, 3), { color: PAL.enemy, emit: 1, pos: [R * 1.1, 0.34, 0.08] });
    b.add(new SphereGeometry(R * 0.08 + 0.03, 4, 3), { color: PAL.enemy, emit: 1, pos: [R * 1.1, 0.34, -0.08] });
    for (const z of [-1, 1]) b.add(new ConeGeometry(0.035, 0.22, 3), { color: 0xd8c8b0, pos: [R * 1.25, 0.24, z * 0.06], rot: [0, 0, -Math.PI / 2 - 0.4], part: Part.Petal, param: 0.6, pivot: [R, 0.24, 0] });
    const start = b.vertexCount;
    for (let k = 0; k < 3; k++) {
      const x = 0.25 - k * 0.2;
      b.add(new ConeGeometry(0.025, p['legs']!, 3), { color: 0x2a0a0c, part: Part.Leg, param: 1.2, pos: [x, 0.16, R * 0.9], rot: [-1.1, 0, 0], pivot: [x, 0.26, R * 0.5] });
    }
    b.mirrorZ(start);
    return b.build();
  },
};

// ───────────────────────────────────────── brood mother (mini-boss)
const brood: ModelDef = {
  key: 'brood',
  name: 'МАТКА (мини-босс)',
  height: 3.4,
  rim: PAL.enemy,
  params: { mass: P(2.2, 1.4, 3), eggs: P(22, 6, 40, 1), tentacles: P(8, 0, 14, 1) },
  build(p) {
    const b = new ModelBuilder();
    const R = p['mass']!;
    const cy = R * 0.75;
    // breathing / contracting body (Core with small param = subtle swell before a birth)
    b.add(new IcosahedronGeometry(R, 2), { color: 0x8a4a52, part: Part.Core, param: 0.07, pivot: [0, cy, 0], pos: [0, cy, 0], scale: [1, 0.8, 1], jitter: 0.22, jitterSeed: 31 });
    b.add(new IcosahedronGeometry(R * 0.7, 1), { color: 0x5a1a26, pos: [-R * 0.35, cy * 1.45, 0], scale: [1, 0.7, 1], jitter: 0.15, jitterSeed: 7, part: Part.Core, param: 0.05, pivot: [0, cy, 0] });
    // eggs: swell and glow before a birth
    const n = p['eggs']!;
    for (let k = 0; k < n; k++) {
      const a = k * 2.399;
      const el = 0.15 + ((k * 0.61) % 1) * 1.1;
      const ex = Math.cos(a) * Math.cos(el) * R * 0.98;
      const ez = Math.sin(a) * Math.cos(el) * R * 0.98;
      const ey = cy + Math.sin(el) * R * 0.78;
      b.add(new SphereGeometry(0.16 + (k % 4) * 0.05, 6, 5), { color: k % 3 ? 0xd8ff5a : PAL.enemy, emit: 0.85, part: Part.Core, param: 0.55, pos: [ex, ey, ez], scale: [1, 1.3, 1], pivot: [ex, ey, ez] });
    }
    // maw facing the player (+x)
    b.add(new TorusGeometry(0.55, 0.14, 5, 14), { color: 0x3a060c, pos: [R * 0.85, cy * 1.05, 0], rot: [0, Math.PI / 2, 0] });
    b.add(new SphereGeometry(0.42, 8, 6), { color: PAL.enemy, emit: 1, part: Part.Core, param: 0.3, pos: [R * 0.8, cy * 1.05, 0], pivot: [R * 0.8, cy * 1.05, 0] });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      b.add(new ConeGeometry(0.06, 0.35, 3), { color: 0xeadcc0, part: Part.Petal, param: 0.5, pos: [R * 0.95, cy * 1.05 + Math.sin(a) * 0.55, Math.cos(a) * 0.55], rot: [a, 0, -Math.PI / 2 - 0.6], pivot: [R * 0.8, cy * 1.05, 0] });
    }
    // tentacles writhing on the floor
    const nt = p['tentacles']!;
    for (let k = 0; k < nt; k++) {
      const a = (k / Math.max(1, nt)) * Math.PI * 2 + 0.3;
      for (let s = 0; s < 4; s++) {
        const d = R * 0.9 + s * 0.5;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        b.add(new IcosahedronGeometry(0.28 - s * 0.05, 0), { color: s % 2 ? 0x8a3a48 : 0x6a2232, pos: [x, 0.18, z], part: Part.Wiggle, param: 0.12 + s * 0.06, pivot: [x, 0.18, z] });
      }
    }
    return b.build();
  },
};

// ───────────────────────────────────────── flesh growth pillar (Act II)
const growth: ModelDef = {
  key: 'growth',
  name: 'Нарост (колонна Плоти)',
  height: 2.1,
  rim: PAL.enemy,
  params: { lumps: P(4, 2, 7, 1), pustules: P(6, 0, 14, 1) },
  build(p) {
    const b = new ModelBuilder();
    const n = p['lumps']!;
    let y = 0.35;
    for (let k = 0; k < n; k++) {
      const r = 1.05 - k * (0.55 / n);
      b.add(new IcosahedronGeometry(r, 1), { color: k % 2 ? 0x6a2a34 : 0x502030, pos: [Math.sin(k * 1.7) * 0.15, y, Math.cos(k * 2.1) * 0.15], scale: [1, 0.7, 1], jitter: 0.25, jitterSeed: k * 3 });
      y += r * 0.6;
    }
    const m = p['pustules']!;
    for (let k = 0; k < m; k++) {
      const a = k * 2.4;
      const yy = 0.4 + (k / Math.max(1, m)) * (y - 0.6);
      const rr = 0.95 - (yy / y) * 0.5;
      b.add(new SphereGeometry(0.1 + (k % 3) * 0.04, 5, 4), { color: k % 2 ? 0xd8ff5a : PAL.enemy, emit: 0.9, part: Part.Core, param: 0.3, pos: [Math.cos(a) * rr, yy, Math.sin(a) * rr], pivot: [Math.cos(a) * rr, yy, Math.sin(a) * rr] });
    }
    // glowing vein ring at the base
    b.add(new TorusGeometry(1.05, 0.05, 3, 18), { color: PAL.enemy, emit: 0.7, pos: [0, 0.08, 0], rot: [Math.PI / 2, 0, 0] });
    return b.build();
  },
};

export const MODELS: readonly ModelDef[] = [player, swarmer, gunner, charger, archer, shielder, bloater, dart, worm, parasite, brood, boss, pillar, growth];
/** enemy type index → model (matches ET order) */
export const ENEMY_MODELS: readonly ModelDef[] = [swarmer, gunner, charger, archer, shielder, boss, bloater, dart, worm, parasite, brood];

export function modelByKey(key: string): ModelDef {
  const m = MODELS.find((x) => x.key === key);
  if (!m) throw new Error(`unknown model ${key}`);
  return m;
}

/** Runtime overrides (lab edits persist via localStorage in dev). */
export const modelOverrides: Record<string, Params> = {};
export function paramsFor(def: ModelDef): Params {
  return { ...defaults(def), ...(modelOverrides[def.key] ?? {}) };
}
