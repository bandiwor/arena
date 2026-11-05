import { BEDS, BED_SR, renderBed, type BedId } from './beds';
import { LOOP_SEC, renderStem, STEMS } from './music';
import { categoryOf, LOOPS, renderSfx, SFX, SFX_INDEX, VARIANTS, type Cat, type SfxId } from './sfx';
import { makeImpulse } from './space';
import type { SynthJob, SynthResult } from './synth.worker';

const MAX_VOICES = 48;
export const LOOP_SLOTS = 8;

/** per-category mix level and reverb send */
const CAT: Record<Cat, { gain: number; verb: number }> = {
  weapon: { gain: 0.8, verb: 0.22 },
  impact: { gain: 0.72, verb: 0.18 },
  enemy: { gain: 0.8, verb: 0.3 },
  world: { gain: 0.9, verb: 0.4 },
  ui: { gain: 0.65, verb: 0 },
};
const CATS: Cat[] = ['weapon', 'impact', 'enemy', 'world', 'ui'];

/** cancel pending automation without jumping, then glide to target */
export function glide(p: AudioParam, target: number, now: number, tc: number): void {
  const hold = (p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam }).cancelAndHoldAtTime;
  if (hold) hold.call(p, now);
  else {
    const v = p.value;
    p.cancelScheduledValues(now);
    p.setValueAtTime(v, now);
  }
  p.setTargetAtTime(target, now, Math.max(0.005, tc));
}

interface LoopSlot {
  key: number;
  id: SfxId | null;
  src: AudioBufferSourceNode | null;
  gain: GainNode;
  lp: BiquadFilterNode;
  pan: PannerNode;
  lastGain: number;
  lastRate: number;
}

