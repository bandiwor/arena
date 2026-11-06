import { DIFFICULTIES } from '../sim/content/difficulty';
import { WAVES } from '../sim/content/waves';
import { WavePhase } from '../sim/world';
import type { Game } from '../game';
import type { ReplayData } from '../sim/replay';
import { BOT_SKILLS } from '../sim/scenario';
import { button, card, kbd, textField } from './kit';
import { applySettings, loadSettings, saveSettings } from './settings';
import { DIFF_COLORS, SettingsScreen } from './settings-screen';

const BOT_COLORS = ['#7f86a8', '#5cff9b', '#2ef2ff', '#ffb02e', '#c77dff'];
const LS_REPLAY = 'null-arena:last-replay';

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
  readonly settings = loadSettings();
  readonly settingsScreen: SettingsScreen;
  /** where the settings screen returns to */
  private settingsFrom: 'main' | 'pause' = 'main';
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
    this.pause.innerHTML = `<div class="col pause-col"><h1 class="title">ПАУЗА</h1><div class="stack">
      ${button('Продолжить', { variant: 'primary', size: 'lg', action: 'resume', wide: true, icon: '▶' })}
      ${button('Настройки', { action: 'settings', wide: true, icon: '⚙' })}
      ${button('Заново', { action: 'restart', wide: true, icon: '↻' })}
      ${button('В меню', { variant: 'danger', action: 'menu', wide: true, icon: '✕' })}</div></div>`;
    const act = (e: Event): void => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset['a'];
      if (!a) return;
      this.game.audio.playUi('ui_click');
      this.action(a);
    };
    this.pause.addEventListener('click', act);
    this.over.addEventListener('click', act);
    this.settingsScreen = new SettingsScreen(game, root, this.settings);
    this.settingsScreen.onClose = () => {
      if (this.settingsFrom === 'pause' && game.mode === 'pause') this.pause.classList.remove('hidden');
      else if (game.mode === 'menu') {
        this.buildMain();
        this.main.classList.remove('hidden');
      }
    };
    this.replayBar.innerHTML = `РЕПЛЕЙ <button class="btn" data-s="0.25">¼×</button><button class="btn" data-s="1">1×</button><button class="btn" data-s="2">2×</button><button class="btn" data-s="4">4×</button><button class="btn" data-s="8">8×</button><button class="btn" data-a="menu">✕</button>`;
    this.replayBar.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.dataset['s']) game.replaySpeed = parseFloat(t.dataset['s']);
      else this.action(t.dataset['a']);
    });
    root.addEventListener('pointerenter', (e) => {
      if ((e.target as HTMLElement).classList?.contains('btn')) game.audio.playUi('ui_hover', 0.8);
    }, true);
    applySettings(game, this.settings);
    game.onModeChange = (m) => {
      this.main.classList.toggle('hidden', m !== 'menu');
      this.pause.classList.toggle('hidden', m !== 'pause');
      this.over.classList.toggle('hidden', m !== 'over');
      this.replayBar.classList.toggle('hidden', m !== 'replay');
      this.botBar.classList.toggle('hidden', !(m === 'demo' && game.bot));
      if (m === 'demo' && game.bot) this.buildBotBar();
      if (m !== 'menu') this.botPick.classList.add('hidden');
      if (m !== 'menu' && m !== 'pause' && this.settingsScreen.isOpen) this.settingsScreen.close();
      if (m === 'over') this.buildOver();
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.settingsScreen.isOpen) this.settingsScreen.close();
        else if (game.mode === 'play') game.setMode('pause');
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
  ensureAudio(): void {
    const a = this.game.audio;
    if (!a.ctx) {
      void a.init(7);
      applySettings(this.game, this.settings);
    }
    a.resume();
  }

  private buildMain(): void {
    const s = this.settings;
    const hasReplay = !!loadReplay();
    this.main.innerHTML = `<div class="mm">
      <div class="mm-left">
        <h1 class="title">NULL<span>//</span>ARENA</h1>
        <div class="sub">3 АКТА · ${WAVES.length} ВОЛН · ПРОЦЕСС «ВЕКТОР»</div>
        <div class="stack">
          ${button('В бой', { variant: 'primary', size: 'lg', action: 'start', wide: true, icon: '▶', accent: DIFF_COLORS[s.difficulty] })}
          ${hasReplay ? button('Последний реплей', { action: 'replay', wide: true, icon: '⟲' }) : ''}
          ${button('Смотреть бота', { action: 'botmenu', wide: true, icon: '◎' })}
          ${button('Настройки', { action: 'settings', wide: true, icon: '⚙' })}
          ${button('Отладка', { variant: 'link', size: 'sm', action: 'debug', hint: 'Сцены, лаборатория ассетов, UI-кит, инструменты (F1)' })}
        </div>
      </div>
      <div class="mm-right">
        <h4 class="mm-h">СЛОЖНОСТЬ</h4>
        <div class="mm-diffs">${DIFFICULTIES.map((d, i) => card({ title: d.name, body: d.desc, accent: DIFF_COLORS[i]!, selected: i === s.difficulty, data: { d: i }, tag: ['мягко', 'задумано', 'жёстко', 'предел'][i] ?? '' })).join('')}</div>
        <div class="mm-seed"><span>ИТЕРАЦИЯ (SEED)</span>${textField('seed', String(this.seed))}<small>один seed — один и тот же забег</small></div>
      </div>
      <div class="mm-help help"><span class="kb">${kbd('WASD')} движение · ${kbd('ЛКМ')} огонь · ${kbd('SPACE')} рывок · ${kbd('Q')}${kbd('E')} оружие · ${kbd('ESC')} пауза</span><span class="tc">левый стик — движение · правый — прицел и огонь · РЫВОК — кнопка или двойное касание слева</span></div>
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
        this.main.querySelector<HTMLElement>('[data-a="start"]')?.style.setProperty('--ac', DIFF_COLORS[s.difficulty]!);
        return;
      }
      this.action(t.dataset['a']);
    };
    this.main.oninput = (e) => {
      const t = e.target as HTMLInputElement;
      if (t.dataset['k'] === 'seed') this.seed = parseInt(t.value, 10) >>> 0;
    };
  }

  private buildBotPick(): void {
    const sk = BOT_SKILLS.map((b, i) => card({ title: b.name, body: b.desc, accent: BOT_COLORS[i]!, selected: b.key === this.botKey, data: { bot: b.key } })).join('');
    const df = `<div class="k-seg">${DIFFICULTIES.map((d, i) => `<button data-bd="${i}" class="${i === this.botDiff ? 'on' : ''}" style="--ac:${DIFF_COLORS[i]}">${d.name}</button>`).join('')}</div>`;
    this.botPick.innerHTML = `<div class="col">
      <h1 class="title" style="font-size:56px">БОТ</h1>
      <div class="sub">УРОВЕНЬ МАСТЕРСТВА</div>
      <div class="diffs">${sk}</div>
      <div class="row"><span class="field">СЛОЖНОСТЬ</span>${df}</div>
      <div class="row" style="margin-top:14px">${button('Смотреть', { variant: 'primary', action: 'botgo', icon: '▶' })}${button('Назад', { action: 'botback' })}</div>
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
      <h1 class="title over-title" style="${win ? '' : 'text-shadow:0 0 40px #ff2d7a,3px 0 #ff2d7a,-3px 0 #2ef2ff'}">${win ? 'ПОБЕДА' : 'СИГНАЛ ПОТЕРЯН'}</h1>
      <div class="sub">${bot ? `БОТ «${bot.name}» · ${DIFFICULTIES[this.game.config.difficulty]!.name} · ${win ? 'ПОЛНАЯ ПОБЕДА' : `ПАЛ НА ВОЛНЕ ${w.wave.index + 1}`}` : isReplay ? 'КОНЕЦ РЕПЛЕЯ' : win ? (w.act === 2 ? 'СБОРЩИК ОСТАНОВЛЕН · сборка 9.3 отклонена' : 'МОНОЛИТ РАЗРУШЕН') : `ВОЛНА ${w.wave.index + 1}`}</div>
      <div class="stats">
        <div>ОЧКИ<b>${w.stats.score}</b></div><div>УБИЙСТВ<b>${w.stats.kills}</b></div>
        <div>ВРЕМЯ<b>${(t / 60) | 0}:${String(t % 60).padStart(2, '0')}</b></div><div>УРОН<b>${Math.round(w.stats.dmgDealt)}</b></div>
      </div>
      <div class="row" style="margin-top:22px">
        ${bot ? button('Ещё забег бота', { variant: 'primary', action: 'botagain', icon: '↻' }) + button('Другой бот', { action: 'botmenu' }) : button('Ещё раз', { variant: 'primary', action: 'restart', icon: '↻' })}
        ${this.game.lastReplay && !bot ? button('Смотреть реплей', { action: 'watch', icon: '⟲' }) + button('Скачать реплей', { action: 'download', icon: '⤓' }) : ''}
        ${button('В меню', { action: 'menu' })}
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
      case 'settings':
        this.settingsFrom = g.mode === 'pause' ? 'pause' : 'main';
        this.main.classList.add('hidden');
        this.pause.classList.add('hidden');
        this.settingsScreen.open();
        break;
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
