import { PerspectiveCamera, Vector3 } from 'three';
import type { Juice } from './juice';

const tmp = new Vector3();

/** Tilted top-down follow camera with look-ahead, trauma shake, kick and zoom punch. */
export class CameraRig {
  readonly cam: PerspectiveCamera;
  fx = 0;
  fy = 0;
  height = 26;
  back = 12.5;
  baseFov = 38;
  lookAhead = 0.22;
  /** when true, an external controller (lab orbit) owns the camera */
  manual = false;
  private focusX = 0;
  private focusY = 0;
  private focusT = 0;
  private t = 0;

  constructor(aspect: number) {
    this.cam = new PerspectiveCamera(this.baseFov, aspect, 1, 200);
  }

  /** briefly pull the camera toward a point of interest (e.g. the last kill of a wave) */
  focus(x: number, y: number, seconds: number): void {
    this.focusX = x;
    this.focusY = y;
    this.focusT = seconds;
  }

  snap(x: number, y: number): void {
    this.fx = x;
    this.fy = y;
  }

  update(dt: number, px: number, py: number, ax: number, ay: number, j: Juice): void {
    this.t += dt;
    if (this.manual) return;
    let tx = px + (ax - px) * this.lookAhead;
    let ty = py + (ay - py) * this.lookAhead;
    if (this.focusT > 0) {
      this.focusT -= dt;
      const f = Math.min(1, this.focusT * 2) * 0.55;
      tx += (this.focusX - tx) * f;
      ty += (this.focusY - ty) * f;
    }
    const k = 1 - Math.exp(-dt * 7);
    this.fx += (tx - this.fx) * k;
    this.fy += (ty - this.fy) * k;
    const tr = j.trauma * j.trauma;
    const t = this.t * 38;
    const sx = (Math.sin(t * 1.1) + Math.sin(t * 2.3 + 1.7) * 0.5) * tr * 0.9;
    const sy = (Math.sin(t * 1.3 + 4.1) + Math.sin(t * 2.9 + 0.3) * 0.5) * tr * 0.9;
    const roll = Math.sin(t * 0.9 + 2.2) * tr * 0.035;
    // last line of defence: a non-finite camera renders nothing (black frame)
    if (!Number.isFinite(this.fx + this.fy)) {
      this.fx = px;
      this.fy = py;
    }
    const cx = this.fx + sx + j.kickX;
    const cz = this.fy + sy + j.kickY;
    this.cam.position.set(cx, this.height, cz + this.back);
    tmp.set(cx, 0, cz);
    this.cam.up.set(Math.sin(roll), Math.cos(roll), 0);
    this.cam.lookAt(tmp);
    const fov = this.baseFov * (1 - j.zoom * 0.08);
    if (Math.abs(fov - this.cam.fov) > 1e-3) {
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
    }
  }

  setAspect(a: number): void {
    this.cam.aspect = a;
    this.cam.updateProjectionMatrix();
  }

  private readonly ray = new Vector3();
  /** Screen NDC → point on ground plane (y=0). Writes into out [x, simY]. */
  groundFromNdc(nx: number, ny: number, out: Float32Array): void {
    const c = this.cam;
    this.ray.set(nx, ny, 0.5).unproject(c).sub(c.position).normalize();
    const t = -c.position.y / (this.ray.y || -1e-4);
    out[0] = c.position.x + this.ray.x * t;
    out[1] = c.position.z + this.ray.z * t;
  }

  private readonly proj = new Vector3();
  /** World → screen uv (0..1). Returns false if behind camera. */
  toScreen(x: number, h: number, y: number, out: Float32Array): boolean {
    this.proj.set(x, h, y).project(this.cam);
    out[0] = this.proj.x * 0.5 + 0.5;
    out[1] = this.proj.y * 0.5 + 0.5;
    return this.proj.z < 1;
  }
}
