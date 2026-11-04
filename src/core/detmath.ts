/**
 * Deterministic math for the simulation. Math.sin/cos/atan2/exp are NOT guaranteed
 * bit-identical between engines, but + - * / sqrt floor are (IEEE-754). Everything here
 * is built from those, so replays are portable.
 */
export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

export function dsin(x: number): number {
  x = x - TAU * Math.floor((x + PI) / TAU);
  if (x > HALF_PI) x = PI - x;
  else if (x < -HALF_PI) x = -PI - x;
  const x2 = x * x;
  return (
    x *
    (1 +
      x2 *
        (-0.16666666666666666 +
          x2 * (0.008333333333333333 + x2 * (-0.0001984126984126984 + x2 * (2.7557319223985893e-6 + x2 * -2.505210838544172e-8)))))
  );
}

export function dcos(x: number): number {
  return dsin(x + HALF_PI);
}

function atanUnit(z: number): number {
  // |z| <= 1, max error ~1e-5 rad
  const z2 = z * z;
  return z * (0.999866 + z2 * (-0.3302995 + z2 * (0.180141 + z2 * (-0.085133 + z2 * 0.0208351))));
}

export function datan2(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = x < 0 ? -x : x;
  const ay = y < 0 ? -y : y;
  let r: number;
  if (ax >= ay) {
    r = atanUnit(ay / ax);
  } else {
    r = HALF_PI - atanUnit(ax / ay);
  }
  if (x < 0) r = PI - r;
  return y < 0 ? -r : r;
}

/** exp via range reduction 2^k * e^r, polynomial on r. */
export function dexp(x: number): number {
  if (x < -80) return 0;
  const k = Math.floor(x * 1.4426950408889634 + 0.5);
  const r = x - k * 0.6931471805599453;
  const p = 1 + r * (1 + r * (0.5 + r * (0.16666666666666666 + r * (0.041666666666666664 + r * (0.008333333333333333 + r * 0.001388888888888889)))));
  let s = 1;
  let kk = k;
  if (kk > 0) while (kk-- > 0) s *= 2;
  else while (kk++ < 0) s *= 0.5;
  return p * s;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** shortest signed angle difference b - a in [-PI, PI] */
export function angDiff(a: number, b: number): number {
  let d = b - a;
  d = d - TAU * Math.floor((d + PI) / TAU);
  return d;
}
export function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
/** squared distance from point p to segment ab */
export function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + abx * t - px;
  const dy = ay + aby * t - py;
  return dx * dx + dy * dy;
}
