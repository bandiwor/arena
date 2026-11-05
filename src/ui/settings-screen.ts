import type { Game } from '../game';
import { DIFFICULTIES } from '../sim/content/difficulty';
import { bindKit, button, iconButton, kbd, pct, row, section, segmented, slider, tabs, toggle, type KitValue } from './kit';
import { applySettings, DEFAULT_TOUCH, defaultSettings, saveSettings, type Place, type Settings, type TouchLayout } from './settings';

export const DIFF_COLORS = ['#5cff9b', '#2ef2ff', '#ffa126', '#ff2d7a'];
type TabId = 'sound' | 'game' | 'gfx' | 'controls';
const TABS = [
  { id: 'sound', label: 'Звук', icon: '♪' },
  { id: 'game', label: 'Игра', icon: '◆' },
  { id: 'gfx', label: 'Графика', icon: '▣' },
  { id: 'controls', label: 'Управление', icon: '✥' },
] as const;

const FMT: Record<string, (v: number) => string> = {
  lookAhead: (v) => `${Math.round((v / 0.4) * 100)}%`,
  scan: (v) => `${Math.round((v / 0.08) * 100)}%`,
  grain: (v) => `${Math.round((v / 0.04) * 100)}%`,
  fireAt: (v) => `${Math.round(v * 100)}% хода`,
  opacity: pct,
};

/** keys of Settings that are flat numbers/booleans and edited directly */
type FlatKey = Exclude<keyof Settings, 'touch'>;

/**
 * Settings: four tabs, every change applies live and is saved. Opens over the main menu or the
 * pause screen; `onClose` returns there. The Управление tab opens the touch layout editor.
 */
export class SettingsScreen {
  readonly el: HTMLElement;
  private tab: TabId = 'sound';
  onClose: (() => void) | null = null;

  constructor(
    private readonly game: Game,
    root: HTMLElement,
    private readonly s: Settings,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'screen settings hidden';
    root.appendChild(this.el);
    bindKit(this.el, {
      fmt: FMT,
      onTab: (id) => {
        this.tab = id as TabId;
        this.renderBody();
        this.game.audio.playUi('ui_click');
      },
      onChange: (k, v) => this.change(k, v),
      onAction: (a) => this.action(a),
    });
  }

  open(tab?: TabId): void {
    if (tab) this.tab = tab;
    this.render();
    this.el.classList.remove('hidden');
  }

