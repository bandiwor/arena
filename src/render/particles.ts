import {
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  ShaderMaterial,
  type Scene,
} from 'three';

/** Particle shapes */
export const PS = {
  Glow: 0,
  Spark: 1,
  Pixel: 2,
  Shard: 3,
  Leaf: 4,
  Smoke: 5,
  Blood: 6,
  Ring: 7,
  Ember: 8,
  Bolt: 9,
} as const;

/**
 * Stateless GPU particles. CPU writes only spawn parameters into a ring buffer;
 * the vertex shader integrates drag + gravity analytically and lands particles on the floor.
 * Cost per frame is the upload of newly spawned particles only.
 */
const VERT = /* glsl */ `
attribute vec4 a0; // x, h, y, t0
attribute vec4 a1; // vx, vh, vy, life
attribute vec4 a2; // r, g, b (HDR), size
attribute vec4 a3; // drag, gravity, shape, alpha(occlusion)
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
varying float vLife;
varying float vSeed;
void main(){
  float age = uTime - a0.w;
  float life = a1.w;
  if(age < 0.0 || age > life){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float k = max(a3.x, 1e-3);
  float g = a3.y;
  float f = (1.0 - exp(-k * age)) / k;
  vec3 p0 = a0.xyz;
  vec3 v0 = a1.xyz;
  // vertical: gravity w/o drag (analytic landing time), horizontal: drag
  float tLand = 1e9;
  if(g > 0.0){
    float disc = v0.y * v0.y + 2.0 * g * max(p0.y, 0.0);
    tLand = (v0.y + sqrt(disc)) / g;
  }
  float ta = min(age, tLand);
  float fa = (1.0 - exp(-k * ta)) / k;
  vec3 p = vec3(p0.x + v0.x * fa, p0.y + v0.y * ta - 0.5 * g * ta * ta, p0.z + v0.z * fa);
  vec3 vel = vec3(v0.x * exp(-k * ta), v0.y - g * ta, v0.z * exp(-k * ta));
  bool landed = age >= tLand;
  if(landed){ p.y = 0.02; vel = vec3(0.0); }
  if(g <= 0.0) { p.y = p0.y + v0.y * f; vel.y = v0.y * exp(-k * age); }
  float t01 = age / life;
  float shape = a3.z;
  float size = a2.w;
  // size curve per shape
  float sz = size * (shape == 5.0 ? (0.4 + t01 * 1.6) : (1.0 - t01 * t01));
  vec3 viewDir = normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec2 q = position.xy;
  vec3 wp;
  float sp = length(vel);
  if((shape == 1.0 || shape == 9.0) && sp > 0.05){
    // velocity-stretched spark
    vec3 ax = vel - dot(vel, viewDir) * viewDir;
    float al = length(ax);
    ax = al > 1e-4 ? ax / al : right;
    vec3 side = normalize(cross(viewDir, ax));
    float len = sz + sp * 0.045;
    wp = p + ax * q.x * len * 2.0 + side * q.y * sz * 0.5;
  } else if(landed && (shape == 6.0 || shape == 4.0 || shape == 3.0)){
    // lie flat on the floor
    float a = a0.w * 91.7;
    float c = cos(a), s = sin(a);
    vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * sz * 1.4;
    wp = vec3(p.x + r.x, 0.02, p.z + r.y);
  } else {
    float a = a0.w * 53.1 + age * (shape == 3.0 || shape == 4.0 ? 9.0 : 0.0);
    float c = cos(a), s = sin(a);
    vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * sz;
    wp = p + right * r.x + up * r.y;
  }
  vUv = uv * 2.0 - 1.0;
  float fade = shape == 6.0 || shape == 3.0 ? (1.0 - smoothstep(0.75, 1.0, t01)) : (1.0 - t01);
  vCol = vec4(a2.rgb * fade, a3.w * fade);
  vShape = shape;
  vLife = t01;
  vSeed = fract(a0.w * 13.37);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vCol;
varying float vShape;
varying float vLife;
varying float vSeed;
void main(){
  float d = length(vUv);
  float a;
  float s = vShape;
  if(s < 0.5) a = exp(-d * d * 4.0) * smoothstep(1.0, 0.8, d);                // glow
  else if(s < 1.5) a = exp(-vUv.y * vUv.y * 8.0) * smoothstep(1.0, 0.5, abs(vUv.x)); // spark
  else if(s < 2.5) a = step(max(abs(vUv.x), abs(vUv.y)), 0.7);                 // pixel
  else if(s < 3.5) a = step(abs(vUv.x) * 0.6 + abs(vUv.y), 0.7);               // shard
  else if(s < 4.5) a = step(length(vUv * vec2(1.0, 2.2)), 0.85) * (0.75 + 0.25 * step(abs(vUv.y), 0.06)); // leaf
  else if(s < 5.5) a = smoothstep(1.0, 0.1, d) * 0.6;                           // smoke
  else if(s < 6.5) a = smoothstep(0.85, 0.55, d + (fract(sin(dot(floor(vUv * 3.0), vec2(12.9, 78.2)) + vSeed) * 43758.5) - 0.5) * 0.3); // blood drop
  else if(s < 7.5) a = smoothstep(0.12, 0.0, abs(d - 0.8));                     // ring
  else if(s < 8.5) a = exp(-d * d * 6.0) * (0.7 + 0.3 * sin(vLife * 40.0 + vSeed * 6.0)); // ember flicker
  else a = exp(-vUv.y * vUv.y * 30.0) * smoothstep(1.0, 0.3, abs(vUv.x)) * 1.5; // bolt
  if(a < 0.01) discard;
  // premultiplied: rgb added, alpha occludes (blood/smoke/leaves darken what is under them)
  gl_FragColor = vec4(vCol.rgb * a, vCol.a * a);
}`;

