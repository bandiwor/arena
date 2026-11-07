import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { GameHost } from '../app/game-host';
import { DIFFICULTIES } from '../sim/content/difficulty';
import type { IconName } from './icons';
import { Button, IconButton, Kbd, pct, Row, Section, Segmented, Slider, Tabs, Toggle } from './kit';
import { DEFAULT_TOUCH, defaultSettings, type Place, type Settings, type TouchLayout } from './settings';

const DIFF_COLORS = DIFFICULTIES.map((d) => d.color);
type TabId = 'sound' | 'game' | 'gfx' | 'controls';
const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'sound', label: 'Звук', icon: 'sound' },
  { id: 'game', label: 'Игра', icon: 'gamepad' },
  { id: 'gfx', label: 'Графика', icon: 'monitor' },
  { id: 'controls', label: 'Управление', icon: 'joystick' },
];

const FMT = {
  lookAhead: (v: number) => `${Math.round((v / 0.4) * 100)}%`,
  scan: (v: number) => `${Math.round((v / 0.08) * 100)}%`,
  grain: (v: number) => `${Math.round((v / 0.04) * 100)}%`,
  fireAt: (v: number) => `${Math.round(v * 100)}% хода`,
};

/** flat number / boolean settings, edited directly */
type NumKey = { [K in keyof Settings]: Settings[K] extends number ? K : never }[keyof Settings];
type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

const RESET: Record<TabId, (keyof Settings)[]> = {
  sound: ['volume', 'music', 'ambience', 'weapons', 'impacts', 'enemies', 'world', 'ui', 'binaural', 'night', 'lowHpFx', 'muteHidden'],
  game: ['difficulty', 'shake', 'freeze', 'lookAhead', 'autoPause', 'showFps', 'vibration'],
  gfx: ['quality', 'dprCap', 'bloom', 'flash', 'distort', 'scan', 'grain', 'vignette'],
  controls: ['aimAssist', 'dblTapDash', 'fireAt'],
};
const PRESETS = {
  low: { quality: 0.5, dprCap: 1, bloom: 0.7, scan: 0.02, grain: 0 },
  mid: { quality: 0.75, dprCap: 1.5, bloom: 1, scan: 0.03, grain: 0.018 },
  high: { quality: 1, dprCap: 2, bloom: 1.15, scan: 0.03, grain: 0.018 },
};

/**
 * Settings: four tabs; every change applies live and is saved (host.updateSettings). Opens over
 * the main menu or the pause screen. The Управление tab opens the touch layout editor.
 */
