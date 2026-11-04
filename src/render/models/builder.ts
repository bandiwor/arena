import { BufferAttribute, BufferGeometry, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { hash01 } from '../../core/rng';
import { srgbToLinear } from '../palette';

/**
 * Animated part ids — interpreted in the entity vertex shader (GPU-side animation, zero CPU cost).
 */
export const Part = {
  Static: 0,
  Spin: 1, // rotate around pivot Y, param = rad/s
  Leg: 2, // swing with walk cycle around pivot, param = amplitude
  Petal: 3, // opens outward with charge, param = amount
  Bob: 4, // vertical sine, param = amplitude
  Jitter: 5, // glitchy vertex jitter (boss corruption), param = amount
  Core: 6, // scales/pulses with charge around pivot, param = amount
  Shield: 7, // ripples on hit
  Recoil: 8, // slides back along -X with recoil/charge, param = distance
  Wiggle: 9, // serpentine lateral wave travelling along -X (worms, tentacles), param = amplitude
} as const;

export interface PartOpts {
  color: number; // sRGB hex
  emit?: number; // 0..1 emissive strength
  part?: number;
  param?: number;
  extra?: number;
  pivot?: readonly [number, number, number];
  pos?: readonly [number, number, number];
  rot?: readonly [number, number, number];
  scale?: readonly [number, number, number] | number;
  /** organic vertex jitter amplitude (deterministic per position) */
  jitter?: number;
  jitterSeed?: number;
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const v = new Vector3();
const s = new Vector3();
const nm = new Matrix4();

/**
 * Accumulates primitives into a single flat-shaded, non-indexed geometry with
 * attributes: position, normal, color, aMat(emit, part, param, extra), aPivot.
 */
export class ModelBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private mat: number[] = [];
  private piv: number[] = [];
  triangles = 0;

  add(src: BufferGeometry, o: PartOpts): this {
    let g = src.index ? src.toNonIndexed() : src.clone();
    const p = o.pos ?? [0, 0, 0];
    const r = o.rot ?? [0, 0, 0];
    const sc = typeof o.scale === 'number' ? [o.scale, o.scale, o.scale] : (o.scale ?? [1, 1, 1]);
    e.set(r[0], r[1], r[2]);
    q.setFromEuler(e);
    v.set(p[0], p[1], p[2]);
    s.set(sc[0]!, sc[1]!, sc[2]!);
    m4.compose(v, q, s);
    g.applyMatrix4(m4);
    const P = g.getAttribute('position') as BufferAttribute;
    if (o.jitter) {
      const seed = o.jitterSeed ?? 0;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i);
        const y = P.getY(i);
        const z = P.getZ(i);
        const h = Math.floor(x * 997 + y * 7919 + z * 104729 + seed * 13);
        P.setXYZ(i, x + (hash01(h) - 0.5) * o.jitter, y + (hash01(h + 1) - 0.5) * o.jitter, z + (hash01(h + 2) - 0.5) * o.jitter);
      }
    }
    g.deleteAttribute('normal');
    g.computeVertexNormals(); // non-indexed ⇒ flat normals = crisp low-poly facets
    const N = g.getAttribute('normal') as BufferAttribute;
    const cr = srgbToLinear(((o.color >> 16) & 255) / 255);
    const cg = srgbToLinear(((o.color >> 8) & 255) / 255);
    const cb = srgbToLinear((o.color & 255) / 255);
    const pv = o.pivot ?? p;
    for (let i = 0; i < P.count; i++) {
      this.pos.push(P.getX(i), P.getY(i), P.getZ(i));
      this.nrm.push(N.getX(i), N.getY(i), N.getZ(i));
      this.col.push(cr, cg, cb);
      this.mat.push(o.emit ?? 0, o.part ?? 0, o.param ?? 0, o.extra ?? 0);
      this.piv.push(pv[0], pv[1], pv[2]);
    }
    this.triangles += P.count / 3;
    g.dispose();
    nm.identity();
    return this;
  }

  /** Mirror everything added so far across the XY plane (z → -z) — for symmetric legs etc. */
  mirrorZ(fromVertex = 0): this {
    const n = this.pos.length / 3;
    for (let i = fromVertex; i < n; i++) {
      // emit triangles with flipped winding
    }
    const start = fromVertex;
    const add: number[][] = [[], [], [], [], []];
    for (let t = start; t < n; t += 3) {
      for (const k of [0, 2, 1]) {
        const i = t + k;
        add[0]!.push(this.pos[i * 3]!, this.pos[i * 3 + 1]!, -this.pos[i * 3 + 2]!);
        add[1]!.push(this.nrm[i * 3]!, this.nrm[i * 3 + 1]!, -this.nrm[i * 3 + 2]!);
        add[2]!.push(this.col[i * 3]!, this.col[i * 3 + 1]!, this.col[i * 3 + 2]!);
        add[3]!.push(this.mat[i * 4]!, this.mat[i * 4 + 1]!, this.mat[i * 4 + 2]!, this.mat[i * 4 + 3]!);
        add[4]!.push(this.piv[i * 3]!, this.piv[i * 3 + 1]!, -this.piv[i * 3 + 2]!);
      }
    }
    this.pos.push(...add[0]!);
    this.nrm.push(...add[1]!);
    this.col.push(...add[2]!);
    this.mat.push(...add[3]!);
    this.piv.push(...add[4]!);
    this.triangles += (n - start) / 3;
    return this;
  }

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  build(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.nrm), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aMat', new BufferAttribute(new Float32Array(this.mat), 4));
    g.setAttribute('aPivot', new BufferAttribute(new Float32Array(this.piv), 3));
    g.computeBoundingSphere();
    return g;
  }
}
