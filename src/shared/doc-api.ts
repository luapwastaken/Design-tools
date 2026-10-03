import type { DocKind, FileStamp, ToolId } from './types.ts';

/** The Library item a document is linked to (only doc-kind tools ever have one). */
export type DocSource = {
  itemId: string;
  kind: DocKind;
  name: string;
  collection: string;
  /** last stamp read or written by this app, for changed-outside detection */
  stamp: FileStamp;
} | null;

/** What the title-bar readout shows (spec §7.3, §7.5). */
export type DocState =
  | { t: 'new' } // in memory, nothing committed yet
  | { t: 'saved'; at: number; collection: string }
  | { t: 'workspace' } // image tools
  | { t: 'owned-elsewhere'; by: ToolId } // OPEN IN <TOOL>; next edit forks
  | { t: 'locked'; collection: string } // LOCKED · <COLLECTION>; next edit forks
  | { t: 'missing' } // NOT IN LIBRARY; next edit forks into Scratch
  | { t: 'changed-outside' } // writing paused
  | { t: 'write-failed'; message: string };

/** Why the document changed, for the persistence hook. */
export type ChangeCause = 'commit' | 'undo' | 'redo' | 'receive' | 'restore';

export type Entry<D> = { data: D; source: DocSource };

/**
 * One tool's document with undo (spec §8). Implemented in shared/doc.ts over shared/history.ts.
 * Pure: no DOM, no Electron, no timers except `now()` for key-repeat coalescing.
 */
export interface DocController<D> {
  readonly toolId: ToolId;
  get(): D;
  source(): DocSource;
  state(): DocState;
  /** React: useSyncExternalStore(doc.subscribe, doc.get) */
  subscribe(fn: () => void): () => void;

  // gestures
  begin(): void;
  /** only inside a gesture (throws in dev otherwise); updates the live doc without a history step */
  set(fn: (d: D) => D): void;
  /**
   * End the gesture. No step if nothing changed. `key` identifies the control: a commit with the
   * same key and label as the previous step, within 1s and with nothing in between, replaces that
   * step (key-repeat coalescing).
   */
  commit(label: string, key?: string): void;
  /** end the gesture, restoring the state from begin(); no step */
  cancel(): void;
  inGesture(): boolean;
  /** begin + set + commit in one call, for clicks and one-off changes */
  transact(label: string, fn: (d: D) => D, key?: string): void;

  /** during an open gesture: cancels it instead, no step (spec §8) */
  undo(): void;
  /** during an open gesture with something to redo: cancels it first */
  redo(): void;
  // canUndo/canRedo/labels/depth describe history steps only; an open gesture is not one
  canUndo(): boolean;
  canRedo(): boolean;
  undoLabel(): string | null;
  redoLabel(): string | null;
  depth(): number;

  // shell-only
  // reset and receive both end an open gesture, and give older entries of `source`'s item its stamp
  /**
   * Replace the current entry's doc and source in place: no step, undo and redo kept (restore on
   * launch, load-time analysis). To drop history (Start empty), create a new controller instead.
   */
  reset(data: D, source: DocSource, cause: 'restore'): void;
  /** receive(): replace or merge as ONE history step labelled `label`, never coalesced */
  receive(label: string, data: D, source: DocSource): void;
  /**
   * After a write, no step and no onChange. Every entry linked to `from`'s item (every unlinked
   * entry when `from` is null) takes `source`. Omit `from` for the same item (new stamp, rename,
   * move); pass it for a first commit (null) or a fork (the original).
   */
  setSource(source: DocSource, from?: DocSource): void;
  setState(state: DocState): void;
  /** persistence hook: called after every commit, undo, redo, receive and reset, with its cause */
  onChange(fn: (entry: Entry<D>, cause: ChangeCause) => void): () => void;
}

export type DocControllerOptions = {
  /** default 200 */
  limit?: number;
  /** default Date.now; injected by tests */
  now?: () => number;
  /** default: import.meta.env?.DEV — when true, set() outside a gesture throws */
  strict?: boolean;
};
