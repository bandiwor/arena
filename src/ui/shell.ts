import type { Game } from '../game';
import { iconHtml } from './icons';

/**
 * App shell around the game (the boot screen itself is the Preact <Boot>, which calls begin()):
 *  - boot gesture: one tap unlocks audio (browsers need a gesture), enters fullscreen and locks
 *    landscape on touch devices;
 *  - fullscreen keeper: mobile browsers drop fullscreen when the tab/app is switched — the game
 *    pauses, and the very next tap anywhere restores fullscreen (a chip also offers it);
 *  - pause on tab hide / portrait rotation, audio suspend/resume.
 *
 * Fullscreen may only be requested from a user activation. For touch, pointerdown does NOT
 * count — pointerup / touchend / click do — so re-entry listens to those.
 */
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

export class Shell {
  private readonly touch: boolean;
  /** the player opted into fullscreen; keep restoring it */
  private wantFs = false;
  private readonly chip: HTMLElement;
  private readonly rotate: HTMLElement;
  private booted = false;

  constructor(
    private readonly game: Game,
    root: HTMLElement,
    private readonly startAudio: () => void,
  ) {
    this.touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    document.body.classList.toggle('coarse', this.touch);
    this.chip = document.createElement('button');
    this.chip.className = 'fs-chip hidden';
    this.chip.innerHTML = `${iconHtml('fullscreen')} <span>Полный экран</span>`;
    root.appendChild(this.chip);
    this.rotate = document.createElement('div');
    this.rotate.className = 'rotate hidden';
    this.rotate.innerHTML = `<div class="col"><div class="phone"></div><h2>ПОВЕРНИ УСТРОЙСТВО</h2><p>арена рассчитана на горизонтальный экран</p></div>`;
    root.appendChild(this.rotate);

    // re-enter fullscreen / resume audio on the next real activation after it was lost
    const activation = (): void => {
      if (!this.booted) return;
      this.game.audio.resume();
      if (this.wantFs && !this.isFs()) this.enterFs();
    };
    window.addEventListener('pointerup', activation, true);
    window.addEventListener('touchend', activation, true);
    window.addEventListener('keydown', activation, true);
    const onFsChange = (): void => this.updateChip();
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    this.chip.addEventListener('click', () => this.enterFs());

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.game.prefs.autoPause) this.pauseGame();
        this.game.touch.release();
        if (this.game.prefs.muteHidden) void this.game.audio.ctx?.suspend();
      } else {
        this.game.audio.resume();
        this.updateChip();
      }
    });
    window.addEventListener('pagehide', () => this.pauseGame());
    // losing focus (alt-tab, notification shade, incoming call) pauses too
    window.addEventListener('blur', () => {
      if (this.game.prefs.autoPause) {
        this.pauseGame();
        this.game.touch.release();
      }
    });

    const portrait = matchMedia('(orientation: portrait)');
    const onOrient = (): void => {
      const bad = this.touch && portrait.matches;
      this.rotate.classList.toggle('hidden', !bad);
      if (bad) this.pauseGame();
      // the viewport changes size without a window resize on some browsers
      requestAnimationFrame(() => this.game.renderer.resize());
    };
    portrait.addEventListener('change', onOrient);
    onOrient();
    window.visualViewport?.addEventListener('resize', () => this.game.renderer.resize());
  }

  private pauseGame(): void {
    if (this.game.mode === 'play') this.game.setMode('pause');
  }

  private isFs(): boolean {
    const d = document as FsDoc;
    return !!(d.fullscreenElement ?? d.webkitFullscreenElement);
  }

  private fsSupported(): boolean {
    const d = document as FsDoc;
    return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
  }

  private standalone(): boolean {
    return matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  }

  private enterFs(): void {
    if (!this.fsSupported() || this.isFs()) return;
    const el = document.documentElement as FsEl;
    try {
      const p = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : (el.webkitRequestFullscreen?.(), undefined);
      void Promise.resolve(p)
        .then(() => {
          const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
          return o?.lock?.('landscape');
        })
        .catch(() => {
          /* refused / orientation lock unsupported: the rotate overlay covers portrait */
        })
        .finally(() => this.updateChip());
    } catch {
      /* not allowed outside a gesture */
    }
  }

  private updateChip(): void {
    const lost = this.wantFs && !this.isFs() && this.fsSupported();
    this.chip.classList.toggle('hidden', !lost);
  }

  /** the boot gesture (a real user activation): fullscreen + landscape on touch, audio unlock */
  begin(): void {
    this.booted = true;
    if (this.touch) {
      this.wantFs = true;
      this.enterFs();
    }
    this.startAudio();
  }

  /** debug / screenshot URLs boot silently */
  skip(): void {
    this.booted = true;
  }

  get isTouch(): boolean {
    return this.touch;
  }

  /** iPhone Safari has no fullscreen API: suggest «На экран Домой» */
  get iosHint(): boolean {
    return this.touch && !this.fsSupported() && !this.standalone();
  }
}