  close(): void {
    this.el.classList.add('hidden');
    this.onClose?.();
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  private render(): void {
    this.el.innerHTML = `<div class="set-wrap k-panel">
      <header class="set-head"><h2>НАСТРОЙКИ</h2>${tabs(TABS, this.tab)}${iconButton('✕', 'close', 'Закрыть')}</header>
      <div class="set-body"></div>
      <footer class="set-foot">${button('Сбросить вкладку', { variant: 'link', size: 'sm', action: 'reset' })}<span class="set-saved">изменения сохраняются сразу</span>${button('Готово', { variant: 'primary', action: 'close' })}</footer>
    </div>`;
    this.renderBody();
  }

  private renderBody(): void {
    const body = this.el.querySelector<HTMLElement>('.set-body')!;
    const R: Record<TabId, () => string> = { sound: () => this.sound(), game: () => this.gameTab(), gfx: () => this.gfx(), controls: () => this.controls() };
    body.innerHTML = R[this.tab]();
    body.scrollTop = 0;
  }

  // ───────────── tabs

  private sound(): string {
    const s = this.s;
    const v = (k: FlatKey, max = 1): string => slider(k, s[k] as number, { min: 0, max, step: 0.05 });
    return (
      section('Громкость', row('Общая', v('volume')) + row('Музыка', v('music'), 'адаптивные стемы: темп и накал боя') + row('Атмосфера', v('ambience'), 'фон сектора: гул, дыхание плоти, цех')) +
      section(
        'Микшер эффектов',
        row('Оружие', v('weapons', 1.5), 'выстрелы, гильзы, рывок') +
          row('Попадания', v('impacts', 1.5), 'удары, убийства, криты') +
          row('Враги', v('enemies', 1.5), 'замахи, гул дронов и червей') +
          row('Мир и арена', v('world', 1.5), 'взрывы, прессы, дуги, лазеры') +
          row('Интерфейс', v('ui', 1.5), 'кнопки, волны, комбо') +
          `<div class="set-test">${button('Проверить звук', { size: 'sm', action: 'test', icon: '▶' })}</div>`,
        'до 150%',
      ) +
      section(
        'Пространство и обработка',
        row('3D-звук (HRTF)', toggle('binaural', s.binaural), 'точное положение источников в наушниках; выключи для колонок') +
          row('Ночной режим', toggle('night', s.night), 'сильнее сжимает громкие пики — тише взрывы, слышнее детали') +
          row('Эффекты низкого здоровья', toggle('lowHpFx', s.lowHpFx), 'сердцебиение, звон в ушах, приглушение при ударе') +
          row('Тишина в фоне', toggle('muteHidden', s.muteHidden), 'выключать звук, когда вкладка или приложение свёрнуты'),
      )
    );
  }

  private gameTab(): string {
    const s = this.s;
    return (
      section(
        'Забег',
        row(
          'Сложность по умолчанию',
          segmented(
            'difficulty',
            s.difficulty,
            DIFFICULTIES.map((d, i) => ({ value: i, label: d.name, accent: DIFF_COLORS[i] })),
          ),
          DIFFICULTIES[s.difficulty]?.desc,
        ),
      ) +
      section(
        'Ощущения',
        row('Тряска экрана', slider('shake', s.shake, { min: 0, max: 1.5, step: 0.05 })) +
          row('Стоп-кадры и замедление', toggle('freeze', s.freeze), 'короткая пауза на мощных попаданиях и slow-mo на боссах') +
          row('Опережение камеры', slider('lookAhead', s.lookAhead, { min: 0, max: 0.4, step: 0.02, fmt: FMT['lookAhead'] }), 'насколько камера смещается к прицелу'),
      ) +
      section(
        'Удобство',
        row('Автопауза', toggle('autoPause', s.autoPause), 'пауза при смене вкладки, сворачивании или потере фокуса') +
          row('Счётчик FPS', toggle('showFps', s.showFps)) +
          row('Вибрация', toggle('vibration', s.vibration), 'короткий отклик на рывок (Android)'),
      )
    );
  }

  private gfx(): string {
    const s = this.s;
    return (
      section(
        'Пресеты',
        `<div class="set-presets">${button('Экономия', { size: 'sm', action: 'preset:low' })}${button('Баланс', { size: 'sm', action: 'preset:mid' })}${button('Максимум', { size: 'sm', action: 'preset:high' })}</div>`,
        'батарея ↔ красота',
      ) +
      section(
        'Производительность',
        row(
          'Разрешение рендера',
          segmented('quality', s.quality, [
            { value: 0.5, label: '50%' },
            { value: 0.75, label: '75%' },
            { value: 1, label: '100%' },
          ]),
          'доля от размера экрана',
        ) +
          row(
            'Плотность пикселей',
            segmented('dprCap', s.dprCap, [
              { value: 1, label: '1×' },
              { value: 1.5, label: '1.5×' },
              { value: 2, label: '2×' },
            ]),
            `экран: ${(window.devicePixelRatio || 1).toFixed(2)}× — выше = чётче, но тяжелее`,
          ),
      ) +
      section(
        'Пост-обработка',
        row('Свечение (bloom)', slider('bloom', s.bloom, { min: 0, max: 1.5, step: 0.05 })) +
          row('Виньетка', slider('vignette', s.vignette, { min: 0, max: 1, step: 0.05 })) +
          row('Скан-линии', slider('scan', s.scan, { min: 0, max: 0.08, step: 0.005, fmt: FMT['scan'] })) +
          row('Зерно', slider('grain', s.grain, { min: 0, max: 0.04, step: 0.002, fmt: FMT['grain'] })),
      ) +
      section(
        'Эффекты',
        row('Вспышки', slider('flash', s.flash, { min: 0, max: 1, step: 0.05 }), 'светочувствительность: уменьши, если вспышки неприятны') +
          row('Глитч и хроматика', slider('distort', s.distort, { min: 0, max: 1, step: 0.05 }), 'цифровые искажения на ударах и переходах'),
      )
    );
  }

  private controls(): string {
    const s = this.s;
    const L = s.touch;
    const keys: [string, string][] = [
      ['W A S D / стрелки', 'движение'],
      ['мышь', 'прицел'],
      ['ЛКМ', 'огонь'],
      ['SPACE / SHIFT / ПКМ', 'рывок'],
      ['колесо / Q E', 'смена оружия'],
      ['1 – 6', 'слот оружия · выбор модуля'],
      ['ESC', 'пауза'],
      ['F1', 'отладка'],
    ];
    return (
      section(
        'Сенсорное управление',
        row('Раскладка', `${button('Расставить элементы', { size: 'sm', action: 'editor', icon: '✥', accent: 'var(--amber)' })}`, 'перетащи стики и кнопки куда удобно, поменяй размер') +
          row(
            'Стики',
            segmented('stickMode', L.stickMode, [
              { value: 'float', label: 'Плавающие' },
              { value: 'fixed', label: 'Фиксированные' },
            ]),
            L.stickMode === 'float' ? 'появляются под пальцем в своей половине экрана' : 'всегда на своём месте; касание в половине экрана управляет стиком',
          ) +
          row(
            'Помощь в прицеливании',
            segmented('aimAssist', s.aimAssist, [
              { value: 0, label: 'Выкл' },
              { value: 0.35, label: 'Слабая' },
              { value: 0.7, label: 'Обычная' },
              { value: 1, label: 'Сильная' },
            ]),
            'доводит прицел до врага в узком конусе',
          ) +
          row('Огонь с отклонения', slider('fireAt', s.fireAt, { min: 0.1, max: 0.6, step: 0.05, fmt: FMT['fireAt'] }), 'меньше — стрельба начинается раньше; больше — можно целиться без огня') +
          row('Рывок двойным касанием', toggle('dblTapDash', s.dblTapDash), 'второе касание слева в течение 0.26 с') +
          row('Прозрачность элементов', slider('opacity', L.opacity, { min: 0.3, max: 1, step: 0.05, fmt: FMT['opacity'] })),
      ) +
      section('Клавиатура и мышь', `<div class="set-keys">${keys.map(([k, d]) => `<div>${k.split(' / ').map(kbd).join(' ')}<span>${d}</span></div>`).join('')}</div>`)
    );
  }

  // ───────────── changes

  private change(k: string, v: KitValue): void {
    const s = this.s;
    if (k === 'stickMode') s.touch.stickMode = v as TouchLayout['stickMode'];
    else if (k === 'opacity') s.touch.opacity = v as number;
    else if (k in s) (s as unknown as Record<string, KitValue>)[k] = v;
    saveSettings(s);
    applySettings(this.game, s);
    // rows whose hint depends on the value
    if (k === 'stickMode' || k === 'difficulty') this.renderBody();
  }

  private action(a: string): void {
    const s = this.s;
    this.game.audio.playUi('ui_click');
    if (a === 'close') return this.close();
    if (a === 'test') {
      const A = this.game.audio;
      const seq: [Parameters<typeof A.playUi>[0], number][] = [
        ['shoot_pulse', 0],
        ['hit_machine', 180],
        ['charger_roar', 420],
        ['explode', 900],
        ['wave_clear', 1500],
      ];
      for (const [id, t] of seq) setTimeout(() => A.playUi(id, 0.8), t);
      return;
    }
    if (a === 'editor') {
      this.el.classList.add('hidden');
      new LayoutEditor(this.game, this.el.parentElement!, s, () => {
        saveSettings(s);
        applySettings(this.game, s);
        this.el.classList.remove('hidden');
      });
      return;
    }
    if (a.startsWith('preset:')) {
      const p = a.slice(7);
      const P = p === 'low' ? { quality: 0.5, dprCap: 1, bloom: 0.7, scan: 0.02, grain: 0 } : p === 'mid' ? { quality: 0.75, dprCap: 1.5, bloom: 1, scan: 0.03, grain: 0.018 } : { quality: 1, dprCap: 2, bloom: 1.15, scan: 0.03, grain: 0.018 };
      Object.assign(s, P);
      saveSettings(s);
      applySettings(this.game, s);
      this.renderBody();
      return;
    }
    if (a === 'reset') {
      const d = defaultSettings();
      const keys: Record<TabId, FlatKey[]> = {
        sound: ['volume', 'music', 'ambience', 'weapons', 'impacts', 'enemies', 'world', 'ui', 'binaural', 'night', 'lowHpFx', 'muteHidden'],
        game: ['difficulty', 'shake', 'freeze', 'lookAhead', 'autoPause', 'showFps', 'vibration'],
        gfx: ['quality', 'dprCap', 'bloom', 'flash', 'distort', 'scan', 'grain', 'vignette'],
        controls: ['aimAssist', 'dblTapDash', 'fireAt'],
      };
      for (const k of keys[this.tab]) (s as unknown as Record<string, unknown>)[k] = d[k];
      if (this.tab === 'controls') s.touch = structuredClone(DEFAULT_TOUCH);
      saveSettings(s);
      applySettings(this.game, s);
      this.renderBody();
    }
  }
}

/**
 * Touch layout editor: the real controls are shown at their positions; drag a handle to move,
 * tap to select and resize. Positions are stored as viewport fractions, so they survive rotation
 * and different screens.
 */
class LayoutEditor {
  private readonly el: HTMLElement;
  private sel: keyof Omit<TouchLayout, 'stickMode' | 'opacity'> = 'dash';

