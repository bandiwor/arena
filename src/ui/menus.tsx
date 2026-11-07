import { useSignal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { loadReplay, type GameHost } from '../app/game-host';
import { navigate } from '../app/router';
import { DIFFICULTIES } from '../sim/content/difficulty';
import { WAVES } from '../sim/content/waves';
import { BOT_SKILLS, type BotSkill } from '../sim/scenario';
import { WavePhase } from '../sim/world';
import { modelSkills } from '../train/models';
import { Icon } from './icons';
import { Button, Card, Kbd, Segmented, TextField } from './kit';
import { SettingsScreen } from './settings-screen';

export const DIFF_COLORS = DIFFICULTIES.map((d) => d.color);
const BOT_COLORS = ['#7f86a8', '#5cff9b', '#2ef2ff', '#ffb02e', '#c77dff', '#5cff9b'];

/** built-in bots + models trained on #/train */
function allBots(): BotSkill[] {
  return [...BOT_SKILLS, ...modelSkills()];
}

/**
 * Every screen over the running game: boot, main menu, bot picker, pause, end of run, replay and
 * bot bars, settings. Which one shows is derived from two signals: the game mode and the menu
 * screen. Clicks play the UI click; hovering a button plays the hover tick.
 */
export function GameScreens({ host }: { host: GameHost }): JSX.Element {
  return host.booted.value ? <Screens host={host} /> : <Boot host={host} />;
}

function Screens({ host }: { host: GameHost }): JSX.Element {
  const mode = host.mode.value;
  const scr = host.screen.value;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const over = (e: PointerEvent): void => {
      const b = (e.target as HTMLElement).closest('.k-btn,.k-card,.btn');
      if (b && !b.contains(e.relatedTarget as Node)) host.game.audio.playUi('ui_hover', 0.8);
    };
    const click = (e: MouseEvent): void => {
      if ((e.target as HTMLElement).closest('button')) host.game.audio.playUi('ui_click');
    };
    el.addEventListener('pointerover', over);
    el.addEventListener('click', click, true);
    return () => {
      el.removeEventListener('pointerover', over);
      el.removeEventListener('click', click, true);
    };
  }, []);
  const settings = scr === 'settings' && (mode === 'menu' || mode === 'pause');
  return (
    <div class="gs" ref={ref}>
      {mode === 'menu' && scr === 'main' && <MainMenu host={host} />}
      {mode === 'menu' && scr === 'bots' && <BotPick host={host} />}
      {mode === 'pause' && !settings && <Pause host={host} />}
      {mode === 'over' && <Over host={host} />}
      {mode === 'replay' && <ReplayBar host={host} />}
      {mode === 'demo' && host.game.bot && <BotBar host={host} />}
      {settings && <SettingsScreen host={host} />}
    </div>
  );
}

