import { DIFFICULTIES } from '../sim/content/difficulty';
import { WAVES } from '../sim/content/waves';
import { WavePhase } from '../sim/world';
import type { Game } from '../game';
import type { ReplayData } from '../sim/replay';
import { BOT_SKILLS } from '../sim/scenario';

const BOT_COLORS = ['#7f86a8', '#5cff9b', '#2ef2ff', '#ffb02e'];

const DIFF_COLORS = ['#5cff9b', '#2ef2ff', '#ffa126', '#ff2d7a'];
const LS_REPLAY = 'null-arena:last-replay';
const LS_SETTINGS = 'null-arena:settings';

interface Settings {
  volume: number;
  ambience: number;
  binaural: boolean;
  music: number;
  shake: number;
  quality: number;
  difficulty: number;
}

function loadSettings(): Settings {
  const d: Settings = { volume: 0.8, music: 0.55, ambience: 0.7, binaural: true, shake: 1, quality: 1, difficulty: 1 };
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
  private readonly botPick: HTMLElement;
  private readonly botBar: HTMLElement;
  private botKey = 'skilled';
  private botDiff = 1;
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
    this.botPick = this.el(root, 'screen botpick hidden');
    this.botBar = this.el(root, 'replaybar botbar hidden');
    this.botBar.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset['s']) {
        game.demoSpeed = parseFloat(t.dataset['s']);
        this.botBar.querySelectorAll('[data-s]').forEach((b) => b.classList.toggle('on', b === t));
      } else this.action(t.dataset['a']);
    });
    this.botPick.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-bot],[data-bd],[data-a]');
      if (!t) return;
      this.game.audio.playUi('ui_click');
      if (t.dataset['bot']) this.botKey = t.dataset['bot'];
      else if (t.dataset['bd']) this.botDiff = parseInt(t.dataset['bd'], 10);
      else return this.action(t.dataset['a']);
      this.buildBotPick();
    });
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
      if ((e.target as HTMLElement).classList?.contains('btn')) game.audio.playUi('ui_hover', 0.8);
    }, true);
    game.renderer.juice.shakeScale = this.settings.shake;
    game.renderer.renderScale = this.settings.quality;
    game.renderer.resize();
    game.onModeChange = (m) => {
      this.main.classList.toggle('hidden', m !== 'menu');
      this.pause.classList.toggle('hidden', m !== 'pause');
      this.over.classList.toggle('hidden', m !== 'over');
      this.replayBar.classList.toggle('hidden', m !== 'replay');
      this.botBar.classList.toggle('hidden', !(m === 'demo' && game.bot));
      if (m === 'demo' && game.bot) this.buildBotBar();
      if (m !== 'menu') this.botPick.classList.add('hidden');
      if (m === 'over') this.buildOver();
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (game.mode === 'play') game.setMode('pause');
        else if (game.mode === 'pause') game.setMode('play');
        else if (game.mode === 'replay' || (game.mode === 'demo' && game.bot)) this.action('menu');
        else if (!this.botPick.classList.contains('hidden')) this.action('botback');
      }
    });
  }

  private el(root: HTMLElement, cls: string): HTMLElement {
    const e = document.createElement('div');
    e.className = cls;
    root.appendChild(e);
    return e;
  }

  /** boots audio on the first gesture; synthesis continues in the background */
  private ensureAudio(): void {
    const a = this.game.audio;
    if (!a.ctx) {
      a.binaural = this.settings.binaural;
      void a.init(7);
      a.setVolume(this.settings.volume, this.settings.music, this.settings.ambience);
    }
    a.resume();
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
        <button class="btn alt" data-a="botmenu">Смотреть бота</button>
        <button class="btn alt small" data-a="debug" title="Сцены, лаборатория ассетов, инструменты (F1)">Отладка</button>
        <label class="field">SEED <input type="text" data-k="seed" value="${this.seed}"></label>
      </div>
      <div class="row">
        <label class="field">ЗВУК <input type="range" min="0" max="1" step="0.05" data-k="volume" value="${s.volume}"></label>
        <label class="field">МУЗЫКА <input type="range" min="0" max="1" step="0.05" data-k="music" value="${s.music}"></label>
        <label class="field">АТМОСФЕРА <input type="range" min="0" max="1" step="0.05" data-k="ambience" value="${s.ambience}"></label>
        <button class="btn alt small" data-a="binaural" title="HRTF: точное положение звука в наушниках">${s.binaural ? '3D · НАУШНИКИ' : '3D · КОЛОНКИ'}</button>
        <label class="field">ТРЯСКА <input type="range" min="0" max="1.5" step="0.05" data-k="shake" value="${s.shake}"></label>
        <label class="field">КАЧЕСТВО <input type="range" min="0.5" max="1" step="0.25" data-k="quality" value="${s.quality}"></label>
      </div>
      <div class="help"><b>WASD</b> движение · <b>ЛКМ</b> огонь · <b>КОЛЕСО / Q E / 1–6</b> оружие · <b>SPACE / SHIFT / ПКМ</b> рывок · <b>ESC</b> пауза</div>
    </div>`;
    this.main.onclick = (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-d],[data-a]');
      if (!t) return;
      // audio boots in the background — never delay the game on sound synthesis
      this.ensureAudio();
      this.game.audio.playUi('ui_click');
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
      if (k === 'volume' || k === 'music' || k === 'ambience' || k === 'shake' || k === 'quality') {
        s[k] = parseFloat(t.value);
        saveSettings(s);
        this.game.audio.setVolume(s.volume, s.music, s.ambience);
        this.game.renderer.juice.shakeScale = s.shake;
        if (k === 'quality') {
          this.game.renderer.renderScale = s.quality;
          this.game.renderer.resize();
        }
      }
    };
  }

  private buildBotPick(): void {
    const sk = BOT_SKILLS.map(
      (b, i) => `<button class="card ${b.key === this.botKey ? 'sel' : ''}" data-bot="${b.key}" style="--cc:${BOT_COLORS[i]}"><h3>${b.name}</h3><p>${b.desc}</p></button>`,
    ).join('');
    const df = DIFFICULTIES.map((d, i) => `<button class="btn alt small ${i === this.botDiff ? 'on' : ''}" data-bd="${i}" style="${i === this.botDiff ? `color:${DIFF_COLORS[i]};border-color:${DIFF_COLORS[i]}` : ''}">${d.name}</button>`).join('');
    this.botPick.innerHTML = `<div class="col">
      <h1 class="title" style="font-size:56px">БОТ</h1>
      <div class="sub">УРОВЕНЬ МАСТЕРСТВА</div>
      <div class="diffs">${sk}</div>
      <div class="row"><span class="field">СЛОЖНОСТЬ</span>${df}</div>
      <div class="row" style="margin-top:14px"><button class="btn" data-a="botgo">Смотреть</button><button class="btn alt" data-a="botback">Назад</button></div>
      <div class="help">во время просмотра: скорость <b>1–8×</b> · <b>взять управление</b> — продолжить забег самому · <b>ESC</b> — выход</div>
    </div>`;
  }

  private buildBotBar(): void {
    const b = this.game.bot;
    if (!b) return;
    const d = DIFFICULTIES[this.game.config.difficulty]!;
    this.botBar.innerHTML = `БОТ · ${b.name.toUpperCase()} · ${d.name.toUpperCase()}
      <button class="btn on" data-s="1">1×</button><button class="btn" data-s="2">2×</button><button class="btn" data-s="4">4×</button><button class="btn" data-s="8">8×</button>
      <button class="btn" data-a="takeover">Взять управление</button><button class="btn" data-a="menu">✕</button>`;
  }

  private buildOver(): void {
    const w = this.game.world;
    const win = w.wave.phase === WavePhase.Victory;
    const isReplay = this.game.replay !== null;
    const bot = this.game.bot;
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
      <div class="sub">${bot ? `БОТ «${bot.name}» · ${DIFFICULTIES[this.game.config.difficulty]!.name} · ${win ? 'ПОЛНАЯ ПОБЕДА' : `ПАЛ НА ВОЛНЕ ${w.wave.index + 1}`}` : isReplay ? 'КОНЕЦ РЕПЛЕЯ' : win ? (w.act === 2 ? 'СБОРЩИК ОСТАНОВЛЕН · сборка 9.3 отклонена' : 'МОНОЛИТ РАЗРУШЕН') : `ВОЛНА ${w.wave.index + 1}`}</div>
      <div class="stats">
        <div>ОЧКИ<b>${w.stats.score}</b></div><div>УБИЙСТВ<b>${w.stats.kills}</b></div>
        <div>ВРЕМЯ<b>${(t / 60) | 0}:${String(t % 60).padStart(2, '0')}</b></div><div>УРОН<b>${Math.round(w.stats.dmgDealt)}</b></div>
      </div>
      <div class="row" style="margin-top:28px">
        ${bot ? '<button class="btn" data-a="botagain">Ещё забег бота</button><button class="btn alt" data-a="botmenu">Другой бот</button>' : '<button class="btn" data-a="restart">Ещё раз</button>'}
        ${this.game.lastReplay && !bot ? '<button class="btn alt" data-a="watch">Смотреть реплей</button><button class="btn alt" data-a="download">Скачать реплей</button>' : ''}
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
      case 'botmenu':
        if (g.mode !== 'menu') {
          this.buildMain();
          this.onMenu?.();
        }
        this.botDiff = this.settings.difficulty;
        this.buildBotPick();
        this.main.classList.add('hidden');
        this.botPick.classList.remove('hidden');
        break;
      case 'botback':
        this.botPick.classList.add('hidden');
        this.main.classList.remove('hidden');
        break;
      case 'botgo':
      case 'botagain': {
        const skill = BOT_SKILLS.find((b) => b.key === this.botKey) ?? BOT_SKILLS[2]!;
        const diff = a === 'botagain' ? g.config.difficulty : this.botDiff;
        g.startBot({ seed: (Date.now() % 1_000_000) >>> 0 || 1, difficulty: diff }, skill);
        break;
      }
      case 'takeover':
        g.takeOver();
        break;
      case 'debug':
        this.onDebug?.();
        break;
      case 'binaural': {
        this.settings.binaural = !this.settings.binaural;
        saveSettings(this.settings);
        this.game.audio.setBinaural(this.settings.binaural);
        const b = this.main.querySelector('[data-a="binaural"]');
        if (b) b.textContent = this.settings.binaural ? '3D · НАУШНИКИ' : '3D · КОЛОНКИ';
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
  onDebug: (() => void) | null = null;
}
