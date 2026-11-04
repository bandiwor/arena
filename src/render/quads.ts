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
import { NOISE } from './shaders/chunks';

/** Quad shape kinds — each a small SDF program in the fragment shader. */
export const QK = {
  Capsule: 0,
  Orb: 1,
  Ring: 2,
  Flash: 3,
  Beam: 4,
  TeleLine: 5,
  TeleCircle: 6,
  Portal: 7,
  Vortex: 8,
  Arrow: 9,
  Shard: 10,
  Grenade: 11,
  Pickup: 12,
  Crosshair: 13,
  Laser: 14,
  Needle: 15,
  Lightning: 16,
  Streak: 17,
  Hitmarker: 18,
} as const;

/** Orientation modes */
export const QM = { Ground: 0, Billboard: 1 } as const;

const VERT = /* glsl */ `
attribute vec4 iP; // x, height, y(sim), angle
attribute vec4 iS; // length, width, kind, mode
attribute vec4 iC; // rgb (HDR), alpha (0 = additive, 1 = occluding)
attribute vec4 iX; // progress, seed, p1, p2
varying vec2 vUv;
varying vec4 vC;
varying vec4 vX;
varying vec2 vSize;
varying float vKind;
void main(){
  vUv = uv * 2.0 - 1.0;
  vC = iC; vX = iX; vKind = iS.z; vSize = iS.xy;
  vec2 q = position.xy * iS.xy;
  vec3 wp;
  if(iS.w < 0.5){
    float c = cos(iP.w), s = sin(iP.w);
    vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
    wp = vec3(iP.x + r.x, iP.y, iP.z + r.y);
  } else {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float c = cos(iP.w), s = sin(iP.w);
    vec2 r = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
    wp = vec3(iP.x, iP.y, iP.z) + right * r.x + up * r.y;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vC;
varying vec4 vX;
varying vec2 vSize;
varying float vKind;
${NOISE}
float sdCapsule(vec2 p, float halfLen, float r){ p.x = abs(p.x); p.x = max(p.x - halfLen, 0.0); return length(p) - r; }
void main(){
  vec2 uv = vUv;
  float k = vKind;
  float prog = vX.x;
  float seed = vX.y;
  vec3 col = vC.rgb;
  float a = 0.0;         // coverage for emissive glow
  float occl = 0.0;      // dark occluding part (premultiplied alpha)
  vec3 darkCol = vec3(0.0);
  float aspect = vSize.x / max(vSize.y, 1e-3);
  if(k < 0.5){ // capsule bullet: white-hot core + coloured halo, stretched along travel
    vec2 p = vec2(uv.x * aspect, uv.y);
    float d = sdCapsule(p, aspect - 1.0, 0.0);
    float core = smoothstep(0.32, 0.0, d);
    float halo = exp(-max(d, 0.0) * 3.2) * 0.8;
    col = mix(col, vec3(1.0) * max(col.r, max(col.g, col.b)) * 1.5, core);
    a = core + halo * smoothstep(1.0, 0.6, length(uv * vec2(1.0, 1.0)));
  } else if(k < 1.5){ // orb (enemy): bright ring + white core, pulsing
    float d = length(uv);
    float pulse = 0.85 + 0.15 * sin(uTime * 20.0 + seed * 40.0);
    float core = smoothstep(0.42, 0.25, d);
    float ring = smoothstep(0.2, 0.0, abs(d - 0.55)) * pulse;
    float halo = exp(-d * 3.5) * 0.6;
    col = mix(col, vec3(2.5), core * 0.8);
    a = (core + ring + halo) * smoothstep(1.0, 0.85, d);
  } else if(k < 2.5){ // expanding ring (shockwave / ground pulse)
    float d = length(uv);
    float r = 1.0 - pow(1.0 - prog, 2.2);
    // thickness in world units, independent of ring size
    float w = (0.25 + 0.7 * (1.0 - prog)) / max(vSize.x, 0.5) * 2.0;
    a = smoothstep(w, 0.0, abs(d - r)) * (1.0 - prog) * 1.6;
    a += smoothstep(r, 0.0, d) * (1.0 - prog) * 0.15 * smoothstep(12.0, 3.0, vSize.x);
  } else if(k < 3.5){ // flash: star-burst
    float d = length(uv);
    float ang = atan(uv.y, uv.x);
    float rays = pow(abs(cos(ang * 3.0 + seed * 6.0)), 18.0) * smoothstep(1.0, 0.0, d) * 0.9;
    float core = exp(-d * d * 9.0);
    a = (core * 1.5 + rays) * (1.0 - prog);
    col = mix(col, vec3(3.0), core * (1.0 - prog));
  } else if(k < 4.5){ // beam (rail): long, flickering core, noisy edges
    float n = vnoise(vec2(uv.x * vSize.x * 2.0 - uTime * 40.0, seed * 10.0));
    float w = 0.25 + n * 0.25;
    float core = smoothstep(w * 0.5, 0.0, abs(uv.y));
    float halo = exp(-abs(uv.y) * 4.0) * 0.6;
    float fade = 1.0 - prog;
    col = mix(col, vec3(3.0), core);
    a = (core + halo) * fade * smoothstep(1.0, 0.97, abs(uv.x));
  } else if(k < 5.5){ // telegraph line: hatched lane that fills toward the tip with progress
    float edge = smoothstep(1.0, 0.75, abs(uv.y));
    float x01 = uv.x * 0.5 + 0.5;
    float stripes = step(0.5, fract(uv.x * vSize.x * 0.9 - uTime * 3.0));
    float fill = step(x01, prog);
    float border = smoothstep(0.82, 0.95, abs(uv.y)) * edge;
    float center = smoothstep(0.12, 0.0, abs(uv.y)) * prog;
    a = (border * 0.7 + stripes * 0.05 * edge + fill * 0.12 * edge + center * 1.1) * (0.45 + prog * 0.75);
    a *= smoothstep(1.0, 0.92, abs(uv.x));
  } else if(k < 6.5){ // telegraph circle: rim + inner fill rising with progress
    float d = length(uv);
    float rim = smoothstep(0.05, 0.0, abs(d - 0.96));
    float fill = step(d, prog) * 0.25;
    float ringP = smoothstep(0.04, 0.0, abs(d - prog)) * 1.2;
    float hatch = step(0.6, fract((uv.x + uv.y) * 6.0 + uTime * 2.0)) * 0.08;
    a = (rim + fill + ringP + hatch) * step(d, 1.0);
  } else if(k < 7.5){ // spawn portal: rotating hex rune ring + rising core
    float d = length(uv);
    float ang = atan(uv.y, uv.x) + uTime * 2.0 * (seed > 0.5 ? 1.0 : -1.0);
    float hexR = 0.75 + 0.05 * cos(ang * 6.0);
    float ring = smoothstep(0.06, 0.0, abs(d - hexR * (0.4 + prog * 0.6)));
    float ticks = step(0.7, fract(ang * 6.0 / 6.2831)) * smoothstep(0.08, 0.0, abs(d - 0.92));
    float core = exp(-d * d * 10.0) * prog * 1.5;
    a = (ring * 1.5 + ticks + core) * (0.3 + prog);
    darkCol = vec3(0.0);
    occl = smoothstep(0.7, 0.0, d) * 0.5 * prog;
  } else if(k < 8.5){ // vortex: dark centre with bright accretion swirl
    float d = length(uv);
    float ang = atan(uv.y, uv.x);
    float sw = fbm(vec2(ang * 2.0 + d * 6.0 - uTime * 6.0, d * 3.0 + seed * 5.0));
    float disk = smoothstep(1.0, 0.35, d) * smoothstep(0.15, 0.4, d);
    float arms = pow(0.5 + 0.5 * sin(ang * 3.0 + d * 10.0 - uTime * 5.0), 3.0);
    a = disk * (0.15 + sw * 0.5) * (0.4 + arms) + smoothstep(0.04, 0.0, abs(d - 0.3)) * 1.6;
    occl = smoothstep(0.34, 0.16, d) * 0.95;
  } else if(k < 9.5){ // arrow / thorn: sharp tapered spike
    float x01 = uv.x * 0.5 + 0.5;
    float wdt = mix(0.05, 0.9, smoothstep(1.0, 0.25, x01)) * smoothstep(0.0, 0.15, x01);
    float d = abs(uv.y) - wdt;
    float core = smoothstep(0.1, -0.1, d);
    float halo = exp(-max(d, 0.0) * 6.0) * 0.6 * smoothstep(1.0, 0.3, abs(uv.x));
    col = mix(col, vec3(2.0), core * smoothstep(0.3, 1.0, x01));
    a = core + halo;
  } else if(k < 10.5){ // shard: diamond
    float d = abs(uv.x) * 0.7 + abs(uv.y) - 0.65;
    float core = smoothstep(0.08, -0.15, d);
    a = core + exp(-max(d, 0.0) * 5.0) * 0.5;
    col = mix(col, vec3(2.2), smoothstep(-0.2, -0.45, d));
  } else if(k < 11.5){ // grenade: blinking core
    float d = length(uv);
    float blink = step(0.5, fract(uTime * (4.0 + prog * 14.0)));
    float core = smoothstep(0.5, 0.35, d);
    a = core + exp(-d * 3.0) * (0.3 + blink * 0.9);
    col = mix(col, vec3(3.0), blink * core);
    occl = core * 0.8;
    darkCol = vec3(0.04, 0.03, 0.05);
  } else if(k < 12.5){ // pickup: glowing cross in a ring
    float d = length(uv);
    vec2 au = abs(uv);
    float cross = step(min(au.x, au.y), 0.16) * step(max(au.x, au.y), 0.55);
    float ring = smoothstep(0.06, 0.0, abs(d - 0.82));
    a = (cross * 1.4 + ring + exp(-d * 2.5) * 0.4) * (0.75 + 0.25 * sin(uTime * 8.0 + seed * 10.0));
  } else if(k < 13.5){ // crosshair
    float d = length(uv);
    float ang = atan(uv.y, uv.x) + uTime * 1.5;
    float ring = smoothstep(0.05, 0.0, abs(d - 0.7)) * step(0.35, fract(ang * 4.0 / 6.2831));
    vec2 au = abs(uv);
    float tick = step(min(au.x, au.y), 0.035) * step(0.25, max(au.x, au.y)) * step(max(au.x, au.y), 0.45);
    float dot_ = smoothstep(0.08, 0.0, d);
    a = (ring + tick + dot_) * (0.8 + prog * 0.6);
  } else if(k < 14.5){ // boss laser: thick hot beam with crawling noise
    float n = fbm(vec2(uv.x * vSize.x * 0.6 - uTime * 25.0, uv.y * 2.0 + seed));
    float w = 0.55 + n * 0.35;
    float core = smoothstep(w * 0.45, 0.0, abs(uv.y));
    float halo = exp(-abs(uv.y) * 2.5) * 0.7;
    col = mix(col, vec3(4.0), core);
    a = (core + halo) * smoothstep(1.0, 0.98, abs(uv.x));
  } else if(k < 15.5){ // needle: thin bright line
    float d = abs(uv.y);
    a = smoothstep(0.6, 0.0, d) * smoothstep(1.0, 0.4, abs(uv.x)) * 1.4;
    col = mix(col, vec3(2.0), smoothstep(0.25, 0.0, d));
  } else if(k < 16.5){ // lightning: jagged
    float j = (vnoise(vec2(uv.x * vSize.x * 3.0, floor(uTime * 30.0) + seed * 9.0)) - 0.5) * 1.2;
    float d = abs(uv.y - j);
    a = smoothstep(0.25, 0.0, d) * 1.5 + exp(-d * 4.0) * 0.4;
    a *= 1.0 - prog;
  } else if (k < 17.5) { // streak (dash afterimage / wind)
    float d = abs(uv.y);
    a = smoothstep(1.0, 0.0, d) * smoothstep(1.0, -0.6, uv.x) * smoothstep(-1.0, -0.7, uv.x) * (1.0 - prog);
  } else { // hitmarker: four diagonal ticks that punch outward
    vec2 au = abs(uv);
    float diag = abs(au.x - au.y);
    float r = (au.x + au.y) * 0.7071;
    float open_ = 0.3 + prog * 0.25;
    a = smoothstep(0.09, 0.0, diag) * step(open_, r) * step(r, open_ + 0.42) * (1.0 - prog) * 2.2;
  }
  a = clamp(a, 0.0, 4.0);
  vec3 rgb = col * a * (1.0 - occl) + darkCol * occl;
  float outA = clamp(occl * vC.a + occl, 0.0, 1.0);
  gl_FragColor = vec4(rgb, outA);
}`;

