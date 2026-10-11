import type { ChangeCause, DocSource, DocState, Entry } from '../../../shared/doc-api.ts';
import { same } from '../../../shared/history.ts';
import type { DocKind, DocPayload, LibraryItemRef, ToolId, WorkspaceState, WriteResult } from '../../../shared/types.ts';
import { toast } from '../../ui/index.ts';
import { errorText, guardSync } from './errors.ts';
import { ipc, log } from './ipc.ts';
import { docState, editName, findRef, holdsItem, lockedIn, planChange, SCRATCH, sameStamp, sourceOf, stampOf } from './ownership.ts';
import { collectionLabel } from './routing.ts';
import { allRuntimes, docRuntimes, enqueue, isEmptyDoc, type Linked, missing, rtOf, type Runtime } from './runtime.ts';
import { getState, setState } from './store.ts';

// Saving (spec §7): doc-kind tools write their Library item on every commit, undo, redo and applied
// item, forking per §7.3; image tools write workspace state.json. Also the ownership map and the
// per-tool state the title bar reads.

// -- the persistence hook --

/** set while a tool takes an item as its document (Open, Take back, Reload): the file already holds it */
let quiet: Runtime | null = null;

export function quietly(r: Runtime, fn: () => void): void {
  quiet = r;
  try {
    fn();
  } finally {
    quiet = null;
  }
}

/** wire a tool's controller to saving and to the ShellState mirror (after restore, so restoring writes nothing) */
export function attach(r: Runtime): void {
  const offChange = r.doc.onChange((entry, cause) => changed(r, entry, cause));
  const offMirror = r.doc.subscribe(() => mirror(r));
  r.detach = () => {
    offChange();
    offMirror();
  };
}

function changed(r: Runtime, entry: Entry<unknown>, cause: ChangeCause): void {
  r.data = entry.data;
  if (cause === 'restore') return;
  r.crashes = 0; // another document now: an earlier crash no longer counts towards starting empty
  // spec §8: after a tool commit, Ctrl+Z belongs to the tool again
  if (cause === 'commit' || cause === 'receive') toast.noteCommit();
  else toast.refresh(); // an undo or redo can end a Send to toast's hold on Ctrl+Z
  if (quiet === r) return;
  void enqueue(r, () => (r.def.itemKind ? persistItem(r, entry, cause) : saveWorkspace(r)));
}

async function persistItem(r: Runtime, entry: Entry<unknown>, cause: ChangeCause): Promise<void> {
  const source = resolve(r, entry.source);
  const plan = planChange({ cause, kind: r.def.itemKind!, source, state: stateOf(r, source), empty: isEmptyDoc(r, entry.data) });
  const payload = plan.t === 'none' ? null : payloadOf(r, entry.data);
  if (payload && plan.t === 'write') await write(r, source!, payload, cause === 'commit' || cause === 'receive');
  else if (payload && plan.t === 'fork') {
    // an edit to a locked item, or one open in another tool, lands in a copy; the name numbers itself and the toast says so
    const scratch = getState().library?.collections.find((c) => c.name === SCRATCH)?.items ?? [];
    const name = plan.original ? editName(plan.name, scratch.filter((i) => i.kind === r.def.itemKind).map((i) => i.name)) : plan.name;
    await create(r, name, payload, source);
    if (plan.original && !r.failed && source) toast.show({ icon: 'info', message: `Edited a copy: ${name}. The original stays in ${collectionLabel(source.collection)}.` });
  }
  else if (payload && plan.t === 'create') {
    const name = r.newName ?? plan.name;
    r.newName = undefined;
    await create(r, name, payload, source);
  }
  refreshAll();
  await saveWorkspace(r);
}

/** Try again: write what's on screen as an edit would */
export function retry(r: Runtime): void {
  r.saved = '';
  void enqueue(r, () => (r.def.itemKind ? persistItem(r, { data: r.data, source: r.doc.source() }, 'commit') : saveWorkspace(r)));
}

function payloadOf(r: Runtime, data: unknown): DocPayload | null {
  const body = guardSync(`${r.def.label} couldn't save its document`, () => r.def.toItem!(data));
  if (!body) {
    r.failed = "The document couldn't be turned into a file.";
    return null;
  }
  // the service assigns ids; the shell stamps kind and the item file's version (not the tool's
  // docVersion: two tools write palettes, and their workspace shapes version separately)
  const kind = r.def.itemKind!;
  return { ...body, kind, id: '', version: ITEM_VERSION[kind] } as DocPayload;
}

