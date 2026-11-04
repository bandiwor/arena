import { DIFFICULTIES } from '../sim/content/difficulty';
import { WAVES } from '../sim/content/waves';
import { WavePhase } from '../sim/world';
import type { Game } from '../game';
import type { ReplayData } from '../sim/replay';

const DIFF_COLORS = ['#5cff9b', '#2ef2ff', '#ffa126', '#ff2d7a'];
const LS_REPLAY = 'null-arena:last-replay';
const LS_SETTINGS = 'null-arena:settings';

interface Settings {
  volume: number;
  music: number;
  shake: number;
  quality: number;
  difficulty: number;
}

function loadSettings(): Settings {
  const d: Settings = { volume: 0.8, music: 0.55, shake: 1, quality: 1, difficulty: 1 };
  try {
    const s = localStorage.getItem(LS_SETTINGS);
    if (s) return { ...d, ...(JSON.parse(s) as Partial<Settings>) };
  } catch {
    /* storage unavailable */
  }
  return d;
}
function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
function loadReplay(): ReplayData | null {
  try {
    const s = localStorage.getItem(LS_REPLAY);
    return s ? (JSON.parse(s) as ReplayData) : null;
  } catch {
    return null;
  }
}

/** Main menu, pause and end screens. */
export class Menus {
  private readonly main: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly over: HTMLElement;
  private readonly replayBar: HTMLElement;
  private readonly settings = loadSettings();
  private seed = (Date.now() % 1_000_000) >>> 0;

