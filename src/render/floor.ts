import {
  BoxGeometry,
  CustomBlending,
  DynamicDrawUsage,
  HalfFloatType,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  ZeroFactor,
  type WebGLRenderer,
} from 'three';
import { ARENA_H, ARENA_HH, ARENA_HW, ARENA_W } from '../sim/constants';
import type { LightPool } from './lights';
import { LIGHTS, NOISE, NOISE_TEX, noiseTexture } from './shaders/chunks';

export const MAX_RIPPLES = 12;
const DECAL_PX_PER_UNIT = 28;
const DECAL_CAP = 1024;

// ───────────────────────────── persistent decal layer (blood, sap, oil, scorch)

const SPLAT_VERT = /* glsl */ `
attribute vec4 iA; // x, y, size, rot
attribute vec4 iB; // r, g, b, alpha
attribute vec4 iC; // shape, seed, stretch, _
varying vec2 vUv; varying vec4 vB; varying vec4 vC;
void main(){
  vUv = uv * 2.0 - 1.0; vB = iB; vC = iC;
  vec2 q = position.xy * iA.z * vec2(1.0 + iC.z, 1.0);
  float c = cos(iA.w), s = sin(iA.w);
  vec2 p = vec2(q.x * c - q.y * s, q.x * s + q.y * c) + iA.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(p.x, -p.y, 0.0, 1.0);
}`;
const SPLAT_FRAG = /* glsl */ `
varying vec2 vUv; varying vec4 vB; varying vec4 vC;
${NOISE}
void main(){
  float d = length(vUv);
  float n = fbm(vUv * 3.0 + vC.y * 17.0);
  float shape = vC.x;
  float a;
  if(shape < 0.5){ // splat: noisy blob + droplets
    a = smoothstep(0.62, 0.5, d + (n - 0.5) * 0.55);
    vec2 cell = floor(vUv * 5.0 + vC.y * 3.0);
    vec2 h = hash22(cell);
    float drop = smoothstep(0.18, 0.08, length(fract(vUv * 5.0 + vC.y * 3.0) - h)) * step(0.72, hash12(cell + 9.1)) * step(d, 1.0);
    a = max(a, drop);
  } else if(shape < 1.5){ // scorch: soft dark ring with crackle
    a = smoothstep(1.0, 0.2, d) * (0.6 + n * 0.6);
  } else { // smear / streak
    a = smoothstep(1.0, 0.3, length(vUv * vec2(0.6, 1.6))) * (0.5 + n * 0.7);
  }
  a *= vB.a;
  gl_FragColor = vec4(vB.rgb * a, a);
}`;

const FADE_FRAG = /* glsl */ `uniform float uKeep; void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, uKeep); }`;
const FADE_VERT = /* glsl */ `void main(){ gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }`;

export class DecalLayer {
  readonly rt: WebGLRenderTarget;
  private readonly scene = new Scene();
  private readonly cam: OrthographicCamera;
  private readonly geo: InstancedBufferGeometry;
  private readonly aA: InstancedBufferAttribute;
  private readonly aB: InstancedBufferAttribute;
  private readonly aC: InstancedBufferAttribute;
  private readonly splats: Mesh;
  private readonly fade: Mesh;
  private readonly fadeMat: ShaderMaterial;
  private count = 0;
  private readonly attrs: InstancedBufferAttribute[];
  private fadeAcc = 0;
  private cleared = false;

