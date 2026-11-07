import { ENEMIES } from '../sim/content/enemies';
import { ENEMY_LORE, RACES } from '../sim/content/races';
import { ET, Mat } from '../sim/constants';
import { MUTATORS } from '../sim/content/mutators';
import { WEAPONS } from '../sim/content/weapons';
import { BOT_SKILLS } from '../sim/scenario';
import type { Game } from '../game';
import type { DebugApi } from './dbg';
import type { DebugOverlay, OverlayKind } from './overlay';
import { SCENES } from './dbg';
import { navigate } from '../app/router';
import { iconHtml } from '../ui/icons';

/**
 * Debug hub: every page, scene and tool in one drawer. Opened from the main menu ("Отладка")
 * or with F1 at any time. Lazy-loaded, so it costs nothing in normal play.
 */
export class DebugPanel {
  private readonly el: HTMLElement;
  open = false;

  constructor(
    private readonly game: Game,
    private readonly api: DebugApi,
    private readonly overlay: DebugOverlay,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'dbg-drawer hidden';
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1') {
        e.preventDefault();
        this.toggle();
      } else if (e.code === 'Escape' && this.open) {
        e.stopPropagation();
        this.hide();
      }
    }, true);
    // perf readout: on by default in dev builds, opt-in in production
    this.overlay.showPanel = __DEV__;
    this.overlay.panel.style.display = __DEV__ ? '' : 'none';
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    this.render();
    this.open = true;
    this.el.classList.remove('hidden');
    this.game.canvas.style.cursor = 'default';
  }

  hide(): void {
    this.open = false;
    this.el.classList.add('hidden');
    if (this.game.mode === 'play') this.game.canvas.style.cursor = 'none';
  }

  private section(title: string, body: string): string {
    return `<section><h4>${title}</h4><div class="dbg-btns">${body}</div></section>`;
  }

  private btn(label: string, act: string, arg = '', on = false, title = ''): string {
    return `<button class="${on ? 'on' : ''}" data-act="${act}" data-arg="${arg}"${title ? ` title="${title}"` : ''}>${label}</button>`;
  }

  /** «Спавн рядом», split by race (with the race colour); bosses and mini-bosses get their own group */
  private spawnSection(): string {
    const BOSSES: number[] = [ET.Boss, ET.Brood, ET.Press, ET.Assembler, ET.Arm];
    const ACT = ['I', 'II', 'III'];
    const groups: { title: string; color: string; keys: typeof ENEMIES }[] = [
      { title: 'Плоть', color: '#ff3a52', keys: [] },
      { title: 'Линия 9 · машины', color: '#ffa126', keys: [] },
      { title: 'Оранжерея', color: '#b6ff3b', keys: [] },
      { title: 'Решётка', color: '#8fa6ff', keys: [] },
      { title: 'Боссы и мини-боссы', color: '#c77dff', keys: [] },
    ];
    const byMat: Record<number, number> = { [Mat.Flesh]: 0, [Mat.Machine]: 1, [Mat.Plant]: 2, [Mat.Crystal]: 3, [Mat.Void]: 4 };
    for (const e of ENEMIES) groups[BOSSES.includes(e.type) ? 4 : byMat[e.material]!]!.keys.push(e);
    const body = groups
      .filter((g) => g.keys.length)
      .map((g) => {
        const btns = g.keys
          .map((e) => {
            const race = RACES[e.material];
            const home = race.home >= 0 ? ` · дом: акт ${ACT[race.home]}` : '';
            const tip = `${race.name}${home} · HP ${e.hp}\n${ENEMY_LORE[e.key] ?? ''}`.replace(/"/g, "'");
            return this.btn(e.name, 'spawn', e.key, false, tip);
          })
          .join('');
        return `<div class="dbg-sub" style="--sc:${g.color}"><h5>${g.title} <small>${g.keys.length}</small></h5><div class="dbg-btns">${btns}</div></div>`;
      })
      .join('');
    return `<section><h4>Спавн рядом</h4>${body}</section>`;
  }

  private render(): void {
    const g = this.game;
    const w = g.world;
    const inGame = g.mode !== 'menu';
    const ov = this.overlay.kind;
    const ovs: OverlayKind[] = ['off', 'hitbox', 'ai', 'flow', 'grid', 'all'];
    this.el.innerHTML = `
      <header><b>NULL<span>//</span>DEBUG</b><button data-act="close" title="F1 / Esc">${iconHtml('close')}</button></header>
      ${this.section(
        'Страницы',
        this.btn('Лаборатория ассетов', 'page', '#/lab', false, 'модели, анимации, эффекты, звуки, пост-обработка') +
        this.btn('UI-кит', 'page', '#/kit', false, 'все элементы интерфейса во всех состояниях') +
        this.btn('Обучение ботов', 'page', '#/train', false, 'эволюция ботов, награды, сохранённые модели') +
          this.btn('Пустая песочница', 'scene', 'arena') +
          this.btn('Игра с ?debug ↗', 'page', '?debug'),
      )}
      ${this.section('Сцены', Object.entries(SCENES).map(([k, v]) => this.btn(k, 'scene', k, false, v)).join(''))}
      ${this.section(
        'Бот играет текущую сцену',
        BOT_SKILLS.map((b) => this.btn(b.name, 'bot', b.key, g.attract !== null && g.mode === 'demo' && g.bot?.key === b.key)).join('') + this.btn('Стоп', 'bot', ''),
      )}
      ${this.section(
        'Время и состояние',
        this.btn(g.paused ? 'Продолжить' : 'Пауза', 'pause') +
          this.btn('Шаг +1', 'step', '1') +
          this.btn('Шаг +10', 'step', '10') +
          [0.25, 0.5, 1, 2].map((s) => this.btn(`${s}×`, 'speed', String(s), g.timeScale === s)).join('') +
          this.btn('Бессмертие', 'god', '', w.god) +
          this.btn('Без ИИ', 'noai', '', w.noAI) +
          this.btn('Убить всех', 'killall') +
          this.btn('Перф-панель', 'perf', '', this.overlay.showPanel),
      )}
      ${this.section('Оверлей', ovs.map((k) => this.btn(k, 'overlay', k, ov === k)).join(''))}
      ${this.spawnSection()}
      ${this.section('Оружие', WEAPONS.map((x) => this.btn(x.name, 'weapon', x.key)).join(''))}
      ${this.section('Мутаторы', MUTATORS.map((m) => this.btn(m.name, 'mutator', m.key, (w.mutators & (1 << m.id)) !== 0)).join(''))}
      ${this.section(
        'Эффекты',
        this.btn('Взрыв', 'fx', 'explode') + this.btn('Отдача Рельсы', 'fx', 'rail') + ENEMIES.map((e) => this.btn(`смерть: ${e.name}`, 'fx', 'kill:' + e.key)).join(''),
      )}
      <footer>${inGame ? `тик ${w.tick} · сид ${w.seed} · врагов ${w.enemies.count}` : 'в меню: выбери сцену, чтобы начать'} · <b>\`</b> оверлей · <b>F2</b> пауза · <b>F3</b> шаг</footer>`;
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t) return;
    const act = t.dataset['act'];
    const arg = t.dataset['arg'] ?? '';
    const a = this.api;
    const g = this.game;
    switch (act) {
      case 'close':
        return this.hide();
      case 'page':
        if (arg.startsWith('#/')) {
          this.hide();
          navigate(arg);
        } else location.href = arg;
        return;
      case 'scene':
        a.scene(arg, (Date.now() % 100000) + 1, 1);
        this.hide();
        return;
      case 'bot': {
        const sk = BOT_SKILLS.find((b) => b.key === arg);
        if (!sk) {
          g.attract = null;
          g.bot = null;
          g.setMode('play');
        } else {
          g.bot = sk;
          g.attract = sk.make();
          g.demoSpeed = 1;
          g.setMode('demo');
        }
        break;
      }
      case 'pause':
        g.paused = !g.paused;
        break;
      case 'step':
        a.step(parseInt(arg, 10));
        break;
      case 'speed':
        a.timeScale(parseFloat(arg));
        break;
      case 'god':
        a.god(!g.world.god);
        break;
      case 'noai':
        a.noAI(!g.world.noAI);
        break;
      case 'killall':
        a.kill('all');
        break;
      case 'perf':
        this.overlay.showPanel = !this.overlay.showPanel;
        this.overlay.panel.style.display = this.overlay.showPanel ? '' : 'none';
        break;
      case 'overlay':
        a.overlay(arg as OverlayKind);
        break;
      case 'spawn': {
        const p = g.world.player;
        const ang = Math.random() * Math.PI * 2;
        a.spawn(arg, p.x + Math.cos(ang) * 9, p.y + Math.sin(ang) * 7);
        break;
      }
      case 'weapon':
        a.weapon(arg);
        break;
      case 'mutator': {
        const m = MUTATORS.find((x) => x.key === arg);
        if (m) a.mutator(arg, !(g.world.mutators & (1 << m.id)));
        break;
      }
      case 'fx':
        if (arg === 'explode') a.fx.explode();
        else if (arg === 'rail') a.fx.muzzle('rail');
        else if (arg.startsWith('kill:')) a.fx.kill(arg.slice(5));
        break;
    }
    this.render();
  }
}
