import { LOOP_SEC, renderMusicLayer } from './music';
import { renderSfx, SFX, SFX_INDEX, type SfxId } from './sfx';

const MAX_VOICES = 40;

/**
 * WebAudio engine: all SFX pre-rendered to AudioBuffers (procedural, seeded), music as
 * three looping stems crossfaded by combat intensity. Spatialised by stereo pan + distance.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private duckGain!: GainNode;
  private buffers: (AudioBuffer | null)[] = [];
  private readonly lastPlay = new Float64Array(SFX.length);
  private readonly playingCount = new Int32Array(SFX.length);
  private voices = 0;
  private stems: GainNode[] = [];
  private stemTargets = [0.8, 0, 0];
  ready = false;
  musicReady = false;
  volume = 0.8;
  musicVolume = 0.55;

  async init(seed = 1): Promise<void> {
    if (this.ctx) return;
    const Ctx = window.AudioContext;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.duckGain = ctx.createGain();
    this.sfxBus.connect(comp);
    this.musicBus.connect(this.duckGain).connect(comp);
    comp.connect(this.master).connect(ctx.destination);
    const sr = ctx.sampleRate;
    this.buffers = SFX.map((id) => {
      const b = renderSfx(id, sr, seed);
      const ab = ctx.createBuffer(1, b.n, sr);
      ab.copyToChannel(b.d, 0);
      return ab;
    });
    this.ready = true;
    // music rendered in slices so the menu stays responsive
    const layers: AudioBuffer[] = [];
    for (let l = 0; l < 3; l++) {
      await new Promise((r) => setTimeout(r, 0));
      const b = renderMusicLayer(l, sr, seed);
      const ab = ctx.createBuffer(1, b.n, sr);
      ab.copyToChannel(b.d, 0);
      layers.push(ab);
    }
    const start = ctx.currentTime + 0.1;
    for (let l = 0; l < 3; l++) {
      const src = ctx.createBufferSource();
      src.buffer = layers[l]!;
      src.loop = true;
      src.loopEnd = LOOP_SEC;
      const g = ctx.createGain();
      g.gain.value = this.stemTargets[l]!;
      src.connect(g).connect(this.musicBus);
      src.start(start);
      this.stems.push(g);
    }
    this.musicReady = true;
  }

  resume(): void {
    void this.ctx?.resume();
  }

  setVolume(v: number, music: number): void {
    this.volume = v;
    this.musicVolume = music;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    this.musicBus.gain.setTargetAtTime(music, this.ctx.currentTime, 0.05);
  }

  /** intensity 0..1, boss flag → stem mix */
  setIntensity(t: number, boss: boolean, calm: boolean): void {
    if (!this.ctx || !this.musicReady) return;
    this.stemTargets[0] = calm ? 0.9 : 0.55;
    this.stemTargets[1] = calm ? 0 : Math.min(1, 0.45 + t * 0.8);
    this.stemTargets[2] = boss ? 0.9 : t > 0.8 ? (t - 0.8) * 2.5 : 0;
    const now = this.ctx.currentTime;
    for (let i = 0; i < this.stems.length; i++) this.stems[i]!.gain.setTargetAtTime(this.stemTargets[i]!, now, 0.6);
  }

  /** brief music duck for impacts */
  duck(amount: number, time: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.duckGain.gain.cancelScheduledValues(now);
    this.duckGain.gain.setValueAtTime(1 - amount, now);
    this.duckGain.gain.linearRampToValueAtTime(1, now + time);
  }

  play(id: SfxId, pan = 0, vol = 1, rate = 1, minGap = 0.03, maxSame = 6): void {
    const ctx = this.ctx;
    if (!ctx || !this.ready || ctx.state !== 'running') return;
    const i = SFX_INDEX[id];
    const now = ctx.currentTime;
    if (now - this.lastPlay[i]! < minGap) return;
    if (this.playingCount[i]! >= maxSame || this.voices >= MAX_VOICES) return;
    const buf = this.buffers[i];
    if (!buf) return;
    this.lastPlay[i] = now;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vol;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(g).connect(p).connect(this.sfxBus);
    this.voices++;
    this.playingCount[i] = this.playingCount[i]! + 1;
    src.onended = () => {
      this.voices--;
      this.playingCount[i] = this.playingCount[i]! - 1;
      p.disconnect();
    };
    src.start();
  }
}
