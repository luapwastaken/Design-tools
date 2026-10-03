// Exporting (spec §10.4). Main picks the place (the save dialog, remembering the folder per tool
// and type) and replaces reversibly. Here each export counts as running work for the quit check,
// and a failure becomes an error toast with main's plain message (main logs the details).
import type { Api } from '../../shared/api.ts';
import type { ToolId } from '../../shared/types.ts';
import { shell } from '../shell/core/index.ts';
import { errorText } from '../shell/core/errors.ts';
import { ipc } from '../shell/core/ipc.ts';
import { toast } from '../ui/index.ts';

type SaveReq = Parameters<Api['export.save']>[0];
type FolderReq = Parameters<Api['export.toFolder']>[0];

/** one file through the save dialog; its path, or null when cancelled or failed */
export const saveFile = (req: SaveReq): Promise<string | null> => run(() => ipc.invoke('export.save', req));

/** several files into one chosen folder, never a burst of dialogs; null when cancelled or failed */
export const saveToFolder = (req: FolderReq): Promise<{ folder: string; written: string[] } | null> => run(() => ipc.invoke('export.toFolder', req));

/**
 * One chosen folder for files made one at a time, so a long animation is never held whole: `fill`
 * writes each through `write`, and says whether it finished. The folder, or null when cancelled or
 * failed (the toast says why).
 */
export const intoFolder = (tool: ToolId, fill: (write: (name: string, data: ArrayBuffer | string) => Promise<string>) => Promise<boolean>): Promise<string | null> =>
  run(async () => {
    const got = await ipc.invoke('export.openFolder', tool);
    if (!got) return null;
    try {
      return (await fill((name, data) => ipc.invoke('export.intoFolder', got.id, name, data))) ? got.folder : null;
    } finally {
      await ipc.invoke('export.closeFolder', got.id);
    }
  });

let awake = 0;

/**
 * Runs `fn` with the window kept at full speed even if it is hidden or minimised meanwhile, which
 * Chromium would otherwise slow to a frame a second: a long export started in view finishes at the
 * speed it began. Exports overlap safely: it goes back to normal when the last one is done.
 */
export async function keepAwake<T>(fn: () => Promise<T>): Promise<T> {
  const set = (on: boolean) => ipc.invoke('window.keepAwake', on).catch(() => {}); // only speed is at stake
  if (!awake++) await set(true);
  try {
    return await fn();
  } finally {
    if (!--awake) await set(false);
  }
}

async function run<T>(fn: () => Promise<T | null>): Promise<T | null> {
  try {
    return await shell.runBusy(fn);
  } catch (e) {
    toast.show({ kind: 'error', message: errorText(e) });
    return null;
  }
}
