import { AXIS, InputRecorder } from './input';

export interface ReplayData {
  /** 1: move stored as -1/0/1; 2: analog move ×127 */
  version: 1 | 2;
  seed: number;
  difficulty: number;
  startWave: number;
  ticks: number;
  /** final hash for verification */
  hash: string;
  inputs: string; // base64 of packed recorder arrays
  date: string;
}

export function packInputs(r: InputRecorder): string {
  const n = r.length;
  const bytes = new Uint8Array(n * (1 + 1 + 4 + 4 + 2));
  let o = 0;
  bytes.set(new Uint8Array(r.mx.buffer, 0, n), o);
  o += n;
  bytes.set(new Uint8Array(r.my.buffer, 0, n), o);
  o += n;
  bytes.set(new Uint8Array(r.ax.buffer, 0, n * 4), o);
  o += n * 4;
  bytes.set(new Uint8Array(r.ay.buffer, 0, n * 4), o);
  o += n * 4;
  bytes.set(new Uint8Array(r.btn.buffer, 0, n * 2), o);
  return toB64(bytes);
}

export function unpackInputs(s: string, ticks: number, version = 2): InputRecorder {
  const bytes = fromB64(s);
  const n = ticks;
  const r = new InputRecorder(Math.max(n, 1));
  let o = 0;
  r.mx.set(new Int8Array(bytes.buffer, o, n));
  o += n;
  r.my.set(new Int8Array(bytes.buffer, o, n));
  o += n;
  r.ax.set(new Float32Array(bytes.slice(o, o + n * 4).buffer));
  o += n * 4;
  r.ay.set(new Float32Array(bytes.slice(o, o + n * 4).buffer));
  o += n * 4;
  r.btn.set(new Uint16Array(bytes.slice(o, o + n * 2).buffer));
  if (version < 2) {
    // v1 stored the sign of the move axis; scale it to the analog encoding
    for (let i = 0; i < n; i++) {
      r.mx[i] = r.mx[i]! * AXIS;
      r.my[i] = r.my[i]! * AXIS;
    }
  }
  r.length = n;
  return r;
}

function toB64(b: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < b.length; i += CH) s += String.fromCharCode(...b.subarray(i, i + CH));
  return btoa(s);
}
function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
