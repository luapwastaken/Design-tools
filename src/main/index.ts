import { app, Menu, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
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

// --smoke runs against a new temp folder (printed at start); --smoke-dir=<dir> is a smoke run that
// reuses one, for the relaunch pass.
const smokeDirArg = process.argv.find((a) => a.startsWith('--smoke-dir='))?.slice('--smoke-dir='.length);
const smoke = process.argv.includes('--smoke') || smokeDirArg !== undefined;
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

  if (smokeDir) {
    console.log(`[smoke] folder ${smokeDir}`);
    setTimeout(() => {
      log('error', `Smoke: no result within ${SMOKE_TIMEOUT_MS / 1000}s`);
      app.exit(2);
    }, SMOKE_TIMEOUT_MS);
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
  const library = new LibraryService(settings.get().libraryRoot, { trashItem, now: Date.now }, (index) => send('library.changed', index));
  // pure Node, so the first scan can overlap Electron's start-up
  void library.start().catch((e) => log('error', 'Library failed to start', errorText(e)));

  registerIpc({
    settings,
    workspace,
    library,
    exporter,
    smoke,
    smokeDone(ok, report) {
      const pass = ok && mainErrors === 0;
      console.log(`[smoke] ${pass ? 'PASS' : 'FAIL'}${mainErrors ? ` (${mainErrors} main-process errors, see log)` : ''}\n${report}`);
      log(pass ? 'info' : 'error', `Smoke ${pass ? 'passed' : 'failed'}`, report);
      app.exit(pass ? 0 : 1);
    },
  });

  void app.whenReady().then(() => {
    handleDt({
      libraryRoot: () => settings.get().libraryRoot,
      itemPath: (id) => library.pathOf(id),
      assetPath: workspace.assetPath,
    });
    const win = createWindow({ theme: settings.get().theme, smoke });
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