  constructor(
    private readonly game: Game,
    root: HTMLElement,
    private readonly s: Settings,
    private readonly done: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'layout-ed';
    const items: [keyof Omit<TouchLayout, 'stickMode' | 'opacity'>, string, number][] = [
      ['ls', 'Движение', 116],
      ['rs', 'Прицел', 116],
      ['dash', 'Рывок', 80],
      ['swap', 'Оружие', 54],
      ['pause', 'Пауза', 40],
    ];
    this.el.innerHTML = `${items.map(([k, label, size]) => `<div class="ed-item" data-ed="${k}" style="--base:${size}px"><span>${label}</span></div>`).join('')}
      <div class="ed-bar k-panel"><b>РАСКЛАДКА</b><span class="ed-name"></span>
        <label class="k-slider ed-size" style="--f:0.5"><input type="range" min="0.6" max="1.6" step="0.05" value="1"><output>100%</output></label>
        ${button('Сброс', { size: 'sm', action: 'ed-reset' })}${button('Готово', { size: 'sm', variant: 'primary', action: 'ed-done' })}</div>
      <div class="ed-hint">перетаскивай элементы · коснись, чтобы выбрать и изменить размер</div>`;
    root.appendChild(this.el);
    game.touch.setEditing(true);
    this.place();
    this.select(this.sel);

    let drag: { k: string; id: number; dx: number; dy: number } | null = null;
    this.el.addEventListener('pointerdown', (e) => {
      const it = (e.target as HTMLElement).closest<HTMLElement>('[data-ed]');
      if (!it) return;
      e.preventDefault();
      const k = it.dataset['ed'] as typeof this.sel;
      this.select(k);
      const p = this.s.touch[k];
      drag = { k, id: e.pointerId, dx: p.x * innerWidth - e.clientX, dy: p.y * innerHeight - e.clientY };
      it.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const p = this.s.touch[drag.k as typeof this.sel];
      p.x = Math.max(0.03, Math.min(0.97, (e.clientX + drag.dx) / innerWidth));
      p.y = Math.max(0.05, Math.min(0.95, (e.clientY + drag.dy) / innerHeight));
      this.place();
    });
    const end = (): void => {
      drag = null;
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    const size = this.el.querySelector<HTMLInputElement>('.ed-size input')!;
    size.addEventListener('input', () => {
      this.s.touch[this.sel].s = parseFloat(size.value);
      this.syncSize();
      this.place();
    });
    this.el.querySelector('.ed-bar')!.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset['a'];
      if (a === 'ed-done') this.close();
      if (a === 'ed-reset') {
        const keep = { stickMode: this.s.touch.stickMode, opacity: this.s.touch.opacity };
        this.s.touch = { ...structuredClone(DEFAULT_TOUCH), ...keep };
        this.place();
        this.select(this.sel);
      }
    });
    void this.game;
  }

