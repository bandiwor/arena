import { describe, expect, it } from 'vitest';
import { Scene } from 'three';
import { DynamicResolution } from '../src/render/dynres';
import { Particles } from '../src/render/particles';

describe('dynamic resolution', () => {
  const run = (d: DynamicResolution, dt: number, sec: number): void => {
    for (let t = 0; t < sec; t += dt) {
      d.update(dt);
    }
  };
  it('steps down when frames are slow, never below the floor', () => {
    const d = new DynamicResolution();
    run(d, 1 / 30, 3);
    expect(d.scale).toBeLessThan(1);
    run(d, 1 / 20, 30);
    expect(d.scale).toBe(d.min);
  });
  it('probes back up with headroom', () => {
    const d = new DynamicResolution();
    run(d, 1 / 30, 6);
    const low = d.scale;
    run(d, 1 / 60, 40);
    expect(d.scale).toBeGreaterThan(low);
    expect(d.scale).toBeLessThanOrEqual(1);
  });
  it('a GPU at the limit settles instead of oscillating (back-off)', () => {
    const d = new DynamicResolution();
    let changes = 0;
    // fast below 0.7, slow above: the true sweet spot
    for (let t = 0; t < 180; t += 1 / 60) {
      const dt = d.scale > 0.7 ? 1 / 35 : 1 / 60;
      if (d.update(dt)) changes++;
    }
    expect(d.scale).toBeLessThanOrEqual(0.75);
    expect(changes).toBeLessThan(16);
  });
  it('ignores tab-switch gaps and does nothing when disabled', () => {
    const d = new DynamicResolution();
    for (let i = 0; i < 20; i++) d.update(2);
    expect(d.scale).toBe(1);
    d.enabled = false;
    run(d, 1 / 15, 10);
    expect(d.scale).toBe(1);
  });
});

describe('particles: adaptive ring', () => {
  it('draws only the live window, not the whole capacity', () => {
    const P = new Particles(new Scene(), 32768);
    let t = 0;
    // a steady heavy stream: 600 particles/s living ≤ 1.2 s
    for (let f = 0; f < 60 * 20; f++) {
      for (let k = 0; k < 10; k++) P.emit(0, 0, 0, 0, 0, 0, 0.6 + (k % 3) * 0.3, 1, 1, 1, 0.1, 1, 0, 0, 0);
      t += 1 / 60;
      P.update(t);
    }
    // live ≈ 600/s × 1.2 s ≈ 720; the window must stay a small multiple of that
    expect(P.drawn).toBeGreaterThan(500);
    expect(P.drawn).toBeLessThan(4000);
    // silence: everything dies → nothing drawn
    for (let f = 0; f < 120; f++) P.update((t += 1 / 60));
    expect(P.drawn).toBe(0);
  });
  it('a burst larger than the soft window still keeps every live particle drawn', () => {
    const P = new Particles(new Scene(), 32768);
    let t = 1;
    P.update(t);
    for (let k = 0; k < 5000; k++) P.emit(0, 0, 0, 0, 0, 0, 2, 1, 1, 1, 0.1, 1, 0, 0, 0);
    P.update((t += 1 / 60));
    expect(P.drawn).toBe(5000);
  });
});