  constructor() {
    this.rt = new WebGLRenderTarget(Math.round(ARENA_W * DECAL_PX_PER_UNIT), Math.round(ARENA_H * DECAL_PX_PER_UNIT), {
      type: HalfFloatType,
      format: RGBAFormat,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: false,
    });
    this.cam = new OrthographicCamera(-ARENA_HW, ARENA_HW, ARENA_HH, -ARENA_HH, -1, 1);
    const base = new PlaneGeometry(1, 1);
    const g = new InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    const mk = (): InstancedBufferAttribute => {
      const a = new InstancedBufferAttribute(new Float32Array(DECAL_CAP * 4), 4);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    this.aA = mk();
    this.aB = mk();
    this.aC = mk();
    g.setAttribute('iA', this.aA);
    g.setAttribute('iB', this.aB);
    g.setAttribute('iC', this.aC);
    this.attrs = [this.aA, this.aB, this.aC];
    this.geo = g;
    this.splats = new Mesh(
      g,
      new ShaderMaterial({
        vertexShader: SPLAT_VERT,
        fragmentShader: SPLAT_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
      }),
    );
    this.splats.frustumCulled = false;
    this.fadeMat = new ShaderMaterial({
      vertexShader: FADE_VERT,
      fragmentShader: FADE_FRAG,
      uniforms: { uKeep: { value: 0.995 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: ZeroFactor,
      blendDst: SrcAlphaFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: SrcAlphaFactor,
    });
    this.fade = new Mesh(new PlaneGeometry(1, 1), this.fadeMat);
    this.fade.frustumCulled = false;
  }

  /** shape: 0 splat, 1 scorch, 2 smear. Colour is linear (can be >1 for faint glow). */
  add(x: number, y: number, size: number, rot: number, r: number, g: number, b: number, a: number, shape: number, seed: number, stretch = 0): void {
    if (this.count >= DECAL_CAP) return;
    const o = this.count++ * 4;
    const A = this.aA.array as Float32Array;
    const B = this.aB.array as Float32Array;
    const C = this.aC.array as Float32Array;
    A[o] = x;
    A[o + 1] = y;
    A[o + 2] = size;
    A[o + 3] = rot;
    B[o] = r;
    B[o + 1] = g;
    B[o + 2] = b;
    B[o + 3] = a;
    C[o] = shape;
    C[o + 1] = seed;
    C[o + 2] = stretch;
  }

  clear(): void {
    this.cleared = false;
  }

  render(renderer: WebGLRenderer, dt: number): void {
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.rt);
    if (!this.cleared) {
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      this.cleared = true;
    }
    this.fadeAcc += dt;
    if (this.fadeAcc > 0.25) {
      // slow fade so the arena tells the story of the fight, then heals
      this.fadeMat.uniforms['uKeep']!.value = 0.993;
      this.scene.add(this.fade);
      renderer.render(this.scene, this.cam);
      this.scene.remove(this.fade);
      this.fadeAcc = 0;
    }
    if (this.count > 0) {
      this.geo.instanceCount = this.count;
      for (const a of this.attrs) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, this.count * 4);
        a.needsUpdate = true;
      }
      this.scene.add(this.splats);
      renderer.render(this.scene, this.cam);
      this.scene.remove(this.splats);
      this.count = 0;
    }
    renderer.setRenderTarget(null);
    renderer.autoClear = prevAuto;
  }
}

// ───────────────────────────── floor