/** the version of each item file format (spec §6.1) */
const ITEM_VERSION: Record<DocKind, number> = { palette: 1, pattern: 1, logo: 1 };

async function write(r: Runtime, source: Linked, payload: DocPayload, edit: boolean): Promise<void> {
  let res: WriteResult;
  try {
    res = await ipc.invoke('library.write', source.itemId, payload, source.stamp);
  } catch (e) {
    res = { ok: false, reason: 'error', message: errorText(e) };
  }
  if (res.ok) {
    patchRef(source.itemId, res.ref);
    // the first write of a doc known only by its path gives it an id of its own
    if (res.ref.id !== source.itemId) follow(source.itemId, res.ref);
    relink(r, sourceOf(res.ref, res.stamp), { ...source, itemId: res.ref.id });
    r.failed = null;
    claim(r, res.ref.id);
  } else if (res.reason === 'changed-outside') r.paused.add(source.itemId);
  else if (res.reason === 'missing') {
    missing.add(source.itemId);
    if (edit) await create(r, source.name, payload, source); // spec §7.3: the edit forks into Scratch
  } else {
    r.failed = res.message;
    log('warn', `${r.def.label}: writing ${source.name} failed`, res.message);
  }
}

/**
 * The Library row of an item this app just wrote takes its new stamp now: main sends no index for
 * its own writes, and the row's swatch count and thumbnail are keyed by the stamp.
 */
function patchRef(id: string, ref: LibraryItemRef): void {
  const lib = getState().library;
  if (!lib) return;
  const collections = lib.collections.map((c) => (c.items.some((i) => i.id === id) ? { ...c, items: c.items.map((i) => (i.id === id ? ref : i)) } : c));
  setState({ library: { ...lib, collections } });
}

/** a first commit (`from` null) or a fork of `from` into Scratch */
async function create(r: Runtime, name: string, payload: DocPayload, from: DocSource): Promise<void> {
  try {
    const { ref, stamp } = await ipc.invoke('library.create', SCRATCH, name, payload);
    relink(r, sourceOf(ref, stamp), from, true);
    if (from) {
      r.paused.delete(from.itemId);
      r.lostTo.delete(from.itemId);
    }
    r.failed = null;
    claim(r, ref.id);
  } catch (e) {
    r.failed = errorText(e);
    log('warn', `${r.def.label}: creating ${name} failed`, errorText(e));
  }
}

/** Keep mine as a copy (CHANGED ON DISK): the document forks into Scratch; the changed file stays as it is. */
export function keepCopy(r: Runtime): Promise<void> {
  return enqueue(r, async () => {
    const src = r.doc.source();
    const payload = src && payloadOf(r, r.data);
    const scratch = getState().library?.collections.find((c) => c.name === SCRATCH)?.items ?? [];
    if (src && payload) await create(r, editName(src.name, scratch.filter((i) => i.kind === r.def.itemKind).map((i) => i.name)), payload, src);
    refreshAll();
    await saveWorkspace(r);
  });
}

// -- links: which item a queued snapshot means now --

const relinks = new Set<(tool: ToolId, from: string, to: string, fork: boolean) => void>();

/** the document now lives in another item: a fork (`fork`) or its own item under a new id (rename, move) */
export function onRelink(tool: ToolId, fn: (from: string, to: string, fork: boolean) => void): () => void {
  const hook = (t: ToolId, from: string, to: string, fork: boolean) => t === tool && fn(from, to, fork);
  relinks.add(hook);
  return () => void relinks.delete(hook);
}

/** after a write, create or fork: the controller's entries and this tool's links follow (handoff: setSource rules) */
export function relink(r: Runtime, next: Linked, from: DocSource, fork = false): void {
  // told first, so what the tool keeps per item (a painting) moves before its view sees the new id
  if (from && from.itemId !== next.itemId) relinks.forEach((fn) => guardSync(`${r.def.label} couldn't follow its palette`, () => fn(r.def.id, from.itemId, next.itemId, fork)));
  r.doc.setSource(next, from);
  r.links.set(from?.itemId ?? '', next);
  r.links.set(next.itemId, next);
}

