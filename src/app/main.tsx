import '../ui/style.css';
import '../ui/kit.css';
import './app.css';
import { render } from 'preact';
import { App } from './App';
import { ORDER, preload, route } from './router';

/** Entry: load the chunk of the page in the URL, render, then warm the other chunks when idle. */
await preload(route.value.name);
render(<App />, document.getElementById('app')!);
const idle = (fn: () => void): void => void ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));
idle(() => {
  for (const n of ORDER) void preload(n);
});