/**
 * Audio engine.
 *
 *  voices (src → gain → air-absorption LP → HRTF panner) ─► category bus ─┬─► sfx bus ─► pre-master
 *                                                                       └─► reverb send ─► convolver ─┘
 *  music stems (stereo, sample-locked) ─► music LP ─► music duck ─► pre-master (+ small verb send)
 *  ambience beds (stereo loops) ─► amb LP ─► amb duck ─► pre-master
 *  pre-master ─► state LP (slow-mo / low HP / pause) ─► hurt LP (transient) ─► glue comp ─► limiter ─► master
 *  ui bus ──────────────────────────────────────────────────────────────────► glue comp
 *
 * Every continuous parameter moves with setTargetAtTime — no hard jumps, no clicks.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private buffers: AudioBuffer[][] = [];
  private master!: GainNode;
  private glue!: DynamicsCompressorNode;
  private stateLP!: BiquadFilterNode;
  private hurtLP!: BiquadFilterNode;
  private pre!: GainNode;
  private sfxBus!: GainNode;
  private catBus = new Map<Cat, GainNode>();
  private verbSend!: GainNode;
  private musicLP!: BiquadFilterNode;
  private musicDuck!: GainNode;
  private musicBus!: GainNode;
  private ambLP!: BiquadFilterNode;
  private ambDuck!: GainNode;
  private ambBus!: GainNode;
  private stems: GainNode[] = [];
  private beds = new Map<BedId, GainNode>();
  private hover: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private heart: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  readonly loops: LoopSlot[] = [];
  private readonly lastPlay = new Float64Array(SFX.length);
  private readonly playing = new Int32Array(SFX.length);
  /** recent-start timestamps per category for density compensation */
  private readonly density = new Map<Cat, number>();
  private voices = 0;
  ready = false;
  /** synthesis progress for the boot screen: finished jobs / total jobs */
  readonly progress = { done: 0, total: 1 };
  musicReady = false;
  bedsReady = false;
  volume = 0.8;
  musicVolume = 0.55;
  ambVolume = 0.7;
  binaural = true;
  /** global playback-rate factor for new one-shots (slow-mo pitch drop) */
  rateScale = 1;
  private initP: Promise<void> | null = null;
  private analyser: AnalyserNode | null = null;
  private meterBuf: Float32Array<ArrayBuffer> | null = null;
  /** ms spent synthesising each stage (perf diagnostics) */
  readonly bootMs = { sfx: 0, beds: 0, music: 0 };

  init(seed = 1): Promise<void> {
    if (!this.initP) this.initP = this.boot(seed);
    return this.initP;
  }

  private async boot(seed: number): Promise<void> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const now = ctx.currentTime;
    // ── master chain
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    this.glue = ctx.createDynamicsCompressor();
    this.glue.threshold.value = -18;
    this.glue.knee.value = 12;
    this.glue.ratio.value = 2.5;
    this.glue.attack.value = 0.012;
    this.glue.release.value = 0.28;
    this.hurtLP = this.lp(20000, 0.5);
    this.stateLP = this.lp(20000, 0.6);
    this.pre = ctx.createGain();
    this.pre.connect(this.stateLP).connect(this.hurtLP).connect(this.glue).connect(limiter).connect(this.master).connect(ctx.destination);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.meterBuf = new Float32Array(new ArrayBuffer(2048 * 4));
    this.master.connect(this.analyser);
    // ── reverb
    const conv = ctx.createConvolver();
    conv.normalize = true;
    conv.buffer = makeImpulse(ctx, 2.1, seed);
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 0.25;
    const verbReturn = ctx.createGain();
    verbReturn.gain.value = 0.55;
    this.verbSend.connect(conv).connect(verbReturn).connect(this.pre);
    // ── sfx buses
    this.sfxBus = ctx.createGain();
    this.sfxBus.connect(this.pre);
    for (const c of CATS) {
      const g = ctx.createGain();
      g.gain.value = CAT[c].gain;
      if (c === 'ui') g.connect(this.glue);
      else {
        g.connect(this.sfxBus);
        const s = ctx.createGain();
        s.gain.value = CAT[c].verb;
        g.connect(s).connect(this.verbSend);
      }
      this.catBus.set(c, g);
      this.density.set(c, 0);
    }
    // ── music & ambience buses
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicLP = this.lp(1200, 0.7);
    this.musicDuck = ctx.createGain();
    this.musicBus.connect(this.musicLP).connect(this.musicDuck).connect(this.pre);
    const mv = ctx.createGain();
    mv.gain.value = 0.12;
    this.musicDuck.connect(mv).connect(this.verbSend);
    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = this.ambVolume;
    this.ambLP = this.lp(20000, 0.5);
    this.ambDuck = ctx.createGain();
    this.ambBus.connect(this.ambLP).connect(this.ambDuck).connect(this.pre);
    const av = ctx.createGain();
    av.gain.value = 0.2;
    this.ambDuck.connect(av).connect(this.verbSend);
    void now;
    // ── synthesis runs in two workers (no main-thread hitches); main-thread fallback if unavailable
    const sr = ctx.sampleRate;
    const pool = new SynthPool();
    let tb = performance.now();
    this.buffers = SFX.map(() => []);
    let jobs = BEDS.length + STEMS.length;
    for (const id of SFX) jobs += VARIANTS[id] ?? 1;
    this.progress.total = jobs;
    this.progress.done = 0;
    const tick = <T>(v: T): T => {
      this.progress.done++;
      return v;
    };
    await Promise.all(
      SFX.flatMap((id, i) =>
        Array.from({ length: VARIANTS[id] ?? 1 }, (_, v) =>
          pool.run({ job: 0, kind: 'sfx', id, sr, seed: seed + v * 101 }).then((r) => {
            const ab = ctx.createBuffer(1, r.l.length, sr);
            ab.copyToChannel(r.l, 0);
            this.buffers[i]![v] = ab;
            tick(0);
          }),
        ),
      ),
    );
    this.ready = true;
    this.bootMs.sfx = performance.now() - tb;
    this.buildLoops();
    tb = performance.now();
    // ── ambience beds + music stems requested together (both workers busy)
    const bedP = BEDS.map((id) => pool.run({ job: 0, kind: 'bed', id, seed }).then(tick));
    const stemP = STEMS.map((id) => pool.run({ job: 0, kind: 'stem', id, sr, seed }).then(tick));
    const beds = await Promise.all(bedP);
    BEDS.forEach((id, k) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      this.startLoop(this.pcmBuffer(beds[k]!, BED_SR), g, this.ambBus, 0);
      this.beds.set(id, g);
    });
    this.bedsReady = true;
    this.bootMs.beds = performance.now() - tb;
    const stems = await Promise.all(stemP);
    this.bootMs.music = performance.now() - tb;
    pool.dispose();
    // all stems share one start time → sample-locked
    const t0 = ctx.currentTime + 0.15;
    for (const s of stems) {
      const g = ctx.createGain();
      g.gain.value = 0;
      this.startLoop(this.pcmBuffer(s, sr), g, this.musicBus, t0, LOOP_SEC);
      this.stems.push(g);
    }
    this.musicReady = true;
  }

  /** output meter: peak and RMS of the last ~43 ms at the master */
  levels(out: { peak: number; rms: number }): void {
    const a = this.analyser;
    const b = this.meterBuf;
    if (!a || !b) return;
    a.getFloatTimeDomainData(b);
    let pk = 0;
    let s = 0;
    for (let i = 0; i < b.length; i++) {
      const v = b[i]!;
      const av = v < 0 ? -v : v;
      if (av > pk) pk = av;
      s += v * v;
    }
    out.peak = pk;
    out.rms = Math.sqrt(s / b.length);
  }

  private lp(f: number, q: number): BiquadFilterNode {
    const n = this.ctx!.createBiquadFilter();
    n.type = 'lowpass';
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  }

  private pcmBuffer(s: SynthResult, sr: number): AudioBuffer {
    const ab = this.ctx!.createBuffer(s.r ? 2 : 1, s.l.length, sr);
    ab.copyToChannel(s.l, 0);
    if (s.r) ab.copyToChannel(s.r, 1);
    return ab;
  }

  private startLoop(buf: AudioBuffer, gain: GainNode, dest: AudioNode, at: number, loopEnd?: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    if (loopEnd) src.loopEnd = loopEnd;
    src.connect(gain).connect(dest);
    src.start(at || this.ctx!.currentTime);
    return src;
  }

  private makePanner(): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = this.binaural ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 7;
    p.maxDistance = 90;
    p.rolloffFactor = 0.85;
    return p;
  }

  private buildLoops(): void {
    const ctx = this.ctx!;
    const enemyBus = this.catBus.get('enemy')!;
    for (let k = 0; k < LOOP_SLOTS; k++) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const lp = this.lp(20000, 0.5);
      const pan = this.makePanner();
      gain.connect(lp).connect(pan).connect(enemyBus);
      this.loops.push({ key: -1, id: null, src: null, gain, lp, pan, lastGain: 0, lastRate: 1 });
    }
    const mk = (id: SfxId, bus: Cat): { src: AudioBufferSourceNode; gain: GainNode } => {
      const g = ctx.createGain();
      g.gain.value = 0;
      const src = this.startLoop(this.buffers[SFX_INDEX[id]]![0]!, g, this.catBus.get(bus)!, 0);
      return { src, gain: g };
    };
    this.hover = mk('player_hover', 'weapon');
    this.heart = mk('heartbeat', 'ui');
  }

  resume(): void {
    void this.ctx?.resume();
  }

  setVolume(v: number, music: number, amb = this.ambVolume): void {
    this.volume = v;
    this.musicVolume = music;
    this.ambVolume = amb;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    glide(this.master.gain, v, now, 0.05);
    glide(this.musicBus.gain, music, now, 0.05);
    glide(this.ambBus.gain, amb, now, 0.05);
  }

  setBinaural(on: boolean): void {
    this.binaural = on;
    for (const l of this.loops) l.pan.panningModel = on ? 'HRTF' : 'equalpower';
  }

  // ───────────── continuous controls (driven by AudioDirector)

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }
  setStem(i: number, g: number, tc: number): void {
    const s = this.stems[i];
    if (s) glide(s.gain, g, this.now, tc);
  }
  setBed(id: BedId, g: number, tc: number): void {
    const b = this.beds.get(id);
    if (b) glide(b.gain, g, this.now, tc);
  }
  setStateLP(hz: number, tc: number): void {
    if (this.ctx) glide(this.stateLP.frequency, hz, this.now, tc);
  }
  setMusicLP(hz: number, tc: number): void {
    if (this.ctx) glide(this.musicLP.frequency, hz, this.now, tc);
  }
  setAmbLP(hz: number, tc: number): void {
    if (this.ctx) glide(this.ambLP.frequency, hz, this.now, tc);
  }
  setReverb(send: number, tc: number): void {
    if (this.ctx) glide(this.verbSend.gain, send, this.now, tc);
  }
  setHover(gain: number, rate: number): void {
    if (!this.hover) return;
    glide(this.hover.gain.gain, gain, this.now, 0.08);
    glide(this.hover.src.playbackRate, rate, this.now, 0.1);
  }
  setHeart(gain: number, rate: number): void {
    if (!this.heart) return;
    glide(this.heart.gain.gain, gain, this.now, 0.4);
    glide(this.heart.src.playbackRate, rate, this.now, 0.4);
  }

  /** smooth sidechain-style duck of music + ambience (no hard cut) */
  duck(amount: number, time: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const p of [this.musicDuck.gain, this.ambDuck.gain]) {
      glide(p, Math.max(0.05, 1 - amount), now, 0.02);
      p.setTargetAtTime(1, now + 0.06, time / 3);
    }
  }

  /** being hit: brief muffle (filter dip) that eases back — and ears ring on heavy hits */
  hurt(severity: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const f = Math.max(450, 2400 - severity * 1800);
    glide(this.hurtLP.frequency, f, now, 0.012);
    this.hurtLP.frequency.setTargetAtTime(20000, now + 0.08, 0.18 + severity * 0.25);
    if (severity > 0.55) this.playUi('tinnitus', 0.5 * severity);
  }

  /** assign / update a positional loop slot (enemy hums). key identifies the emitter. */
  setLoop(slot: number, id: SfxId | null, key: number, rx: number, ry: number, gain: number, rate: number, dist: number): void {
    const L = this.loops[slot];
    if (!L || !this.ctx || !this.ready) return;
    const now = this.ctx.currentTime;
    if (key !== L.key || id !== L.id) {
      // fade out whatever was there, then swap the source
      if (L.src) {
        const old = L.src;
        glide(L.gain.gain, 0, now, 0.04);
        old.stop(now + 0.25);
        L.src = null;
      }
      L.key = key;
      L.id = id;
      L.lastGain = 0;
      if (id) {
        const buf = this.buffers[SFX_INDEX[id]]![0]!;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        src.playbackRate.value = rate;
        src.connect(L.gain);
        // start at a random offset so identical emitters never phase-lock
        src.start(now + 0.03, Math.random() * buf.duration);
        L.src = src;
        L.pan.positionX.setValueAtTime(rx, now);
        L.pan.positionZ.setValueAtTime(ry, now);
      }
    }
    if (!L.src) return;
    glide(L.pan.positionX, rx, now, 0.05);
    glide(L.pan.positionZ, ry, now, 0.05);
    if (Math.abs(gain - L.lastGain) > 0.01) {
      glide(L.gain.gain, gain, now, 0.08);
      L.lastGain = gain;
    }
    if (Math.abs(rate - L.lastRate) > 0.005) {
      glide(L.src.playbackRate, rate, now, 0.08);
      L.lastRate = rate;
    }
    glide(L.lp.frequency, airCutoff(dist), now, 0.1);
  }

  // ───────────── one-shots

  /** Positional one-shot. (rx, ry) are relative to the listener in world units (y = sim y, "down" the screen). */
  play(id: SfxId, rx: number, ry: number, vol = 1, rate = 1, minGap = 0.03, maxSame = 6): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready || ctx.state !== 'running') return;
    const i = SFX_INDEX[id];
    const now = ctx.currentTime;
    if (now - this.lastPlay[i]! < minGap) return;
    if (this.playing[i]! >= maxSame || this.voices >= MAX_VOICES) return;
    const cat = categoryOf(id);
    // low-priority sounds yield when the mix is crowded
    if (this.voices > MAX_VOICES * 0.75 && (cat === 'impact' || id === 'shell')) return;
    const vars = this.buffers[i]!;
    const buf = vars[(Math.random() * vars.length) | 0];
    if (!buf) return;
    this.lastPlay[i] = now;
    // density compensation: many starts in the same category → each one quieter (no harsh build-up)
    const d = this.density.get(cat)! * Math.exp(-(now - (this.densT.get(cat) ?? now)) * 6) + 1;
    this.density.set(cat, d);
    this.densT.set(cat, now);
    const dens = 1 / Math.sqrt(0.6 + d * 0.4);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate * this.rateScale;
    const g = ctx.createGain();
    g.gain.value = vol * dens;
    const dist = Math.sqrt(rx * rx + ry * ry);
    let tail: AudioNode = g;
    if (Number.isFinite(ry)) {
      const lp = this.lp(airCutoff(dist), 0.5);
      const p = this.makePanner();
      p.positionX.value = rx;
      p.positionY.value = 0;
      p.positionZ.value = ry;
      g.connect(lp).connect(p);
      tail = p;
    }
    tail.connect(this.catBus.get(cat)!);
    src.connect(g);
    this.voices++;
    this.playing[i] = this.playing[i]! + 1;
    src.onended = () => {
      this.voices--;
      this.playing[i] = this.playing[i]! - 1;
      tail.disconnect();
    };
    src.start();
  }
  private readonly densT = new Map<Cat, number>();

  /** Non-positional (UI, stingers) */
  playUi(id: SfxId, vol = 1, rate = 1): void {
    this.play(id, 0, Number.NaN, vol, rate, 0.04, 4);
  }

  isLoop(id: SfxId): boolean {
    return LOOPS.has(id);
  }
}

