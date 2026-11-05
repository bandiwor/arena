/**
 * NULL//ARENA UI kit: tiny string builders for every control the menus use, plus one delegated
 * binder. Each control carries `data-k` (its key) so a whole screen is wired with a single
 * `bindKit(root, onChange)`. Visuals live in kit.css (`.k-*` classes). Showcase: /kit.html.
 *
 * Accent colour is the CSS variable `--ac` on any element (cards, buttons, sliders inherit it).
 */

export type Accent = string;

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ac = (a?: Accent): string => (a ? ` style="--ac:${a}"` : '');

export interface BtnOpts {
  /** primary (filled glow), ghost (default), danger, link */
  variant?: 'primary' | 'ghost' | 'danger' | 'link';
  size?: 'sm' | 'md' | 'lg';
  /** action id → data-a */
  action?: string;
  icon?: string;
  accent?: Accent | undefined;
  disabled?: boolean;
  wide?: boolean;
  hint?: string;
}
export function button(label: string, o: BtnOpts = {}): string {
  const cls = ['k-btn', `k-${o.variant ?? 'ghost'}`, `k-${o.size ?? 'md'}`, o.wide ? 'k-wide' : ''].join(' ');
  return `<button class="${cls}"${o.action ? ` data-a="${o.action}"` : ''}${o.disabled ? ' disabled' : ''}${o.hint ? ` title="${esc(o.hint)}"` : ''}${ac(o.accent)}>${o.icon ? `<i class="k-ico">${o.icon}</i>` : ''}<span>${esc(label)}</span></button>`;
}

export function iconButton(icon: string, action: string, label: string, accent?: Accent): string {
  return `<button class="k-btn k-icon" data-a="${action}" aria-label="${esc(label)}" title="${esc(label)}"${ac(accent)}>${icon}</button>`;
}

/** labelled row: title + optional hint on the left, control on the right */
export function row(label: string, control: string, hint?: string): string {
  return `<div class="k-row"><div class="k-lab"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ''}</div><div class="k-ctl">${control}</div></div>`;
}

export function toggle(key: string, on: boolean, accent?: Accent): string {
  return `<button class="k-toggle${on ? ' on' : ''}" role="switch" aria-checked="${on}" data-k="${key}" data-kind="toggle"${ac(accent)}><i></i></button>`;
}

export interface SliderOpts {
  min: number;
  max: number;
  step: number;
  /** value → readout text (default: percent of max) */
  fmt?: ((v: number) => string) | undefined;
  accent?: Accent;
}
export function slider(key: string, value: number, o: SliderOpts): string {
  const f = (value - o.min) / (o.max - o.min || 1);
  const txt = (o.fmt ?? pct)(value);
  return `<label class="k-slider" style="--f:${f.toFixed(3)}${o.accent ? `;--ac:${o.accent}` : ''}"><input type="range" data-k="${key}" data-kind="range" min="${o.min}" max="${o.max}" step="${o.step}" value="${value}"><output>${esc(txt)}</output></label>`;
}
export const pct = (v: number): string => `${Math.round(v * 100)}%`;

export interface SegOption {
  value: string | number;
  label: string;
  accent?: Accent | undefined;
}
export function segmented(key: string, value: string | number, options: readonly SegOption[]): string {
  return `<div class="k-seg" data-k="${key}" data-kind="seg">${options
    .map((o) => `<button data-v="${o.value}" class="${String(o.value) === String(value) ? 'on' : ''}"${ac(o.accent)}>${esc(o.label)}</button>`)
    .join('')}</div>`;
}

export interface Tab {
  id: string;
  label: string;
  icon?: string;
}
export function tabs(items: readonly Tab[], active: string): string {
  return `<nav class="k-tabs" role="tablist">${items
    .map((t) => `<button role="tab" data-tab="${t.id}" class="${t.id === active ? 'on' : ''}">${t.icon ? `<i>${t.icon}</i>` : ''}<span>${esc(t.label)}</span></button>`)
    .join('')}</nav>`;
}