function resolve(r: Runtime, s: DocSource): DocSource {
  let cur = s;
  let key = s?.itemId ?? '';
  for (let hops = 0; hops < 16; hops++) {
    const next = r.links.get(key);
    if (!next) break;
    cur = next;
    if (next.itemId === key) break;
    key = next.itemId;
  }
  return cur;
}

/** an item's id changed (first write of a doc known by its path, a rename or move of one) */
function rekey(from: string, to: string): void {
  if (from === to) return;
  const owners = { ...getState().owners };
  if (owners[from]) {
    owners[to] = owners[from];
    delete owners[from];
    setState({ owners });
  }
  if (missing.delete(from)) missing.add(to);
  for (const r of allRuntimes()) {
    const by = r.lostTo.get(from);
    if (by) {
      r.lostTo.delete(from);
      r.lostTo.set(to, by);
    }
    if (r.paused.delete(from)) r.paused.add(to);
  }
}

/** After a rename or move: every tool that linked the item follows it, keeping its own stamp. */
export function follow(fromId: string, ref: LibraryItemRef): void {
  rekey(fromId, ref.id);
  for (const r of docRuntimes()) {
    const known = r.links.get(fromId);
    if (known?.itemId === fromId) relink(r, { ...known, itemId: ref.id, name: ref.name, collection: ref.collection }, known);
  }
  refreshAll();
}

// -- ownership and state --

export function stateOf(r: Runtime, src: DocSource): DocState {
  if (!r.def.itemKind) return r.failed ? { t: 'write-failed', message: r.failed } : { t: 'workspace' };
  if (!src) return docState(r.def.id, null, null, r.failed);
  const s = getState();
  const id = src.itemId;
  const facts = { owner: s.owners[id], lostTo: r.lostTo.get(id), missing: missing.has(id), lockedIn: lockedIn(s.library, src.collection), paused: r.paused.has(id) };
  return docState(r.def.id, src, facts, r.failed);
}

/** `r` takes the item (one item per tool); a tool that held it is left detached, OPEN IN <r> */
export function claim(r: Runtime, id: string): void {
  const tool = r.def.id;
  const owners = { ...getState().owners };
  const prev = owners[id];
  for (const k of Object.keys(owners)) if (owners[k] === tool) delete owners[k];
  owners[id] = tool;
  if (prev && prev !== tool) rtOf(prev)?.lostTo.set(id, tool);
  r.lostTo.delete(id);
  setState({ owners });
}

function release(r: Runtime): void {
  const owners = getState().owners;
  const mine = Object.keys(owners).filter((k) => owners[k] === r.def.id);
  if (!mine.length) return;
  const next = { ...owners };
  for (const k of mine) delete next[k];
  setState({ owners: next });
}

/**
 * Recompute every tool's state. A tool whose document is its item again (restored, undeleted,
 * unlocked) owns it; a detached or unlinked one owns nothing. Neither changes the derived state.
 */
export function refreshAll(): void {
  for (const r of allRuntimes()) {
    const src = r.doc.source();
    const state = stateOf(r, src);
    if (r.def.itemKind) {
      if (!src || !holdsItem(state)) release(r);
      else if (getState().owners[src.itemId] === undefined) claim(r, src.itemId);
    }
    if (!same(state, r.doc.state())) r.doc.setState(state);
    // a claim or detach outside a write (unlock, undelete, rename) changes what state.json must hold;
    // a queued job saves it anyway, and start-up records what it restored instead (launch writes nothing)
    if (r.def.itemKind && getState().ready && r.pending === 0 && JSON.stringify(workspaceState(r)) !== r.saved) void enqueue(r, () => saveWorkspace(r));
  }
  const failing = allRuntimes().find((r) => r.failed);
  setState({ statusWarning: failing ? `${failing.def.label} isn't saved: ${failing.failed}` : null });
}

/** ShellState's per-tool copies of the readout state and breadcrumb name */
export function mirror(r: Runtime): void {
  const s = getState();
  const id = r.def.id;
  const state = r.doc.state();
  const own = r.def.docName && guardSync(`${r.def.label} couldn't name its document`, () => r.def.docName!(r.doc.get()));
  const name = own || r.doc.source()?.name || 'Untitled';
  if (s.docStates[id] === state && s.docNames[id] === name) return;
  setState({ docStates: { ...s.docStates, [id]: state }, docNames: { ...s.docNames, [id]: name } });
}

// -- outside changes (spec §7.3) --

let checking: Promise<void> = Promise.resolve();

