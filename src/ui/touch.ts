/**
 * Twin-stick touch controls.
 *
 *  left half  — floating MOVE stick: appears under the thumb, its base follows when you drag past the rim.
 *               Double-tap (second touch within 260 ms near the first) = dash in the new direction.
 *  right half — floating AIM stick: direction aims, pushing past ~25 % fires. Releasing keeps the last
 *               aim (the player keeps facing it) and stops firing.
 *  ДЕШ button — right edge, above the resting thumb: one tap = dash (move direction, or facing).
 *               A conic ring shows the cooldown; the button "pops" when ready.
 *  ⇄ button  — next weapon (the HUD weapon slots are tappable too).
 *  ❚❚ button — pause.
 *
 * Only writes plain numbers; InputDevice turns them into the deterministic InputCmd.
 */
export class TouchControls {
  readonly root: HTMLElement;
  /** a touch screen is in use (flips back off when a real mouse moves) */
  active = false;
  // ── state read by InputDevice
  moveX = 0;
  moveY = 0;
  /** last aim direction (unit) */
  aimX = 1;
  aimY = 0;
  /** aim stick deflection 0..1 */
  aimMag = 0;
  firing = false;
  /** right stick is held (aim is driven by touch) */
  aimHeld = false;
  /** touch has steered aim at least once (until a mouse takes over) */
  aimOwned = false;
  dashQ = false;
  nextQ = false;
  onPause: (() => void) | null = null;
  onActiveChange: ((on: boolean) => void) | null = null;

  private readonly L: Stick;
  private readonly R: Stick;
  private readonly dashBtn: HTMLElement;
  private readonly swapBtn: HTMLElement;
  private readonly swapName: HTMLElement;
  private lastTapT = -1e9;
  private lastTapX = 0;
  private lastTapY = 0;
  private shown = false;
  private dashReady = true;

  constructor(parent: HTMLElement) {
    const root = document.createElement('div');
    root.className = 'touch hidden';
    root.innerHTML = `
      <div class="tz tz-l"></div><div class="tz tz-r"></div>
      <div class="stick st-l idle"><i></i><b></b></div>
      <div class="stick st-r idle"><i></i><b></b></div>
      <button class="tbtn t-dash" aria-label="Рывок"><span>РЫВОК</span></button>
      <button class="tbtn t-swap" aria-label="Следующее оружие">⇄<small></small></button>
      <button class="tbtn t-pause" aria-label="Пауза">❚❚</button>`;
    parent.prepend(root);
    this.root = root;
    this.L = new Stick(root.querySelector('.st-l')!);
    this.R = new Stick(root.querySelector('.st-r')!);
    this.dashBtn = root.querySelector('.t-dash')!;
    this.swapBtn = root.querySelector('.t-swap')!;
    this.swapName = root.querySelector('.t-swap small')!;

    const zl = root.querySelector<HTMLElement>('.tz-l')!;
    const zr = root.querySelector<HTMLElement>('.tz-r')!;
    zl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.L.id !== -1) return;
      // double tap → dash
      const now = e.timeStamp;
      const dx = e.clientX - this.lastTapX;
      const dy = e.clientY - this.lastTapY;
      if (now - this.lastTapT < 260 && dx * dx + dy * dy < 90 * 90) {
        this.dash();
        this.lastTapT = -1e9;
      } else {
        this.lastTapT = now;
        this.lastTapX = e.clientX;
        this.lastTapY = e.clientY;
      }
      this.L.begin(e, zl);
    });
    zr.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.R.id !== -1) return;
      this.R.begin(e, zr);
      this.aimHeld = true;
      this.aimOwned = true;
    });
    const move = (e: PointerEvent): void => {
      if (e.pointerId === this.L.id) this.L.move(e);
      else if (e.pointerId === this.R.id) this.R.move(e);
      else return;
      this.readSticks();
    };
    const up = (e: PointerEvent): void => {
      if (e.pointerId === this.L.id) this.L.end();
      else if (e.pointerId === this.R.id) {
        this.R.end();
        this.aimHeld = false;
      } else return;
      this.readSticks();
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('lostpointercapture', up);

    const tap = (el: HTMLElement, fn: () => void): void => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add('down');
        fn();
      });
      const release = (): void => el.classList.remove('down');
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', release);
    };
    tap(this.dashBtn, () => this.dash());
    tap(this.swapBtn, () => (this.nextQ = true));
    tap(root.querySelector<HTMLElement>('.t-pause')!, () => this.onPause?.());
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    // touch vs mouse: whichever was used last wins (hybrid laptops / tablets with mice)
    const coarse = matchMedia('(pointer: coarse)').matches;
    this.setActive(coarse);
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType === 'touch' || e.pointerType === 'pen') this.setActive(true);
      },
      true,
    );
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'mouse' && (e.movementX !== 0 || e.movementY !== 0) && this.active && !coarse) {
          this.setActive(false);
          this.aimOwned = false;
        }
      },
      true,
    );
  }

  private setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    document.body.classList.toggle('touch-ui', on);
    this.onActiveChange?.(on);
    this.refresh();
  }

  /** shown only during play */
  show(on: boolean): void {
    this.shown = on;
    if (!on) this.release();
    this.refresh();
  }

  private refresh(): void {
    this.root.classList.toggle('hidden', !(this.shown && this.active));
  }

  /** drop every held stick (pause, menus, lost focus) */
  release(): void {
    this.L.end();
    this.R.end();
    this.aimHeld = false;
    this.readSticks();
  }

  private dash(): void {
    this.dashQ = true;
    try {
      navigator.vibrate?.(12);
    } catch {
      /* not supported */
    }
  }

  private readSticks(): void {
    const l = this.L;
    const lm = Math.hypot(l.vx, l.vy);
    if (lm > 0.12) {
      this.moveX = l.vx / lm;
      this.moveY = l.vy / lm;
    } else {
      this.moveX = 0;
      this.moveY = 0;
    }
    const r = this.R;
    const rm = Math.hypot(r.vx, r.vy);
    this.aimMag = Math.min(1, rm);
    if (rm > 0.1) {
      this.aimX = r.vx / rm;
      this.aimY = r.vy / rm;
    }
    this.firing = this.aimHeld && rm > 0.25;
    r.el.classList.toggle('fire', this.firing);
  }

  /** per frame: dash cooldown ring + current weapon name on ⇄ */
  update(dashFrac: number, weaponName: string, slots: number): void {
    if (!this.shown || !this.active) return;
    const f = Math.max(0, Math.min(1, dashFrac));
    this.dashBtn.style.setProperty('--cd', f.toFixed(3));
    const ready = f >= 1;
    if (ready !== this.dashReady) {
      this.dashReady = ready;
      this.dashBtn.classList.toggle('ready', ready);
    }
    if (this.swapName.textContent !== weaponName) this.swapName.textContent = weaponName;
    this.swapBtn.classList.toggle('hidden', slots < 2);
  }
}