  private place(): void {
    const L = this.s.touch;
    this.el.querySelectorAll<HTMLElement>('[data-ed]').forEach((it) => {
      const p: Place = L[it.dataset['ed'] as typeof this.sel];
      it.style.left = `${(p.x * 100).toFixed(2)}%`;
      it.style.top = `${(p.y * 100).toFixed(2)}%`;
      it.style.setProperty('--s', p.s.toFixed(2));
    });
    this.game.touch.setLayout(L);
  }

  private select(k: typeof this.sel): void {
    this.sel = k;
    this.el.querySelectorAll<HTMLElement>('[data-ed]').forEach((it) => it.classList.toggle('on', it.dataset['ed'] === k));
    const names = { ls: 'Стик движения', rs: 'Стик прицела', dash: 'Кнопка рывка', swap: 'Смена оружия', pause: 'Пауза' };
    this.el.querySelector('.ed-name')!.textContent = names[k];
    const inp = this.el.querySelector<HTMLInputElement>('.ed-size input')!;
    inp.value = String(this.s.touch[k].s);
    this.syncSize();
  }

  private syncSize(): void {
    const inp = this.el.querySelector<HTMLInputElement>('.ed-size input')!;
    const v = parseFloat(inp.value);
    const lab = inp.parentElement!;
    lab.style.setProperty('--f', ((v - 0.6) / 1).toFixed(3));
    lab.querySelector('output')!.textContent = `${Math.round(v * 100)}%`;
  }

  private close(): void {
    this.game.touch.setEditing(false);
    this.el.remove();
    this.done();
  }
}
