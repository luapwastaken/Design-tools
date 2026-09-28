import type { Collection, LibraryItemRef, Theme } from '../../../shared/types.ts';
import { toast } from '../../ui/index.ts';
import { errorText, reportError } from './errors.ts';
import { ipc } from './ipc.ts';
import { SCRATCH } from './ownership.ts';
import { follow, reconcile, refreshAll } from './persist.ts';
import { collectionLabel, importSummary, KIND_WORD } from './routing.ts';
import { docRuntimes, missing } from './runtime.ts';
import { runBusy } from './send.ts';
import { getState, setState } from './store.ts';

// Library operations (spec §6.3). Views confirm Delete and Move with ConfirmInline first; these run
// after. Rename, duplicate, lock and unlock are undone by doing them again, so they show no toast.

/** deletes waiting for their Undo toast to close: item id -> send it to the Recycle Bin now */
const pendingTrash = new Map<string, () => Promise<void>>();

async function attempt<T>(what: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    toast.show({ kind: 'error', message: `${what}: ${errorText(e)}` });
    return undefined;
  }
}

export async function deleteItem(ref: LibraryItemRef): Promise<void> {
  try {
    await ipc.invoke('library.hide', ref.id);
  } catch (e) {
    toast.show({ kind: 'error', message: `Couldn't delete ${ref.name}: ${errorText(e)}` });
    return;
  }
  // a tool that has it open keeps it, detached (brief §6: "it stays open there, detached")
  missing.add(ref.id);
  refreshAll();
  let done = false;
  const trash = async () => {
    if (done) return;
    done = true;
    pendingTrash.delete(ref.id);
    await ipc.invoke('library.trash', ref.id).catch((e) => reportError(`Couldn't move ${ref.name} to the Recycle Bin`, e));
  };
  const toastId = toast.show({
    icon: 'delete',
    message: `Deleted ${KIND_WORD[ref.kind]} “${ref.name}”`,
    undo: async () => {
      done = true;
      pendingTrash.delete(ref.id);
      await ipc.invoke('library.unhide', ref.id);
      missing.delete(ref.id);
      refreshAll();
    },
    onClose: (why) => void (why === 'undo' ? undefined : trash()),
  });
  pendingTrash.set(ref.id, async () => {
    const trashed = trash();
    toast.dismiss(toastId); // its Undo can't bring a trashed file back
    await trashed;
  });
}

/** quitting: every delete still showing its Undo toast goes to the Recycle Bin now (spec §6.3) */
export async function trashPending(): Promise<void> {
  await Promise.all([...pendingTrash.values()].map((trash) => trash()));
}

export async function moveItem(ref: LibraryItemRef, collection: string): Promise<void> {
  const moved = await attempt(`Couldn't move ${ref.name}`, () => ipc.invoke('library.move', ref.id, collection));
  if (!moved) return;
  follow(ref.id, moved);
  toast.show({
    icon: 'drive_file_move',
    message: `Moved ${KIND_WORD[ref.kind]} “${ref.name}” to ${collectionLabel(moved.collection)}`,
    undo: async () => follow(moved.id, await ipc.invoke('library.move', moved.id, ref.collection)),
  });
}

export async function renameItem(ref: LibraryItemRef, name: string): Promise<void> {
  const next = await attempt(`Couldn't rename ${ref.name}`, () => ipc.invoke('library.rename', ref.id, name));
  if (next) follow(ref.id, next);
}

export async function duplicateItem(ref: LibraryItemRef): Promise<void> {
  await attempt(`Couldn't duplicate ${ref.name}`, () => ipc.invoke('library.duplicate', ref.id));
}

export async function revealItem(ref: LibraryItemRef): Promise<void> {
  await attempt(`Couldn't show ${ref.name}`, () => ipc.invoke('library.reveal', ref.id));
}

