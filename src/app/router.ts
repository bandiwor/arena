import { signal } from '@preact/signals';

/**
 * Hash router for the single-page app. `route` is a signal: components that read it re-render on
 * navigation, nothing else does. Pages are code-split; `navigate` loads the target chunk FIRST and
 * only then swaps the page inside a View Transition (Chrome / Edge / Safari 18+), so a transition
 * never shows a blank page. Without the API the incoming page plays a CSS entrance instead.
 *
 *   #/            game (menu, runs)
 *   #/watch/ID/D  game, then starts trained model ID on difficulty D
 *   #/train       bot training
 *   #/lab         asset lab
 *   #/kit         UI kit
 */
export type RouteName = 'game' | 'train' | 'lab' | 'kit';
export interface Route {
  name: RouteName;
  params: Readonly<Record<string, string>>;
}

export const ORDER: readonly RouteName[] = ['game', 'train', 'lab', 'kit'];

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const head = parts[0] ?? '';
  if (head === 'train' || head === 'lab' || head === 'kit') return { name: head, params: {} };
  if (head === 'watch' && parts[1]) return { name: 'game', params: { watch: parts[1], diff: parts[2] ?? '1' } };
  return { name: 'game', params: {} };
}

export function href(name: RouteName): string {
  return name === 'game' ? '#/' : `#/${name}`;
}

export const route = signal<Route>(parse(location.hash));
/** true while a page swap is animating (pages can defer heavy work) */
export const navigating = signal(false);

type Loader = () => Promise<unknown>;
const loaders = new Map<RouteName, Loader>();
const loaded = new Set<RouteName>();
export function registerPage(name: RouteName, load: Loader): void {
  loaders.set(name, load);
}
export async function preload(name: RouteName): Promise<void> {
  if (loaded.has(name)) return;
  await loaders.get(name)?.();
  loaded.add(name);
}

type VTDoc = Document & { startViewTransition?: (cb: () => Promise<void> | void) => { finished: Promise<void> } };
export const hasViewTransitions = typeof document !== 'undefined' && typeof (document as VTDoc).startViewTransition === 'function';
const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** wait until Preact has flushed the render queue (signal updates render in a microtask batch) */
const rendered = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let seq = 0;
async function go(r: Route, push: string | null): Promise<void> {
  const my = ++seq;
  await preload(r.name);
  if (my !== seq) return; // a newer navigation won
  const cur = route.value;
  const dir = ORDER.indexOf(r.name) >= ORDER.indexOf(cur.name) ? 'fwd' : 'back';
  const apply = (): void => {
    if (push !== null) history.pushState(null, '', push);
    route.value = r;
  };
  if (cur.name === r.name) {
    apply();
    return;
  }
  const d = document as VTDoc;
  document.documentElement.dataset['nav'] = dir;
  navigating.value = true;
  if (__DEV__) performance.mark(`nav:${r.name}`);
  if (hasViewTransitions && !reducedMotion()) {
    const vt = d.startViewTransition!(async () => {
      apply();
      await rendered();
    });
    await vt.finished.catch(() => undefined);
  } else {
    apply();
    await rendered();
  }
  navigating.value = false;
}

export function navigate(to: string, o: { replace?: boolean } = {}): void {
  const target = to.startsWith('#') ? to : `#/${to.replace(/^\//, '')}`;
  if (o.replace) {
    history.replaceState(null, '', target);
    void go(parse(target), null);
  } else void go(parse(target), target);
}

/** browser back / forward and hand-edited hashes */
window.addEventListener('popstate', () => void go(parse(location.hash), null));

/** intercept same-app links (<a href="#/train">) so they animate like buttons do */
document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest?.('a[href^="#/"]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  navigate(a.getAttribute('href')!);
});
