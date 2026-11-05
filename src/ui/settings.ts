import type { Game } from '../game';

/** On-screen control placement: centre in viewport fractions + scale. */
export interface Place {
  x: number;
  y: number;
  s: number;
}
export interface TouchLayout {
  /** float: sticks appear under the thumb; fixed: they stay where they are placed */
  stickMode: 'float' | 'fixed';
  ls: Place;
  rs: Place;
  dash: Place;
  swap: Place;
  pause: Place;
  opacity: number;
}

export interface Settings {
  // ── sound
  volume: number;
  music: number;
  ambience: number;
  weapons: number;
  impacts: number;
  enemies: number;
  world: number;
  ui: number;
  binaural: boolean;
  night: boolean;
  lowHpFx: boolean;
  muteHidden: boolean;
  // ── game
  difficulty: number;
  shake: number;
  freeze: boolean;
  lookAhead: number;
  autoPause: boolean;
  showFps: boolean;
  vibration: boolean;
  // ── graphics
  quality: number;
  dprCap: number;
  bloom: number;
  flash: number;
  distort: number;
  scan: number;
  grain: number;
  vignette: number;
  // ── controls
  aimAssist: number;
  dblTapDash: boolean;
  fireAt: number;
  touch: TouchLayout;
}

export const DEFAULT_TOUCH: TouchLayout = {
  stickMode: 'float',
  ls: { x: 0.13, y: 0.73, s: 1 },
  rs: { x: 0.87, y: 0.73, s: 1 },
  dash: { x: 0.935, y: 0.4, s: 1 },
  swap: { x: 0.835, y: 0.33, s: 1 },
  pause: { x: 0.31, y: 0.08, s: 1 },
  opacity: 1,
};

const coarse = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export function defaultSettings(): Settings {
  const phone = coarse();
  return {
    volume: 0.8,
    music: 0.55,
    ambience: 0.7,
    weapons: 1,
    impacts: 1,
    enemies: 1,
    world: 1,
    ui: 1,
    binaural: true,
    night: false,
    lowHpFx: true,
    muteHidden: true,
    difficulty: 1,
    shake: 1,
    freeze: true,
    lookAhead: 0.22,
    autoPause: true,
    showFps: false,
    vibration: true,
    quality: phone ? 0.75 : 1,
    dprCap: phone ? 1.5 : 2,
    bloom: 1,
    flash: 1,
    distort: 1,
    scan: 0.03,
    grain: 0.018,
    vignette: 0.6,
    aimAssist: 0.7,
    dblTapDash: true,
    fireAt: 0.25,
    touch: structuredClone(DEFAULT_TOUCH),
  };
}

const LS = 'null-arena:settings';

export function loadSettings(): Settings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<Settings>;
    // shallow merge + nested touch layout merge (older saves lack newer keys)
    const t = { ...d.touch, ...(s.touch ?? {}) };
    for (const k of ['ls', 'rs', 'dash', 'swap', 'pause'] as const) t[k] = { ...d.touch[k], ...(s.touch?.[k] ?? {}) };
    return { ...d, ...s, touch: t };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(LS, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** Push every preference into the engine. Cheap: safe to call on every change. */
export function applySettings(game: Game, s: Settings): void {
  const a = game.audio;
  a.binaural = s.binaural;
  a.setVolume(s.volume, s.music, s.ambience);
  a.setCategory('weapon', s.weapons);
  a.setCategory('impact', s.impacts);
  a.setCategory('enemy', s.enemies);
  a.setCategory('world', s.world);
  a.setCategory('ui', s.ui);
  a.setNight(s.night);
  a.lowHpFx = s.lowHpFx;
  if (a.ctx) a.setBinaural(s.binaural);

  const r = game.renderer;
  const J = r.juice;
  J.shakeScale = s.shake;
  J.freezeOn = s.freeze;
  J.flashScale = s.flash;
  J.distortScale = s.distort;
  r.camera.lookAhead = s.lookAhead;
  const P = r.post.settings;
  P.bloom = s.bloom;
  P.scan = s.scan;
  P.grain = s.grain;
  P.vignette = s.vignette;
  const pr = Math.min(s.dprCap, window.devicePixelRatio || 1);
  if (r.renderScale !== s.quality || r.pixelRatio !== pr) {
    r.renderScale = s.quality;
    r.pixelRatio = pr;
    r.resize();
  }

  const T = game.touch;
  T.aimAssist = s.aimAssist;
  T.dblTapDash = s.dblTapDash;
  T.fireAt = s.fireAt;
  T.vibration = s.vibration;
  T.setLayout(s.touch);
  game.hud.showFps = s.showFps;
  game.prefs.autoPause = s.autoPause;
  game.prefs.muteHidden = s.muteHidden;
}
