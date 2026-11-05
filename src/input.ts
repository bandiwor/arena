import { AS, Btn } from './sim/constants';
import type { InputCmd } from './sim/input';
import type { World } from './sim/world';
import type { CameraRig } from './render/camera';
import type { TouchControls } from './ui/touch';

/** touch aim: how far ahead of the player the aim point sits, and the soft aim-assist cone */
const TOUCH_AIM_DIST = 7;
const ASSIST_CONE = 0.3; // rad (~17°)
const ASSIST_RANGE = 22;
const ASSIST_PULL = 0.7;

const ground = new Float32Array(2);

/** Browser input → per-tick InputCmd. Edge-triggered actions are queued until the next tick. */
export class InputDevice {
  private readonly keys = new Set<string>();
  mouseX = 0;
  mouseY = 0;
  mouseDown = false;
  private wheel = 0;
  private dashQ = false;
  private slotQ = -1;
  private pickQ = 0;
  enabled = true;
  /** set by the app: number keys select upgrades instead of slots */
  upgradeMode = false;
  onKey: ((code: string) => void) | null = null;
  touch: TouchControls | null = null;

  constructor(private readonly el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.dashQ = true;
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10);
        if (this.upgradeMode && n >= 1 && n <= 3) this.pickQ = n;
        else if (n >= 1 && n <= 6) this.slotQ = n - 1;
      }
      if (e.code === 'KeyQ') this.wheel -= 1;
      if (e.code === 'KeyE') this.wheel += 1;
      this.onKey?.(e.code);
      if (e.code === 'Space' || e.code === 'Tab' || e.code === 'F1') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    el.addEventListener('pointermove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.dashQ = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener(
      'wheel',
      (e) => {
        this.wheel += e.deltaY > 0 ? 1 : -1;
        e.preventDefault();
      },
      { passive: false },
    );
  }

  queuePick(n: number): void {
    this.pickQ = n;
  }

  /** select weapon slot (0-based), e.g. from a tapped HUD slot */
  queueSlot(n: number): void {
    this.slotQ = n;
  }

  private down(...codes: string[]): boolean {
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  sample(cmd: InputCmd, cam: CameraRig, w?: World): void {
    cmd.mx = 0;
    cmd.my = 0;
    cmd.btn = 0;
    if (!this.enabled) return;
    if (this.down('KeyA', 'ArrowLeft')) cmd.mx -= 1;
    if (this.down('KeyD', 'ArrowRight')) cmd.mx += 1;
    if (this.down('KeyW', 'ArrowUp')) cmd.my -= 1;
    if (this.down('KeyS', 'ArrowDown')) cmd.my += 1;
    const r = this.el.getBoundingClientRect();
    const nx = ((this.mouseX - r.left) / r.width) * 2 - 1;
    const ny = -((this.mouseY - r.top) / r.height) * 2 + 1;
    cam.groundFromNdc(nx, ny, ground);
    cmd.ax = ground[0]!;
    cmd.ay = ground[1]!;
    if (this.mouseDown) cmd.btn |= Btn.Fire;
    if (this.dashQ) {
      cmd.btn |= Btn.Dash;
      this.dashQ = false;
    }
    if (this.wheel > 0) {
      cmd.btn |= Btn.Next;
      this.wheel = 0;
    } else if (this.wheel < 0) {
      cmd.btn |= Btn.Prev;
      this.wheel = 0;
    }
    if (this.slotQ >= 0) {
      cmd.btn |= (this.slotQ + 1) << Btn.SlotShift;
      this.slotQ = -1;
    }
    if (this.pickQ > 0) {
      cmd.btn |= this.pickQ << Btn.PickShift;
      this.pickQ = 0;
    }
    const T = this.touch;
    if (T && T.active && w) this.sampleTouch(cmd, T, w);
  }

  /** twin-stick: left stick moves (analog direction), right stick aims & fires */
  private sampleTouch(cmd: InputCmd, T: TouchControls, w: World): void {
    if (T.moveX !== 0 || T.moveY !== 0) {
      // screen axes map straight onto the arena (same convention as WASD: screen up = world -y)
      cmd.mx = T.moveX;
      cmd.my = T.moveY;
    }
    const p = w.player;
    if (T.aimOwned) {
      let a = Math.atan2(T.aimY, T.aimX);
      if (T.aimHeld) a = this.assist(w, a);
      cmd.ax = p.x + Math.cos(a) * TOUCH_AIM_DIST;
      cmd.ay = p.y + Math.sin(a) * TOUCH_AIM_DIST;
    }
    if (T.firing) cmd.btn |= Btn.Fire;
    if (T.dashQ) {
      cmd.btn |= Btn.Dash;
      T.dashQ = false;
    }
    if (T.nextQ) {
      cmd.btn |= Btn.Next;
      T.nextQ = false;
    }
  }

  /** soft aim assist: bend the stick angle toward the closest enemy inside a narrow cone */
  private assist(w: World, a: number): number {
    const E = w.enemies;
    const p = w.player;
    let best = ASSIST_CONE;
    let bestD = 0;
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i] || E.st[i] === AS.Spawning || E.st[i] === AS.Underground) continue;
      const dx = E.x[i]! - p.x;
      const dy = E.y[i]! - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > ASSIST_RANGE * ASSIST_RANGE) continue;
      let da = Math.atan2(dy, dx) - a;
      da -= Math.PI * 2 * Math.floor((da + Math.PI) / (Math.PI * 2));
      // prefer closer targets: the cone narrows with distance
      const score = Math.abs(da) * (0.7 + Math.sqrt(d2) / ASSIST_RANGE);
      if (score < best) {
        best = score;
        bestD = da;
      }
    }
    return a + bestD * ASSIST_PULL;
  }
}
