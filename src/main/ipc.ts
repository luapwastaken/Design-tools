// Registers every Api entry (src/shared/api.ts). The Handlers type makes a missing entry a type error.
import { app, dialog, ipcMain, shell } from 'electron';
import type { Api } from '../shared/api.ts';
import type { Settings } from '../shared/types.ts';
import type { Exporter } from './export.ts';
import { inOrder } from './fsx.ts';
import type { LibraryService } from './library/service.ts';
import { errorText, log } from './log.ts';
import type { SettingsStore } from './settings.ts';
import { applyTheme, closeReplied, keepAwake, requireWindow } from './window.ts';
import type { Workspace } from './workspace.ts';

type Handlers = { [K in keyof Api]: (...args: Parameters<Api[K]>) => ReturnType<Api[K]> | Awaited<ReturnType<Api[K]>> };

export type IpcContext = {
  settings: SettingsStore;
  workspace: Workspace;
  library: LibraryService;
  exporter: Exporter;
  smoke: boolean;
  smokeDone(ok: boolean, report: string): void;
};

export function registerIpc({ settings, workspace: ws, library: lib, exporter, smoke, smokeDone }: IpcContext): void {
  // What the window and the LibraryService were last given. One settings.set at a time, each applying
  // the saved result, so overlapping calls (a quick theme toggle, chooseRoot) can't leave them out of step.
  let applied = settings.get();
  const setSettings = (patch: Parameters<Api['settings.set']>[0]): Promise<Settings> =>
    inOrder('settings.set', async () => {
      const { theme, libraryRoot, pickerStyle, pickerModel } = patch;
      const next = await settings.update({ theme, libraryRoot, pickerStyle, pickerModel });
      if (next.theme !== applied.theme) applyTheme(next.theme);
      if (next.libraryRoot !== applied.libraryRoot) await lib.setRoot(next.libraryRoot);
      applied = next;
      return next;
    });

  const itemPath = (id: string) => {
    const path = lib.pathOf(id);
    if (!path) throw new Error('That item is no longer in the Library.');
    return path;
  };

  const handlers: Handlers = {
    'app.info': () => ({ version: app.getVersion(), isPackaged: app.isPackaged, smoke, userData: app.getPath('userData') }),
    'app.log': (level, message, details) => log(level, `renderer: ${message}`, details),
    'app.closeReply': (busy, pendingTrash) => closeReplied(busy, pendingTrash),
    'app.smokeDone': (ok, report) => {
      if (smoke) smokeDone(ok, report);
    },

    'settings.get': () => settings.get(),
    'settings.set': setSettings,

    'library.index': () => lib.index(),
    'library.chooseRoot': async () => {
      const r = await dialog.showOpenDialog(requireWindow(), {
        title: 'Choose the Library folder',
        defaultPath: settings.get().libraryRoot,
        properties: ['openDirectory', 'createDirectory'],
      });
      const root = r.filePaths[0];
      return r.canceled || !root ? null : setSettings({ libraryRoot: root });
    },
    'library.read': (id) => lib.read(id),
    'library.stat': (id) => lib.stat(id),
    'library.write': (id, payload, expected) => lib.write(id, payload, expected),
    'library.create': (collection, name, payload) => lib.create(collection, name, payload),
    'library.createImage': (collection, name, ext, bytes) => lib.createImage(collection, name, ext, bytes),
    'library.rename': (id, name) => lib.rename(id, name),
    'library.move': (id, collection) => lib.move(id, collection),
    'library.duplicate': (id) => lib.duplicate(id),
    'library.hide': (id) => lib.hide(id),
    'library.unhide': (id) => lib.unhide(id),
    'library.trash': (id) => lib.trash(id),
    'library.import': (paths, collection) => lib.import(paths, collection),
    'library.reveal': (id) => shell.showItemInFolder(itemPath(id)),
    'collection.create': (name) => lib.collectionCreate(name),
    'collection.rename': (name, newName) => lib.collectionRename(name, newName),
    'collection.setLocked': (name, locked) => lib.collectionSetLocked(name, locked),

    'workspace.load': (tool) => ws.load(tool),
    'workspace.save': (tool, state) => ws.save(tool, state),
    'workspace.quarantine': (tool, raw) => ws.quarantine(tool, raw),
    'workspace.putAsset': (tool, bytes, ext) => ws.putAsset(tool, bytes, ext),
    'workspace.gcAssets': (tool, keep) => ws.gcAssets(tool, keep),
    'presets.load': (tool) => ws.presetsLoad(tool),
    'presets.save': (tool, presets) => ws.presetsSave(tool, presets),

    'export.save': (req) => exporter.save(req),
    'export.toFolder': (req) => exporter.toFolder(req),
    'export.openFolder': (tool) => exporter.openFolder(tool),
    'export.intoFolder': (id, name, data) => exporter.intoFolder(id, name, data),
    'export.closeFolder': async (id) => exporter.closeFolder(id),
    'window.keepAwake': async (on) => keepAwake(on),
    'shell.reveal': (path) => shell.showItemInFolder(path),
  };

  // the preload's theme before first paint; argv's --dt-theme would be stale after a crash reload
  ipcMain.on('dt:theme', (e) => (e.returnValue = settings.get().theme));

  for (const name of Object.keys(handlers) as (keyof Api)[]) {
    const fn = handlers[name] as (...args: unknown[]) => unknown;
    ipcMain.handle(name, async (_e, ...args: unknown[]) => {
      try {
        return await fn(...args);
      } catch (e) {
        log('warn', `${name} failed`, errorText(e));
        throw e;
      }
    });
  }
}