export async function importFiles(paths: string[], collection: string): Promise<void> {
  const result = await runBusy(() => attempt("Couldn't import", () => ipc.invoke('library.import', paths, collection)));
  if (!result) return;
  const { made, failed } = importSummary(result, collection);
  if (made) toast.show({ icon: 'download', message: made });
  if (failed) toast.show({ kind: 'error', message: failed });
}

/**
 * OS files a tool declined (drop or paste) go into Scratch (spec §9). Files with a path are
 * imported; a pasted bitmap has none, so its bytes become an image item.
 */
export async function offerToLibrary(files: File[]): Promise<void> {
  const paths = files.map((f) => ipc.pathForFile(f)).filter(Boolean);
  if (paths.length) await importFiles(paths, SCRATCH);
  for (const f of files.filter((f) => !ipc.pathForFile(f))) {
    const ext = /^image\/(png|jpeg|webp|gif|bmp|avif)$/.exec(f.type)?.[1]?.replace('jpeg', 'jpg');
    if (!ext) continue;
    const ref = await attempt("Couldn't add the pasted image", async () => ipc.invoke('library.createImage', SCRATCH, 'Pasted image', ext, await f.arrayBuffer()));
    if (ref) toast.show({ icon: 'download', message: `Added ${ref.name} to ${SCRATCH}.` });
  }
}

export async function createCollection(name: string): Promise<void> {
  const c = await attempt(`Couldn't make "${name}"`, () => ipc.invoke('collection.create', name));
  if (c) patchCollection(c);
}

export async function renameCollection(name: string, newName: string): Promise<void> {
  const before = getState().library?.collections.find((x) => x.name === name)?.items ?? [];
  const c = await attempt(`Couldn't rename ${name}`, () => ipc.invoke('collection.rename', name, newName));
  if (!c) return;
  // every tool's link follows the folder. Items known by their path (images, SVGs, docs with no id
  // inside yet) get new ids, so they are matched to their old ones by file name.
  const oldId = new Map(before.map((i) => [fileName(i.path), i.id]));
  for (const item of c.items) follow(oldId.get(fileName(item.path)) ?? item.id, item);
}

const fileName = (path: string) => path.split(/[\\/]/).pop()!.toLowerCase();

/** Locking detaches any of its items that are open; the next edit forks (spec §7.3). */
export async function setCollectionLocked(name: string, locked: boolean): Promise<void> {
  const c = await attempt(`Couldn't ${locked ? 'lock' : 'unlock'} ${name}`, () => ipc.invoke('collection.setLocked', name, locked));
  if (c) patchCollection(c);
}

/** apply a collection an operation returned now, rather than on the index event a moment later */
function patchCollection(c: Collection): void {
  const lib = getState().library;
  if (!lib) return;
  const known = lib.collections.some((x) => x.name === c.name);
  setState({ library: { ...lib, collections: known ? lib.collections.map((x) => (x.name === c.name ? c : x)) : [...lib.collections, c] } });
  refreshAll();
}

/** Settings: point at another folder, moving nothing. Documents from the old folder are detached (spec §4). */
export async function chooseLibraryRoot(): Promise<void> {
  const settings = await attempt("Couldn't change the Library folder", () => ipc.invoke('library.chooseRoot'));
  if (!settings) return;
  for (const r of docRuntimes()) {
    const src = r.doc.source();
    if (src) missing.add(src.itemId);
  }
  setState({ settings });
  const index = await ipc.invoke('library.index').catch(() => null);
  if (index) setState({ library: index });
  refreshAll();
  reconcile();
}

export async function setTheme(theme: Theme): Promise<void> {
  const before = getState().settings;
  document.documentElement.dataset.theme = theme;
  if (before) setState({ settings: { ...before, theme } });
  const saved = await attempt("Couldn't change the theme", () => ipc.invoke('settings.set', { theme }));
  const now = saved ?? before;
  if (now) {
    document.documentElement.dataset.theme = now.theme;
    setState({ settings: now });
  }
}
