import type { ToolId, WorkspaceState } from '../../../shared/types.ts';
import { toast } from '../../ui/index.ts';
import type { ToolDefinition } from '../tool.ts';
import { errorDetails, errorText, guardSync, reportError } from './errors.ts';
import { ipc, log } from './ipc.ts';
import { sameStamp, sourceOf } from './ownership.ts';
import { attach, mirror, refreshAll, saveWorkspace, workspaceState } from './persist.ts';
import { assetHashes, itemProblem } from './routing.ts';
import { idle, type Linked, makeRuntime, missing, rtOf, type Runtime, setRuntime } from './runtime.ts';
import { getState, setState } from './store.ts';

// Start-up restore (spec §4: every controller restored before the UI takes input), Start empty and
// crash handling. Restoring never writes and never adds a history step (spec §7.5).

/** Returns the tools that started; one whose empty document can't even be made is left out. */
export async function restoreAll(defs: ToolDefinition<any>[]): Promise<ToolDefinition<any>[]> {
  const runtimes = defs.flatMap((def) => {
    const r = guardSync(`${def.label} couldn't start`, () => makeRuntime(def));
    if (r) setRuntime(r);
    return r ? [r] : [];
  });
  const readable = await Promise.all(runtimes.map((r) => restore(r).catch((e) => (reportError(`${r.def.label} couldn't restore its document`, e), false))));
  for (const r of runtimes) attach(r);
  refreshAll(); // restored items are claimed here, first tool in rail order first
  runtimes.forEach((r, i) => {
    mirror(r);
    r.saved = JSON.stringify(workspaceState(r)); // so launching and quitting writes nothing
    // spec §7.2: assets the restored document doesn't use go (the service keeps any under a minute
    // old). Only after a document was read: an unreadable or quarantined one still refers to its own.
    if (!r.def.itemKind && readable[i]) {
      void ipc.invoke('workspace.gcAssets', r.def.id, assetHashes(r.def.id, r.data)).catch((e) => log('warn', `Asset clean-up for ${r.def.id} failed`, errorText(e)));
    }
  });
  return runtimes.map((r) => r.def);
}

/** true when a saved document was read (so its assets are known) */
async function restore(r: Runtime): Promise<boolean> {
  const { def, doc } = r;
  let ws: WorkspaceState | null = null;
  try {
    ws = await ipc.invoke('workspace.load', def.id);
  } catch (e) {
    log('warn', `${def.id}: workspace.load failed`, errorText(e));
  }
  if (!ws) return false;
  r.view = ws.view;

  // a saved document is its file (spec §7.1)
  if (def.itemKind && ws.itemId && ws.doc === undefined) {
    const item = await ipc.invoke('library.read', ws.itemId).catch(() => null);
    const problem = item?.kind === def.itemKind ? itemProblem(item) : null;
    if (problem) toast.show({ kind: 'error', message: problem });
    else if (item?.kind === def.itemKind) {
      try {
        const data = def.fromItem!(item);
        const source = sourceOf(item.ref);
        doc.reset(data, source, 'restore');
        r.data = data;
        r.links.set(source.itemId, source);
      } catch (e) {
        reportError(`${def.label} couldn't reopen ${item.ref.name}`, e);
      }
    }
    return true;
  }
  if (ws.doc === undefined) return false;
  try {
    let data = ws.doc;
    if (ws.docVersion !== def.docVersion) {
      if (!def.migrate) throw new Error(`It was saved as version ${ws.docVersion}, and this build reads version ${def.docVersion}.`);
      data = def.migrate(ws.doc, ws.docVersion);
    }
    const source: Linked | null = def.itemKind && ws.itemId && ws.link ? { itemId: ws.itemId, kind: def.itemKind, name: ws.link.name, collection: ws.link.collection, stamp: ws.link.stamp } : null;
    doc.reset(data, source, 'restore');
    r.data = data;
    r.failed = def.itemKind ? (ws.failed ?? null) : null;
    if (source) await relinkRestored(r, source, ws.link?.lostTo);
    return true;
  } catch (e) {
    // spec §4: it can't be read, so keep it in crashed/ and start empty, and say so
    const path = await ipc.invoke('workspace.quarantine', def.id, ws).catch(() => null);
    log('error', `${def.id}: the saved document couldn't be restored`, errorDetails(e));
    toast.show({ kind: 'error', message: `${def.label}'s last document couldn't be opened, so it started empty. It's kept in ${path ?? 'the workspace'}.` });
    return false;
  }
}

/**
 * A document kept in state.json because its file may not hold it: it comes back linked, in the
 * state it was in. Its file is checked as a write would: gone is NOT IN LIBRARY, a new stamp is
 * CHANGED ON DISK, the same stamp leaves the earlier failure (NOT SAVED) or detachment as it was.
 */
async function relinkRestored(r: Runtime, source: Linked, lostTo: ToolId | undefined): Promise<void> {
  r.links.set(source.itemId, source);
  if (lostTo) r.lostTo.set(source.itemId, lostTo);
  const now = await ipc.invoke('library.stat', source.itemId).catch(() => null);
  if (now === null) missing.add(source.itemId);
  else if (!sameStamp(now, source.stamp)) r.paused.add(source.itemId);
}

/** Keep the document in workspace/<tool>/crashed/ and give the tool a fresh controller (not reset: undo would bring it back). */
export async function startEmpty(id: ToolId, crash?: { message: string; details: string }): Promise<void> {
  const old = rtOf(id);
  if (!old) return;
  await idle(old);
  const path = await ipc
    .invoke('workspace.quarantine', id, { toolId: id, docVersion: old.def.docVersion, itemId: old.doc.source()?.itemId ?? null, doc: old.data, view: old.view })
    .catch((e) => (log('error', `${id}: quarantine failed`, errorText(e)), null));
  const r = guardSync(`${old.def.label} couldn't start empty`, () => makeRuntime(old.def));
  if (!r) return;
  old.detach();
  r.view = old.view;
  setRuntime(r);
  attach(r);
  refreshAll(); // releases whatever the old document held
  mirror(r);
  void saveWorkspace(r);
  const crashed = { ...getState().crashed };
  if (crash) crashed[id] = { ...crash, automatic: true };
  else delete crashed[id];
  setState({ crashed });
  if (!crash) toast.show({ icon: 'restart_alt', message: `${old.def.label} started empty. The old document is kept in ${path ?? 'the workspace'}.` });
}

/**
 * ToolHost's and the status slot's error boundaries: the error panel the first time; a second
 * crash of the same document starts empty by itself (spec §4). While the panel shows, further
 * reports (the other boundary in the same render) don't count.
 */
export function reportCrash(id: ToolId, error: unknown): void {
  const r = rtOf(id);
  if (!r || getState().crashed[id]) return;
  const info = { message: errorText(error), details: errorDetails(error) };
  log('error', `${r.def.label} crashed`, info.details);
  const automatic = ++r.crashes >= 2;
  setState({ crashed: { ...getState().crashed, [id]: { ...info, automatic } } });
  if (automatic) void startEmpty(id, info);
}

export function reloadTool(id: ToolId): void {
  const crashed = { ...getState().crashed };
  delete crashed[id];
  setState({ crashed });
}
