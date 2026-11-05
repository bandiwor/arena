/**
 * Global "feel" state: screen shake (trauma model), hitstop, slow-mo, flashes, glitch, chroma,
 * zoom punches, camera kick. Pure presentation — never touches the simulation.
 */
export class Juice {
  trauma = 0;
  hitstop = 0;
  slowT = 0;
  slowScale = 1;
  timeScale = 1;
  flash = 0;
  flashR = 1;
  flashG = 1;
  flashB = 1;
  glitch = 0;
  glitchBase = 0;
  chroma = 0;
  zoom = 0;
  damage = 0;
  kickX = 0;
  kickY = 0;
  kickVX = 0;
  kickVY = 0;
  saturate = 0;
  /** user preferences */
  shakeScale = 1;
  /** full-screen flashes (photosensitivity) 0..1 */
  flashScale = 1;
  /** glitch + chromatic aberration 0..1 */
  distortScale = 1;
  /** hitstop freeze-frames and slow-mo */
  freezeOn = true;

  addTrauma(v: number): void {
    this.trauma = Math.min(1, this.trauma + v * this.shakeScale);
  }
  stop(seconds: number): void {
    if (!this.freezeOn) return;
    this.hitstop = Math.max(this.hitstop, seconds);
  }
  slow(scale: number, seconds: number): void {
    if (!this.freezeOn) return;
    if (scale <= this.slowScale || this.slowT <= 0) {
      this.slowScale = scale;
      this.slowT = Math.max(this.slowT, seconds);
    }
  }
  doFlash(v: number, r = 1, g = 1, b = 1): void {
    v *= this.flashScale;
    if (v > this.flash) {
      this.flash = v;
      this.flashR = r;
      this.flashG = g;
      this.flashB = b;
    }
  }
  addGlitch(v: number): void {
    this.glitch = Math.min(1.5, this.glitch + v * this.distortScale);
  }
  addChroma(v: number): void {
    this.chroma = Math.min(2, this.chroma + v * this.distortScale);
  }
  punch(v: number): void {
    this.zoom = Math.max(-1, Math.min(1, this.zoom + v));
  }
  kick(dx: number, dy: number, v: number): void {
    this.kickVX += dx * v;
    this.kickVY += dy * v;
  }

  update(dt: number): void {
    this.hitstop = Math.max(0, this.hitstop - dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    if (this.slowT > 0) {
      this.slowT -= dt;
      if (this.slowT <= 0) this.slowScale = 1;
    }
    // ease back to normal speed for a smooth exit from slow-mo
    const target = this.slowT > 0 ? this.slowScale : 1;
    this.timeScale += (target - this.timeScale) * Math.min(1, dt * (this.slowT > 0 ? 20 : 6));
    this.flash = Math.max(0, this.flash - dt * 5);
    this.glitch = Math.max(0, this.glitch - dt * 2.5);
    this.chroma = Math.max(0, this.chroma - dt * 3);
    this.damage = Math.max(0, this.damage - dt * 1.6);
    this.saturate = Math.max(0, this.saturate - dt * 2);
    this.zoom *= Math.max(0, 1 - dt * 7);
    // critically-damped-ish spring for camera kick. Semi-implicit Euler in ≤ 1/240 s sub-steps:
    // a single explicit step with a long frame (dt = 0.1 s) is unstable and used to blow up to
    // NaN, which turned the whole frame black.
    const k = 260;
    const d = 22;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.kickVX += (-this.kickX * k - this.kickVX * d) * h;
      this.kickVY += (-this.kickY * k - this.kickVY * d) * h;
      this.kickX += this.kickVX * h;
      this.kickY += this.kickVY * h;
    }
    if (!Number.isFinite(this.kickX + this.kickY + this.kickVX + this.kickVY)) this.kickX = this.kickY = this.kickVX = this.kickVY = 0;
  }

  /** effective sim time multiplier (0 during hitstop) */
  get simScale(): number {
    return this.hitstop > 0 ? 0 : this.timeScale;
  }
}
