import {
  BufferGeometry,
  Float32BufferAttribute,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector4,
  WebGLRenderTarget,
  type Camera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { NOISE } from './shaders/chunks';

export const MAX_WAVES = 8;

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Dual-Kawase downsample (first pass applies soft-knee threshold). */
const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uFirst;
varying vec2 vUv;
vec3 pre(vec3 c){
  // a single NaN/Inf pixel would otherwise be smeared over the whole frame by the blur chain
  if(any(isnan(c)) || any(isinf(c))) return vec3(0.0);
  c = max(c, vec3(0.0));
  if(uFirst < 0.5) return c;
  float br = max(c.r, max(c.g, c.b));
  float knee = 0.6;
  float soft = clamp(br - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, br - uThreshold) / max(br, 1e-4);
  return min(c * w, vec3(40.0));
}
void main(){
  vec2 o = uTexel;
  vec3 s = pre(texture2D(tSrc, vUv).rgb) * 4.0;
  s += pre(texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb);
  s += pre(texture2D(tSrc, vUv + vec2( o.x, -o.y)).rgb);
  s += pre(texture2D(tSrc, vUv + vec2(-o.x,  o.y)).rgb);
  s += pre(texture2D(tSrc, vUv + vec2( o.x,  o.y)).rgb);
  gl_FragColor = vec4(s / 8.0, 1.0);
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uMix;
varying vec2 vUv;
void main(){
  vec2 o = uTexel;
  vec3 s = vec3(0.0);
  s += texture2D(tSrc, vUv + vec2(-2.0*o.x, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2( 2.0*o.x, 0.0)).rgb;
  s += texture2D(tSrc, vUv + vec2(0.0, -2.0*o.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(0.0,  2.0*o.y)).rgb;
  s += texture2D(tSrc, vUv + vec2(-o.x, -o.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2( o.x, -o.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2(-o.x,  o.y)).rgb * 2.0;
  s += texture2D(tSrc, vUv + vec2( o.x,  o.y)).rgb * 2.0;
  vec3 base = texture2D(tBase, vUv).rgb;
  gl_FragColor = vec4(base + s / 12.0 * uMix, 1.0);
}`;

/**
 * Final stylisation pass: shockwave distortion → chromatic aberration → bloom → AgX-ish tonemap
 * → grade → glitch (block shift, RGB tear, inversion) → scanlines, grain, vignette, flashes.
 */
const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform vec2 uRes; uniform float uTime;
uniform float uBloom; uniform float uExposure;
uniform float uChroma; uniform float uGlitch; uniform float uFlash; uniform vec3 uFlashCol;
uniform float uDamage; uniform float uSaturate; uniform float uCorrupt; uniform float uVignette;
uniform float uScan; uniform float uGrain; uniform vec3 uTint;
uniform vec4 uWaves[${MAX_WAVES}]; // xy = uv, z = radius (uv), w = strength
uniform vec4 uLens; // xy uv, z radius, w strength (singularity lens)
varying vec2 vUv;
${NOISE}

vec3 agx(vec3 c){
  // compact AgX-like curve: log2 encode + sigmoid, keeps saturated neons from clipping to white too early
  c = max(c, vec3(0.0));
  vec3 x = clamp((log2(c + 1e-5) + 10.0) / 16.5, 0.0, 1.0);
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  vec3 r = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  return clamp(r, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }

void main(){
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  // ── shockwave ring distortion
  for(int i=0;i<${MAX_WAVES};i++){
    vec4 w = uWaves[i];
    if(w.w <= 0.0) continue;
    vec2 d = uv - w.xy; d.x *= aspect;
    float l = length(d);
    float ring = exp(-pow((l - w.z) * 28.0, 2.0));
    uv -= (d / max(l, 1e-4)) * vec2(1.0/aspect, 1.0) * ring * w.w * 0.035;
  }
  // ── singularity lens: pinch toward centre
  if(uLens.w > 0.0){
    vec2 d = uv - uLens.xy; d.x *= aspect;
    float l = length(d);
    float f = smoothstep(uLens.z, 0.0, l) * uLens.w;
    uv -= (d / max(l, 1e-4)) * vec2(1.0/aspect, 1.0) * f * 0.06 * sin(clamp(l / uLens.z, 0.0, 1.0) * 3.14159);
  }
  // ── glitch: block displacement + line tears
  float g = uGlitch + uCorrupt * 0.25;
  float tq = floor(uTime * 18.0);
  if(g > 0.01){
    vec2 blk = floor(uv * vec2(6.0, 28.0));
    float h = hash13(vec3(blk, tq));
    if(h > 1.0 - g * 0.35) uv.x += (hash12(blk + tq) - 0.5) * 0.12 * g;
    float line = floor(uv.y * uRes.y / 3.0);
    if(hash12(vec2(line, tq)) > 1.0 - g * 0.06) uv.x += (hash12(vec2(tq, line)) - 0.5) * 0.25 * g;
  }
  // ── chromatic aberration (radial) + glitch RGB split
  vec2 cd = (uv - 0.5);
  float ca = 0.0018 + uChroma * 0.012 + g * 0.006;
  vec2 off = cd * ca + vec2(g * 0.004 * (hash12(vec2(tq, 3.0)) - 0.5), 0.0);
  vec3 col;
  col.r = texture2D(tScene, uv + off).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - off).b;
  if(any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  vec3 bl;
  bl.r = texture2D(tBloom, uv + off * 1.5).r;
  bl.g = texture2D(tBloom, uv).g;
  bl.b = texture2D(tBloom, uv - off * 1.5).b;
  col += bl * uBloom;
  col *= uExposure;
  col = mix(col, col * uTint, 0.35);
  // ── tonemap + grade (cool shadows, warm-magenta highlights)
  col = agx(col);
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, 1.12 + uSaturate * 0.6);
  col += vec3(-0.004, 0.0, 0.012) * (1.0 - luma);
  // flashes
  col = mix(col, uFlashCol, clamp(uFlash, 0.0, 1.0) * 0.7);
  // glitch inversion blocks
  if(g > 0.25){
    vec2 blk = floor(vUv * vec2(10.0, 18.0));
    if(hash13(vec3(blk, tq + 7.0)) > 1.0 - (g - 0.25) * 0.12) col = col.brg * 1.7 + vec3(0.015, 0.0, 0.03);
  }
  // damage vignette (crimson edges)
  vec2 vv = vUv - 0.5;
  float vd = dot(vv, vv);
  col = mix(col, vec3(0.7, 0.02, 0.08), clamp(uDamage, 0.0, 1.0) * smoothstep(0.08, 0.5, vd) * 0.85);
  // vignette, scanlines, grain
  col *= 1.0 - smoothstep(0.18, 0.75, vd) * uVignette;
  col *= 1.0 - uScan * (0.5 + 0.5 * sin(vUv.y * uRes.y * 3.14159));
  col += (hash12(vUv * uRes + fract(uTime * 13.7) * 100.0) - 0.5) * uGrain;
  gl_FragColor = vec4(toSRGB(clamp(col, 0.0, 1.0)), 1.0);
}`;

function fsTriangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  return g;
}

export interface PostSettings {
  bloom: number;
  threshold: number;
  exposure: number;
  scan: number;
  grain: number;
  vignette: number;
  enabled: boolean;
}

export class PostFX {
  readonly scene: WebGLRenderTarget;
  private readonly mips: WebGLRenderTarget[] = [];
  private readonly ups: WebGLRenderTarget[] = [];
  private readonly quad: Mesh;
  private readonly qScene = new Scene();
  private readonly qCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly down: ShaderMaterial;
  private readonly up: ShaderMaterial;
  readonly composite: ShaderMaterial;
  readonly settings: PostSettings = { bloom: 1.0, threshold: 1.0, exposure: 1.0, scan: 0.03, grain: 0.018, vignette: 0.6, enabled: true };
  private w = 1;
  private h = 1;
  private readonly levels = 6;

  constructor(private readonly renderer: WebGLRenderer) {
    const opts = { type: HalfFloatType, format: RGBAFormat, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: false };
    this.scene = new WebGLRenderTarget(1, 1, { ...opts, depthBuffer: true, samples: 4 });
    for (let i = 0; i < this.levels; i++) {
      this.mips.push(new WebGLRenderTarget(1, 1, opts));
      this.ups.push(new WebGLRenderTarget(1, 1, opts));
    }
    this.down = new ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: DOWN_FRAG,
      uniforms: { tSrc: { value: null }, uTexel: { value: new Vector2() }, uThreshold: { value: 1 }, uFirst: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    this.up = new ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: UP_FRAG,
      uniforms: { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new Vector2() }, uMix: { value: 1 } },
      depthTest: false,
      depthWrite: false,
    });
    this.composite = new ShaderMaterial({
      vertexShader: FS_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        uRes: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uBloom: { value: 1 },
        uExposure: { value: 1 },
        uChroma: { value: 0 },
        uGlitch: { value: 0 },
        uFlash: { value: 0 },
        uFlashCol: { value: [1, 1, 1] },
        uDamage: { value: 0 },
        uSaturate: { value: 0 },
        uCorrupt: { value: 0 },
        uVignette: { value: 0.55 },
        uScan: { value: 0.035 },
        uGrain: { value: 0.035 },
        uTint: { value: [1, 1, 1] },
        uWaves: { value: Array.from({ length: MAX_WAVES }, () => new Vector4()) },
        uLens: { value: new Vector4() },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(fsTriangle(), this.down);
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
  }

  setSize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.scene.setSize(w, h);
    let mw = w;
    let mh = h;
    for (let i = 0; i < this.levels; i++) {
      mw = Math.max(1, mw >> 1);
      mh = Math.max(1, mh >> 1);
      this.mips[i]!.setSize(mw, mh);
      this.ups[i]!.setSize(mw, mh);
    }
    (this.composite.uniforms['uRes']!.value as Vector2).set(w, h);
  }

  private pass(mat: ShaderMaterial, target: WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  render(scene: Scene, camera: Camera): void {
    const r = this.renderer;
    if (!this.settings.enabled) {
      r.setRenderTarget(null);
      r.render(scene, camera);
      return;
    }
    r.setRenderTarget(this.scene);
    r.render(scene, camera);
    // bloom down chain
    const D = this.down.uniforms;
    let src: Texture = this.scene.texture;
    let sw = this.w;
    let sh = this.h;
    for (let i = 0; i < this.levels; i++) {
      D['tSrc']!.value = src;
      (D['uTexel']!.value as Vector2).set(1 / sw, 1 / sh);
      D['uThreshold']!.value = this.settings.threshold;
      D['uFirst']!.value = i === 0 ? 1 : 0;
      this.pass(this.down, this.mips[i]!);
      src = this.mips[i]!.texture;
      sw = Math.max(1, sw >> 1);
      sh = Math.max(1, sh >> 1);
    }
    // up chain: ups[i] = mips[i] + blur(ups[i+1])
    const U = this.up.uniforms;
    let upSrc: Texture = this.mips[this.levels - 1]!.texture;
    for (let i = this.levels - 2; i >= 0; i--) {
      const t = this.mips[i + 1]!;
      U['tSrc']!.value = upSrc;
      U['tBase']!.value = this.mips[i]!.texture;
      (U['uTexel']!.value as Vector2).set(1 / t.width, 1 / t.height);
      U['uMix']!.value = 1.0;
      this.pass(this.up, this.ups[i]!);
      upSrc = this.ups[i]!.texture;
    }
    const C = this.composite.uniforms;
    C['tScene']!.value = this.scene.texture;
    C['tBloom']!.value = upSrc;
    C['uBloom']!.value = this.settings.bloom * 0.22;
    C['uExposure']!.value = this.settings.exposure;
    C['uScan']!.value = this.settings.scan;
    C['uGrain']!.value = this.settings.grain;
    C['uVignette']!.value = this.settings.vignette;
    this.pass(this.composite, null);
  }
}