const FLOOR_VERT = /* glsl */ `
varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const FLOOR_FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D tDecal;
uniform vec4 uRipples[${MAX_RIPPLES}]; // x, y, age, strength — live ones packed first
uniform int uRippleCount;
uniform int uWellCount;
uniform vec3 uTint;
uniform float uIce;
uniform float uCorrupt;
uniform vec3 uPlayer;
uniform vec4 uWells[4];
uniform float uAct;      // current sector: 0 Карантин, 1 Плоть, 2 Литейный цех
uniform float uPrevAct;  // sector shown outside the synthesis front
uniform float uSynthR;   // synthesis wave front radius (<0: none / complete)
uniform float uScanR;    // decompile scan ring radius (<0: none)
uniform vec4 uPools[12]; // x, y, r, live (electrified 0..1)
uniform int uPoolCount;
uniform vec4 uLanes[4];  // cx, cy, hw, hh
uniform vec4 uLaneS[4];  // dx, dy, scroll, warn(0..1) | frozen → negative warn
uniform int uLaneCount;
uniform vec4 uPads[8];   // x, y, phase01 state: 0 idle 1 mark(fill) 2 hot 3 retract, fill
uniform int uPadCount;
varying vec3 vW;
${NOISE}
${NOISE_TEX}
${LIGHTS}
float hexDist(vec2 p){ p = abs(p); return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x); }
// cellular noise → organic cells; x = F1, y = F2, z = cell id hash
vec3 cells(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i + g);
    o = 0.5 + 0.38 * sin(uTime * 0.35 + 6.2831 * o);
    float d = length(g + o - f);
    if(d < f1){ f2 = f1; f1 = d; id = hash12(i + g); } else if(d < f2) f2 = d;
  }
  return vec3(f1, f2, id);
}
vec4 hexCoords(vec2 uv){
  vec2 r = vec2(1.0, 1.7320508); vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h; vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec4(gv, uv - gv);
}
void main(){
  vec2 p = vW.xz;
  // ripples displace the grid lookup & add glow rings
  vec2 rp = p;
  float rippleGlow = 0.0;
  for(int i=0;i<${MAX_RIPPLES};i++){
    if(i >= uRippleCount) break;
    vec4 r = uRipples[i];
    vec2 d = p - r.xy; float l = length(d);
    float front = r.z * 22.0;
    float band = exp(-pow((l - front) * 0.9, 2.0)) * r.w * exp(-r.z * 2.5);
    rp += d / max(l, 1e-3) * band * 0.35;
    rippleGlow += band;
  }
  // gravity wells swirl the grid
  for(int i=0;i<4;i++){
    if(i >= uWellCount) break;
    vec4 wl = uWells[i];
    if(wl.w <= 0.0) continue;
    vec2 d = p - wl.xy; float l = length(d);
    float s = wl.w * smoothstep(wl.z, 0.0, l);
    float a = s * 1.6 * (1.0 + sin(uTime * 2.0) * 0.1);
    float c = cos(a), sn = sin(a);
    rp = wl.xy + mat2(c, -sn, sn, c) * (rp - wl.xy) * (1.0 - s * 0.25);
  }
  vec4 hc = hexCoords(rp * 0.55);
  float hd = hexDist(hc.xy);
  float line = smoothstep(0.47, 0.5, hd);
  float id = hash12(hc.zw);
  // base: deep violet-black with subtle tile variation
  vec3 base = vec3(0.0065, 0.0055, 0.013) * (0.85 + id * 0.3);
  base *= 0.9 + fbmT(p * 0.15) * 0.25;
  // lights: the floor is where glows "land" — biggest contributor to the neon look
  vec3 N = vec3(0.0, 1.0, 0.0);
  vec3 lit = pointLights(vec3(p.x, 0.0, p.y), N, 0.0);
  // tone the light pool down on the floor: glows should pool, not flood
  vec3 litF = lit / (1.0 + lit * 0.35);
  vec3 col = base + base * litF * 3.0 + litF * 0.012;
  // grid lines glow faintly, more near the player & on ripples
  float pd = length(p - uPlayer.xz);
  float near = exp(-pd * 0.12);
  vec3 lineCol = mix(vec3(0.035, 0.03, 0.09), vec3(0.0, 0.35, 0.5), near * 0.4) * uTint;
  col += line * (lineCol * (0.12 + near * 0.6) + litF * 0.06 + vec3(0.2, 0.6, 1.2) * rippleGlow);
  // occasional pulsing tiles
  float pulse = step(0.985, id) * (0.5 + 0.5 * sin(uTime * 2.0 + id * 50.0));
  col += (1.0 - line) * pulse * vec3(0.02, 0.01, 0.05) * uTint;
  // ── decompile scan: a bright ring sweeps out, the grid behind it is "erased" (data removed)
  float rr = length(p);
  if(uScanR >= 0.0){
    float band = exp(-pow((rr - uScanR) * 1.4, 2.0));
    float erased = clamp((uScanR - rr) / 8.0, 0.0, 1.0);
    col *= 1.0 - erased * 0.75 * (uAct < 0.5 ? 1.0 : 0.0);
    col += band * (vec3(0.1, 0.9, 1.4) * (0.6 + line * 1.5)) + band * line * vec3(0.8, 0.3, 1.2);
  }
  // biome weights: inside the synthesis front the new sector, outside it the old one
  float inF = 1.0;
  if(uSynthR >= 0.0) inF = clamp((uSynthR - rr) / 4.0, 0.0, 1.0);
  float fl = (abs(uAct - 1.0) < 0.5 ? inF : 0.0) + (abs(uPrevAct - 1.0) < 0.5 && uSynthR >= 0.0 ? 1.0 - inF : 0.0);
  float st = (abs(uAct - 2.0) < 0.5 ? inF : 0.0) + (abs(uPrevAct - 2.0) < 0.5 && uSynthR >= 0.0 ? 1.0 - inF : 0.0);
  // ── Плоть: living tissue with pulsing veins
  if(fl > 0.0){
    vec2 wp = p * 0.42 + vec2(fbmT(p * 0.12 + 3.1), fbmT(p * 0.12 - 7.7)) * 1.6;
    vec3 c = cells(wp);
    float edge = c.y - c.x;
    float vein = 1.0 - smoothstep(0.0, 0.09, edge);
    float hb = pow(max(0.0, sin(uTime * 2.2)), 12.0) + 0.6 * pow(max(0.0, sin(uTime * 2.2 - 0.55)), 12.0);
    float travel = 0.5 + 0.5 * sin(rr * 0.6 - uTime * 3.0 + c.z * 6.0);
    vec3 cell = vec3(0.02, 0.0035, 0.007) * (0.7 + c.z * 0.6) * (0.8 + fbmT(p * 0.5) * 0.5);
    cell *= 0.75 + 0.5 * smoothstep(0.0, 0.5, c.x); // cell centres bulge (lighter), edges sink
    vec3 veinCol = vec3(0.22, 0.012, 0.035) * (0.35 + hb * 1.1 + travel * 0.25);
    vec3 fleshCol = cell + cell * litF * 4.0 + vein * veinCol + vein * litF * 0.05;
    fleshCol += litF * 0.03 * smoothstep(0.15, 0.45, c.x);
    if(uAct > 0.5 && uAct < 1.5){
      for(int k=0;k<12;k++){
        if(k >= uPoolCount) break;
        vec4 pl = uPools[k];
        float d0 = length(p - pl.xy) / pl.z;
        if(d0 > 1.2) continue; // the noisy rim only reaches ±0.09: skip the fbm far from the pool
        float d = d0 + (fbmT(p * 0.8 + float(k)) - 0.5) * 0.18;
        if(d < 1.08){
          float inside = 1.0 - smoothstep(0.92, 1.0, d);
          vec3 liquid = vec3(0.025, 0.0, 0.006) + litF * vec3(0.05, 0.03, 0.04) + vec3(0.06, 0.0, 0.012) * (0.5 + 0.5 * sin(d * 18.0 - uTime * 1.6)) * 0.4;
          fleshCol = mix(fleshCol, liquid, inside);
          fleshCol += vec3(0.35, 0.02, 0.08) * exp(-pow((d - 1.0) * 14.0, 2.0)) * (0.6 + hb);
        }
      }
    }
    col = mix(col, fleshCol, fl);
  }
  // ── Литейный цех: riveted 4×4 steel plates, glowing seams, conveyor belts, stamp pads, coolant
  if(st > 0.0){
    vec2 pv = p / 4.0;
    vec2 pid = floor(pv);
    vec2 f = fract(pv) - 0.5;
    float pidh = hash12(pid);
    float seamD = 0.5 - max(abs(f.x), abs(f.y));
    float seam = 1.0 - smoothstep(0.0, 0.018, seamD);
    // brushed grain runs along alternate plates
    float grain = vnoiseT(vec2((pidh > 0.5 ? p.x : p.y) * 0.4, (pidh > 0.5 ? p.y : p.x) * 22.0)) * 0.35;
    vec3 plate = vec3(0.0068, 0.0072, 0.0095) * (0.7 + pidh * 0.6 + grain);
    // rivets near each plate corner
    vec2 rc = abs(f) - 0.42;
    float rivet = smoothstep(0.035, 0.015, length(rc));
    // seams carry a slow amber heat pulse outward from the centre
    float heat = 0.5 + 0.5 * sin(rr * 0.35 - uTime * 1.4 + pidh * 2.0);
    vec3 steelCol = plate + plate * litF * 3.5 + litF * 0.018 * (0.4 + grain);
    steelCol += seam * vec3(0.12, 0.045, 0.008) * (0.2 + heat * 0.7) * uTint;
    steelCol += rivet * (vec3(0.012, 0.013, 0.016) + litF * 0.08);
    // hazard chevrons along the arena rim
    vec2 eh = vec2(${ARENA_HW.toFixed(1)}, ${ARENA_HH.toFixed(1)}) - abs(p);
    float rim = step(min(eh.x, eh.y), 1.1) * step(0.35, min(eh.x, eh.y));
    float chev = step(0.5, fract((p.x + p.y) * 0.5));
    steelCol = mix(steelCol, mix(vec3(0.004), vec3(0.09, 0.05, 0.004) + litF * 0.08, chev), rim * 0.85);
    // conveyor belts: dark rubber, scrolling ribs, amber chevrons pointing the push direction
    for(int k=0;k<4;k++){
      if(k >= uLaneCount) break;
      vec4 L = uLanes[k]; vec4 S = uLaneS[k];
      vec2 q = p - L.xy;
      vec2 e = L.zw - abs(q);
      if(min(e.x, e.y) < -0.25) continue;
      bool horiz = L.z > L.w;
      float along = horiz ? q.x : q.y;
      float across = horiz ? q.y : q.x;
      float halfW = horiz ? L.w : L.z;
      float dir = horiz ? S.x : S.y;
      float u = along - S.z;
      float inside = step(0.0, min(e.x, e.y));
      float rib = smoothstep(0.08, 0.0, abs(fract(u * 2.0) - 0.5) - 0.38);
      vec3 belt = vec3(0.006, 0.006, 0.008) + rib * vec3(0.012) + litF * 0.02;
      // chevrons: |across| bends the stripe; dir flips it
      float cv = fract((u * dir + abs(across) * 0.8) * 0.5);
      float chevron = smoothstep(0.1, 0.0, abs(cv - 0.25) - 0.08) * step(abs(across), halfW * 0.8);
      float warn = max(S.w, 0.0);
      float flick = warn > 0.0 ? step(0.5, fract(uTime * 6.0)) : 1.0;
      // during the warning a second, opposite chevron set fades in
      float cv2 = fract((-u * dir + abs(across) * 0.8) * 0.5);
      float chevron2 = smoothstep(0.1, 0.0, abs(cv2 - 0.25) - 0.08) * step(abs(across), halfW * 0.8) * warn;
      vec3 amber = vec3(1.0, 0.45, 0.05);
      float frozen = S.w < 0.0 ? 1.0 : 0.0;
      vec3 chevCol = mix(amber, vec3(0.2, 0.9, 1.3), frozen) * (frozen > 0.0 ? 0.25 : 0.55);
      belt += chevron * chevCol * flick + chevron2 * amber * 0.6 * (1.0 - flick);
      // rails along both long edges
      float rail = smoothstep(0.12, 0.0, abs(abs(across) - halfW));
      belt += rail * (vec3(0.05, 0.05, 0.06) + litF * 0.2) + rail * amber * 0.25 * (0.5 + warn);
      steelCol = mix(steelCol, belt, max(inside, rail));
    }
    // stamp pads: square plates with hazard rims; fill amber while marking, white-hot on impact
    for(int k=0;k<8;k++){
      if(k >= uPadCount) break;
      vec4 P = uPads[k];
      vec2 q = abs(p - P.xy);
      float d = max(q.x, q.y);
      if(d > 1.35) continue;
      float inside = step(d, 1.0);
      float stripe = step(0.5, fract((p.x - p.y) * 1.6));
      float rimP = step(1.0, d) * step(d, 1.3);
      vec3 pad = vec3(0.012, 0.012, 0.016) + litF * 0.05;
      pad = mix(pad, mix(vec3(0.005), vec3(0.16, 0.08, 0.005), stripe), rimP);
      float state = P.z;
      if(state > 0.5 && state < 1.5){ // mark: fill rises outward from the centre
        float fillR = P.w;
        pad += inside * vec3(0.5, 0.2, 0.02) * (step(d, fillR) * 0.25 + smoothstep(0.05, 0.0, abs(d - fillR)) * 1.2);
        pad += rimP * vec3(0.8, 0.35, 0.03) * (0.5 + 0.5 * step(0.5, fract(uTime * 8.0)));
      } else if(state > 1.5 && state < 2.5){
        pad += inside * vec3(2.2, 1.6, 1.1);
      } else if(state > 2.5){
        pad += inside * vec3(0.6, 0.18, 0.02) * (1.0 - P.w);
      }
      steelCol = mix(steelCol, pad, max(inside, rimP));
    }
    // coolant: violet, shimmering at ~4 Hz, conducts the arcs
    for(int k=0;k<12;k++){
      if(k >= uPoolCount) break;
      vec4 pl = uPools[k];
      float d0 = length(p - pl.xy) / pl.z;
      // the rim glow fades by d≈1.2 (exp(-(0.2·18)²) ≈ 0): skip everything beyond
      if(d0 > 1.25) continue;
      float d = d0 + (vnoiseT(p * 1.4 + float(k) * 7.0 + uTime * 0.4) - 0.5) * 0.1;
      if(d < 1.1){
        float inside = 1.0 - smoothstep(0.94, 1.0, d);
        float shim = 0.5 + 0.5 * sin(uTime * 25.13 + d * 9.0);
        // thin bright caustic filaments over a near-black glossy liquid
        float n1 = vnoiseT(p * 1.6 + vec2(uTime * 0.6, -uTime * 0.4));
        float n2 = vnoiseT(p * 1.6 - vec2(uTime * 0.5, uTime * 0.7) + 4.0);
        float caust = pow(1.0 - abs(n1 - n2), 14.0);
        // live: a pylon discharge electrified it — the filaments flare, the whole pool crackles
        float live = clamp(pl.w, 0.0, 1.0);
        float crackle = step(0.5, fract(uTime * 23.0 + d * 3.0)) * live;
        vec3 liquid = vec3(0.006, 0.003, 0.016) + vec3(0.16, 0.06, 0.5) * caust * (0.55 + shim * 0.45) * (1.0 + live * 5.0) + litF * vec3(0.02, 0.015, 0.05);
        liquid += vec3(0.12, 0.06, 0.4) * live * (0.5 + crackle);
        steelCol = mix(steelCol, liquid, inside);
        steelCol += vec3(0.25, 0.1, 0.9) * exp(-pow((d - 1.0) * 18.0, 2.0)) * (0.45 + shim * 0.3 + live * 2.5);
      }
    }
    col = mix(col, steelCol, st);
  }
  // synthesis front: hot crimson-white seam where matter is being written
  if(uSynthR >= 0.0){
    float sb = exp(-pow((rr - uSynthR) * 0.9, 2.0));
    vec3 seamCol = uAct > 1.5 ? vec3(1.7, 0.7, 0.12) : vec3(1.6, 0.18, 0.35);
    col += sb * (seamCol + vec3(1.0) * pow(sb, 6.0)) * (0.7 + 0.3 * sin(atan(p.y, p.x) * 12.0 + uTime * 9.0));
  }
  // decals (blood / sap / oil / scorch)
  vec2 duv = vec2((p.x + ${ARENA_HW.toFixed(1)}) / ${ARENA_W.toFixed(1)}, 1.0 - (p.y + ${ARENA_HH.toFixed(1)}) / ${ARENA_H.toFixed(1)});
  vec4 dc = texture2D(tDecal, duv);
  // wet decals catch light
  vec3 decal = dc.rgb + dc.rgb * lit * 2.0;
  col = col * (1.0 - dc.a) + decal;
  // ice sheen
  if(uIce > 0.0){
    float streak = fbmT(vec2(p.x * 0.2 + p.y * 0.6, p.y * 0.05) * 2.0);
    col = mix(col, col * 0.8 + vec3(0.002, 0.007, 0.011) * (0.4 + streak * 1.5) + litF * 0.03, uIce);
  }
  // corruption: tiles flicker and invert
  if(uCorrupt > 0.0){
    float c = hash13(vec3(hc.zw, floor(uTime * 8.0)));
    col += step(1.0 - uCorrupt * 0.06, c) * vec3(0.05, 0.012, 0.1) * (1.0 - line);
  }
  // arena border glow
  vec2 e = vec2(${ARENA_HW.toFixed(1)}, ${ARENA_HH.toFixed(1)}) - abs(p);
  float ed = min(e.x, e.y);
  col += vec3(0.25, 0.08, 0.6) * exp(-max(ed, 0.0) * 3.0) * 0.12 * uTint;
  // outside arena: void with sparse falling grid
  if(ed < 0.0){
    col = vec3(0.002, 0.002, 0.005) + line * vec3(0.01, 0.008, 0.03) * exp(ed * 0.3);
  }
  gl_FragColor = vec4(col, 1.0);
}`;