export function SettingsScreen({ host }: { host: GameHost }): JSX.Element {
  const tab = useSignal<TabId>('sound');
  const editing = useSignal(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const s = host.settings.value;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]): void => host.updateSettings((x) => void (x[k] = v));
  const num = (k: NumKey, max = 1, step = 0.05, fmt?: (v: number) => string): JSX.Element => <Slider value={s[k]} min={0} max={max} step={step} fmt={fmt} onInput={(v) => set(k, v)} />;
  const tog = (k: BoolKey): JSX.Element => <Toggle on={s[k]} onChange={(v) => set(k, v)} />;
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [tab.value]);

  const test = (): void => {
    const A = host.game.audio;
    const seq: [Parameters<typeof A.playUi>[0], number][] = [
      ['shoot_pulse', 0],
      ['hit_machine', 180],
      ['charger_roar', 420],
      ['explode', 900],
      ['wave_clear', 1500],
    ];
    for (const [id, t] of seq) setTimeout(() => A.playUi(id, 0.8), t);
  };
  const reset = (): void => {
    const d = defaultSettings();
    host.updateSettings((x) => {
      for (const k of RESET[tab.value]) (x as unknown as Record<string, unknown>)[k] = d[k];
      if (tab.value === 'controls') x.touch = structuredClone(DEFAULT_TOUCH);
    });
  };

  if (editing.value) return <LayoutEditor host={host} onDone={() => (editing.value = false)} />;

  const L = s.touch;
  const bodies: Record<TabId, () => JSX.Element> = {
    sound: () => (
      <>
        <Section title="Громкость">
          <Row label="Общая">{num('volume')}</Row>
          <Row label="Музыка" hint="адаптивные стемы: темп и накал боя">
            {num('music')}
          </Row>
          <Row label="Атмосфера" hint="фон сектора: гул, дыхание плоти, цех">
            {num('ambience')}
          </Row>
        </Section>
        <Section title="Микшер эффектов" note="до 150%">
          <Row label="Оружие" hint="выстрелы, гильзы, рывок">
            {num('weapons', 1.5)}
          </Row>
          <Row label="Попадания" hint="удары, убийства, криты">
            {num('impacts', 1.5)}
          </Row>
          <Row label="Враги" hint="замахи, гул дронов и червей">
            {num('enemies', 1.5)}
          </Row>
          <Row label="Мир и арена" hint="взрывы, прессы, дуги, лазеры">
            {num('world', 1.5)}
          </Row>
          <Row label="Интерфейс" hint="кнопки, волны, комбо">
            {num('ui', 1.5)}
          </Row>
          <div class="set-test">
            <Button size="sm" icon="sound" onClick={test}>
              Проверить звук
            </Button>
          </div>
        </Section>
        <Section title="Пространство и обработка">
          <Row label="3D-звук (HRTF)" hint="точное положение источников в наушниках; выключи для колонок">
            {tog('binaural')}
          </Row>
          <Row label="Ночной режим" hint="сильнее сжимает громкие пики — тише взрывы, слышнее детали">
            {tog('night')}
          </Row>
          <Row label="Эффекты низкого здоровья" hint="сердцебиение, звон в ушах, приглушение при ударе">
            {tog('lowHpFx')}
          </Row>
          <Row label="Тишина в фоне" hint="выключать звук, когда вкладка или приложение свёрнуты">
            {tog('muteHidden')}
          </Row>
        </Section>
      </>
    ),
    game: () => (
      <>
        <Section title="Забег">
          <Row label="Сложность по умолчанию" hint={DIFFICULTIES[s.difficulty]?.desc}>
            <Segmented value={s.difficulty} options={DIFFICULTIES.map((d, i) => ({ value: i, label: d.name, accent: DIFF_COLORS[i] }))} onChange={(v) => set('difficulty', v)} />
          </Row>
        </Section>
        <Section title="Ощущения">
          <Row label="Тряска экрана">{num('shake', 1.5)}</Row>
          <Row label="Стоп-кадры и замедление" hint="короткая пауза на мощных попаданиях и slow-mo на боссах">
            {tog('freeze')}
          </Row>
          <Row label="Опережение камеры" hint="насколько камера смещается к прицелу">
            {num('lookAhead', 0.4, 0.02, FMT.lookAhead)}
          </Row>
        </Section>
        <Section title="Удобство">
          <Row label="Автопауза" hint="пауза при смене вкладки, сворачивании или потере фокуса">
            {tog('autoPause')}
          </Row>
          <Row label="Счётчик FPS">{tog('showFps')}</Row>
          <Row label="Вибрация" hint="короткий отклик на рывок (Android)">
            {tog('vibration')}
          </Row>
        </Section>
      </>
    ),
    gfx: () => (
      <>
        <Section title="Пресеты" note="батарея ↔ красота">
          <div class="set-presets">
            {(['low', 'mid', 'high'] as const).map((p) => (
              <Button key={p} size="sm" onClick={() => host.updateSettings((x) => void Object.assign(x, PRESETS[p]))}>
                {p === 'low' ? 'Экономия' : p === 'mid' ? 'Баланс' : 'Максимум'}
              </Button>
            ))}
          </div>
        </Section>
        <Section title="Производительность">
          <Row label="Разрешение рендера" hint="доля от размера экрана">
            <Segmented value={s.quality} options={[0.5, 0.75, 1].map((v) => ({ value: v, label: `${v * 100}%` }))} onChange={(v) => set('quality', v)} />
          </Row>
          <Row label="Плотность пикселей" hint={`экран: ${(window.devicePixelRatio || 1).toFixed(2)}× — выше = чётче, но тяжелее`}>
            <Segmented value={s.dprCap} options={[1, 1.5, 2].map((v) => ({ value: v, label: `${v}×` }))} onChange={(v) => set('dprCap', v)} />
          </Row>
        </Section>
        <Section title="Пост-обработка">
          <Row label="Свечение (bloom)">{num('bloom', 1.5)}</Row>
          <Row label="Виньетка">{num('vignette')}</Row>
          <Row label="Скан-линии">{num('scan', 0.08, 0.005, FMT.scan)}</Row>
          <Row label="Зерно">{num('grain', 0.04, 0.002, FMT.grain)}</Row>
        </Section>
        <Section title="Эффекты">
          <Row label="Вспышки" hint="светочувствительность: уменьши, если вспышки неприятны">
            {num('flash')}
          </Row>
          <Row label="Глитч и хроматика" hint="цифровые искажения на ударах и переходах">
            {num('distort')}
          </Row>
        </Section>
      </>
    ),
    controls: () => (
      <>
        <Section title="Сенсорное управление">
          <Row label="Раскладка" hint="перетащи стики и кнопки куда удобно, поменяй размер">
            <Button size="sm" icon="joystick" accent="var(--amber)" onClick={() => (editing.value = true)}>
              Расставить элементы
            </Button>
          </Row>
          <Row label="Стики" hint={L.stickMode === 'float' ? 'появляются под пальцем в своей половине экрана' : 'всегда на своём месте; касание в половине экрана управляет стиком'}>
            <Segmented
              value={L.stickMode}
              options={[
                { value: 'float', label: 'Плавающие' },
                { value: 'fixed', label: 'Фиксированные' },
              ]}
              onChange={(v) => host.updateSettings((x) => void (x.touch.stickMode = v as TouchLayout['stickMode']))}
            />
          </Row>
          <Row label="Помощь в прицеливании" hint="доводит прицел до врага в узком конусе">
            <Segmented
              value={s.aimAssist}
              options={[
                { value: 0, label: 'Выкл' },
                { value: 0.35, label: 'Слабая' },
                { value: 0.7, label: 'Обычная' },
                { value: 1, label: 'Сильная' },
              ]}
              onChange={(v) => set('aimAssist', v)}
            />
          </Row>
          <Row label="Огонь с отклонения" hint="меньше — стрельба начинается раньше; больше — можно целиться без огня">
            <Slider value={s.fireAt} min={0.1} max={0.6} step={0.05} fmt={FMT.fireAt} onInput={(v) => set('fireAt', v)} />
          </Row>
          <Row label="Рывок двойным касанием" hint="второе касание слева в течение 0.26 с">
            {tog('dblTapDash')}
          </Row>
          <Row label="Прозрачность элементов">
            <Slider value={L.opacity} min={0.3} max={1} step={0.05} fmt={pct} onInput={(v) => host.updateSettings((x) => void (x.touch.opacity = v))} />
          </Row>
        </Section>
        <Section title="Клавиатура и мышь">
          <div class="set-keys">
            {KEYS.map(([k, d]) => (
              <div key={k}>
                {k.split(' / ').map((x) => (
                  <Kbd key={x}>{x}</Kbd>
                ))}
                <span>{d}</span>
              </div>
            ))}
          </div>
        </Section>
      </>
    ),
  };

  return (
    <div class="screen settings">
      <div class="set-wrap k-panel">
        <header class="set-head">
          <h2>НАСТРОЙКИ</h2>
          <Tabs items={TABS} active={tab.value} onChange={(t) => (tab.value = t)} />
          <IconButton icon="close" label="Закрыть" onClick={() => host.closeSettings()} />
        </header>
        <div class="set-body" ref={bodyRef}>
          {bodies[tab.value]()}
        </div>
        <footer class="set-foot">
          <Button variant="link" size="sm" icon="reset" onClick={reset}>
            Сбросить вкладку
          </Button>
          <span class="set-saved">изменения сохраняются сразу</span>
          <Button variant="primary" icon="check" onClick={() => host.closeSettings()}>
            Готово
          </Button>
        </footer>
      </div>
    </div>
  );
}

