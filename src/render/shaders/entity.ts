import { ShaderMaterial, Vector3 } from 'three';
import { LIGHTS, NOISE } from './chunks';
import type { LightPool } from '../lights';
import { lin, PAL } from '../palette';

/**
 * Entity material: flat-shaded low-poly, key + hemi + pooled point lights, team-coloured rim,
 * HDR emissive, GPU part animation, spawn dissolve, death glitch-dissolve, hit flash, elite aura,
 * boss corruption. Per-instance data: instanceMatrix, iFx(flash, spawn, charge, seed), iAnim(walk, speed, state, elite).
 */
const VERT = /* glsl */ `
attribute vec3 color;
attribute vec4 aMat;
attribute vec3 aPivot;
attribute vec4 iFx;
attribute vec4 iAnim;
uniform float uTime;
uniform float uHeight;
uniform float uCorrupt;
varying vec3 vN;
varying vec3 vW;
varying vec3 vCol;
varying vec4 vMat;
varying vec4 vFx;
varying vec4 vAnim;
varying float vH;
varying vec3 vObj;
${NOISE}
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main(){
  vec3 p = position;
  vec3 n = normal;
  float part = aMat.y;
  float prm = aMat.z;
  float seed = iFx.w;
  float t = uTime + seed * 37.0;
  float charge = iFx.z;
  vec3 pv = aPivot;
  if(part > 0.5 && part < 1.5){ // spin around pivot Y
    vec3 q = p - pv; float a = t * prm; q.xz = rot(a) * q.xz; n.xz = rot(a) * n.xz; p = q + pv;
  } else if(part < 2.5 && part > 1.5){ // leg swing (walk cycle), alternating by side & front/back
    float side = sign(pv.z + 1e-4) * sign(pv.x + 1e-4);
    float ph = iAnim.x * 2.6 + (side > 0.0 ? 0.0 : 3.14159);
    float sw = sin(ph) * 0.55 * prm * iAnim.y;
    vec3 q = p - pv; q.xy = rot(sw) * q.xy; n.xy = rot(sw) * n.xy; p = q + pv;
    p.y += max(0.0, cos(ph)) * 0.1 * iAnim.y * prm;
  } else if(part < 3.5 && part > 2.5){ // petal: opens outward with charge
    vec3 q = p - pv;
    float o = charge * prm;
    vec2 rd = normalize(q.xz + vec2(1e-4));
    float r = length(q.xz);
    q.xz += rd * (o * 0.35 + o * q.y * 0.5);
    q.y -= o * r * 0.4;
    p = q + pv;
  } else if(part < 4.5 && part > 3.5){ // bob
    p.y += sin(t * 2.4) * prm;
  } else if(part < 5.5 && part > 4.5){ // corruption jitter (horizontal slices)
    float slice = floor(p.y * 3.0);
    float g = step(0.75, hash12(vec2(slice, floor(uTime * 14.0)))) * uCorrupt;
    p.x += (hash12(vec2(slice + 3.1, floor(uTime * 14.0))) - 0.5) * prm * 4.0 * g;
  } else if(part < 6.5 && part > 5.5){ // core pulse with charge
    vec3 q = p - pv;
    q *= 1.0 + charge * prm + sin(t * (8.0 + charge * 20.0)) * 0.06 * (0.3 + charge);
    p = q + pv;
  } else if(part < 7.5 && part > 6.5){ // shield ripple when hit; collapses while shattered
    p += n * sin(p.y * 9.0 - uTime * 30.0) * 0.05 * iFx.x;
    if(iAnim.z > 19.5) p = pv + (p - pv) * 0.001;
  } else if(part > 7.5 && part < 8.5){ // recoil slide
    p.x -= prm * charge;
  } else if(part > 8.5){ // serpentine wiggle: whole segment shifts sideways, wave runs tail-ward
    float ph = uTime * (6.0 + iAnim.y * 8.0) + pv.x * 2.4 + seed * 20.0;
    p.z += sin(ph) * prm * (0.35 + iAnim.y);
    p.y += cos(ph * 0.5) * prm * 0.15;
  }
  // global: hit punch, windup squash, idle breathing
  float flash = iFx.x;
  float st = iAnim.z;
  float sq = (abs(st - 3.0) < 0.5) ? charge * 0.14 : 0.0;
  p.y *= 1.0 - sq + sin(t * 3.0) * 0.015;
  p.xz *= 1.0 + sq * 0.5 + flash * 0.1;
  // death: glitch slices + swell
  float death = -min(iFx.y, 0.0);
  if(death > 0.0){
    float slice = floor(p.y * 10.0);
    p.x += (hash12(vec2(slice, floor(uTime * 30.0))) - 0.5) * death * 0.9;
    p *= 1.0 + death * 0.25;
  }
  vObj = p;
  vH = p.y / uHeight;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  // individual variation: value ±12%, slight warm/cool shift (seed-driven)
  float vs = fract(seed * 7.31);
  vCol = color * (0.88 + vs * 0.24) * mix(vec3(1.08, 0.94, 0.96), vec3(0.94, 1.0, 1.1), fract(seed * 3.7));
  vMat = aMat;
  vFx = iFx;
  vAnim = iAnim;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uRim;
uniform vec3 uElite;
uniform float uCorrupt;
uniform float uEmitBoost;
uniform float uOvergrow; // Act II: non-flesh samples overgrown by the sector's tissue
varying vec3 vN;
varying vec3 vW;
varying vec3 vCol;
varying vec4 vMat;
varying vec4 vFx;
varying vec4 vAnim;
varying float vH;
varying vec3 vObj;
${NOISE}
${LIGHTS}
void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  float spawn = vFx.y;
  vec3 edgeGlow = vec3(0.0);
  // spawn: materialise bottom → top with a hot scanline edge
  if(spawn >= 0.0 && spawn < 0.999){
    float e = spawn * 1.15 - vH + (vnoise(vObj.xz * 9.0 + uTime * 3.0) - 0.5) * 0.12;
    if(e < 0.0) discard;
    edgeGlow = uRim * 6.0 * smoothstep(0.09, 0.0, e);
  }
  // death: voxel-ish dissolve with glowing edges
  if(spawn < 0.0){
    float d = -spawn;
    float h = hash13(floor(vObj * 7.0));
    if(h < d) discard;
    edgeGlow = mix(uRim, vec3(1.0), 0.5) * 8.0 * smoothstep(0.12, 0.0, h - d);
  }
  vec3 L = normalize(vec3(-0.45, 1.0, -0.35));
  float diff = max(dot(N, L), 0.0);
  vec3 hemi = mix(vec3(0.02, 0.016, 0.035), vec3(0.11, 0.10, 0.18), N.y * 0.5 + 0.5);
  vec3 lights = pointLights(vW, N, 0.35);
  lights = lights / (1.0 + lights * 0.25);
  vec3 col = vCol * (hemi + diff * vec3(0.62, 0.58, 0.78) + lights);
  // specular-ish glint from key
  vec3 H = normalize(L + V);
  col += pow(max(dot(N, H), 0.0), 40.0) * 0.25 * vec3(0.7, 0.75, 1.0);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col += uRim * fres * 0.45;
  // emissive (charge-boosted for animated cores/petals)
  float emit = vMat.x;
  float charge = vFx.z;
  float part = vMat.y;
  float boost = (part > 5.5 && part < 6.5) || (part > 2.5 && part < 3.5) ? 1.0 + charge * 1.4 : 1.0;
  col += vCol * emit * 2.2 * boost * uEmitBoost;
  // elite aura
  if(vAnim.w > 0.5){
    float pulse = 0.6 + 0.4 * sin(uTime * 6.0 + vW.y * 4.0);
    col += uElite * fres * 3.0 * pulse;
  }
  // overgrowth: patches of crimson tissue with pulsing veins (heartbeat in sync with the floor)
  if(uOvergrow > 0.0){
    float patchN = vnoise(vObj.xz * 2.1 + vObj.y * 1.7 + 11.0);
    float mask = smoothstep(0.3, 0.58, patchN) * uOvergrow;
    vec3 tissue = vec3(0.16, 0.012, 0.024) * (hemi + diff * 0.8 + lights) * 3.0;
    col = mix(col, tissue, mask * 0.85);
    col += vec3(0.5, 0.02, 0.07) * fres * mask * 1.5; // wet sheen at the silhouette
    float v = vnoise(vObj.xy * 6.0 + vObj.z * 4.0);
    float vein = smoothstep(0.07, 0.0, abs(v - 0.5)) * mask;
    float hb = pow(max(0.0, sin(uTime * 2.2)), 12.0);
    col += vec3(1.6, 0.08, 0.2) * vein * (0.5 + hb * 1.2);
  }
  // boss corruption: flickering inverted facets
  if(uCorrupt > 0.0){
    float c = hash13(floor(vObj * 4.0) + floor(uTime * 12.0) * vec3(1.7, 3.1, 5.3));
    if(c > 1.0 - uCorrupt * 0.15) col = vec3(1.0) * 2.5 - col;
  }
  col += edgeGlow;
  // hit flash → HDR white
  float fl = clamp(vFx.x, 0.0, 1.0);
  col = mix(col, vec3(2.2), fl * fl * 0.7);
  gl_FragColor = vec4(col, 1.0);
}
`;

export function makeEntityMaterial(lights: LightPool, rimHex: number, height: number): ShaderMaterial {
  const rim = new Vector3();
  const a = new Float32Array(3);
  lin(rimHex, a);
  rim.set(a[0]!, a[1]!, a[2]!);
  const el = new Float32Array(3);
  lin(PAL.elite, el);
  return new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uHeight: { value: height },
      uRim: { value: rim },
      uElite: { value: new Vector3(el[0], el[1], el[2]) },
      uCorrupt: { value: 0 },
      uEmitBoost: { value: 1 },
      uOvergrow: { value: 0 },
      ...lights.uniforms,
    },
  });
}
