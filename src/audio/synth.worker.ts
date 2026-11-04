/// <reference lib="webworker" />
import { renderBed, type BedId } from './beds';
import { renderStem, type StemId } from './music';
import { renderSfx, type SfxId } from './sfx';

/** Off-main-thread synthesis: returns raw PCM (transferred, zero-copy). */
export type SynthJob =
  | { job: number; kind: 'sfx'; id: SfxId; sr: number; seed: number }
  | { job: number; kind: 'bed'; id: BedId; seed: number }
  | { job: number; kind: 'stem'; id: StemId; sr: number; seed: number };
export interface SynthResult {
  job: number;
  l: Float32Array<ArrayBuffer>;
  r: Float32Array<ArrayBuffer> | null;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (e: MessageEvent<SynthJob>) => {
  const j = e.data;
  let res: SynthResult;
  if (j.kind === 'sfx') res = { job: j.job, l: renderSfx(j.id, j.sr, j.seed).d, r: null };
  else if (j.kind === 'bed') {
    const s = renderBed(j.id, j.seed);
    res = { job: j.job, l: s.l.d, r: s.r.d };
  } else {
    const s = renderStem(j.id, j.sr, j.seed);
    res = { job: j.job, l: s.l.d, r: s.r.d };
  }
  scope.postMessage(res, res.r ? [res.l.buffer, res.r.buffer] : [res.l.buffer]);
};