// ───────────────────────────── boot: one gesture → fullscreen + audio, then synthesis progress
function Boot({ host }: { host: GameHost }): JSX.Element {
  const started = useSignal(false);
  const prog = useSignal(0);
  const log = useSignal('');
  const out = useSignal(false);
  const sh = host.shell;
  const go = (): void => {
    if (started.value) return;
    started.value = true;
    sh.begin();
    const a = host.game.audio;
    const t0 = performance.now();
    const step = (): void => {
      const P = a.progress;
      const f = a.ctx ? Math.min(1, P.done / Math.max(1, P.total)) : 1;
      prog.value = f;
      const stage = !a.ready ? 'синтез звуков' : !a.bedsReady ? 'синтез атмосферы' : 'синтез музыки';
      log.value = `> аудио-контекст: ${a.ctx ? a.ctx.state : 'нет'}\n> ${stage} ......... ${Math.round(f * 100)}%`;
      // the menu is usable once sfx + ambience exist; music keeps rendering in the background
      if (!a.ctx || (a.ready && a.bedsReady) || performance.now() - t0 > 30000) {
        out.value = true;
        setTimeout(() => (host.booted.value = true), 420);
      } else requestAnimationFrame(step);
    };
    step();
  };
  useEffect(() => {
    if (host.skipBoot) {
      sh.skip();
      host.booted.value = true;
      return;
    }
    const key = (e: KeyboardEvent): void => {
      if (e.code === 'Enter' || e.code === 'Space') go();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const touch = sh.isTouch;
  return (
    <div class={`screen boot${out.value ? ' out' : ''}`} onClick={go}>
      <div class="col">
        <h1 class="title">
          NULL<span>//</span>ARENA
        </h1>
        {!started.value ? (
          <>
            <button class="btn boot-go">
              <Icon name="play" /> {touch ? 'Коснись, чтобы начать' : 'Нажми, чтобы начать'}
            </button>
            <div class="boot-note">
              {touch ? 'полный экран · ' : ''}звук будет включён{touch ? ' · играй в наушниках' : ''}
            </div>
            {sh.iosHint && (
              <div class="boot-note ios">
                Для полного экрана на iPhone: <b>Поделиться → «На экран Домой»</b>
              </div>
            )}
          </>
        ) : (
          <div class="boot-prog">
            <div class="bar">
              <i style={{ transform: `scaleX(${prog.value.toFixed(3)})` }} />
            </div>
            <pre>{log.value}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────── main menu
function MainMenu({ host }: { host: GameHost }): JSX.Element {
  const s = host.settings.value;
  const pick = (i: number): void => host.updateSettings((x) => void (x.difficulty = i));
  const act = (fn: () => void) => (): void => {
    host.ensureAudio(); // audio boots in the background — never delay the game on synthesis
    fn();
  };
  return (
    <div class="screen menu">
      <div class="mm">
        <div class="mm-left">
          <h1 class="title">
            NULL<span>//</span>ARENA
          </h1>
          <div class="sub">3 АКТА · {WAVES.length} ВОЛН · ПРОЦЕСС «ВЕКТОР»</div>
          <div class="stack">
            <Button variant="primary" size="lg" wide icon="play" accent={DIFF_COLORS[s.difficulty]} onClick={act(() => host.start())}>
              В бой
            </Button>
            {host.hasReplay.value && (
              <Button wide icon="replay" onClick={act(() => { const r = loadReplay(); if (r) host.game.playReplay(r); })}>
                Последний реплей
              </Button>
            )}
            <Button wide icon="target" onClick={act(() => host.openBots())}>
              Смотреть бота
            </Button>
            <Button wide icon="flask" onClick={() => navigate('#/train')}>
              Обучение ботов
            </Button>
            <Button wide icon="gear" onClick={act(() => host.openSettings())}>
              Настройки
            </Button>
            <Button variant="link" size="sm" icon="bug" hint="Сцены, лаборатория ассетов, UI-кит, инструменты (F1)" onClick={() => void host.ensureDebug().then((p) => p.show())}>
              Отладка
            </Button>
          </div>
        </div>
        <div class="mm-right">
          <h4 class="mm-h">СЛОЖНОСТЬ</h4>
          <div class="mm-diffs">
            {DIFFICULTIES.map((d, i) => (
              <Card key={d.key} title={d.name} body={d.desc} accent={DIFF_COLORS[i]!} selected={i === s.difficulty} tag={d.tag} onClick={act(() => pick(i))} />
            ))}
          </div>
          <div class="mm-seed">
            <span>ИТЕРАЦИЯ (SEED)</span>
            <TextField value={String(host.seed.value)} inputMode="numeric" onInput={(v) => (host.seed.value = parseInt(v, 10) >>> 0)} />
            <small>один seed — один и тот же забег</small>
          </div>
        </div>
        <div class="mm-help help">
          <span class="kb">
            <Kbd>WASD</Kbd> движение · <Kbd>ЛКМ</Kbd> огонь · <Kbd>SPACE</Kbd> рывок · <Kbd>Q</Kbd>
            <Kbd>E</Kbd> оружие · <Kbd>ESC</Kbd> пауза
          </span>
          <span class="tc">левый стик — движение · правый — прицел и огонь · РЫВОК — кнопка или двойное касание слева</span>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── bot picker
function BotPick({ host }: { host: GameHost }): JSX.Element {
  const bots = allBots();
  const key = host.botKey.value;
  const go = (): void => host.startBot(bots.find((b) => b.key === key) ?? BOT_SKILLS[2]!, host.botDiff.value);
  return (
    <div class="screen botpick">
      <div class="col">
        <h1 class="title" style="font-size:56px">
          БОТ
        </h1>
        <div class="sub">УРОВЕНЬ МАСТЕРСТВА</div>
        <div class="diffs">
          {bots.map((b, i) => (
            <Card key={b.key} title={b.name} body={b.desc} accent={BOT_COLORS[i] ?? '#5cff9b'} selected={b.key === key} tag={b.key.startsWith('model:') ? 'обученная модель' : ''} onClick={() => (host.botKey.value = b.key)} />
          ))}
        </div>
        <div class="row">
          <span class="field">СЛОЖНОСТЬ</span>
          <Segmented value={host.botDiff.value} options={DIFFICULTIES.map((d, i) => ({ value: i, label: d.name, accent: DIFF_COLORS[i] }))} onChange={(v) => (host.botDiff.value = v)} />
        </div>
        <div class="row" style="margin-top:14px">
          <Button variant="primary" icon="play" onClick={go}>
            Смотреть
          </Button>
          <Button icon="flask" onClick={() => navigate('#/train')}>
            Обучение ботов
          </Button>
          <Button icon="back" onClick={() => (host.screen.value = 'main')}>
            Назад
          </Button>
        </div>
        <div class="help">
          во время просмотра: скорость <b>1–8×</b> · <b>взять управление</b> — продолжить забег самому · <b>ESC</b> — выход
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── pause
function Pause({ host }: { host: GameHost }): JSX.Element {
  const g = host.game;
  return (
    <div class="screen pause">
      <div class="col pause-col">
        <h1 class="title">ПАУЗА</h1>
        <div class="stack">
          <Button variant="primary" size="lg" wide icon="play" onClick={() => g.setMode('play')}>
            Продолжить
          </Button>
          <Button wide icon="gear" onClick={() => host.openSettings()}>
            Настройки
          </Button>
          <Button wide icon="restart" onClick={() => g.start({ ...g.config })}>
            Заново
          </Button>
          <Button variant="danger" wide icon="home" onClick={() => host.toMenu()}>
            В меню
          </Button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── end of run
function Over({ host }: { host: GameHost }): JSX.Element {
  void host.overTick.value; // re-read world stats on every new "over"
  const g = host.game;
  const w = g.world;
  const win = w.wave.phase === WavePhase.Victory;
  const isReplay = g.replay !== null;
  const bot = g.bot;
  const t = (w.tick / 60) | 0;
  const dname = DIFFICULTIES[g.config.difficulty]!.name;
  const sub = bot
    ? `БОТ «${bot.name}» · ${dname} · ${win ? 'ПОЛНАЯ ПОБЕДА' : `ПАЛ НА ВОЛНЕ ${w.wave.index + 1}`}`
    : isReplay
      ? 'КОНЕЦ РЕПЛЕЯ'
      : win
        ? w.act === 2
          ? 'СБОРЩИК ОСТАНОВЛЕН · сборка 9.3 отклонена'
          : 'МОНОЛИТ РАЗРУШЕН'
        : `ВОЛНА ${w.wave.index + 1}`;
  const download = (): void => {
    const r = g.lastReplay;
    if (!r) return;
    const el = document.createElement('a');
    el.href = URL.createObjectURL(new Blob([JSON.stringify(r)], { type: 'application/json' }));
    el.download = `null-arena-${r.seed}.json`;
    el.click();
  };
  return (
    <div class="screen over">
      <div class="col">
        <h1 class="title over-title" style={win ? undefined : 'text-shadow:0 0 40px #ff2d7a,3px 0 #ff2d7a,-3px 0 #2ef2ff'}>
          {win ? 'ПОБЕДА' : 'СИГНАЛ ПОТЕРЯН'}
        </h1>
        <div class="sub">{sub}</div>
        <div class="stats">
          <div>
            ОЧКИ<b>{w.stats.score}</b>
          </div>
          <div>
            УБИЙСТВ<b>{w.stats.kills}</b>
          </div>
          <div>
            ВРЕМЯ
            <b>
              {(t / 60) | 0}:{String(t % 60).padStart(2, '0')}
            </b>
          </div>
          <div>
            УРОН<b>{Math.round(w.stats.dmgDealt)}</b>
          </div>
        </div>
        <div class="row" style="margin-top:22px">
          {bot ? (
            <>
              <Button variant="primary" icon="restart" onClick={() => host.startBot(bot, g.config.difficulty)}>
                Ещё забег бота
              </Button>
              <Button icon="target" onClick={() => host.openBots()}>
                Другой бот
              </Button>
            </>
          ) : (
            <Button variant="primary" icon="restart" onClick={() => g.start({ ...g.config })}>
              Ещё раз
            </Button>
          )}
          {g.lastReplay && !bot && (
            <>
              <Button icon="replay" onClick={() => g.lastReplay && g.playReplay(g.lastReplay)}>
                Смотреть реплей
              </Button>
              <Button icon="download" onClick={download}>
                Скачать реплей
              </Button>
            </>
          )}
          <Button icon="home" onClick={() => host.toMenu()}>
            В меню
          </Button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── bars over a replay / a watched bot
function SpeedBtns({ speeds, value, onPick }: { speeds: number[]; value: number; onPick: (s: number) => void }): JSX.Element {
  return (
    <>
      {speeds.map((s) => (
        <button key={s} class={`btn${s === value ? ' on' : ''}`} onClick={() => onPick(s)}>
          {s === 0.25 ? '¼' : s}×
        </button>
      ))}
    </>
  );
}

function ReplayBar({ host }: { host: GameHost }): JSX.Element {
  const spd = useSignal(host.game.replaySpeed);
  return (
    <div class="replaybar">
      <span class="rb-label">
        <Icon name="replay" /> РЕПЛЕЙ
      </span>
      <SpeedBtns speeds={[0.25, 1, 2, 4, 8]} value={spd.value} onPick={(s) => (host.game.replaySpeed = spd.value = s)} />
      <button class="btn" aria-label="Выйти" onClick={() => host.toMenu()}>
        <Icon name="close" />
      </button>
    </div>
  );
}

function BotBar({ host }: { host: GameHost }): JSX.Element {
  const g = host.game;
  const spd = useSignal(g.demoSpeed);
  const b = g.bot!;
  return (
    <div class="replaybar botbar">
      <span class="rb-label">
        <Icon name="target" /> БОТ · {b.name.toUpperCase()} · {DIFFICULTIES[g.config.difficulty]!.name.toUpperCase()}
      </span>
      <SpeedBtns speeds={[1, 2, 4, 8]} value={spd.value} onPick={(s) => (g.demoSpeed = spd.value = s)} />
      <button class="btn" onClick={() => g.takeOver()}>
        <Icon name="gamepad" /> Взять управление
      </button>
      <button class="btn" aria-label="Выйти" onClick={() => host.toMenu()}>
        <Icon name="close" />
      </button>
    </div>
  );
}
