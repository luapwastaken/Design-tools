import { app, BrowserWindow, Menu, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createExporter } from './export.ts';
import { renameRetry } from './fsx.ts';
import { registerIpc } from './ipc.ts';
import { LibraryService } from './library/service.ts';
import { errorText, log } from './log.ts';
import { handleDt, registerDtScheme } from './protocol.ts';
import { createSettings } from './settings.ts';
import { createWindow, focusWindow, send } from './window.ts';
import { createWorkspace } from './workspace.ts';

const SMOKE_TIMEOUT_MS = 120_000;

// Smoke folders (temp userData and Library): --smoke makes a new one (printed at start) and runs the
// full smoke pass (src/renderer/smoke.ts); --smoke-dir=<dir> reuses one and runs no pass, for
// driving the app by hand or by script; --smoke-quiet with it is the relaunch pass. `npm run smoke`
// (scripts/smoke.mjs) runs --smoke, then --smoke-quiet on the same folder. The two passes run in a
// window that is never shown; --smoke-dir shows one, unfocused, on a second monitor (window.ts).
// No test run shows a dialog: --smoke-answer=quit|keep answers "Quit anyway?" (default quit).
const smokeDirArg = process.argv.find((a) => a.startsWith('--smoke-dir='))?.slice('--smoke-dir='.length);
const smokeRun = process.argv.includes('--smoke-quiet') ? 'quiet' : process.argv.includes('--smoke') ? 'full' : null;
const smoke = smokeRun !== null || smokeDirArg !== undefined;
const smokeDir = smoke ? (smokeDirArg ? resolve(smokeDirArg) : mkdtempSync(join(tmpdir(), 'dt-smoke-'))) : null;

// Dev and built runs share one data folder, and never touch the old app's %APPDATA%\designtools.
// Set before ready and before the single-instance lock, which is keyed on it. The smoke folder's
// userData also ends in "Design Tools" (the smoke run checks that).
app.setPath('userData', join(smokeDir ?? app.getPath('appData'), 'Design Tools'));
const defaultLibrary = smokeDir ? join(smokeDir, 'Library') : join(app.getPath('documents'), 'Design Tools', 'Library');

let mainErrors = 0;
const onMainError = (what: string) => (e: unknown) => {
  mainErrors++;
  log('error', what, errorText(e));
  send('app.notice', { level: 'error', message: 'Something went wrong in the background. Details are in the log.' });
};
process.on('uncaughtException', onMainError('Uncaught exception in main'));
process.on('unhandledRejection', onMainError('Unhandled rejection in main'));

registerDtScheme();
Menu.setApplicationMenu(null);

// A second launch focuses the running window and quits.
if (!app.requestSingleInstanceLock()) app.quit();
else start();

function start() {
  app.on('second-instance', focusWindow);

  if (smokeDir) console.log(`[smoke] folder ${smokeDir}`);
  if (smokeDir && smokeRun) {
    setTimeout(() => {
      log('error', `Smoke: no result within ${SMOKE_TIMEOUT_MS / 1000}s`);
      app.exit(2);
    }, SMOKE_TIMEOUT_MS);
    // the files the full pass imports, beside its userData (smoke.ts looks there)
    if (smokeRun === 'full') {
      try {
        cpSync(join(app.getAppPath(), 'test', 'fixtures'), join(smokeDir, 'fixtures'), { recursive: true });
      } catch (e) {
        log('error', 'Smoke: could not copy test/fixtures', errorText(e));
      }
    }
  }

  const userData = app.getPath('userData');
  const settings = createSettings(userData, defaultLibrary);
  // A fresh install gets its default Library. A folder Luap chose that has gone missing stays missing (spec §11).
  if (settings.get().libraryRoot === defaultLibrary) {
    try {
      mkdirSync(defaultLibrary, { recursive: true });
    } catch (e) {
      log('warn', 'Could not create the default Library folder', errorText(e));
    }
  }
  // smoke runs keep their deletions in <smokeDir>/trash, out of Luap's Recycle Bin
  const trashItem = smokeDir ? smokeTrash(join(smokeDir, 'trash')) : (path: string) => shell.trashItem(path);
  const workspace = createWorkspace(userData);
  const exporter = createExporter(settings, { trashItem, fixedDir: smokeDir && join(smokeDir, 'exports') });
  const library = new LibraryService(
    settings.get().libraryRoot,
    { trashItem, now: Date.now, log: (message, details) => log('warn', message, details) },
    (index) => send('library.changed', index),
  );
  // pure Node, so the first scan can overlap Electron's start-up
  void library.start().catch((e) => log('error', 'Library failed to start', errorText(e)));

  registerIpc({
    settings,
    workspace,
    library,
    exporter,
    smoke,
    smokeDone(ok, report) {
      log(ok ? 'info' : 'error', 'Smoke report', report); // unpackaged, log() prints it too
      const exit = () => {
        const pass = ok && mainErrors === 0;
        console.log(`[smoke] ${pass ? 'PASS' : 'FAIL'}${mainErrors ? ` (${mainErrors} main-process errors, see log)` : ''}`);
        app.exit(pass ? 0 : 1);
      };
      // quit as the close button does, so the close handshake (last writes, pending deletes) runs too
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) return exit();
      w.once('closed', exit);
      w.close();
    },
  });

  void app.whenReady().then(() => {
    handleDt({
      libraryRoot: () => settings.get().libraryRoot,
      itemPath: (id) => library.pathOf(id),
      assetPath: workspace.assetPath,
    });
    const win = createWindow({
      theme: settings.get().theme,
      smoke,
      smokeRun,
      // trash() is a no-op for an id already gone, so a toast closing during the quit can't clash
      trashOnQuit: async (ids) => {
        await Promise.all(ids.map((id) => library.trash(id).catch((e) => log('warn', 'Quit: a pending delete could not be trashed', errorText(e)))));
      },
    });
    // spec §6.2: regaining focus rescans everything (changes made in Explorer while away)
    win.on('focus', () => void library.rescanAll());
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => void library.stop());
}

function smokeTrash(dir: string) {
  return async (path: string) => {
    await mkdir(dir, { recursive: true });
    await renameRetry(path, join(dir, `${randomUUID().slice(0, 8)} ${basename(path)}`));
  };
}
