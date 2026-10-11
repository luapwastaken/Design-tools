import type { ChangeCause, DocSource, DocState } from '../../../shared/doc-api.ts';
import type { DocKind, FileStamp, LibraryIndex, LibraryItemRef, ToolId } from '../../../shared/types.ts';

// One owner per item, forking and "what does this change do on disk" (spec §7.1, §7.3). Pure, so
// it is unit tested (test/shell-ownership.test.ts); core/persist.ts applies the decisions.

export const SCRATCH = 'Scratch';

/** What the shell knows about a document's linked item, from one tool's point of view. */
export type ItemFacts = {
  /** the tool whose live document the item is */
  owner?: ToolId;
  /** this tool had it until that tool took it; sticky until Take back (the next edit forks) */
  lostTo?: ToolId;
  /** deleted, moved outside the app, or pending delete */
  missing: boolean;
  /** the collection's name when it is locked */
  lockedIn: string | null;
  /** changed on disk since this tool last read or wrote it: writing is paused */
  paused: boolean;
};

/** The title-bar state of a doc-kind tool's document. `failed` is the last write's error, if any. */
export function docState(tool: ToolId, source: DocSource, facts: ItemFacts | null, failed: string | null): DocState {
  if (!source || !facts) return failed ? { t: 'write-failed', message: failed } : { t: 'new' };
  const by = facts.lostTo ?? (facts.owner !== undefined && facts.owner !== tool ? facts.owner : undefined);
  if (by) return { t: 'owned-elsewhere', by };
  if (facts.missing) return { t: 'missing' };
  if (facts.lockedIn !== null) return { t: 'locked', collection: facts.lockedIn };
  if (facts.paused) return { t: 'changed-outside' };
  if (failed) return { t: 'write-failed', message: failed };
  return { t: 'saved', at: source.stamp.mtimeMs, collection: source.collection };
}

/**
 * A document in one of these states is its item's live document, so its tool owns the item (and
 * the row shows it open). A locked one is the file as it is: its edits fork, but it is still open.
 */
export const holdsItem = (s: DocState): boolean => s.t === 'saved' || s.t === 'locked' || s.t === 'changed-outside' || s.t === 'write-failed';

/** a name without what an earlier fork added, so a copy of a copy is "X (edit 2)", never "X copy copy"; one " copy" alone may be the person's own word and stays */
const editBase = (name: string): string => name.replace(/( \(edit( \d+)?\)| copy(?= copy))+( copy)?$/i, '') || name;

/** the name an edit's copy takes: "X (edit)", then "X (edit 2)", the first one `taken` (names in the same place) doesn't have */
export function editName(name: string, taken: string[]): string {
  const base = editBase(name);
  const used = new Set(taken.map((n) => n.toLowerCase()));
  for (let n = 1; ; n++) {
    const next = n === 1 ? `${base} (edit)` : `${base} (edit ${n})`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

/** `original`: the item it forks from is still there, so the edit made a copy beside it (persist says so) */
export type Plan = { t: 'none' } | { t: 'write' } | { t: 'create'; name: string } | { t: 'fork'; name: string; original?: boolean };

const NONE: Plan = { t: 'none' };

/**
 * What a change to a doc-kind tool's document does on disk. Commits and applied items are edits;
 * undo and redo only follow the document, so they never fork. Restores never write (spec §7.5).
 */
export function planChange(o: { cause: ChangeCause; kind: DocKind; source: DocSource; state: DocState; empty: boolean }): Plan {
  if (o.cause === 'restore') return NONE;
  if (!o.source) return o.empty ? NONE : { t: 'create', name: `Untitled ${o.kind}` };
  const edit = o.cause === 'commit' || o.cause === 'receive';
  switch (o.state.t) {
    case 'owned-elsewhere':
    case 'locked':
      return edit ? { t: 'fork', name: editBase(o.source.name), original: true } : NONE;
    case 'missing':
      return edit ? { t: 'fork', name: o.source.name } : NONE;
    case 'changed-outside':
      return NONE;
    default:
      return { t: 'write' };
  }
}

export const stampOf = (ref: Pick<LibraryItemRef, 'mtimeMs' | 'size'>): FileStamp => ({ mtimeMs: ref.mtimeMs, size: ref.size });
export const sameStamp = (a: FileStamp | null | undefined, b: FileStamp | null | undefined): boolean =>
  !!a && !!b && a.mtimeMs === b.mtimeMs && a.size === b.size;

export function sourceOf(ref: LibraryItemRef, stamp: FileStamp = stampOf(ref)): NonNullable<DocSource> {
  return { itemId: ref.id, kind: ref.kind as DocKind, name: ref.name, collection: ref.collection, stamp };
}

export function findRef(index: LibraryIndex | null, id: string): LibraryItemRef | null {
  for (const c of index?.collections ?? []) for (const i of c.items) if (i.id === id) return i;
  return null;
}

/** the collection's own name when it is locked, else null */
export function lockedIn(index: LibraryIndex | null, collection: string): string | null {
  const c = index?.collections.find((x) => x.name.toLowerCase() === collection.toLowerCase());
  return c?.locked ? c.name : null;
}
