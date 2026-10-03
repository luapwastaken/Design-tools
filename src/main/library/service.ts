// LibraryService (spec §6.2, §6.3): the one owner of every Library read and write. Pure Node: the
// Electron parts come in through `platform`, so it runs under node --test.
import { randomUUID } from 'node:crypto';
import { type FSWatcher, watch } from 'node:fs';
import { copyFile, mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import type {
  Collection,
  DocPayload,
  FileStamp,
  ImportResult,
  LibraryIndex,
  LibraryItemRef,
  LoadedItem,
  WriteResult,
} from '../../shared/types.ts';
import { DOC_SUFFIX } from '../../shared/types.ts';
import { isMissing, renameRetry } from '../fsx.ts';
import { atomically, plainError, sameStamp, stampOf } from './files.ts';
import { safeName, uniqueName } from './names.ts';
import {
  COLLECTION_FILE,
  type IdCache,
  isHidden,
  isImageExt,
  isPaletteExt,
  isScratch,
  parseJson,
  SCRATCH,
  scanLibrary,
} from './scan.ts';

export type Platform = {
  /** to the Recycle Bin (Electron: shell.trashItem) */
  trashItem(path: string): Promise<void>;
  now(): number;
  /** Node's own text of a failed file operation (callers get a plain sentence) */
  log?(message: string, details: string): void;
  /** how often to look at the Library folder itself; default 2s */
  rootPollMs?: number;
  /** something Luap should hear (a toast): the watcher gave up */
  notice?(message: string): void;
};

const WATCH_DEBOUNCE_MS = 250;
const EMIT_DEBOUNCE_MS = 100;
/** a watcher that dies again this soon waits for the next rescanAll (window focus) to restart */
const WATCH_RETRY_MS = 5000;
/** queue key for operations that pick names or change folders (item ids are never empty) */
const STRUCTURE = '';
/** Windows' watcher reports nothing when the Library folder itself is renamed, deleted or put back */
const ROOT_POLL_MS = 2000;
const FOLDER_MISSING = 'The Library folder is missing.';

const unscanned = (root: string): LibraryIndex => ({ root, ok: false, error: 'Not scanned yet.', collections: [] });

/** `root/name`, made if needed; refuses when `root` itself is gone */
async function mkdirIn(root: string, name: string): Promise<string> {
  const dir = join(root, name);
  try {
    await mkdir(dir);
  } catch (e) {
    if (isMissing(e)) throw new Error(FOLDER_MISSING);
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  return dir;
}

/** ".palette.json", ".png": everything after the display name */
const suffixOf = (ref: LibraryItemRef) => basename(ref.path).slice(ref.name.length);

export class LibraryService {
  private root: string;
  private readonly platform: Platform;
  private readonly onChange: (index: LibraryIndex) => void;

  /** everything scanned, hidden items included; `visible()` is what callers see */
  private state: LibraryIndex;
  private readonly cache: IdCache = new Map();
  private readonly hidden = new Set<string>();
  /**
   * old id → current id, for ids our own operations changed (a rename or move of an item known by
   * its path, a collection rename, the first save of a doc with no id), so callers' ids keep working
   */
  private readonly aliases = new Map<string, string>();
  /** lowercased path → stamp of our own last write there, so the watcher ignores it landing */
  private readonly own = new Map<string, FileStamp>();
  private readonly queues = new Map<string, Promise<void>>();
  /** item operations called during a collection rename wait for it: their paths are about to change */
  private gate: Promise<void> = Promise.resolve();
  /** scans and in-memory patches, one at a time */
  private scans: Promise<void> = Promise.resolve();
  private loaded: Promise<void> | null = null;

  private started = false;
  private watcher: FSWatcher | null = null;
  private lastWatchError = -Infinity;
  private pending: Set<string> | 'all' | null = null;
  private rescanTimer: ReturnType<typeof setTimeout> | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private rootPoll: ReturnType<typeof setInterval> | null = null;
  /** the Library folder's identity (dev:ino) at the last look, null when it wasn't there */
  private rootId: string | null = null;

  constructor(root: string, platform: Platform, onChange: (index: LibraryIndex) => void) {
    this.root = root;
    this.platform = platform;
    this.onChange = onChange;
    this.state = unscanned(root);
  }

  // ── lifecycle ──

  async start(): Promise<void> {
    this.started = true;
    await this.ready();
    this.watch();
    this.rootId = await this.rootIdentity();
    this.rootPoll ??= setInterval(() => void this.checkRoot(), this.platform.rootPollMs ?? ROOT_POLL_MS);
    this.rootPoll.unref?.();
  }

  stop(): void {
    this.started = false;
    this.unwatch();
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
    if (this.rootPoll) clearInterval(this.rootPoll);
    this.rootPoll = null;
  }

  async setRoot(root: string): Promise<void> {
    this.unwatch();
    this.loaded = this.serial(() => {
      this.root = root;
      this.state = unscanned(root);
      this.cache.clear();
      this.hidden.clear();
      this.aliases.clear();
      this.own.clear();
    }).then(() => this.load());
    await this.loaded;
    if (this.started) this.watch();
  }

  /** everything from scratch, and a fresh watcher (window focus, watcher errors) */
  async rescanAll(): Promise<void> {
    this.unwatch();
    await this.refresh();
    if (this.started) this.watch();
  }

  // ── items ──

  async index(): Promise<LibraryIndex> {
    await this.ready();
    return this.visible();
  }

  pathOf(id: string): string | null {
    return this.find(id)?.path ?? null;
  }

  read(id: string): Promise<LoadedItem> {
    return this.op(id, async () => {
      const ref = this.require(id);
      if (ref.kind === 'image' || ref.kind === 'svg') {
        return { ref, kind: ref.kind, url: `dt://item/${encodeURIComponent(ref.id)}` };
      }
      const fh = await open(ref.path, 'r');
      try {
        const { mtimeMs, size } = await fh.stat();
        const text = await fh.readFile('utf8');
        let data: unknown = null;
        try {
          data = parseJson(text);
        } catch {
          // said as the shell says it of a file of the wrong shape (routing.ts itemProblem)
        }
        if (!data || typeof data !== 'object') throw new Error(`${ref.name} isn't a readable ${ref.kind}.`);
        // the file's name decides the kind, and the index decides the id (a copy's id is its path)
        const payload = { ...data, kind: ref.kind, id: ref.id };
        return { ref: { ...ref, mtimeMs, size }, kind: ref.kind, payload } as LoadedItem;
      } finally {
        await fh.close();
      }
    });
  }

  stat(id: string): Promise<FileStamp | null> {
    return this.op(id, async () => {
      const ref = this.find(id);
      return ref ? stampOf(ref.path) : null;
    });
  }

  /**
   * Refuses if the file isn't at `expected` (null: don't check) or is gone. A doc known by its path
   * gets an id of its own on its first write, returned in `ref.id`; only that emits a change.
   */
  write(id: string, payload: DocPayload, expected: FileStamp | null): Promise<WriteResult> {
    return this.op(id, async (): Promise<WriteResult> => {
      const ref = this.find(id);
      if (!ref) return this.gone();
      if (ref.kind !== payload.kind) return { ok: false, reason: 'error', message: `${ref.name} isn't a ${payload.kind}.` };
      try {
        const current = await stampOf(ref.path);
        if (!current) return this.gone();
        if (expected && !sameStamp(current, expected)) return { ok: false, reason: 'changed-outside', stamp: current };
        const own = ref.id.startsWith('path:') ? randomUUID() : ref.id;
        const stamp = await this.writeDoc(ref.path, { ...payload, id: own });
        const next = { ...ref, id: own, ...stamp };
        this.rekey(ref.id, own);
        await this.patch(next);
        if (own !== ref.id) this.emit();
        return { ok: true, ref: next, stamp };
      } catch (e) {
        return { ok: false, reason: 'error', message: this.plain(e) };
      }
    });
  }

  /**
   * The item's file is gone. With the whole Library folder gone (renamed, a drive unplugged) that
   * isn't the item's doing: the write fails and can be tried again once the folder is back, rather
   * than the edit forking a copy (spec §7.3 "missing" is for the item alone).
   */
  private async gone(): Promise<WriteResult> {
    if (await this.rootIdentity()) return { ok: false, reason: 'missing' };
    void this.checkRoot();
    return { ok: false, reason: 'error', message: FOLDER_MISSING };
  }

  create(collection: string, name: string, payload: DocPayload): Promise<{ ref: LibraryItemRef; stamp: FileStamp }> {
    return this.op(STRUCTURE, async () => {
      const dir = await this.ensureDir(collection);
      const suffix = DOC_SUFFIX[payload.kind];
      const path = join(dir, (await uniqueName(dir, safeName(name), suffix)) + suffix);
      const stamp = await this.writeDoc(path, { ...payload, id: this.freshId(payload.id) });
      return { ref: await this.settle(path, [collection]), stamp };
    });
  }

  createImage(collection: string, name: string, ext: string, bytes: ArrayBuffer): Promise<LibraryItemRef> {
    return this.op(STRUCTURE, async () => {
      const e = ext.toLowerCase().replace(/^\./, '');
      if (e !== 'svg' && !isImageExt(e)) throw new Error(`.${e} isn't an image type the Library keeps.`);
      const dir = await this.ensureDir(collection);
      const path = join(dir, `${await uniqueName(dir, safeName(name), `.${e}`)}.${e}`);
      await atomically(path, (tmp) => writeFile(tmp, new Uint8Array(bytes), { flush: true }));
      return this.settle(path, [collection]);
    });
  }

  rename(id: string, name: string): Promise<LibraryItemRef> {
    return this.op(id, () =>
      this.op(STRUCTURE, async () => {
        const ref = this.require(id);
        const suffix = suffixOf(ref);
        // "fx shot.png" typed for an image is its name, not "fx shot.png.png"
        const typed = name.trim();
        const base = safeName(typed.toLowerCase().endsWith(suffix.toLowerCase()) ? typed.slice(0, -suffix.length) : typed);
        if (base === ref.name) return ref;
        const dir = dirname(ref.path);
        // a change of case only collides with the item itself
        const next = base.toLowerCase() === ref.name.toLowerCase() ? base : await uniqueName(dir, base, suffix);
        return this.relocate(ref, join(dir, next + suffix), [ref.collection]);
      }),
    );
  }

  move(id: string, collection: string): Promise<LibraryItemRef> {
    return this.op(id, () =>
      this.op(STRUCTURE, async () => {
        const ref = this.require(id);
        if (ref.collection.toLowerCase() === collection.toLowerCase()) return ref;
        const dir = await this.ensureDir(collection);
        const suffix = suffixOf(ref);
        const path = join(dir, (await uniqueName(dir, ref.name, suffix)) + suffix);
        return this.relocate(ref, path, [ref.collection, collection]);
      }),
    );
  }

  duplicate(id: string): Promise<LibraryItemRef> {
    return this.op(id, () =>
      this.op(STRUCTURE, async () => {
        const ref = this.require(id);
        const dir = dirname(ref.path);
        const suffix = suffixOf(ref);
        const path = join(dir, (await uniqueName(dir, `${ref.name} copy`, suffix)) + suffix);
        if (ref.kind === 'image' || ref.kind === 'svg') {
          await atomically(path, (tmp) => copyFile(ref.path, tmp));
        } else {
          const data = parseJson(await readFile(ref.path, 'utf8')) as DocPayload;
          await this.writeDoc(path, { ...data, kind: ref.kind, id: randomUUID() } as DocPayload);
        }
        return this.settle(path, [ref.collection]);
      }),
    );
  }

  /** pending delete: out of `index()` until unhide or trash */
  async hide(id: string): Promise<void> {
    await this.ready();
    this.hidden.add(this.current(id));
    this.emit();
  }

  async unhide(id: string): Promise<void> {
    await this.ready();
    if (this.hidden.delete(this.current(id))) this.emit();
  }

  trash(id: string): Promise<void> {
    return this.op(id, async () => {
      const ref = this.find(id);
      try {
        if (ref) await this.platform.trashItem(ref.path);
      } finally {
        // gone, or back in view if the Recycle Bin refused it
        this.hidden.delete(ref?.id ?? id);
        this.emit();
        await this.refresh(ref ? [ref.collection] : []);
      }
    });
  }

  /** .ase/.aco/.gpl become palettes, images and SVGs are copied; each file is made or says why not */
  import(paths: string[], collection: string): Promise<ImportResult> {
    return this.op(STRUCTURE, async () => {
      const dir = await this.ensureDir(collection);
      const made: { path: string; warnings: string[] }[] = [];
      const failed: ImportResult['failed'] = [];
      for (const src of paths) {
        try {
          made.push(await this.importOne(src, dir));
        } catch (e) {
          failed.push({ name: basename(src), reason: isMissing(e) ? "The file isn't there any more." : this.plain(e) });
        }
      }
      await this.refresh([collection]);
      const refs = made.map((m) => this.at(m.path));
      const warnings = made.flatMap((m, i) => (m.warnings.length ? [{ name: refs[i].name, messages: m.warnings }] : []));
      return { made: refs, failed, warnings };
    });
  }

  // ── collections ──

  collectionCreate(name: string): Promise<Collection> {
    return this.op(STRUCTURE, async () => {
      await this.ensureDir(''); // the root is there, with Scratch
      const real = await uniqueName(this.root, safeName(name), '');
      await mkdir(join(this.root, real));
      await this.refresh([real]);
      return this.collection(real);
    });
  }

  async collectionRename(name: string, newName: string): Promise<Collection> {
    if (name === '' || isScratch(name)) throw new Error(`${name ? 'Scratch' : 'The Library root'} can't be renamed.`);
    // item operations already called land first; ones called from now on wait for the new paths
    const done = this.settled().then(() =>
      this.op(STRUCTURE, async () => {
        const real = this.known(name);
        const base = safeName(newName);
        if (base === real) return this.collection(real);
        const next = base.toLowerCase() === real.toLowerCase() ? base : await uniqueName(this.root, base, '');
        const from = join(this.root, real);
        const to = join(this.root, next);
        const moved = this.folder(real)!.items;
        await renameRetry(from, to);
        this.moveCache(from, to);
        await this.refresh([real, next]);
        for (const ref of moved) this.followed(ref, join(to, basename(ref.path)));
        return this.collection(next);
      }),
    );
    this.gate = Promise.allSettled([this.gate, done]).then(() => {});
    return done;
  }

  async collectionSetLocked(name: string, locked: boolean): Promise<Collection> {
    if (name === '') throw new Error("The Library root can't be locked.");
    if (locked && isScratch(name)) throw new Error("Scratch can't be locked.");
    return this.op(STRUCTURE, async () => {
      const real = this.known(name);
      const file = join(this.root, real, COLLECTION_FILE);
      if (locked) await atomically(file, (tmp) => writeFile(tmp, '{ "locked": true }\n'));
      else await rm(file, { force: true });
      await this.refresh([real]);
      return this.collection(real);
    });
  }

  // ── internals ──

  private ready(): Promise<void> {
    return (this.loaded ??= this.load());
  }

  /**
   * The first scan of a root. Scratch always exists (spec §6), so a root without one (a folder
   * Luap just pointed the app at) gets it; a missing root makes mkdir fail and is never recreated.
   */
  private async load(): Promise<void> {
    await mkdir(join(this.root, SCRATCH)).catch(() => {});
    await this.refresh();
  }

  /**
   * `fn` once everything queued under `key` has settled: one queue per item, one for structure. A
   * failure reaches the caller as a plain sentence; Node's own text goes to the log.
   */
  private op<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const key = this.current(id); // an old id queues with the new one
    const gate = key === STRUCTURE ? null : this.gate;
    const next = (this.queues.get(key) ?? Promise.resolve()).then(async () => {
      await gate;
      await this.ready();
      try {
        return await fn();
      } catch (e) {
        const message = this.plain(e);
        throw e instanceof Error && message === e.message ? e : new Error(message);
      }
    });
    const tail = next.then(
      () => {},
      () => {},
    );
    this.queues.set(key, tail);
    void tail.then(() => this.queues.get(key) === tail && this.queues.delete(key));
    return next;
  }

  /** every item operation queued so far */
  private async settled(): Promise<void> {
    await Promise.all([...this.queues].filter(([key]) => key !== STRUCTURE).map(([, tail]) => tail));
  }

  /** a plain sentence for `e`, logging Node's own text */
  private plain(e: unknown): string {
    const { message, raw } = plainError(e);
    if (raw) this.platform.log?.(`Library: ${message}`, raw);
    return message;
  }

  private serial(fn: () => unknown): Promise<void> {
    const p = this.scans.then(fn).then(() => {});
    this.scans = p.catch(() => {});
    return p;
  }

  /** Rescan everything, or only these collections, and emit if what `index()` shows changed. */
  private refresh(collections?: string[]): Promise<void> {
    return this.serial(async () => {
      const before = JSON.stringify(this.visible());
      const only = collections && new Set(collections.map((c) => c.toLowerCase()));
      const prev = new Map(this.state.collections.map((c) => [c.name, c]));
      const keep = only && ((name: string) => (only.has(name.toLowerCase()) ? undefined : prev.get(name)));
      const holders = new Map(this.items().filter((i) => !i.id.startsWith('path:')).map((i) => [i.id, i.path]));
      this.state = await scanLibrary(this.root, this.cache, { keep, holders });
      if (JSON.stringify(this.visible()) !== before) this.emit();
    });
  }

  /** swap in a ref our own write changed: no rescan, no emit */
  private patch(ref: LibraryItemRef): Promise<void> {
    return this.serial(() => {
      for (const c of this.state.collections) c.items = c.items.map((i) => (i.path === ref.path ? ref : i));
    });
  }

  private emit(): void {
    this.emitTimer ??= setTimeout(() => {
      this.emitTimer = null;
      this.onChange(this.visible());
    }, EMIT_DEBOUNCE_MS);
  }

  private visible(): LibraryIndex {
    const collections = this.state.collections
      .map((c) => ({ ...c, items: c.items.filter((i) => !this.hidden.has(i.id)) }))
      .filter((c) => c.name !== '' || c.items.length + c.notImported.length + c.ignored > 0);
    return { ...this.state, collections };
  }

  private items(): LibraryItemRef[] {
    return this.state.collections.flatMap((c) => c.items);
  }

  private find(id: string): LibraryItemRef | undefined {
    const items = this.items();
    const now = this.aliases.get(id);
    return items.find((i) => i.id === id) ?? (now === undefined ? undefined : items.find((i) => i.id === now));
  }

  /** the id `id` goes by now */
  private current(id: string): string {
    return this.find(id)?.id ?? id;
  }

  /** `from` is now called `to`: old ids keep resolving, and a pending delete stays pending */
  private rekey(from: string, to: string): void {
    if (from === to) return;
    for (const [old, now] of this.aliases) if (now === from) this.aliases.set(old, to);
    this.aliases.set(from, to);
    this.aliases.delete(to);
    if (this.hidden.delete(from)) this.hidden.add(to);
  }

  /** after our own rename of `ref`'s file to `path`: its id follows if it was the path */
  private followed(ref: LibraryItemRef, path: string): void {
    const p = path.toLowerCase();
    const now = this.items().find((i) => i.path.toLowerCase() === p);
    if (now) this.rekey(ref.id, now.id);
  }

  private require(id: string): LibraryItemRef {
    const ref = this.find(id);
    if (!ref) throw new Error('That item is no longer in the Library.');
    return ref;
  }

  /** the ref now at `path` (after a refresh) */
  private at(path: string): LibraryItemRef {
    const p = path.toLowerCase();
    const ref = this.items().find((i) => i.path.toLowerCase() === p);
    if (!ref) throw new Error(`${basename(path)} didn't show up in the Library.`);
    return ref;
  }

  private async settle(path: string, collections: string[]): Promise<LibraryItemRef> {
    await this.refresh(collections);
    return this.at(path);
  }

  /** an existing collection's name as it is on disk */
  private known(name: string): string {
    const c = this.folder(name);
    if (!c) throw new Error(`There's no collection called "${name}".`);
    return c.name;
  }

  private folder(name: string): Collection | undefined {
    return this.state.collections.find((c) => c.name !== '' && c.name.toLowerCase() === name.toLowerCase());
  }

  private collection(name: string): Collection {
    const c = this.visible().collections.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (!c) throw new Error(`There's no collection called "${name}".`);
    return c;
  }

  /**
   * The collection's folder, created if needed, and Scratch with it (Scratch always exists). A
   * missing Library folder is never recreated: the Library offers "Choose folder" for that.
   */
  private async ensureDir(collection: string): Promise<string> {
    await mkdirIn(this.root, SCRATCH);
    if (collection === '') return this.root;
    const known = this.folder(collection);
    if (!known && safeName(collection) !== collection) throw new Error(`"${collection}" can't be a collection name.`);
    return mkdirIn(this.root, known?.name ?? collection);
  }

  /** the payload's own id, unless it's missing or taken (a fork, a copy) */
  private freshId(id: unknown): string {
    return typeof id === 'string' && id !== '' && !id.startsWith('path:') && !this.find(id) ? id : randomUUID();
  }

  private async writeDoc(path: string, payload: DocPayload): Promise<FileStamp> {
    const key = path.toLowerCase();
    await atomically(path, async (tmp) => {
      await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, { flush: true });
      // a rename keeps the stamp, so recording it now beats the watcher's report of the rename
      const pre = await stampOf(tmp);
      if (pre) this.own.set(key, pre);
    });
    const stamp = await stampOf(path);
    if (!stamp) throw new Error(`${basename(path)} vanished as it was written.`);
    this.own.set(key, stamp);
    this.cache.set(path, { ...stamp, id: payload.id });
    return stamp;
  }

  private async relocate(ref: LibraryItemRef, path: string, collections: string[]): Promise<LibraryItemRef> {
    await renameRetry(ref.path, path);
    this.moveCache(ref.path, path);
    const next = await this.settle(path, collections);
    this.rekey(ref.id, next.id);
    return next;
  }

  /** a rename keeps the file's stamp, so its cached id follows it and nothing is read again */
  private moveCache(from: string, to: string): void {
    for (const [path, hit] of [...this.cache]) {
      if (path !== from && !path.startsWith(from + sep)) continue;
      this.cache.delete(path);
      this.cache.set(to + path.slice(from.length), hit);
    }
  }

  /** one file into `dir`; returns the path it made, and what the palette reader had to say */
  private async importOne(src: string, dir: string): Promise<{ path: string; warnings: string[] }> {
    const ext = extname(src).slice(1).toLowerCase();
    const stem = basename(src, extname(src));
    if (isPaletteExt(ext)) {
      // Unit C's readers; imported lazily so the Library works without them
      const readers = await import('../../shared/color/palette-readers.ts').catch(() => null);
      if (!readers) throw new Error("Palette files can't be imported in this build.");
      const read = readers.readPaletteFile(ext, await readFile(src), stem);
      if (read.swatches.length === 0) throw new Error('No colours found in the file.');
      // from "Not imported" in this collection: named after the file, so it stops being listed
      const name = resolve(dirname(src)).toLowerCase() === dir.toLowerCase() ? stem : read.name;
      const suffix = DOC_SUFFIX.palette;
      const path = join(dir, (await uniqueName(dir, safeName(name), suffix)) + suffix);
      const notes = read.warnings.join('\n');
      await this.writeDoc(path, { kind: 'palette', id: randomUUID(), version: 1, swatches: read.swatches, notes });
      return { path, warnings: read.warnings };
    }
    if (ext === 'svg' || isImageExt(ext)) {
      const path = join(dir, `${await uniqueName(dir, safeName(stem), `.${ext}`)}.${ext}`);
      await atomically(path, (tmp) => copyFile(src, tmp));
      return { path, warnings: [] };
    }
    throw new Error(unsupported(ext));
  }

  // ── watching ──

  private async rootIdentity(): Promise<string | null> {
    const st = await stat(this.root).catch(() => null);
    return st?.isDirectory() ? `${st.dev}:${st.ino}` : null;
  }

  /**
   * fs.watch says nothing when the Library folder itself is renamed away, deleted and put back, or
   * swapped for another (checked on Windows), and window focus (rescanAll) may never come. So look
   * at it now and then, and rescan when it came, went or changed.
   */
  private async checkRoot(): Promise<void> {
    const now = await this.rootIdentity();
    const was = this.rootId;
    this.rootId = now;
    if ((now !== null) !== this.state.ok || (now !== null && was !== null && now !== was)) await this.rescanAll();
  }

  private watch(): void {
    if (this.watcher || !this.state.ok) return;
    try {
      this.watcher = watch(this.root, { recursive: true }, (event, file) => void this.hint(event, file));
      this.watcher.on('error', () => this.watchFailed());
    } catch {
      // the root went away since the scan; the next rescanAll tries again
    }
  }

  private unwatch(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.rescanTimer) clearTimeout(this.rescanTimer);
    this.rescanTimer = null;
    this.pending = null;
  }

  private watchFailed(): void {
    const now = this.platform.now();
    const restart = now - this.lastWatchError > WATCH_RETRY_MS;
    this.lastWatchError = now;
    this.platform.log?.(restart ? 'Library: the folder watcher failed and is restarting' : 'Library: the folder watcher failed again and stays off until the window is focused', '');
    if (restart) return void this.rescanAll();
    this.unwatch();
    this.platform.notice?.("The Library can't watch its folder for changes right now. It looks again when you come back to this window.");
    void this.refresh();
  }

  /** a watcher event: rescan the collection it names, unless it's our own write landing */
  private async hint(event: string, file: string | null): Promise<void> {
    if (!file) return this.schedule(null);
    const parts = file.split(/[\\/]/);
    const leaf = parts[parts.length - 1];
    if (parts.length > 2 || parts.slice(0, -1).some(isHidden) || (isHidden(leaf) && leaf !== COLLECTION_FILE)) return;
    if (parts.length === 1) {
      // a folder's "change" is its contents changing, and they have events of their own
      if (event === 'change' && this.folder(leaf)) return;
      return this.schedule(['', leaf]); // a root file, or a collection folder itself
    }
    const path = join(this.root, file);
    const stamp = await stampOf(path).catch(() => null);
    if (sameStamp(this.own.get(path.toLowerCase()), stamp)) return;
    this.schedule([parts[0]]);
  }

  private schedule(collections: string[] | null): void {
    if (!this.watcher) return; // stopped meanwhile
    if (!collections || this.pending === 'all') this.pending = 'all';
    else {
      const set = this.pending ?? new Set<string>();
      for (const c of collections) set.add(c);
      this.pending = set;
    }
    this.rescanTimer ??= setTimeout(() => {
      const pending = this.pending;
      this.pending = null;
      this.rescanTimer = null;
      void this.refresh(pending === 'all' || !pending ? undefined : [...pending]);
    }, WATCH_DEBOUNCE_MS);
  }
}

/** why a file can't be imported, in words (spec §10.3) */
function unsupported(ext: string): string {
  if (ext === 'psd') return "PSD files aren't supported. Export a PNG or TIFF.";
  const what = ext ? `${ext.toUpperCase()} files aren't supported.` : "It isn't a file the Library takes.";
  return `${what} The Library takes ASE, ACO and GPL palettes, images and SVGs.`;
}
