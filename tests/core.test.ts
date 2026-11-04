import { describe, expect, it } from 'vitest';
import { Rng, hash01 } from '../src/core/rng';
import { datan2, dcos, dexp, dsin } from '../src/core/detmath';
import { SpatialGrid } from '../src/core/spatial';

describe('Rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.u32()).toBe(b.u32());
  });
  it('differs between seeds and is roughly uniform', () => {
    const r = new Rng(7);
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100000; i++) buckets[Math.floor(r.float() * 10)]++;
    for (const b of buckets) expect(Math.abs(b - 10000)).toBeLessThan(500);
    expect(new Rng(1).u32()).not.toBe(new Rng(2).u32());
  });
  it('state round-trips', () => {
    const r = new Rng(9);
    r.u32();
    const s = r.getState(new Uint32Array(4));
    const x = r.u32();
    r.setState(s);
    expect(r.u32()).toBe(x);
  });
  it('golden sequence (guards against accidental algorithm changes)', () => {
    const r = new Rng(12345);
    expect([r.u32(), r.u32(), r.u32()]).toMatchSnapshot();
    expect(hash01(1)).toMatchSnapshot();
  });
});

describe('detmath', () => {
  it('sin/cos/atan2/exp match Math within tolerance', () => {
    for (let x = -20; x < 20; x += 0.0137) {
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-6);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-6);
    }
    for (let y = -3; y <= 3; y += 0.21)
      for (let x = -3; x <= 3; x += 0.23) expect(Math.abs(datan2(y, x) - Math.atan2(y, x))).toBeLessThan(2e-5);
    for (let x = -10; x < 10; x += 0.1) expect(Math.abs(dexp(x) / Math.exp(x) - 1)).toBeLessThan(1e-6);
  });
});

describe('SpatialGrid', () => {
  it('finds all items within query radius', () => {
    const g = new SpatialGrid(-50, -50, 100, 100, 2, 512);
    const r = new Rng(3);
    const n = 300;
    const xs = new Float32Array(n);
    const ys = new Float32Array(n);
    const ids = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = r.range(-48, 48);
      ys[i] = r.range(-48, 48);
      ids[i] = i;
    }
    g.build(ids, n, xs, ys);
    const out = new Int32Array(512);
    for (let q = 0; q < 50; q++) {
      const qx = r.range(-40, 40);
      const qy = r.range(-40, 40);
      const rad = r.range(1, 8);
      const m = g.query(qx, qy, rad, out);
      const found = new Set(Array.from(out.subarray(0, m)));
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(xs[i]! - qx, ys[i]! - qy);
        if (d <= rad) expect(found.has(i)).toBe(true);
      }
    }
  });
});
