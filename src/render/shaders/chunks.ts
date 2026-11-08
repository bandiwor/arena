import { DataTexture, LinearFilter, RedFormat, RepeatWrapping, UnsignedByteType } from 'three';

export const MAX_LIGHTS = 24;

export const NOISE = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx+33.33); return fract((p3.xx+p3.yz)*p3.zy); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float a = 0.5; float s = 0.0; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

/** Point-light pool shared by floor, entities and pillars. */
export const LIGHTS = /* glsl */ `
uniform vec4 uLightPos[${MAX_LIGHTS}];
uniform vec4 uLightCol[${MAX_LIGHTS}];
uniform int uLightCount;
vec3 pointLights(vec3 P, vec3 N, float wrap){
  vec3 acc = vec3(0.0);
  for(int i=0;i<${MAX_LIGHTS};i++){
    if(i >= uLightCount) break;
    vec4 lp = uLightPos[i];
    vec3 L = lp.xyz - P;
    float d = length(L);
    float att = clamp(1.0 - d / lp.w, 0.0, 1.0);
    att *= att;
    float nl = clamp((dot(N, L / max(d, 1e-3)) + wrap) / (1.0 + wrap), 0.0, 1.0);
    acc += uLightCol[i].rgb * att * nl;
  }
  return acc;
}
`;

/**
 * Value noise from a 256² lattice texture (tNoise): ONE bilinear fetch at i + hermite(f) gives
 * exactly the smoothstep-interpolated value noise that `vnoise` computes with 4 hashes, and fbmT
 * is 4 fetches instead of 16 hashes + math. Used by the floor, the most expensive full-screen
 * shader. Needs the `tNoise` uniform (noiseTexture()).
 */
export const NOISE_TEX = /* glsl */ `
uniform sampler2D tNoise;
float vnoiseT(vec2 p){ vec2 i = mod(floor(p), 256.0); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return texture2D(tNoise, (i + u + 0.5) / 256.0).r; }
float fbmT(vec2 p){ float a = 0.5; float s = 0.0; for(int i=0;i<4;i++){ s += a*vnoiseT(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

let noiseTex: DataTexture | null = null;
/** 256² lattice of uniform random values (deterministic), wrapping, linearly filtered */
export function noiseTexture(): DataTexture {
  if (noiseTex) return noiseTex;
  const N = 256;
  const data = new Uint8Array(N * N);
  let s = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    data[i] = (s >>> 0) & 255;
  }
  const t = new DataTexture(data, N, N, RedFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  noiseTex = t;
  return t;
}
