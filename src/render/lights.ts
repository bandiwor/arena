import { Vector4 } from 'three';
import { MAX_LIGHTS } from './shaders/chunks';

const POOL = 48;

/** Transient + persistent point lights packed into shared uniforms each frame. */
export class LightPool {
  readonly uniforms = {
    uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4()) },
    uLightCol: { value: Array.from({ length: MAX_LIGHTS }, () => new Vector4()) },
    uLightCount: { value: 0 },
  };
  private readonly x = new Float32Array(POOL);
  private readonly y = new Float32Array(POOL);
  private readonly h = new Float32Array(POOL);
  private readonly rad = new Float32Array(POOL);
  private readonly col = new Float32Array(POOL * 3);
  private readonly life = new Float32Array(POOL);
  private readonly maxLife = new Float32Array(POOL);
  private cursor = 0;
  private frameCount = 0;

  /** transient light that fades out over `life` seconds */
  flash(x: number, y: number, h: number, radius: number, r: number, g: number, b: number, life: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % POOL;
    this.x[i] = x;
    this.y[i] = y;
    this.h[i] = h;
    this.rad[i] = radius;
    this.col[i * 3] = r;
    this.col[i * 3 + 1] = g;
    this.col[i * 3 + 2] = b;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  beginFrame(dt: number): void {
    this.frameCount = 0;
    for (let i = 0; i < POOL; i++) if (this.life[i]! > 0) this.life[i] = this.life[i]! - dt;
  }

  /** persistent light for this frame only (player glow, boss core, big projectiles) */
  add(x: number, y: number, h: number, radius: number, r: number, g: number, b: number): void {
    if (this.frameCount >= MAX_LIGHTS) return;
    const k = this.frameCount++;
    this.uniforms.uLightPos.value[k]!.set(x, h, y, radius);
    this.uniforms.uLightCol.value[k]!.set(r, g, b, 1);
  }

  endFrame(): void {
    for (let i = 0; i < POOL && this.frameCount < MAX_LIGHTS; i++) {
      const l = this.life[i]!;
      if (l <= 0) continue;
      const f = l / this.maxLife[i]!;
      const k = f * f;
      this.add(this.x[i]!, this.y[i]!, this.h[i]!, this.rad[i]!, this.col[i * 3]! * k, this.col[i * 3 + 1]! * k, this.col[i * 3 + 2]! * k);
    }
    this.uniforms.uLightCount.value = this.frameCount;
  }
}