/** One floating stick: base under the first touch point, knob follows the finger. */
class Stick {
  id = -1;
  vx = 0;
  vy = 0;
  private ox = 0;
  private oy = 0;
  private readonly knob: HTMLElement;
  private readonly R = 56;

  constructor(readonly el: HTMLElement) {
    this.knob = el.querySelector('b')!;
  }

  begin(e: PointerEvent, zone: HTMLElement): void {
    this.id = e.pointerId;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      /* capture is optional */
    }
    // keep the whole base on screen
    const m = this.R + 8;
    this.ox = Math.max(m, Math.min(innerWidth - m, e.clientX));
    this.oy = Math.max(m, Math.min(innerHeight - m, e.clientY));
    this.el.classList.remove('idle');
    this.el.style.left = `${this.ox}px`;
    this.el.style.top = `${this.oy}px`;
    this.move(e);
  }

  move(e: PointerEvent): void {
    let dx = e.clientX - this.ox;
    let dy = e.clientY - this.oy;
    const d = Math.hypot(dx, dy);
    const R = this.R;
    if (d > R * 1.35) {
      // drag the base along so the stick never "runs out"
      const k = (d - R * 1.35) / d;
      this.ox += dx * k;
      this.oy += dy * k;
      dx = e.clientX - this.ox;
      dy = e.clientY - this.oy;
      this.el.style.left = `${this.ox}px`;
      this.el.style.top = `${this.oy}px`;
    }
    const dd = Math.hypot(dx, dy);
    const c = dd > R ? R / dd : 1;
    this.vx = (dx * c) / R;
    this.vy = (dy * c) / R;
    this.knob.style.transform = `translate(${dx * c}px, ${dy * c}px)`;
  }

  end(): void {
    this.id = -1;
    this.vx = 0;
    this.vy = 0;
    this.knob.style.transform = '';
    this.el.classList.add('idle');
    this.el.style.left = '';
    this.el.style.top = '';
  }
}
