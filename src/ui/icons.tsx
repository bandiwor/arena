import type { JSX } from 'preact';

/**
 * NULL//ARENA icon set — drawn for the game's look: 24-unit grid, square caps, mitred joins,
 * chamfered (cut-corner) silhouettes like the panels and cards, plus small solid "pixel" accents
 * (`.f`). Colour is currentColor; the neon glow comes from CSS (`.ico` in kit.css), so one icon
 * works in every accent. Preview: kit page → «Иконки».
 */
const P = (d: string): string => `<path d="${d}"/>`;
const F = (d: string): string => `<path class="f" d="${d}"/>`;

export const ICONS = {
  // ── actions
  play: P('M7 4.5 19 12 7 19.5Z') + F('M3 9h2v6H3z'),
  pause: P('M6.5 5h3.5v14H6.5zM14 5h3.5v14H14z'),
  stop: P('M7 5h10l2 2v10l-2 2H7l-2-2V7z'),
  restart: P('M18.5 9 15 5.5H9L5.5 9v6L9 18.5h6l3.5-3.5') + P('M19 4.5V9h-4.5'),
  replay: P('M5.5 15 9 18.5h6l3.5-3.5V9L15 5.5H9L5.5 9') + P('M5 4.5V9h4.5') + P('M12 8.5V12l2.5 2'),
  close: P('M6 6l12 12M18 6 6 18'),
  check: P('M4 12.5l5 5L20 6.5'),
  plus: P('M12 4.5v15M4.5 12h15'),
  minus: P('M4.5 12h15'),
  back: P('M15 4.5 7.5 12l7.5 7.5'),
  forward: P('M9 4.5l7.5 7.5L9 19.5'),
  down: P('M4.5 9l7.5 7.5L19.5 9'),
  speed: P('M3 6l8 6-8 6zM12 6l8 6-8 6z'),
  download: P('M12 3.5v11M7 10l5 5 5-5') + P('M4 16v4h16v-4'),
  upload: P('M12 15V4M7 8.5l5-5 5 5') + P('M4 16v4h16v-4'),
  copy: P('M8 8h10l2 2v10H10l-2-2z') + P('M5 15H4V4h11v1'),
  trash: P('M4 6.5h16M9.5 6.5V4h5v2.5M6.5 6.5 7.5 20h9l1-13.5') + P('M10.5 10v6.5M13.5 10v6.5'),
  save: P('M4 4h12.5L20 7.5V20H4z') + P('M8 4v4.5h7V4') + F('M8 13h8v7H8z'),
  edit: P('M4 20l1-4.5L15.5 5 19 8.5 8.5 19z') + P('M13 7.5l3.5 3.5') + F('M4 20h4l-4-4z'),
  reset: P('M5.5 9 9 5.5h6L18.5 9v6L15 18.5H9L5.5 15') + P('M5 4.5V9h4.5'),
  spark: P('M12 3l1.8 7.2L21 12l-7.2 1.8L12 21l-1.8-7.2L3 12l7.2-1.8z') + F('M11 11h2v2h-2z'),
  link: P('M14 4h6v6M20 4l-9 9') + P('M17 14v6H4V7h6'),
  // ── navigation / sections
  home: P('M3 11.5 12 4l9 7.5') + P('M6 9.5V20h4.5v-5.5h3V20H18V9.5'),
  gear: P('M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z') + P('M12 8.5 15 12l-3 3.5L9 12z'),
  eye: P('M2.5 12 7 6.5h10l4.5 5.5-4.5 5.5H7z') + F('M12 9.5 14.5 12 12 14.5 9.5 12z'),
  target: P('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5') + F('M12 9.5 14.5 12 12 14.5 9.5 12z'),
  flask: P('M9 3.5h6M10 3.5v6L4.5 19l1.5 1.5h12l1.5-1.5L14 9.5v-6') + F('M7 16h10l1.6 3H5.4z'),
  chip: P('M7 7h10v10H7z') + P('M10 3.5V7M14 3.5V7M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5') + F('M10 10h4v4h-4z'),
  cube: P('M12 3l8 4.5v9L12 21l-8-4.5v-9z') + P('M4 7.5l8 4.5 8-4.5M12 12v9'),
  grid: P('M4 4h6.5v6.5H4zM13.5 4H20v6.5h-6.5zM4 13.5h6.5V20H4z') + F('M13.5 13.5H20V20h-6.5z'),
  bug: P('M8.5 9h7v6.5L12 19l-3.5-3.5z') + P('M8.5 11.5H4.5M8.5 15H5M15.5 11.5h4M15.5 15h3.5') + P('M9.5 9V7l2.5-2.5L14.5 7v2'),
  chart: P('M4 4v16h16') + P('M7.5 15.5l4-5 3 3L19 7.5') + F('M18 6.5h2v2h-2z'),
  // ── settings tabs
  sound: P('M4 9h4l5-4.5v15L8 15H4z') + P('M16.5 9l1.5 3-1.5 3M19 6.5l2.5 5.5-2.5 5.5'),
  mute: P('M4 9h4l5-4.5v15L8 15H4z') + P('M16 9.5l5 5M21 9.5l-5 5'),
  gamepad: P('M3 10l3-3.5h12l3 3.5v6.5L18.5 19h-2.5l-2-3h-4l-2 3H5.5L3 16.5z') + P('M7 12.5h3.5M8.75 10.75v3.5') + F('M14.5 10.5h2v2h-2zM16.5 13h2v2h-2z'),
  monitor: P('M3 4.5h18v11.5H3z') + P('M8.5 20h7M12 16v4') + F('M5.5 7h5v2h-5z'),
  joystick: P('M5 15.5h14V20H5z') + P('M12 9.5v6') + F('M12 3l3.5 3.5L12 10 8.5 6.5z'),
  // ── game
  dash: P('M3 8h6M3 12h9M3 16h6') + P('M13 6l7 6-7 6z'),
  swap: P('M4 8.5h14.5L15 5M20 15.5H5.5L9 19'),
  fullscreen: P('M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'),
  shield: P('M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6z') + F('M11 9h2v6h-2z'),
  skull: P('M5 11V8l3-4h8l3 4v3l-2 2v4H7v-4z') + F('M8.5 10h2.5v2.5H8.5zM13 10h2.5v2.5H13z') + P('M10 17v3M14 17v3'),
  trophy: P('M7 4h10v5l-2 4H9L7 9z') + P('M7 6H4v2l3 3M17 6h3v2l-3 3M12 13v4M8 20h8l-1-3H9z'),
  heart: P('M12 20 3.5 11.5V7L7 3.5h2.5L12 6l2.5-2.5H17L20.5 7v4.5z'),
  bolt: P('M13.5 3 5.5 13.5H11L9.5 21l9-11.5H13z'),
  info: P('M12 3l9 9-9 9-9-9z') + P('M12 10.5V16') + F('M11 7h2v2h-2z'),
  warn: P('M12 3.5 21 19.5H3z') + P('M12 9.5v5') + F('M11 16h2v2h-2z'),
  dice: P('M5 5h14v14H5z') + F('M8 8h2.5v2.5H8zM13.5 13.5H16V16h-2.5zM10.75 10.75h2.5v2.5h-2.5z'),
  star: P('M12 3l2.6 6.1 6.4.5-4.9 4.2 1.5 6.4L12 16.8l-5.6 3.4 1.5-6.4L3 9.6l6.4-.5z'),
} as const;

export type IconName = keyof typeof ICONS;

const svg = (name: IconName, cls: string): string =>
  `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter">${ICONS[name]}</svg>`;

/** markup for imperative DOM code (HUD, touch controls, debug drawer) */
export function iconHtml(name: IconName, cls = ''): string {
  return svg(name, cls);
}

export function Icon({ name, class: cls = '', size }: { name: IconName; class?: string; size?: number }): JSX.Element {
  return (
    <svg
      class={`ico${cls ? ' ' + cls : ''}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="square"
      stroke-linejoin="miter"
      style={size ? { width: size, height: size } : undefined}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
