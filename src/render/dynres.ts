/**
 * Dynamic resolution: when frames stay slower than ~48 fps the internal render scale steps down
 * (×0.85, floor 0.5); when there is headroom it probes back up. A probe that brings the drops back
 * makes the next probe wait longer (exponential back-off), so on a GPU that is just at the limit
 * it settles instead of oscillating. Works with vsync (it only looks at frame intervals).
 */
export class DynamicResolution {
  enabled = true;
  scale = 1;
  readonly min = 0.5;
  private ema = 1 / 60;
  private bad = 0;
  private good = 0;
  private cool = 0;
  private probeT = -1;
  private backoff = 0;

  /** dt: real frame interval (s). Returns true when the scale changed (caller resizes). */
  update(dt: number): boolean {
    if (!this.enabled) {
      if (this.scale !== 1) {
        this.scale = 1;
        return true;
      }
      return false;
    }
    if (dt > 0.5) return false; // tab switch / breakpoint: not a GPU signal
    this.ema += (dt - this.ema) * 0.1;
    this.cool -= dt;
    this.bad = this.ema > 1 / 48 ? this.bad + dt : 0;
    this.good = this.ema < 1 / 56 ? this.good + dt : 0;
    if (this.probeT >= 0) {
      this.probeT += dt;
      if (this.probeT > 3) {
        this.probeT = -1; // the step up held
        this.backoff = Math.max(0, this.backoff - 1);
      }
    }
    if (this.bad > 0.8 && this.cool <= 0 && this.scale > this.min) {
      if (this.probeT >= 0) this.backoff = Math.min(5, this.backoff + 1); // the probe failed
      this.probeT = -1;
      this.scale = Math.max(this.min, +(this.scale * 0.85).toFixed(3));
      this.cool = 1.2;
      this.bad = 0;
      this.good = 0;
      return true;
    }
    if (this.good > 5 * 2 ** this.backoff && this.cool <= 0 && this.scale < 1) {
      this.scale = Math.min(1, +(this.scale / 0.85).toFixed(3));
      this.probeT = 0;
      this.cool = 1.5;
      this.good = 0;
      return true;
    }
    return false;
  }
}
