// DocController (spec §8, contract in doc-api.ts) over shared/history.ts.
import type { ChangeCause, DocController, DocControllerOptions, DocSource, DocState, Entry } from './doc-api.ts';
import type { ToolId } from './types.ts';
import { History, same } from './history.ts';

const sameItem = (a: DocSource, b: DocSource) => a === b || (a !== null && b !== null && a.itemId === b.itemId);

export function createDocController<D>(toolId: ToolId, initial: D, options: DocControllerOptions = {}): DocController<D> {
  const { limit = 200, now = Date.now, strict = !!import.meta.env?.DEV } = options;
  const history = new History<Entry<D>>({ data: initial, source: null }, limit);
  /** the live entry while a gesture is open; the gesture's start is always history.current() */
  let draft: Entry<D> | null = null;
  let state: DocState = { t: 'new' };
  const subscribers = new Set<() => void>();
  const hooks = new Set<(entry: Entry<D>, cause: ChangeCause) => void>();

  const live = () => draft ?? history.current();
  const notify = () => subscribers.forEach((fn) => fn());
  const changed = (cause: ChangeCause) => {
    notify();
    const entry = history.current();
    hooks.forEach((fn) => fn(entry, cause));
  };
  /** every entry (and the draft) linked to `from`'s item, or every unlinked one when `from` is null, takes `to` */
  const relink = (from: DocSource, to: DocSource) => {
    const swap = (e: Entry<D>) => (sameItem(e.source, from) ? { data: e.data, source: to } : e);
    history.map(swap);
    if (draft) draft = swap(draft);
  };
  /** receive and reset replace the document outright, so they end an open gesture as undo does */
  const replaceWith = (source: DocSource) => {
    draft = null;
    // a fresher read of an item already in history: undo into its older entries must use this stamp
    if (source) relink(source, source);
  };

  const doc: DocController<D> = {
    toolId,
    get: () => live().data,
    source: () => live().source,
    state: () => state,
    subscribe(fn) {
      subscribers.add(fn);
      return () => void subscribers.delete(fn);
    },

    // a second begin() keeps the first one's start
    begin() {
      if (draft) return;
      draft = history.current();
      notify();
    },
    set(fn) {
      if (!draft) {
        if (strict) throw new Error(`${toolId}: DocController.set() outside a gesture`);
        return; // e.g. a drag still moving after Ctrl+Z cancelled its gesture
      }
      const data = fn(draft.data);
      if (data === draft.data) return;
      draft = { data, source: draft.source };
      notify();
    },
    commit(label, key) {
      if (!draft) return;
      const next = draft;
      draft = null;
      if (same(next.data, history.current().data)) return notify();
      history.push(next, label, key ?? null, now());
      changed('commit');
    },
    cancel() {
      if (!draft) return;
      draft = null;
      notify();
    },
    inGesture: () => draft !== null,
    // inside an open gesture this ends that gesture: both changes become one step labelled `label`
    transact(label, fn, key) {
      const outer = draft !== null;
      doc.begin();
      try {
        doc.set(fn);
      } catch (e) {
        if (!outer) doc.cancel();
        throw e;
      }
      doc.commit(label, key);
    },

    undo() {
      if (draft) return doc.cancel(); // spec §8: during a gesture, undo cancels it
      if (history.undo()) changed('undo');
    },
    redo() {
      if (!history.canRedo()) return; // Ctrl+Y with nothing to redo leaves a drag alone
      draft = null;
      history.redo();
      changed('redo');
    },
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    undoLabel: () => history.undoLabel(),
    redoLabel: () => history.redoLabel(),
    depth: () => history.depth(),

    // in place: no step, redo and undo kept, so load-time analysis after an Open still undoes the Open
    reset(data, source, cause) {
      replaceWith(source);
      history.replace({ data, source });
      changed(cause);
    },
    receive(label, data, source) {
      replaceWith(source);
      history.push({ data, source }, label, null, now()); // never merges, never skipped
      changed('receive');
    },
    // Keyed on the item the write was for, never on what is current now: writes resolve late, and
    // by then the user may have opened another item.
    setSource(next, from = next) {
      relink(from, next);
      notify();
    },
    setState(next) {
      state = next;
      notify();
    },
    onChange(fn) {
      hooks.add(fn);
      return () => void hooks.delete(fn);
    },
  };
  return doc;
}
