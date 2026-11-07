import type { JSX } from 'preact';
import { Icon, type IconName } from '../ui/icons';
import { href, route, type RouteName } from './router';

const LINKS: [RouteName, string, IconName][] = [
  ['game', 'Игра', 'play'],
  ['train', 'Обучение', 'flask'],
  ['lab', 'Лаборатория', 'cube'],
  ['kit', 'UI-кит', 'grid'],
];

/** top bar of the non-game pages: plain hash links (the router animates them) */
export function PageNav({ extra }: { extra?: JSX.Element }): JSX.Element {
  const cur = route.value.name;
  return (
    <nav class="pg-nav">
      <span class="brand">
        NULL<span>//</span>ARENA
      </span>
      {LINKS.map(([n, label, icon]) => (
        <a key={n} href={href(n)} class={n === cur ? 'on' : ''} aria-current={n === cur ? 'page' : undefined}>
          <Icon name={icon} />
          <span>{label}</span>
        </a>
      ))}
      <span class="sp" />
      {extra}
    </nav>
  );
}