const WALL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uTint;
varying vec3 vW;
varying vec3 vN;
${LIGHTS}
void main(){
  vec3 N = normalize(vN);
  vec3 lit = pointLights(vW, N, 0.2);
  vec3 col = vec3(0.012, 0.01, 0.025) + vec3(0.03, 0.025, 0.06) * lit;
  // thin neon lip on the inner top edge only (the top face itself stays dark)
  vec2 e2 = vec2(${ARENA_HW.toFixed(1)}, ${ARENA_HH.toFixed(1)}) - abs(vW.xz);
  float edgeD = min(e2.x, e2.y);
  float lip = 1.0 - clamp(abs(edgeD + 0.06) / 0.1, 0.0, 1.0);
  float top = clamp((vW.y - 1.06) / 0.04, 0.0, 1.0) * lip;
  float scan = step(0.92, fract(vW.y * 3.0 - uTime * 0.5)) * 0.25;
  float seg = step(0.96, fract((vW.x + vW.z) * 0.25));
  col += (top * 1.6 + scan * 0.3 + seg * 0.12) * vec3(0.35, 0.12, 1.0) * uTint;
  gl_FragColor = vec4(col, 1.0);
}`;
const WALL_VERT = /* glsl */ `
varying vec3 vW; varying vec3 vN;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;