const KEYS: [string, string][] = [
  ['W A S D / стрелки', 'движение'],
  ['мышь', 'прицел'],
  ['ЛКМ', 'огонь'],
  ['SPACE / SHIFT / ПКМ', 'рывок'],
  ['колесо / Q E', 'смена оружия'],
  ['1 – 6', 'слот оружия · выбор модуля'],
  ['ESC', 'пауза'],
  ['F1', 'отладка'],
];

// ───────────────────────────── touch layout editor
type EdKey = keyof Omit<TouchLayout, 'stickMode' | 'opacity'>;
const ITEMS: [EdKey, string, number][] = [
  ['ls', 'Движение', 116],
  ['rs', 'Прицел', 116],
  ['dash', 'Рывок', 80],
  ['swap', 'Оружие', 54],
  ['pause', 'Пауза', 40],
];
const NAMES: Record<EdKey, string> = { ls: 'Стик движения', rs: 'Стик прицела', dash: 'Кнопка рывка', swap: 'Смена оружия', pause: 'Пауза' };

/**
 * The real controls are shown at their positions; drag a handle to move, tap to select and
 * resize. Positions are viewport fractions, so they survive rotation and other screens. Dragging
 * edits a local copy (no storage writes per pointermove); «Готово» saves it.
 */
function LayoutEditor({ host, onDone }: { host: GameHost; onDone: () => void }): JSX.Element {
  const layout = useSignal<TouchLayout>(structuredClone(host.settings.value.touch));
  const sel = useSignal<EdKey>('dash');
  const drag = useRef<{ k: EdKey; id: number; dx: number; dy: number } | null>(null);
  const T = host.game.touch;
  useEffect(() => {
    T.setEditing(true);
    return () => T.setEditing(false);
  }, []);
  useEffect(() => T.setLayout(layout.value), [layout.value]);
  const L = layout.value;
  const patch = (k: EdKey, p: Partial<Place>): void => {
    layout.value = { ...L, [k]: { ...L[k], ...p } };
  };
  const done = (): void => {
    host.updateSettings((x) => void (x.touch = layout.value));
    onDone();
  };
  return (
    <div
      class="layout-ed"
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || e.pointerId !== d.id) return;
        patch(d.k, { x: Math.max(0.03, Math.min(0.97, (e.clientX + d.dx) / innerWidth)), y: Math.max(0.05, Math.min(0.95, (e.clientY + d.dy) / innerHeight)) });
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {ITEMS.map(([k, label, size]) => {
        const p = L[k];
        return (
          <div
            key={k}
            class={`ed-item${sel.value === k ? ' on' : ''}`}
            style={{ '--base': `${size}px`, '--s': p.s.toFixed(2), left: `${(p.x * 100).toFixed(2)}%`, top: `${(p.y * 100).toFixed(2)}%` }}
            onPointerDown={(e) => {
              e.preventDefault();
              sel.value = k;
              drag.current = { k, id: e.pointerId, dx: p.x * innerWidth - e.clientX, dy: p.y * innerHeight - e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
          >
            <span>{label}</span>
          </div>
        );
      })}
      <div class="ed-bar k-panel">
        <b>РАСКЛАДКА</b>
        <span class="ed-name">{NAMES[sel.value]}</span>
        <Slider class="ed-size" value={L[sel.value].s} min={0.6} max={1.6} step={0.05} onInput={(v) => patch(sel.value, { s: v })} />
        <Button size="sm" icon="reset" onClick={() => (layout.value = { ...structuredClone(DEFAULT_TOUCH), stickMode: L.stickMode, opacity: L.opacity })}>
          Сброс
        </Button>
        <Button size="sm" variant="primary" icon="check" onClick={done}>
          Готово
        </Button>
      </div>
      <div class="ed-hint">перетаскивай элементы · коснись, чтобы выбрать и изменить размер</div>
    </div>
  );
}