export class Particles {
  readonly mesh: Mesh;
  private readonly a0: InstancedBufferAttribute;
  private readonly a1: InstancedBufferAttribute;
  private readonly a2: InstancedBufferAttribute;
  private readonly a3: InstancedBufferAttribute;
  private readonly material: ShaderMaterial;
  private readonly attrs: InstancedBufferAttribute[];
  private cursor = 0;
  private dirtyStart = -1;
  private dirtyCount = 0;
  private wrapped = false;
  time = 0;
  emitted = 0;

  constructor(
    scene: Scene,
    readonly capacity = 32768,
  ) {
    const base = new PlaneGeometry(1, 1);
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    const mk = (): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.a0 = mk();
    this.a1 = mk();
    this.a2 = mk();
    this.a3 = mk();
    // park all at t0 = -1e6 with life 0 → hidden
    (this.a0.array as Float32Array).fill(-1e6);
    g.setAttribute('a0', this.a0);
    g.setAttribute('a1', this.a1);
    g.setAttribute('a2', this.a2);
    g.setAttribute('a3', this.a3);
    this.attrs = [this.a0, this.a1, this.a2, this.a3];
    g.instanceCount = capacity;
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  /**
   * Spawn one particle. x/y are sim ground coords, h is height.
   * color is HDR linear rgb; alpha > 0 makes it occlude (blood, smoke).
   */
  emit(
    x: number,
    h: number,
    y: number,
    vx: number,
    vh: number,
    vy: number,
    life: number,
    r: number,
    g: number,
    b: number,
    size: number,
    drag: number,
    gravity: number,
    shape: number,
    alpha: number,
  ): void {
    const i = this.cursor;
    this.cursor++;
    if (this.cursor >= this.capacity) {
      this.cursor = 0;
      this.wrapped = true;
    }
    const o = i * 4;
    const A0 = this.a0.array as Float32Array;
    const A1 = this.a1.array as Float32Array;
    const A2 = this.a2.array as Float32Array;
    const A3 = this.a3.array as Float32Array;
    A0[o] = x;
    A0[o + 1] = h;
    A0[o + 2] = y;
    A0[o + 3] = this.time;
    A1[o] = vx;
    A1[o + 1] = vh;
    A1[o + 2] = vy;
    A1[o + 3] = life;
    A2[o] = r;
    A2[o + 1] = g;
    A2[o + 2] = b;
    A2[o + 3] = size;
    A3[o] = drag;
    A3[o + 1] = gravity;
    A3[o + 2] = shape;
    A3[o + 3] = alpha;
    if (this.dirtyStart < 0) this.dirtyStart = i;
    this.dirtyCount++;
    this.emitted++;
  }

  update(time: number): void {
    this.time = time;
    this.material.uniforms['uTime']!.value = time;
    if (this.dirtyCount === 0) return;
    const start = this.dirtyStart;
    const n = Math.min(this.dirtyCount, this.capacity);
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      if (this.wrapped || start + n > this.capacity) {
        a.addUpdateRange(start * 4, (this.capacity - start) * 4);
        a.addUpdateRange(0, this.cursor * 4);
      } else {
        a.addUpdateRange(start * 4, n * 4);
      }
      a.needsUpdate = true;
    }
    this.dirtyStart = -1;
    this.dirtyCount = 0;
    this.wrapped = false;
  }
}
