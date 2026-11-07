import type { ComponentChildren, JSX } from 'preact';
import { Icon, type IconName } from './icons';

/**
 * NULL//ARENA UI kit — Preact components over kit.css (`.k-*`). Controls are controlled: pass the
 * value (read a signal's `.value` in the parent → only that parent re-renders) and a change
 * handler. Accent colour = CSS variable `--ac` (cards, buttons, sliders inherit it).
 * Showcase: #/kit.
 */
export type Accent = string;
const acStyle = (a?: Accent, extra?: Record<string, string>): Record<string, string> | undefined => (a || extra ? { ...(a ? { '--ac': a } : {}), ...extra } : undefined);

export interface ButtonProps {
  variant?: 'primary' | 'ghost' | 'danger' | 'link';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName | undefined;
  accent?: Accent | undefined;
  disabled?: boolean;
  wide?: boolean;
  hint?: string;
  class?: string;
  onClick?: (e: MouseEvent) => void;
  children?: ComponentChildren;
}
export function Button(p: ButtonProps): JSX.Element {
  const cls = `k-btn k-${p.variant ?? 'ghost'} k-${p.size ?? 'md'}${p.wide ? ' k-wide' : ''}${p.class ? ' ' + p.class : ''}`;
  return (
    <button class={cls} disabled={p.disabled} title={p.hint} style={acStyle(p.accent)} onClick={p.onClick}>
      {p.icon && <Icon name={p.icon} class="k-ico" />}
      <span>{p.children}</span>
    </button>
  );
}

export function IconButton(p: { icon: IconName; label: string; accent?: Accent | undefined; onClick?: () => void; class?: string }): JSX.Element {
  return (
    <button class={`k-btn k-icon${p.class ? ' ' + p.class : ''}`} aria-label={p.label} title={p.label} style={acStyle(p.accent)} onClick={p.onClick}>
      <Icon name={p.icon} />
    </button>
  );
}

/** labelled row: title + optional hint on the left, control on the right */
export function Row(p: { label: string; hint?: string | undefined; children: ComponentChildren }): JSX.Element {
  return (
    <div class="k-row">
      <div class="k-lab">
        <b>{p.label}</b>
        {p.hint && <small>{p.hint}</small>}
      </div>
      <div class="k-ctl">{p.children}</div>
    </div>
  );
}

export function Toggle(p: { on: boolean; onChange: (on: boolean) => void; accent?: Accent }): JSX.Element {
  return (
    <button class={`k-toggle${p.on ? ' on' : ''}`} role="switch" aria-checked={p.on} style={acStyle(p.accent)} onClick={() => p.onChange(!p.on)}>
      <i />
    </button>
  );
}

export const pct = (v: number): string => `${Math.round(v * 100)}%`;
export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  fmt?: ((v: number) => string) | undefined;
  accent?: Accent | undefined;
  onInput: (v: number) => void;
  class?: string;
}
export function Slider(p: SliderProps): JSX.Element {
  const f = (p.value - p.min) / (p.max - p.min || 1);
  return (
    <label class={`k-slider${p.class ? ' ' + p.class : ''}`} style={acStyle(p.accent, { '--f': f.toFixed(3) })}>
      <input type="range" min={p.min} max={p.max} step={p.step} value={p.value} onInput={(e) => p.onInput(parseFloat(e.currentTarget.value))} />
      <output>{(p.fmt ?? pct)(p.value)}</output>
    </label>
  );
}

export interface SegOption<T> {
  value: T;
  label: string;
  accent?: Accent | undefined;
}
export function Segmented<T extends string | number>(p: { value: T; options: readonly SegOption<T>[]; onChange: (v: T) => void }): JSX.Element {
  return (
    <div class="k-seg">
      {p.options.map((o) => (
        <button key={String(o.value)} class={o.value === p.value ? 'on' : ''} style={acStyle(o.accent)} onClick={() => p.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
}
export function Tabs<T extends string>(p: { items: readonly TabItem<T>[]; active: T; onChange: (id: T) => void }): JSX.Element {
  return (
    <nav class="k-tabs" role="tablist">
      {p.items.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === p.active} class={t.id === p.active ? 'on' : ''} onClick={() => p.onChange(t.id)}>
          {t.icon && <Icon name={t.icon} />}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function Section(p: { title: string; note?: string; children: ComponentChildren }): JSX.Element {
  return (
    <section class="k-sec">
      <h4>
        {p.title}
        {p.note && <small>{p.note}</small>}
      </h4>
      {p.children}
    </section>
  );
}

export function Panel(p: { class?: string; children: ComponentChildren }): JSX.Element {
  return <div class={`k-panel${p.class ? ' ' + p.class : ''}`}>{p.children}</div>;
}

/** selectable card (difficulty, bots, upgrades): always tinted by its accent, not only on hover */
export function Card(p: { title: string; body?: string; tag?: string | undefined; accent: Accent; selected?: boolean; onClick?: () => void; footer?: ComponentChildren }): JSX.Element {
  return (
    <button class={`k-card${p.selected ? ' sel' : ''}`} style={acStyle(p.accent)} onClick={p.onClick}>
      {p.tag && <em>{p.tag}</em>}
      <h3>{p.title}</h3>
      {p.body && <p>{p.body}</p>}
      {p.footer && <footer>{p.footer}</footer>}
    </button>
  );
}

export function Badge(p: { accent?: Accent | undefined; children: ComponentChildren }): JSX.Element {
  return (
    <span class="k-badge" style={acStyle(p.accent)}>
      {p.children}
    </span>
  );
}
export function Kbd(p: { children: ComponentChildren }): JSX.Element {
  return <kbd class="k-kbd">{p.children}</kbd>;
}
export function Progress(p: { value: number; accent?: Accent }): JSX.Element {
  return (
    <div class="k-prog" style={acStyle(p.accent)}>
      <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, p.value)).toFixed(3)})` }} />
    </div>
  );
}
export function TextField(p: { value: string; placeholder?: string; onInput: (v: string) => void; inputMode?: 'numeric' | 'text' }): JSX.Element {
  return <input class="k-text" type="text" value={p.value} placeholder={p.placeholder} inputMode={p.inputMode} onInput={(e) => p.onInput(e.currentTarget.value)} />;
}