/** after the Library index changed: follow renames and moves, spot deletions and outside edits */
export function reconcile(): void {
  checking = checking.then(checkItems).catch((e) => log('warn', 'Checking open documents against the Library failed', errorText(e)));
}

/** the Library folder was away at the last look: what failed to save meanwhile is written again when it is back */
let folderDown = false;

async function checkItems(): Promise<void> {
  // the whole Library folder is gone (renamed, a drive unplugged): its items aren't, one by one. The
  // documents stay as they were; a write says NOT SAVED until the folder is back (spec §11)
  if (!getState().library?.ok) {
    folderDown = true;
    return refreshAll();
  }
  if (folderDown) {
    folderDown = false;
    for (const r of allRuntimes()) if (r.failed && r.pending === 0) retry(r);
  }
  for (const r of docRuntimes()) {
    const src = r.doc.source();
    if (!src) continue;
    const id = src.itemId;
    const ref = findRef(getState().library, id);
    if (ref) {
      missing.delete(id);
      if (ref.name !== src.name || ref.collection !== src.collection) follow(id, ref);
      else if (!sameStamp(stampOf(ref), src.stamp) && getState().owners[id] === r.def.id) await checkStamp(r, id);
    } else if (!missing.has(id) && r.pending === 0) {
      // not listed: gone, or known under an old id the service still answers to
      const stamp = await ipc.invoke('library.stat', id).catch(() => null);
      if (stamp === null && r.doc.source()?.itemId === id) missing.add(id);
    }
  }
  refreshAll();
}

/** the index shows another stamp: ask the service, behind any queued write, before pausing */
async function checkStamp(r: Runtime, id: string): Promise<void> {
  if (r.pending) return; // the write will compare stamps itself
  const now = await ipc.invoke('library.stat', id).catch(() => null);
  const cur = r.doc.source();
  if (now && r.pending === 0 && cur?.itemId === id && !sameStamp(now, cur.stamp)) r.paused.add(id);
}

// -- workspace state.json (spec §7.1, §7.2) --

export function workspaceState(r: Runtime): WorkspaceState {
  const ws: WorkspaceState = { toolId: r.def.id, docVersion: r.def.docVersion, view: r.view };
  if (!r.def.itemKind) return { ...ws, doc: r.data };
  const src = r.doc.source();
  // the link, owned or detached, so the tool reopens where it was (spec §7.1)
  ws.itemId = src?.itemId ?? null;
  // a document its file may not hold stays here too, with its link, so a restart restores it and
  // its state (spec §11); a saved or locked one is its file
  const t = r.doc.state().t;
  const inFile = (t === 'saved' || t === 'locked') && !r.failed;
  if (src ? !inFile : !isEmptyDoc(r, r.data)) {
    ws.doc = r.data;
    if (src) ws.link = { name: src.name, collection: src.collection, stamp: src.stamp, lostTo: r.lostTo.get(src.itemId) };
    if (r.failed) ws.failed = r.failed;
  }
  return ws;
}

export async function saveWorkspace(r: Runtime): Promise<void> {
  const ws = workspaceState(r);
  const json = JSON.stringify(ws);
  if (json === r.saved) return;
  // for image tools this file IS the document, so a failure is the persistent warning (spec §11)
  const own = !r.def.itemKind;
  try {
    await ipc.invoke('workspace.save', r.def.id, ws);
    r.saved = json;
    if (own && r.failed) {
      r.failed = null;
      refreshAll();
    }
  } catch (e) {
    log('warn', `${r.def.label}: saving the workspace failed`, errorText(e));
    if (own) {
      r.failed = errorText(e);
      refreshAll();
    }
  }
}

const VIEW_SAVE_MS = 400;
const viewTimers = new Map<Runtime, ReturnType<typeof setTimeout>>();

/** view state is saved a moment after it settles, never through history */
export function setView(r: Runtime, view: unknown): void {
  r.view = view;
  clearTimeout(viewTimers.get(r));
  viewTimers.set(
    r,
    setTimeout(() => {
      viewTimers.delete(r);
      void enqueue(r, () => saveWorkspace(r));
    }, VIEW_SAVE_MS),
  );
}

export function flushViews(): void {
  for (const [r, timer] of viewTimers) {
    clearTimeout(timer);
    void enqueue(r, () => saveWorkspace(r));
  }
  viewTimers.clear();
}
