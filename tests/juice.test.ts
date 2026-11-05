import { describe, expect, it } from 'vitest';
import { Juice } from '../src/render/juice';

describe('Juice camera kick spring', () => {
  it('stays finite and settles even with long frames (regression: black screen)', () => {
    for (const dt of [1 / 144, 1 / 60, 1 / 20, 0.1]) {
      const j = new Juice();
      for (let f = 0; f < 600; f++) {
        if (f % 7 === 0) j.kick(1, -0.5, 3.5); // rapid heavy recoil
        j.update(dt);
        expect(Number.isFinite(j.kickX) && Number.isFinite(j.kickY)).toBe(true);
        expect(Math.abs(j.kickX)).toBeLessThan(5);
      }
      for (let f = 0; f < 200; f++) j.update(dt);
      expect(Math.abs(j.kickX)).toBeLessThan(0.01);
    }
  });
});
