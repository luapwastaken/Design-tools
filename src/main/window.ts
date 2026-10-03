// The one app window (spec §4): caption overlay colours, input and navigation guards, crash reload,
// and the close handshake with the renderer.
import { app, BrowserWindow, dialog, screen } from 'electron';
import { existsSync } from 'node:fs';
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
/** the window's own icon (taskbar, alt-tab) when run from the project; an installed build carries its icon in the exe */
const ICON = join(app.getAppPath(), 'build', 'icon.ico');

type CloseReply = { busy: boolean; pendingTrash: string[] };

let win: BrowserWindow | null = null;
/** whether the window was made to be slowed when it is hidden (test windows were not) */
let throttles = true;
let closeWaiter: ((reply: CloseReply) => void) | null = null;

export function send<K extends keyof ApiEvents>(name: K, payload: ApiEvents[K]): void {
  if (win && !win.isDestroyed()) win.webContents.send(name, payload);
}

/** the renderer's 'window.keepAwake': for as long as an export runs, a hidden or minimised window keeps its speed */
export function keepAwake(on: boolean): void {
  if (win && !win.isDestroyed()) win.webContents.setBackgroundThrottling(throttles && !on);
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

/**
 * Test runs (--smoke / --smoke-dir) open off every screen, so they never cover what Luap is working
 * on, and never take focus (showInactive below). They keep painting because index.ts turns off
 * Chromium's occlusion tracking for test runs, so CDP screenshots still work.
 */
function testPlacement(): { x: number; y: number } {
  const left = Math.min(...screen.getAllDisplays().map((d) => d.bounds.x));
  return { x: left - 4000, y: 0 };
}

/** a second launch: bring the running window forward (never for test runs) */
export function focusWindow(): void {
  if (!win || win.isDestroyed() || process.argv.some((a) => a === '--smoke' || a.startsWith('--smoke-dir='))) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** the renderer's 'app.closeReply' */
export function closeReplied(busy: boolean, pendingTrash: string[]): void {
  closeWaiter?.({ busy, pendingTrash });
}

export function createWindow(o: {
  theme: Theme;
  smoke: boolean;
  /** the pass the renderer's smoke.ts runs, if any */
  smokeRun: 'full' | 'quiet' | null;
  /** the quit is certain: send these pending deletes to the Recycle Bin (spec §6.3) */
  trashOnQuit(ids: string[]): Promise<void>;
}): BrowserWindow {
  const hex = THEME_HEX[o.theme];
  throttles = !o.smoke;
  const w = new BrowserWindow({
    ...(o.smoke ? testPlacement() : {}),
    width: 1600,
    height: 1000,
    minWidth: 1280,
    minHeight: 800,
    backgroundColor: hex.page,
    ...(existsSync(ICON) ? { icon: ICON } : {}),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: hex.ground, symbolColor: hex.ink2, height: 40 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // a smoke window behind other windows must not have its timers slowed to once a second
      backgroundThrottling: throttles,
      // --dt-theme is the preload's fallback; it asks main for the current theme first
      additionalArguments: [`--dt-theme=${o.theme}`, ...(o.smoke ? ['--dt-smoke'] : []), ...(o.smokeRun ? [`--dt-smoke-run=${o.smokeRun}`] : [])],
    },
  });
  win = w;
  const wc = w.webContents;

  // Test runs never take focus from whatever Luap is doing. The smoke passes need no window at
  // all (it still lays out and paints, unthrottled), so nothing appears; --smoke-dir, driven by
  // scripts that take screenshots, shows one without focus.
  w.once('ready-to-show', () => {
    if (o.smokeRun) return;
    if (!o.smoke) return w.show();
    w.setSkipTaskbar(true);
    w.showInactive();
    // Windows may pull a window back onto a screen when it shows; put it back off-screen
    const p = testPlacement();
    w.setPosition(p.x, p.y);
  });

  // Pinch zoom off. Page zoom needs nothing more: with no application menu, Ctrl+= / Ctrl+- / Ctrl+0
  // and Ctrl+wheel don't zoom the page (checked on Electron 44), and the keys still reach the renderer
  // for canvas zoom. Blocking them in before-input-event would hide them from the renderer too.
  wc.on('did-finish-load', () => void wc.setVisualZoomLevelLimits(1, 1));
  // an export that died with its page (a crash, a reload) never turned this off
  wc.on('did-start-navigation', (_e, _url, _inPlace, isMainFrame) => isMainFrame && keepAwake(false));
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
    void mayClose(w, o.trashOnQuit, o.smoke).then((ok) => {
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
 * is still running. There is no "unsaved changes" prompt: every commit is already written. Deletes
 * still waiting on their Undo toast go to the Recycle Bin only once the quit is certain, so "Keep
 * running" finds them still undoable.
 */
async function mayClose(w: BrowserWindow, trashOnQuit: (ids: string[]) => Promise<void>, testRun: boolean): Promise<boolean> {
  if (w.webContents.isCrashed()) return true;
  const reply = await new Promise<CloseReply | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), CLOSE_WAIT_MS);
    closeWaiter = (r) => {
      clearTimeout(timer);
      resolve(r);
    };
    w.webContents.send('app.closeRequest', null);
  });
  closeWaiter = null;
  if (!reply) log('warn', `Close: the window did not confirm its writes within ${CLOSE_WAIT_MS / 1000}s; closing anyway`);
  const quit = !reply?.busy || (await quitAnyway(w, testRun));
  if (quit && reply?.pendingTrash.length) await trashOnQuit(reply.pendingTrash);
  return quit;
}

const QUIT_ANYWAY = 'An export or import is still running. Quit anyway?';

/**
 * Test runs never show the box: a modal takes the foreground, and Luap's typing would land in it.
 * They answer from --smoke-answer=quit|keep (default quit), so both branches can still be driven.
 */
async function quitAnyway(w: BrowserWindow, test: boolean): Promise<boolean> {
  if (test) {
    const quit = process.argv.find((a) => a.startsWith('--smoke-answer='))?.slice('--smoke-answer='.length) !== 'keep';
    log('info', `Test run: "${QUIT_ANYWAY}" answered ${quit ? 'Quit anyway' : 'Keep running'}`);
    console.log(`[smoke] quit anyway: ${quit ? 'quit' : 'keep'}`);
    return quit;
  }
  const { response } = await dialog.showMessageBox(w, {
    type: 'warning',
    message: QUIT_ANYWAY,
    buttons: ['Quit anyway', 'Keep running'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return response === 0;
}
