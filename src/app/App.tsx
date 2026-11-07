import type { ComponentType, JSX } from 'preact';
import { hasViewTransitions, registerPage, route, type RouteName } from './router';

/**
 * The single page app: one router signal → one page. Each page is its own chunk (the game page
 * carries three.js; the training page carries the trainer), loaded before the swap so the View
 * Transition always has a ready page to animate to.
 */
const comps = new Map<RouteName, ComponentType>();
const PAGES: Record<RouteName, { load: () => Promise<{ default: ComponentType }>; title: string }> = {
  game: { load: () => import('./pages/game'), title: 'NULL//ARENA' },
  train: { load: () => import('../train/page'), title: 'NULL//ARENA · обучение ботов' },
  lab: { load: () => import('../lab/page'), title: 'NULL//ARENA · лаборатория' },
  kit: { load: () => import('../ui/kit-page'), title: 'NULL//ARENA · UI-кит' },
};
for (const [name, p] of Object.entries(PAGES) as [RouteName, (typeof PAGES)[RouteName]][]) {
  registerPage(name, async () => comps.set(name, (await p.load()).default));
}
if (!hasViewTransitions) document.documentElement.classList.add('no-vt');

export function App(): JSX.Element {
  const r = route.value;
  const Page = comps.get(r.name);
  document.title = PAGES[r.name].title;
  return <div class={`pg pg-${r.name}`}>{Page && <Page key={r.name} />}</div>;
}
