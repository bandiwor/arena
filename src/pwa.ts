import type { Mode } from './game';

/**
 * PWA glue: service-worker registration, a quiet install chip (menu only) and an update toast
 * that never interrupts a fight — it waits for the menu/pause/game-over screen.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const LS_DISMISS = 'null-arena:install-dismissed';
const DISMISS_DAYS = 14;
const CHECK_EVERY_MS = 30 * 60 * 1000;

let mode: Mode = 'menu';
let deferred: BeforeInstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;
let updateDismissed = false;
let reloading = false;

const isStandalone = (): boolean => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || (navigator as { standalone?: boolean }).standalone === true;
const isIos = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const quietMode = (): boolean => mode === 'menu' || mode === 'pause' || mode === 'over';

function dismissedRecently(): boolean {
  try {
    const t = parseInt(localStorage.getItem(LS_DISMISS) ?? '0', 10);
    return Date.now() - t < DISMISS_DAYS * 864e5;
  } catch {
    return false;
  }
}
function rememberDismiss(): void {
  try {
    localStorage.setItem(LS_DISMISS, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function toast(id: string, html: string, actions: { label: string; primary?: boolean; on: () => void }[], corner: 'bl' | 'br'): HTMLElement {
  document.getElementById(id)?.remove();
  const el = document.createElement('div');
  el.id = id;
  el.className = `pwa-toast ${corner}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="pwa-msg">${html}</div>`;
  const row = document.createElement('div');
  row.className = 'pwa-act';
  for (const a of actions) {
    const b = document.createElement('button');
    b.textContent = a.label;
    b.className = a.primary ? 'pwa-btn primary' : 'pwa-btn';
    b.onclick = a.on;
    row.appendChild(b);
  }
  el.appendChild(row);
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  return el;
}
function hide(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('in');
  setTimeout(() => el.remove(), 250);
}

// ───────────── install

function refreshInstall(): void {
  if (isStandalone() || dismissedRecently() || mode !== 'menu') return hide('pwa-install');
  if (document.getElementById('pwa-install')) return;
  if (deferred) {
    toast(
      'pwa-install',
      '<b>Установить NULL//ARENA</b><span>играть в отдельном окне и офлайн</span>',
      [
        {
          label: 'Установить',
          primary: true,
          on: () => {
            const d = deferred;
            if (!d) return;
            deferred = null;
            hide('pwa-install');
            void d.prompt();
            void d.userChoice.then((c) => {
              if (c.outcome === 'dismissed') rememberDismiss();
            });
          },
        },
        { label: '✕', on: () => (rememberDismiss(), hide('pwa-install')) },
      ],
      'bl',
    );
  } else if (isIos()) {
    toast('pwa-install', '<b>Установить на экран</b><span>«Поделиться» → «На экран Домой»</span>', [{ label: '✕', on: () => (rememberDismiss(), hide('pwa-install')) }], 'bl');
  }
}

// ───────────── update

function refreshUpdate(): void {
  if (!waiting || updateDismissed || !quietMode()) return hide('pwa-update');
  if (document.getElementById('pwa-update')) return;
  toast(
    'pwa-update',
    '<b>Доступна новая версия</b><span>обновление займёт секунду</span>',
    [
      {
        label: 'Обновить',
        primary: true,
        on: () => {
          reloading = true;
          waiting?.postMessage({ type: 'SKIP_WAITING' });
          hide('pwa-update');
        },
      },
      { label: 'Позже', on: () => ((updateDismissed = true), hide('pwa-update')) },
    ],
    'br',
  );
}

function track(reg: ServiceWorkerRegistration): void {
  const onWaiting = (): void => {
    if (reg.waiting && navigator.serviceWorker.controller) {
      waiting = reg.waiting;
      updateDismissed = false;
      refreshUpdate();
    }
  };
  onWaiting();
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    sw?.addEventListener('statechange', () => {
      if (sw.state === 'installed') onWaiting();
    });
  });
  const check = (): void => void reg.update().catch(() => undefined);
  setInterval(check, CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check();
  });
}

export function installPwa(): void {
  window.addEventListener('null-arena:mode', (e) => {
    mode = (e as CustomEvent<Mode>).detail;
    refreshInstall();
    refreshUpdate();
  });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    refreshInstall();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    hide('pwa-install');
  });
  setTimeout(refreshInstall, 2500); // iOS hint after the menu settles
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  let started = false;
  const register = (): void => {
    if (started) return;
    started = true;
    navigator.serviceWorker
      .register('./sw.js')
      .then(track)
      .catch((err: unknown) => console.warn('SW registration failed', err));
  };
  // after load (don't compete with first paint), but never wait on slow web fonts for long
  if (document.readyState === 'complete') register();
  else {
    window.addEventListener('load', register, { once: true });
    setTimeout(register, 3000);
  }
}