/**
 * Instanced quad batch. Rebuilt every frame (CPU writes flat arrays, one draw call).
 * Premultiplied blending: alpha=0 is pure additive glow, alpha>0 darkens (vortex cores, grenades).
 */
export class QuadBatch {
  readonly mesh: Mesh;
  private readonly aP: InstancedBufferAttribute;
  private readonly aS: InstancedBufferAttribute;
  private readonly aC: InstancedBufferAttribute;
  private readonly aX: InstancedBufferAttribute;
  private readonly geo: InstancedBufferGeometry;
  readonly material: ShaderMaterial;
  count = 0;
  private attrs: InstancedBufferAttribute[] = [];

  constructor(
    scene: Scene,
    readonly capacity: number,
    renderOrder: number,
    depthTest = true,
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
    this.aP = mk();
    this.aS = mk();
    this.aC = mk();
    this.aX = mk();
    g.setAttribute('iP', this.aP);
    g.setAttribute('iS', this.aS);
    g.setAttribute('iC', this.aC);
    g.setAttribute('iX', this.aX);
    this.attrs = [this.aP, this.aS, this.aC, this.aX];
    g.instanceCount = 0;
    this.geo = g;
    this.material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      depthTest,
      side: DoubleSide,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  begin(): void {
    this.count = 0;
  }

  push(
    kind: number,
    mode: number,
    x: number,
    h: number,
    y: number,
    angle: number,
    length: number,
    width: number,
    r: number,
    g: number,
    b: number,
    alpha: number,
    progress: number,
    seed: number,
  ): void {
    if (this.count >= this.capacity) return;
    const o = this.count++ * 4;
    const P = this.aP.array as Float32Array;
    const S = this.aS.array as Float32Array;
    const C = this.aC.array as Float32Array;
    const X = this.aX.array as Float32Array;
    P[o] = x;
    P[o + 1] = h;
    P[o + 2] = y;
    // ground mode: sim angle a → rotate in XZ plane; three's quad is XY so we pass the angle directly
    P[o + 3] = angle;
    S[o] = length;
    S[o + 1] = width;
    S[o + 2] = kind;
    S[o + 3] = mode;
    C[o] = r;
    C[o + 1] = g;
    C[o + 2] = b;
    C[o + 3] = alpha;
    X[o] = progress;
    X[o + 1] = seed;
    X[o + 2] = 0;
    X[o + 3] = 0;
  }

  end(time: number): void {
    this.geo.instanceCount = this.count;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * 4);
      a.needsUpdate = true;
    }
    this.material.uniforms['uTime']!.value = time;
  }
}
