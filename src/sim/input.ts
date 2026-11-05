import { Btn } from './constants';

/** Per-tick player command. The only thing that feeds the simulation from outside. */
export interface InputCmd {
  /** move direction, analog: multiples of 1/127 in [-1, 1] (keyboard gives -1 | 0 | 1) */
  mx: number;
  my: number;
  ax: number; // aim point (world), float32-quantized
  ay: number;
  btn: number;
}

export function makeCmd(): InputCmd {
  return { mx: 0, my: 0, ax: 0, ay: 0, btn: 0 };
}

/** stick axis → one of 255 exact steps (stored as Int8 in replays) */
export function quantAxis(v: number): number {
  const k = Math.round((v > 1 ? 1 : v < -1 ? -1 : v) * AXIS);
  return k / AXIS;
}
export const AXIS = 127;

export function quantizeCmd(c: InputCmd): void {
  c.mx = quantAxis(c.mx);
  c.my = quantAxis(c.my);
  c.ax = Math.fround(c.ax);
  c.ay = Math.fround(c.ay);
  c.btn &= 0xffff;
}

export function cmdPick(c: InputCmd): number {
  return (c.btn & Btn.PickMask) >> Btn.PickShift;
}
export function cmdSlot(c: InputCmd): number {
  return ((c.btn & Btn.SlotMask) >> Btn.SlotShift) - 1;
}

/** Chunk-free recorder: preallocated for 90 minutes @60Hz. */
export class InputRecorder {
  readonly mx: Int8Array;
  readonly my: Int8Array;
  readonly ax: Float32Array;
  readonly ay: Float32Array;
  readonly btn: Uint16Array;
  length = 0;
  constructor(readonly capacity = 60 * 60 * 90) {
    this.mx = new Int8Array(capacity);
    this.my = new Int8Array(capacity);
    this.ax = new Float32Array(capacity);
    this.ay = new Float32Array(capacity);
    this.btn = new Uint16Array(capacity);
  }
  push(c: InputCmd): void {
    if (this.length >= this.capacity) return;
    const i = this.length++;
    this.mx[i] = Math.round(c.mx * AXIS);
    this.my[i] = Math.round(c.my * AXIS);
    this.ax[i] = c.ax;
    this.ay[i] = c.ay;
    this.btn[i] = c.btn;
  }
  read(i: number, out: InputCmd): InputCmd {
    out.mx = (this.mx[i] ?? 0) / AXIS;
    out.my = (this.my[i] ?? 0) / AXIS;
    out.ax = this.ax[i] ?? 0;
    out.ay = this.ay[i] ?? 0;
    out.btn = this.btn[i] ?? 0;
    return out;
  }
  reset(): void {
    this.length = 0;
  }
}
