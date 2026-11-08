import { AS, ARENA_HH, ARENA_HW } from '../sim/constants';
import { enemyDef } from '../sim/content/enemies';
import { BOSS_PATTERN_NAMES } from '../ai/boss';
import type { Game } from '../game';
import { flowCell } from '../ai/flowfield';

export type OverlayKind = 'off' | 'hitbox' | 'ai' | 'flow' | 'grid' | 'all';
const STATE_NAMES = Object.fromEntries(Object.entries(AS).map(([k, v]) => [v, k])) as Record<number, string>;

/** 2D canvas overlay projected from the 3D camera — hitboxes, AI states, utility bars, flow field. */
export class DebugOverlay {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  readonly panel: HTMLElement;
  kind: OverlayKind = 'off';
  showPanel = true;
  private readonly uv = new Float32Array(2);

  constructor(private readonly game: Game) {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'dbg-canvas';
    document.body.appendChild(this.canvas);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d ctx');
    this.ctx = ctx;
    this.panel = document.createElement('div');
    this.panel.className = 'dbg-panel';
    document.body.appendChild(this.panel);
  }

  private proj(x: number, h: number, y: number): boolean {
    const ok = this.game.renderer.camera.toScreen(x, h, y, this.uv);
    this.uv[0] = this.uv[0]! * this.canvas.width;
    this.uv[1] = (1 - this.uv[1]!) * this.canvas.height;
    return ok;
  }

