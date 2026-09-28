// Builds the Library index with readdir and stat (spec §6.1, §6.2). The only contents ever read are
// doc JSON ids (cached by stamp, so a file is read again only after it changes) and .collection.json.
import type { Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative, sep } from 'node:path';
import type { Collection, DocKind, ItemKind, LibraryIndex, LibraryItemRef } from '../../shared/types.ts';
import { DOC_SUFFIX, IMAGE_EXTS, PALETTE_IMPORT_EXTS } from '../../shared/types.ts';
import { isMissing } from '../fsx.ts';
import { sameStamp } from './files.ts';

export const SCRATCH = 'Scratch';
export const COLLECTION_FILE = '.collection.json';

/** doc JSON ids by absolute path, valid while the file's stamp is unchanged */
export type IdCache = Map<string, { mtimeMs: number; size: number; id: string | null }>;

export type ScanOptions = {
  /** a collection to reuse instead of rescanning it */
  keep?: (name: string) => Collection | undefined;
  /** id → path of the file that held it last scan, so a copy never takes an id from its original */
  holders?: Map<string, string>;
};

export const isPaletteExt = (ext: string): ext is (typeof PALETTE_IMPORT_EXTS)[number] => (PALETTE_IMPORT_EXTS as readonly string[]).includes(ext);
export const isImageExt = (ext: string) => (IMAGE_EXTS as readonly string[]).includes(ext);
export const isScratch = (name: string) => name.toLowerCase() === SCRATCH.toLowerCase();

/** dotfiles (our temp files, .collection.json, .git) and Explorer's own: never shown or counted */
export const isHidden = (name: string) => name.startsWith('.') || /^(desktop\.ini|thumbs\.db)$/i.test(name);

/** the id of items without one of their own: images, SVGs, and JSON with no id (or a duplicate one) */
export const pathId = (root: string, path: string) => `path:${relative(root, path).split(sep).join('/')}`;

export const parseJson = (text: string): unknown => JSON.parse(text.replace(/^\uFEFF/, ''));

const collate = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
const byName = (a: { name: string }, b: { name: string }) => collate(a.name, b.name);
const stem = (file: string) => file.slice(0, file.length - extname(file).length);

/** kind, display name and extension from a file name; null for files the Library doesn't show */
function classify(file: string): { kind: ItemKind; name: string; ext: string } | null {
  const lower = file.toLowerCase();
  for (const kind of Object.keys(DOC_SUFFIX) as DocKind[]) {
    const suffix = DOC_SUFFIX[kind];
    if (lower.endsWith(suffix)) return { kind, name: file.slice(0, -suffix.length), ext: 'json' };
  }
  const ext = extname(lower).slice(1);
  if (ext === 'svg') return { kind: 'svg', name: stem(file), ext };
  if (isImageExt(ext)) return { kind: 'image', name: stem(file), ext };
  return null;
}

/** The whole index: collections are the root's folders, the root's own files are collection ''. */
export async function scanLibrary(root: string, cache: IdCache, { keep, holders }: ScanOptions = {}): Promise<LibraryIndex> {
  let names: string[];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory() && !isHidden(e.name)).map((e) => e.name).sort(collate);
  } catch (e) {
    return { root, ok: false, error: isMissing(e) ? 'The Library folder is missing.' : (e as Error).message, collections: [] };
  }
  // a collection that vanished or can't be read since the listing is left out
  const scanned = await Promise.all(['', ...names].map((n) => keep?.(n) ?? scanCollection(root, n, cache).catch(() => null)));
  return { root, ok: true, collections: await assignIds(root, scanned.filter((c) => c !== null), cache, holders) };
}