export function section(title: string, body: string, note?: string): string {
  return `<section class="k-sec"><h4>${esc(title)}${note ? `<small>${esc(note)}</small>` : ''}</h4>${body}</section>`;
}

export function panel(body: string, cls = ''): string {
  return `<div class="k-panel ${cls}">${body}</div>`;
}

/** selectable card (difficulty, upgrades): always tinted by its accent, not only on hover */
export function card(o: { title: string; body?: string; tag?: string; accent: Accent; selected?: boolean; data?: Record<string, string | number>; footer?: string }): string {
  const data = Object.entries(o.data ?? {})
    .map(([k, v]) => ` data-${k}="${v}"`)
    .join('');
  return `<button class="k-card${o.selected ? ' sel' : ''}"${data} style="--ac:${o.accent}">${o.tag ? `<em>${esc(o.tag)}</em>` : ''}<h3>${esc(o.title)}</h3>${o.body ? `<p>${esc(o.body)}</p>` : ''}${o.footer ? `<footer>${o.footer}</footer>` : ''}</button>`;
}

export function badge(text: string, accent?: Accent): string {
  return `<span class="k-badge"${ac(accent)}>${esc(text)}</span>`;
}
export function kbd(text: string): string {
  return `<kbd class="k-kbd">${esc(text)}</kbd>`;
}
export function progress(f: number, accent?: Accent): string {
  return `<div class="k-prog"${ac(accent)}><i style="transform:scaleX(${Math.max(0, Math.min(1, f)).toFixed(3)})"></i></div>`;
}
export function textField(key: string, value: string, placeholder = ''): string {
  return `<input class="k-text" type="text" data-k="${key}" data-kind="text" value="${esc(value)}" placeholder="${esc(placeholder)}">`;
}

export type KitValue = number | boolean | string;

/**
 * Wire every kit control inside root. onChange(key, value) fires for sliders (live),
 * toggles, segmented controls and text fields; onAction(id) for buttons with data-a;
 * onTab(id) for tabs. Visual state (slider fill/readout, toggle, segment) updates itself.
 */
export function bindKit(
  root: HTMLElement,
  h: { onChange?: (key: string, v: KitValue) => void; onAction?: (id: string, el: HTMLElement) => void; onTab?: (id: string) => void; fmt?: Record<string, (v: number) => string> },
): void {
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const k = t.dataset['k'];
    if (!k) return;
    if (t.dataset['kind'] === 'range') {
      const v = parseFloat(t.value);
      const lab = t.parentElement!;
      const f = (v - parseFloat(t.min)) / (parseFloat(t.max) - parseFloat(t.min) || 1);
      lab.style.setProperty('--f', f.toFixed(3));
      const out = lab.querySelector('output');
      if (out) out.textContent = (h.fmt?.[k] ?? pct)(v);
      h.onChange?.(k, v);
    } else if (t.dataset['kind'] === 'text') h.onChange?.(k, t.value);
  });
  root.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    const tog = el.closest<HTMLElement>('[data-kind="toggle"]');
    if (tog) {
      const on = !tog.classList.contains('on');
      tog.classList.toggle('on', on);
      tog.setAttribute('aria-checked', String(on));
      h.onChange?.(tog.dataset['k']!, on);
      return;
    }
    const segBtn = el.closest<HTMLElement>('[data-kind="seg"] > button');
    if (segBtn) {
      const seg = segBtn.parentElement!;
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === segBtn));
      const raw = segBtn.dataset['v']!;
      const num = Number(raw);
      h.onChange?.(seg.dataset['k']!, raw !== '' && !Number.isNaN(num) ? num : raw);
      return;
    }
    const tab = el.closest<HTMLElement>('[data-tab]');
    if (tab) {
      tab.parentElement!.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === tab));
      h.onTab?.(tab.dataset['tab']!);
      return;
    }
    const act = el.closest<HTMLElement>('[data-a]');
    if (act && !(act as HTMLButtonElement).disabled) h.onAction?.(act.dataset['a']!, act);
  });
}
