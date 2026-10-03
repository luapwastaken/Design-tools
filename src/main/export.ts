// export.save and export.toFolder (spec §10.4). Overwriting is reversible: the new file is written to a
// temp first, then the old one goes to the Recycle Bin, or on drives without one (removable, network,
// unknown) is renamed "<name> (replaced YYYY-MM-DD HHMM).<ext>".
import { app, dialog } from 'electron';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { Api } from '../shared/api.ts';
import { renameRetry, writeAtomic } from './fsx.ts';
import { safeName } from './library/names.ts';
import { errorText, log } from './log.ts';
import type { SettingsStore } from './settings.ts';
import { requireWindow } from './window.ts';

type SaveReq = Parameters<Api['export.save']>[0];
type FolderReq = Parameters<Api['export.toFolder']>[0];
type Trash = (path: string) => Promise<void>;

export type Exporter = ReturnType<typeof createExporter>;

/** `fixedDir` (--smoke, where no one answers dialogs) replaces both dialogs with that folder. */
export function createExporter(settings: SettingsStore, o: { trashItem: Trash; fixedDir: string | null }) {
  const lastFolder = (key: string) => settings.get().exportFolders[key] ?? app.getPath('documents');
  const remember = async (key: string, folder: string) => {
    if (settings.get().exportFolders[key] === folder) return;
    await settings.update({ exportFolders: { [key]: folder } }).catch((e) => log('warn', 'Could not remember the export folder', errorText(e)));
  };

  const chooseFile = async (defaultPath: string, filterName: string, ext: string): Promise<string | null> => {
    if (o.fixedDir) return join(o.fixedDir, basename(defaultPath));
    const r = await dialog.showSaveDialog(requireWindow(), { defaultPath, filters: [{ name: filterName, extensions: [ext] }] });
    return r.canceled || !r.filePath ? null : r.filePath;
  };
  const chooseFolder = async (defaultPath: string, tool: string): Promise<string | null> => {
    if (o.fixedDir) return join(o.fixedDir, safeName(tool));
    const r = await dialog.showOpenDialog(requireWindow(), { defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  };

  // folders chosen for files that arrive one at a time, each with the names written so far
  const open = new Map<number, { folder: string; used: Set<string> }>();
  let opened = 0;
  const openFolder = async (tool: string): Promise<{ id: number; folder: string } | null> => {
    const key = `${tool}:folder`;
    const folder = await chooseFolder(lastFolder(key), tool);
    if (!folder) return null;
    await remember(key, folder);
    open.set(++opened, { folder, used: new Set() });
    return { id: opened, folder };
  };
  const intoFolder = async (id: number, name: string, data: ArrayBuffer | string): Promise<string> => {
    const f = open.get(id);
    if (!f) throw new Error('That export folder was closed.');
    const path = join(f.folder, batchName(safeName(name), f.used));
    await writeReplacing(path, data, o.trashItem);
    return path;
  };

  return {
    async save(req: SaveReq): Promise<string | null> {
      const ext = req.ext.replace(/^\./, '').toLowerCase();
      if (!/^[a-z0-9]{1,8}$/.test(ext)) throw new Error(`Unsupported file type ".${req.ext}"`);
      const key = `${req.tool}:${ext}`;
      const given = req.suggestedName;
      const name = safeName(given.toLowerCase().endsWith(`.${ext}`) ? given.slice(0, -ext.length - 1) : given);
      const path = await chooseFile(join(lastFolder(key), `${name}.${ext}`), req.filterName, ext);
      if (!path) return null;
      await writeReplacing(path, req.data, o.trashItem);
      await remember(key, dirname(path));
      return path;
    },

    async toFolder(req: FolderReq): Promise<{ folder: string; written: string[] } | null> {
      const got = await openFolder(req.tool);
      if (!got) return null;
      try {
        const written: string[] = [];
        for (const f of req.files) written.push(await intoFolder(got.id, f.name, f.data));
        return { folder: got.folder, written };
      } finally {
        open.delete(got.id);
      }
    },

    openFolder,
    intoFolder,
    closeFolder: (id: number): void => void open.delete(id),
  };
}

/** "Black.png", then "Black 2.png": two files of one export never land on the same name (ignoring case) */
function batchName(name: string, used: Set<string>): string {
  const ext = extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${base} ${n}${ext}`;
    if (!used.has(candidate.toLowerCase())) {
      used.add(candidate.toLowerCase());
      return candidate;
    }
  }
}

async function writeReplacing(path: string, data: ArrayBuffer | string, trashItem: Trash): Promise<void> {
  try {
    await writeAtomic(path, typeof data === 'string' ? data : new Uint8Array(data), async () => {
      if (await exists(path)) await setAside(path, trashItem);
    });
  } catch (e) {
    log('error', `Export to ${path} failed`, errorText(e));
    throw new Error(plainMessage(e, path));
  }
}

async function setAside(path: string, trashItem: Trash): Promise<void> {
  if (await hasRecycleBin(path)) {
    try {
      return await trashItem(path);
    } catch (e) {
      log('warn', `Recycle Bin refused ${path}; keeping it as a "replaced" copy`, errorText(e));
    }
  }
  await renameRetry(path, await replacedName(path));
}

async function replacedName(path: string): Promise<string> {
  const ext = extname(path);
  const base = path.slice(0, path.length - ext.length);
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}${p2(d.getMinutes())}`;
  for (let n = 1; ; n++) {
    const candidate = `${base} (replaced ${stamp}${n > 1 ? ` ${n}` : ''})${ext}`;
    if (!(await exists(candidate))) return candidate;
  }
}

// Drive type per volume letter, asked once. Anything but a fixed drive (or no answer) counts as no Recycle Bin.
const driveTypes = new Map<string, Promise<string | null>>();
function hasRecycleBin(path: string): Promise<boolean> {
  const letter = /^([a-z]):/i.exec(path)?.[1].toUpperCase();
  if (!letter) return Promise.resolve(false); // UNC path: a network share
  if (!driveTypes.has(letter)) {
    driveTypes.set(
      letter,
      new Promise((resolve) =>
        execFile(
          'powershell',
          ['-NoProfile', '-Command', `(Get-Volume -DriveLetter ${letter}).DriveType`],
          { windowsHide: true, timeout: 20_000 },
          (err, stdout) => resolve(err ? null : stdout.trim()),
        ),
      ),
    );
  }
  return driveTypes.get(letter)!.then((t) => t === 'Fixed');
}

const exists = (path: string) => stat(path).then(() => true, () => false);

function plainMessage(e: unknown, path: string): string {
  const name = path.split(/[\\/]/).pop();
  switch ((e as NodeJS.ErrnoException)?.code) {
    case 'ENOSPC':
      return `Couldn't save ${name}: the disk is full.`;
    case 'EBUSY':
    case 'EPERM':
    case 'EACCES':
      return `Couldn't save ${name}: it's open in another program, or the folder is read-only.`;
    case 'ENOENT':
      return `Couldn't save ${name}: the folder no longer exists.`;
    default:
      return `Couldn't save ${name}. Details are in the log.`;
  }
}