async function scanCollection(root: string, name: string, cache: IdCache): Promise<Collection> {
  const dir = join(root, name);
  const entries = await readdir(dir, { withFileTypes: true });
  const locked = name !== '' && !isScratch(name) && (await readLocked(join(dir, COLLECTION_FILE)));
  const col: Collection = { name, locked, items: [], notImported: [], ignored: 0 };
  const files: { kind: ItemKind; name: string; ext: string; path: string }[] = [];
  for (const e of entries) {
    if (isHidden(e.name)) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) {
      if (name !== '') col.ignored++; // at the root, folders are the collections
      continue;
    }
    const c = classify(e.name);
    if (c) files.push({ ...c, path });
    else if (isPaletteExt(extname(e.name).slice(1).toLowerCase())) col.notImported.push({ name: e.name, path });
    else col.ignored++;
  }
  const refs = await Promise.all(files.map((f) => itemRef(root, col, f, cache)));
  col.items = refs.filter((r) => r !== null).sort(byName);
  // "foo.ase" beside "foo.palette.json" counts as imported (import names the palette after the file)
  const palettes = new Set(col.items.filter((i) => i.kind === 'palette').map((i) => i.name.toLowerCase()));
  col.notImported = col.notImported.filter((f) => !palettes.has(stem(f.name).toLowerCase())).sort(byName);
  return col;
}

async function itemRef(
  root: string,
  col: Collection,
  f: { kind: ItemKind; name: string; ext: string; path: string },
  cache: IdCache,
): Promise<LibraryItemRef | null> {
  const st = await stat(f.path).catch(() => null);
  if (!st?.isFile()) return null; // gone since the listing
  if (f.kind !== 'image' && f.kind !== 'svg') await readId(f.path, st, cache);
  return {
    id: pathId(root, f.path), // until assignIds gives a doc its own
    kind: f.kind,
    name: f.name,
    collection: col.name,
    locked: col.locked,
    path: f.path,
    ext: f.ext,
    mtimeMs: st.mtimeMs,
    size: st.size,
  };
}

/** the doc's own id into the cache, unless it's cached at this stamp already */
async function readId(path: string, st: Stats, cache: IdCache): Promise<void> {
  if (sameStamp(cache.get(path), st)) return;
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return; // busy or gone: the last id read, if any, until the next scan
  }
  let id: string | null = null;
  try {
    const v = parseJson(text) as { id?: unknown } | null;
    // "path:" ids are computed, never stored; one found in a file is ignored
    if (typeof v?.id === 'string' && v.id && !v.id.startsWith('path:')) id = v.id;
  } catch {
    // Not JSON. Most likely a sync or an editor half way through its save: the file keeps the id it
    // had, so an open document reads CHANGED ON DISK rather than gone (spec §7.3). A file never
    // read before is identified by its path.
    id = cache.get(path)?.id ?? null;
  }
  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, id });
}

async function readLocked(file: string): Promise<boolean> {
  try {
    return (parseJson(await readFile(file, 'utf8')) as { locked?: unknown } | null)?.locked === true;
  } catch {
    return false;
  }
}

/**
 * Ids go on last, over the whole index: a doc gets the id inside it, everything else its path. Two
 * files with one id (an Explorer copy, a sync conflict) leave it with the file that held it before,
 * else the older one (a copy is created later), and the other is identified by its path.
 */
async function assignIds(
  root: string,
  collections: Collection[],
  cache: IdCache,
  holders = new Map<string, string>(),
): Promise<Collection[]> {
  const own = (i: LibraryItemRef) => (i.kind === 'image' || i.kind === 'svg' ? null : (cache.get(i.path)?.id ?? null));
  const claims = new Map<string, LibraryItemRef[]>();
  for (const i of collections.flatMap((c) => c.items)) {
    const id = own(i);
    if (id) claims.set(id, [...(claims.get(id) ?? []), i]);
  }
  const keepers = new Map<string, LibraryItemRef>();
  for (const [id, refs] of claims) keepers.set(id, refs.length === 1 ? refs[0] : await keeper(refs, holders.get(id)));
  return collections.map((c) => ({
    ...c,
    items: c.items.map((i) => {
      const id = own(i);
      return { ...i, id: id && keepers.get(id) === i ? id : pathId(root, i.path) };
    }),
  }));
}

async function keeper(refs: LibraryItemRef[], held: string | undefined): Promise<LibraryItemRef> {
  const holder = held && refs.find((r) => r.path.toLowerCase() === held.toLowerCase());
  if (holder) return holder;
  const born = await Promise.all(refs.map((r) => stat(r.path).then((s) => s.birthtimeMs, () => Infinity)));
  return refs[born.indexOf(Math.min(...born))];
}