/** air absorption: distant sounds lose their top end */
function airCutoff(dist: number): number {
  return Math.max(1400, 19000 * Math.exp(-dist / 26));
}

/** Round-robin pool of synthesis workers; falls back to main-thread rendering. */
class SynthPool {
  private readonly workers: Worker[] = [];
  private readonly pending = new Map<number, (r: SynthResult) => void>();
  private next = 1;
  private rr = 0;
  constructor() {
    if (typeof Worker === 'undefined') return;
    const n = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('./synth.worker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<SynthResult>) => {
          const cb = this.pending.get(e.data.job);
          this.pending.delete(e.data.job);
          cb?.(e.data);
        };
        this.workers.push(w);
      }
    } catch {
      this.workers.length = 0;
    }
  }
  run(job: SynthJob): Promise<SynthResult> {
    const id = this.next++;
    const j = { ...job, job: id } as SynthJob;
    if (this.workers.length === 0) return Promise.resolve(renderLocal(j));
    return new Promise((res) => {
      this.pending.set(id, res);
      this.workers[this.rr++ % this.workers.length]!.postMessage(j);
    });
  }
  dispose(): void {
    for (const w of this.workers) w.terminate();
  }
}

function renderLocal(j: SynthJob): SynthResult {
  if (j.kind === 'sfx') return { job: j.job, l: renderSfx(j.id, j.sr, j.seed).d, r: null };
  const s = j.kind === 'bed' ? renderBed(j.id, j.seed) : renderStem(j.id, j.sr, j.seed);
  return { job: j.job, l: s.l.d, r: s.r.d };
}
