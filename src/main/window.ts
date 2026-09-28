// The one app window (spec §4): caption overlay colours, input and navigation guards, crash reload,
// and the close handshake with the renderer.
import { app, BrowserWindow, dialog } from 'electron';
import { join } from 'node:path';
import type { ApiEvents } from '../shared/api.ts';
import type { Theme } from '../shared/types.ts';
import { log } from './log.ts';

/** Brief §3.4: page, ground and ink-2 as hex (Electron takes no oklch). The only colour literals outside tokens.css. */
export const THEME_HEX = {
  dark: { page: '#060606', ground: '#131313', ink2: '#bebebe' },
  light: { page: '#e8e8e8', ground: '#d1d1d1', ink2: '#404040' },
} as const;

const CLOSE_WAIT_MS = 3000;

let win: BrowserWindow | null = null;
let closeWaiter: ((busy: boolean) => void) | null = null;

export function send<K extends keyof ApiEvents>(name: K, payload: ApiEvents[K]): void {
  if (win && !win.isDestroyed()) win.webContents.send(name, payload);
}

/** parent for dialogs */
export function requireWindow(): BrowserWindow {
  if (!win || win.isDestroyed()) throw new Error('The window is closed.');
  return win;
}

export function applyTheme(theme: Theme): void {
  const hex = THEME_HEX[theme];
  win?.setBackgroundColor(hex.page);
  win?.setTitleBarOverlay({ color: hex.ground, symbolColor: hex.ink2, height: 40 });
}

/** a second launch: bring the running window forward */
export function focusWindow(): void {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** the renderer's 'app.closeReply' */
export function closeReplied(busy: boolean): void {
  closeWaiter?.(busy);
}

export function createWindow(o: { theme: Theme; smoke: boolean }): BrowserWindow {
  const hex = THEME_HEX[o.theme];
  const w = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: hex.page,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: hex.ground, symbolColor: hex.ink2, height: 40 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // --dt-theme is the preload's fallback; it asks main for the current theme first
      additionalArguments: [`--dt-theme=${o.theme}`, ...(o.smoke ? ['--dt-smoke'] : [])],
    },
  });
  win = w;
  const wc = w.webContents;

  // smoke runs shouldn't steal focus from whatever Luap is doing
  w.once('ready-to-show', () => (o.smoke ? w.showInactive() : w.show()));

  // Pinch zoom off. Page zoom needs nothing more: with no application menu, Ctrl+= / Ctrl+- / Ctrl+0
  // and Ctrl+wheel don't zoom the page (checked on Electron 44), and the keys still reach the renderer
  // for canvas zoom. Blocking them in before-input-event would hide them from the renderer too.
  wc.on('did-finish-load', () => void wc.setVisualZoomLevelLimits(1, 1));
  wc.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) {
      wc.toggleDevTools();
      e.preventDefault();
    }
  });
  // a reload (Vite's full reload in dev) is allowed; links and dropped files are not
  wc.on('will-navigate', (e) => {
    if (e.url !== wc.getURL()) e.preventDefault();
  });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));

  let lastReload = 0;
  wc.on('render-process-gone', (_e, d) => {
    log('error', `Renderer gone: ${d.reason} (exit code ${d.exitCode})`);
    if (o.smoke) return app.exit(1);
    if (d.reason === 'clean-exit' || w.isDestroyed()) return;
    // a renderer that dies again straight after a reload would loop forever
    if (Date.now() - lastReload < 10_000) return log('error', 'Renderer crashed again right after a reload; not reloading');
    lastReload = Date.now();
    wc.reload();
  });

  let closing: 'no' | 'asking' | 'yes' = 'no';
  w.on('close', (e) => {
    if (closing === 'yes') return;
    e.preventDefault();
    if (closing === 'asking') return;
    closing = 'asking';
    void mayClose(w).then((ok) => {
      closing = ok ? 'yes' : 'no';
      if (ok) w.close();
    });
  });
  w.on('closed', () => {
    if (win === w) win = null;
  });

  const dev = process.env.ELECTRON_RENDERER_URL;
  if (dev) void w.loadURL(dev);
  else void w.loadFile(join(__dirname, '../renderer/index.html'));
  return w;
}

/**
 * Spec §4 quit: ask the renderer to flush and wait up to 3s; ask Luap only if an export or import
 * is still running. There is no "unsaved changes" prompt: every commit is already written.
 */
async function mayClose(w: BrowserWindow): Promise<boolean> {
  if (w.webContents.isCrashed()) return true;
  const busy = await new Promise<boolean | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), CLOSE_WAIT_MS);
    closeWaiter = (b) => {
      clearTimeout(timer);
      resolve(b);
    };
    w.webContents.send('app.closeRequest', null);
  });
  closeWaiter = null;
  if (busy === null) log('warn', `Close: the window did not confirm its writes within ${CLOSE_WAIT_MS / 1000}s; closing anyway`);
  if (!busy) return true;
  const { response } = await dialog.showMessageBox(w, {
    type: 'warning',
    message: 'An export is still running. Quit anyway?',
    buttons: ['Quit anyway', 'Keep running'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
}