export class Floor {
  readonly material: ShaderMaterial;
  readonly wallMat: ShaderMaterial;
  readonly decals = new DecalLayer();
  private readonly rip = new Float32Array(MAX_RIPPLES * 4);
  private ripCursor = 0;

  constructor(scene: Scene, lights: LightPool) {
    this.material = new ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        tDecal: { value: this.decals.rt.texture },
        uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new Vector4()) },
        uRippleCount: { value: 0 },
        tNoise: { value: noiseTexture() },
        uWellCount: { value: 0 },
        uTint: { value: new Vector3(1, 1, 1) },
        uIce: { value: 0 },
        uCorrupt: { value: 0 },
        uPlayer: { value: new Vector3() },
        uWells: { value: Array.from({ length: 4 }, () => new Vector4()) },
        uAct: { value: 0 },
        uPrevAct: { value: 0 },
        uSynthR: { value: -1 },
        uScanR: { value: -1 },
        uPools: { value: Array.from({ length: 12 }, () => new Vector4()) },
        uPoolCount: { value: 0 },
        uLanes: { value: Array.from({ length: 4 }, () => new Vector4()) },
        uLaneS: { value: Array.from({ length: 4 }, () => new Vector4()) },
        uLaneCount: { value: 0 },
        uPads: { value: Array.from({ length: 8 }, () => new Vector4()) },
        uPadCount: { value: 0 },
        ...lights.uniforms,
      },
    });
    const floor = new Mesh(new PlaneGeometry(ARENA_W + 60, ARENA_H + 60), this.material);
    floor.rotation.x = -Math.PI / 2;
    floor.renderOrder = 0;
    scene.add(floor);
    this.wallMat = new ShaderMaterial({
      vertexShader: WALL_VERT,
      fragmentShader: WALL_FRAG,
      uniforms: { uTime: { value: 0 }, uTint: { value: new Vector3(1, 1, 1) }, ...lights.uniforms },
    });
    const t = 0.6;
    const h = 1.1;
    const walls: [number, number, number, number][] = [
      [0, -ARENA_HH - t / 2, ARENA_W + t * 2, t],
      [0, ARENA_HH + t / 2, ARENA_W + t * 2, t],
      [-ARENA_HW - t / 2, 0, t, ARENA_H],
      [ARENA_HW + t / 2, 0, t, ARENA_H],
    ];
    for (const [x, y, w, d] of walls) {
      const m = new Mesh(new BoxGeometry(w, h, d), this.wallMat);
      m.position.set(x, h / 2, y);
      scene.add(m);
    }
  }

  ripple(x: number, y: number, strength: number): void {
    const o = this.ripCursor * 4;
    this.ripCursor = (this.ripCursor + 1) % MAX_RIPPLES;
    this.rip[o] = x;
    this.rip[o + 1] = y;
    this.rip[o + 2] = 0;
    this.rip[o + 3] = strength;
  }

  update(time: number, dt: number, px: number, py: number): void {
    const U = this.material.uniforms;
    U['uTime']!.value = time;
    this.wallMat.uniforms['uTime']!.value = time;
    (U['uPlayer']!.value as Vector3).set(px, 0, py);
    // only live ripples are sent, packed first: the shader loops over uRippleCount, not all slots
    const arr = U['uRipples']!.value as Vector4[];
    let n = 0;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const o = i * 4;
      if (this.rip[o + 3]! <= 0) continue;
      this.rip[o + 2] = this.rip[o + 2]! + dt;
      if (this.rip[o + 2]! > 1.6) {
        this.rip[o + 3] = 0;
        continue;
      }
      arr[n++]!.set(this.rip[o]!, this.rip[o + 1]!, this.rip[o + 2]!, this.rip[o + 3]!);
    }
    U['uRippleCount']!.value = n;
  }
}