  draw(): void {
    const c = this.canvas;
    if (c.width !== window.innerWidth || c.height !== window.innerHeight) {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
    }
    const g = this.ctx;
    g.clearRect(0, 0, c.width, c.height);
    const G = this.game;
    const w = G.world;
    if (this.showPanel) {
      const p = G.perf;
      const s = G.renderer.stats;
      const E = w.enemies;
      const bi = w.boss.id;
      this.panel.textContent =
        `fps ${p.fps.toFixed(0)}  sim ${p.sim.toFixed(2)}ms  render ${p.render.toFixed(2)}ms  steps ${p.steps}\n` +
        `draws ${s.drawCalls}  tris ${(s.triangles / 1000).toFixed(1)}k  quads ${s.quads}  particles ${s.particles}\n` +
        `tick ${w.tick}  seed ${w.seed}  diff ${w.diff.key}  enemies ${E.count}  bullets ${w.bullets.count}\n` +
        `wave ${w.wave.index + 1} phase ${w.wave.phase}  tokens ${w.director.tokensUsed}/${w.director.tokensMax}  tension ${w.director.tension.toFixed(2)}  adapt ${w.director.adapt.toFixed(3)}\n` +
        (bi >= 0 ? `boss phase ${w.boss.phase} pattern ${BOSS_PATTERN_NAMES[w.boss.pattern]} corrupt ${w.boss.corruption.toFixed(2)}\n` : '') +
        `overlay: ${this.kind}  [\` cycle · F2 pause · F3 step · F4 god]` +
        (G.paused ? '  ⏸ PAUSED' : '') +
        (w.god ? '  GOD' : '');
    }
    if (this.kind === 'off') return;
    const E = w.enemies;
    const all = this.kind === 'all';
    if (this.kind === 'flow' || all) {
      const F = w.flow;
      const p = w.player;
      g.strokeStyle = 'rgba(120,255,180,0.5)';
      g.lineWidth = 1;
      for (let cy = 0; cy < F.rows; cy += 1) {
        for (let cx = 0; cx < F.cols; cx += 1) {
          const wx = -ARENA_HW + cx + 0.5;
          const wy = -ARENA_HH + cy + 0.5;
          if (Math.abs(wx - p.x) > 22 || Math.abs(wy - p.y) > 14) continue;
          const i = cy * F.cols + cx;
          if (F.blocked[i]) {
            this.proj(wx, 0, wy);
            g.fillStyle = 'rgba(255,60,60,0.35)';
            g.fillRect(this.uv[0]! - 3, this.uv[1]! - 3, 6, 6);
            continue;
          }
          this.proj(wx, 0, wy);
          const ax = this.uv[0]!;
          const ay = this.uv[1]!;
          flowCell(this.game.world, i);
          this.proj(wx + F.dirX[i]! * 0.4, 0, wy + F.dirY[i]! * 0.4);
          g.beginPath();
          g.moveTo(ax, ay);
          g.lineTo(this.uv[0]!, this.uv[1]!);
          g.stroke();
        }
      }
    }
    if (this.kind === 'grid' || all) {
      g.strokeStyle = 'rgba(255,255,0,0.15)';
      const G2 = w.grid;
      for (let cx = 0; cx <= G2.cols; cx++) {
        const x = G2.minX + cx * G2.cell;
        this.proj(x, 0, -ARENA_HH);
        const a0 = this.uv[0]!;
        const a1 = this.uv[1]!;
        this.proj(x, 0, ARENA_HH);
        g.beginPath();
        g.moveTo(a0, a1);
        g.lineTo(this.uv[0]!, this.uv[1]!);
        g.stroke();
      }
    }
    g.font = '11px JetBrains Mono, monospace';
    for (let i = 0; i < E.hi; i++) {
      if (!E.alive[i]) continue;
      const def = enemyDef(E.type[i]!);
      if (this.kind === 'hitbox' || all) {
        g.strokeStyle = E.token[i] ? '#ffb02e' : '#ff2d7a';
        g.beginPath();
        for (let k = 0; k <= 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          this.proj(E.x[i]! + Math.cos(a) * E.r[i]!, 0.05, E.y[i]! + Math.sin(a) * E.r[i]!);
          if (k === 0) g.moveTo(this.uv[0]!, this.uv[1]!);
          else g.lineTo(this.uv[0]!, this.uv[1]!);
        }
        g.stroke();
        // facing
        this.proj(E.x[i]!, 0.05, E.y[i]!);
        const fx = this.uv[0]!;
        const fy = this.uv[1]!;
        this.proj(E.x[i]! + Math.cos(E.face[i]!) * 1.2, 0.05, E.y[i]! + Math.sin(E.face[i]!) * 1.2);
        g.beginPath();
        g.moveTo(fx, fy);
        g.lineTo(this.uv[0]!, this.uv[1]!);
        g.stroke();
      }
      if (this.kind === 'ai' || all) {
        this.proj(E.x[i]!, def.height + 0.6, E.y[i]!);
        const x = this.uv[0]!;
        const y = this.uv[1]!;
        g.fillStyle = E.token[i] ? '#ffb02e' : '#e8f7ff';
        g.fillText(`#${i} ${def.key} ${STATE_NAMES[E.st[i]!] ?? E.st[i]} ${E.stT[i]!.toFixed(1)}`, x - 40, y);
        g.fillStyle = '#7f86a8';
        g.fillText(`hp ${E.hp[i]!.toFixed(0)} cd ${E.cd[i]!.toFixed(1)} ch ${E.charge[i]!.toFixed(2)}`, x - 40, y + 12);
        // utility bars
        for (let k = 0; k < 6; k++) {
          const u = E.util[i * 6 + k]!;
          if (u <= 0) continue;
          g.fillStyle = `hsl(${k * 55},90%,60%)`;
          g.fillRect(x - 40 + k * 9, y + 30 - u * 14, 7, u * 14);
        }
        // targets
        if (E.st[i] === AS.Move) {
          this.proj(E.tx[i]!, 0.05, E.ty[i]!);
          g.strokeStyle = 'rgba(46,242,255,0.6)';
          g.strokeRect(this.uv[0]! - 3, this.uv[1]! - 3, 6, 6);
        }
      }
    }
    if (this.kind === 'hitbox' || all) {
      const B = w.bullets;
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < B.hi; i++) {
        if (!B.alive[i]) continue;
        this.proj(B.x[i]!, 0.7, B.y[i]!);
        g.strokeRect(this.uv[0]! - 2, this.uv[1]! - 2, 4, 4);
      }
      const p = w.player;
      this.proj(p.x, 0.05, p.y);
      g.strokeStyle = '#2ef2ff';
      g.beginPath();
      g.arc(this.uv[0]!, this.uv[1]!, 6, 0, Math.PI * 2);
      g.stroke();
    }
  }
}