  constructor(
    private readonly game: Game,
    root: HTMLElement,
  ) {
    this.main = this.el(root, 'screen menu');
    this.pause = this.el(root, 'screen pause hidden');
    this.over = this.el(root, 'screen over hidden');
    this.replayBar = this.el(root, 'replaybar hidden');
    this.buildMain();
    this.pause.innerHTML = `<div class="col"><h1 class="title" style="font-size:64px">ПАУЗА</h1><div class="row" style="margin-top:28px">
      <button class="btn" data-a="resume">Продолжить</button><button class="btn alt" data-a="restart">Заново</button><button class="btn alt" data-a="menu">В меню</button></div></div>`;
    this.pause.addEventListener('click', (e) => this.action((e.target as HTMLElement).dataset['a']));
    this.over.addEventListener('click', (e) => this.action((e.target as HTMLElement).dataset['a']));
    this.replayBar.innerHTML = `РЕПЛЕЙ <button class="btn" data-s="0.25">¼×</button><button class="btn" data-s="1">1×</button><button class="btn" data-s="2">2×</button><button class="btn" data-s="4">4×</button><button class="btn" data-s="8">8×</button><button class="btn" data-a="menu">✕</button>`;
    this.replayBar.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset['s']) game.replaySpeed = parseFloat(t.dataset['s']);
      else this.action(t.dataset['a']);
    });
    root.addEventListener('pointerenter', (e) => {
      if ((e.target as HTMLElement).classList?.contains('btn')) game.audio.play('ui_hover', 0, 1, 1, 0.05);
    }, true);
    game.renderer.juice.shakeScale = this.settings.shake;
    game.renderer.renderScale = this.settings.quality;
    game.renderer.resize();
    game.onModeChange = (m) => {
      this.main.classList.toggle('hidden', m !== 'menu');
      this.pause.classList.toggle('hidden', m !== 'pause');
      this.over.classList.toggle('hidden', m !== 'over');
      this.replayBar.classList.toggle('hidden', m !== 'replay');
      if (m === 'over') this.buildOver();
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (game.mode === 'play') game.setMode('pause');
        else if (game.mode === 'pause') game.setMode('play');
        else if (game.mode === 'replay') this.action('menu');
      }
    });
  }

  private el(root: HTMLElement, cls: string): HTMLElement {
    const e = document.createElement('div');
    e.className = cls;
    root.appendChild(e);
    return e;
  }

  private async ensureAudio(): Promise<void> {
    if (!this.game.audio.ctx) {
      const p = this.game.audio.init(7);
      this.game.audio.setVolume(this.settings.volume, this.settings.music);
      await p;
    }
    this.game.audio.resume();
  }

  private buildMain(): void {
    const s = this.settings;
    const hasReplay = !!loadReplay();
    this.main.innerHTML = `<div class="col">
      <h1 class="title">NULL<span>//</span>ARENA</h1>
      <div class="sub">АРЕНА · ${WAVES.length} ВОЛН · МОНОЛИТ</div>
      <div class="diffs">${DIFFICULTIES.map(
        (d, i) => `<button class="card ${i === s.difficulty ? 'sel' : ''}" data-d="${i}" style="--cc:${DIFF_COLORS[i]}"><h3>${d.name}</h3><p>${d.desc}</p></button>`,
      ).join('')}</div>
      <div class="row" style="margin-top:10px">
        <button class="btn" data-a="start">В бой</button>
        ${hasReplay ? '<button class="btn alt" data-a="replay">Последний реплей</button>' : ''}
        <label class="field">SEED <input type="text" data-k="seed" value="${this.seed}"></label>
      </div>
      <div class="row">
        <label class="field">ЗВУК <input type="range" min="0" max="1" step="0.05" data-k="volume" value="${s.volume}"></label>
        <label class="field">МУЗЫКА <input type="range" min="0" max="1" step="0.05" data-k="music" value="${s.music}"></label>
        <label class="field">ТРЯСКА <input type="range" min="0" max="1.5" step="0.05" data-k="shake" value="${s.shake}"></label>
        <label class="field">КАЧЕСТВО <input type="range" min="0.5" max="1" step="0.25" data-k="quality" value="${s.quality}"></label>
      </div>
      <div class="help"><b>WASD</b> движение · <b>ЛКМ</b> огонь · <b>КОЛЕСО / Q E / 1–6</b> оружие · <b>SPACE / SHIFT / ПКМ</b> рывок · <b>ESC</b> пауза</div>
    </div>`;
    this.main.onclick = (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-d],[data-a]');
      if (!t) return;
      // audio boots in the background — never delay the game on sound synthesis
      void this.ensureAudio().then(() => this.game.audio.play('ui_click'));
      if (t.dataset['d']) {
        s.difficulty = parseInt(t.dataset['d'], 10);
        saveSettings(s);
        this.main.querySelectorAll('[data-d]').forEach((c) => c.classList.toggle('sel', c === t));
        return;
      }
      this.action(t.dataset['a']);
    };
    this.main.oninput = (e) => {
      const t = e.target as HTMLInputElement;
      const k = t.dataset['k'];
      if (k === 'seed') {
        this.seed = parseInt(t.value, 10) >>> 0;
        return;
      }
      if (k === 'volume' || k === 'music' || k === 'shake' || k === 'quality') {
        s[k] = parseFloat(t.value);
        saveSettings(s);
        this.game.audio.setVolume(s.volume, s.music);
        this.game.renderer.juice.shakeScale = s.shake;
        if (k === 'quality') {
          this.game.renderer.renderScale = s.quality;
          this.game.renderer.resize();
        }
      }
    };
  }

  private buildOver(): void {
    const w = this.game.world;
    const win = w.wave.phase === WavePhase.Victory;
    const isReplay = this.game.replay !== null;
    if (this.game.lastReplay && !isReplay) {
      try {
        localStorage.setItem(LS_REPLAY, JSON.stringify(this.game.lastReplay));
      } catch {
        /* too large / unavailable */
      }
    }
    const t = (w.tick / 60) | 0;
    this.over.innerHTML = `<div class="col">
      <h1 class="title" style="font-size:72px;${win ? '' : 'text-shadow:0 0 40px #ff2d7a,3px 0 #ff2d7a,-3px 0 #2ef2ff'}">${win ? 'ПОБЕДА' : 'СИГНАЛ ПОТЕРЯН'}</h1>
      <div class="sub">${isReplay ? 'КОНЕЦ РЕПЛЕЯ' : win ? 'МОНОЛИТ РАЗРУШЕН' : `ВОЛНА ${w.wave.index + 1}`}</div>
      <div class="stats">
        <div>ОЧКИ<b>${w.stats.score}</b></div><div>УБИЙСТВ<b>${w.stats.kills}</b></div>
        <div>ВРЕМЯ<b>${(t / 60) | 0}:${String(t % 60).padStart(2, '0')}</b></div><div>УРОН<b>${Math.round(w.stats.dmgDealt)}</b></div>
      </div>
      <div class="row" style="margin-top:28px">
        <button class="btn" data-a="restart">Ещё раз</button>
        ${this.game.lastReplay ? '<button class="btn alt" data-a="watch">Смотреть реплей</button><button class="btn alt" data-a="download">Скачать реплей</button>' : ''}
        <button class="btn alt" data-a="menu">В меню</button>
      </div></div>`;
  }

  action(a: string | undefined): void {
    const g = this.game;
    switch (a) {
      case 'start':
        this.seed = this.seed || 1;
        g.start({ seed: this.seed, difficulty: this.settings.difficulty });
        break;
      case 'resume':
        g.setMode('play');
        break;
      case 'restart':
        g.start({ ...g.config });
        break;
      case 'replay': {
        const r = loadReplay();
        if (r) g.playReplay(r);
        break;
      }
      case 'watch':
        if (g.lastReplay) g.playReplay(g.lastReplay);
        break;
      case 'download': {
        const r = g.lastReplay;
        if (!r) break;
        const el = document.createElement('a');
        el.href = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
        el.download = `null-arena-${r.seed}.json`;
        el.click();
        break;
      }
      case 'menu':
        this.seed = (Date.now() % 1_000_000) >>> 0;
        this.buildMain();
        this.onMenu?.();
        break;
    }
  }

  onMenu: (() => void) | null = null;
}
