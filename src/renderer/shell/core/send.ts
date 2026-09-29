import type { DocState } from '../../../shared/doc-api.ts';
import type { ItemKind, LibraryItemRef, LoadedItem, ToolId } from '../../../shared/types.ts';
import { toast } from '../../ui/index.ts';
import type { Use } from '../tool.ts';
import { errorText, guard, reportError } from './errors.ts';
import { ipc } from './ipc.ts';
import { findRef, SCRATCH, sourceOf } from './ownership.ts';
import { claim, keepCopy, quietly, refreshAll, saveWorkspace } from './persist.ts';
import { rasterize } from './rasterize.ts';
import { cantOpen, itemProblem, openTarget, rasterises, receiveLabel, sendKindOf, sentMessage, targetsFor } from './routing.ts';
import { endGesture, enqueue, idle, isEmptyDoc, rtOf, type Runtime } from './runtime.ts';
import { getState, setState } from './store.ts';

// Open, Send to and the readout actions (spec §5, §6.4, §7.3, §7.4). Every received item becomes
// ONE history step, committed by the shell through doc.receive.

type ItemRef = Pick<LibraryItemRef, 'id' | 'kind' | 'name'>;

const runtime = (id: ToolId): Runtime => {
  const r = rtOf(id);
  if (!r) throw new Error(`There's no tool "${id}".`);
  return r;
};

export async function runBusy<T>(fn: () => Promise<T>): Promise<T> {
  setState({ busy: getState().busy + 1 });
  try {
    return await fn();
  } finally {
    setState({ busy: getState().busy - 1 });
  }
}

export function setActive(id: ToolId): void {
  const s = getState();
  if (!rtOf(id)) return;
  if (s.active !== id) endGesture(rtOf(s.active)); // spec §8: hiding a tool commits its gesture
  setState({ active: id, settingsOpen: false, mounted: s.mounted.includes(id) ? s.mounted : [...s.mounted, id] });
  toast.refresh(); // a Send to toast's Ctrl Z hint follows the tool that took the item
}

export function openTargetFor(kind: ItemKind) {
  const s = getState();
  return openTarget(kind, rtOf(s.active)?.def, s.tools);
}

/** double-click, Open and drop into a tool (spec §6.4) */
export async function openItem(ref: ItemRef): Promise<void> {
  const target = openTargetFor(ref.kind);
  if (!target) {
    // the row's tooltip says this before the double-click; this covers a drop and the keyboard
    toast.show({ icon: 'block', message: cantOpen(ref.kind, targetsFor(ref.kind, getState().tools).map((t) => t.tool.label)) });
    return;
  }
  await deliver(ref, target.tool.id, target.use, false);
}

export async function sendItem(ref: ItemRef, to: ToolId): Promise<void> {
  const use = rtOf(to)?.def.accepts[ref.kind];
  if (!use) {
    toast.show({ kind: 'error', message: `${rtOf(to)?.def.label ?? to} doesn't take ${ref.name}.` });
    return;
  }
  await deliver(ref, to, use, true);
}

/** a tool's own Send to (spec §7.4): its item, or for image tools a full-resolution render saved to Scratch */
export async function sendDoc(from: ToolId, to: ToolId): Promise<void> {
  const r = runtime(from);
  endGesture(r);
  if (sendKind(from) === null) {
    toast.show({ icon: 'block', message: 'There is nothing to send yet.' });
    return;
  }
  if (r.def.itemKind) {
    await idle(r); // the first commit's create, or the last write, lands first
    const src = r.doc.source();
    const name = src?.name ?? `${r.def.label}'s document`;
    const why = unsendable(r.doc.state(), name);
    if (!src || why) {
      toast.show({ kind: 'error', message: why ?? `${name} isn't in the Library yet, so it can't be sent.` });
      return;
    }
    return sendItem(findRef(getState().library, src.itemId) ?? { id: src.itemId, kind: src.kind, name: src.name }, to);
  }
  const doc = r.doc.get();
  const ref = await runBusy(async () => {
    const out = await guard(`${r.def.label} couldn't render`, () => r.def.render!(doc, {}));
    if (!out) return null;
    return ipc.invoke('library.createImage', SCRATCH, `${out.name} · ${r.def.label}`, out.ext, await out.blob.arrayBuffer()).catch((e) => {
      reportError(`Couldn't save the render to ${SCRATCH}`, e);
      return null;
    });
  });
  if (ref) await sendItem(ref, to);
}

/** Send to sends the item file, so the document must be that file: saved, or locked (its edits fork). */
function unsendable(state: DocState, name: string): string | null {
  switch (state.t) {
    case 'saved':
    case 'locked':
      return null;
    case 'owned-elsewhere':
      return `${name} is open in ${rtOf(state.by)?.def.label ?? state.by} now. Take it back to send it from here.`;
    case 'missing':
      return `${name} isn't in the Library any more. Edit it to save a copy in Scratch, then send that.`;
    case 'changed-outside':
      return `${name} changed on disk. Reload it or keep yours as a copy first.`;
    case 'write-failed':
      return `${name} isn't saved: ${state.message}`;
    default:
      return `${name} isn't in the Library yet, so it can't be sent.`;
  }
}

export function sendKind(from: ToolId): ItemKind | null {
  const r = rtOf(from);
  return r ? sendKindOf(r.def, isEmptyDoc(r, r.doc.get())) : null;
}

async function deliver(ref: ItemRef, to: ToolId, use: Use, announce: boolean): Promise<void> {
  const r = runtime(to);
  // an item of the tool's own kind, opened: it becomes the document, and moves here (spec §7.3)
  const linking = use.mode === 'open' && r.def.itemKind === ref.kind;
  setActive(to);
  if (linking && r.doc.source()?.itemId === ref.id && getState().owners[ref.id] === to) return; // already open here
  await idle(r);
  const prev = linking ? getState().owners[ref.id] : undefined;
  const prevRt = prev && prev !== to ? rtOf(prev) : undefined;
  if (prevRt) {
    endGesture(prevRt);
    await idle(prevRt); // its pending write lands before the item moves
  }

  const read = await readItem(ref.id, ref.name);
  if (!read) return;
  let item: LoadedItem = read;
  let revoke = () => {};
  if (rasterises(r.def, item.kind)) {
    const blob = await guard(`Couldn't draw ${ref.name} as an image`, () => rasterize(item));
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    revoke = () => URL.revokeObjectURL(url);
    item = { ref: item.ref, kind: 'image', url };
  }

  try {
    // handoff: the tool is showing, so a drag may have begun during the awaits above. End it as blur
    // would and let its write land, then read `current` once with no await between; doc.receive
    // cancels a drag begun after that.
    for (endGesture(r); r.pending > 0; endGesture(r)) await idle(r);
    const current = r.doc.get();
    const next = await guard(`${r.def.label} couldn't take ${ref.name}`, () => r.def.receive(item, use, current));
    if (next === undefined) return;
    const label = receiveLabel(ref.name, use);
    if (linking) {
      const source = sourceOf(item.ref);
      claim(r, source.itemId);
      r.paused.delete(source.itemId);
      r.failed = null;
      r.links.set(source.itemId, source);
      quietly(r, () => r.doc.receive(label, next, source));
      void enqueue(r, () => saveWorkspace(r));
    } else if (next !== current) {
      // an input: the document keeps its own link, whatever it is by now
      r.doc.receive(label, next, r.doc.source());
    }
    refreshAll();
    // an input the tool took without changing its document (Design's proposals) left no step to undo
    if (announce) announceSent(r, next, ref.name, use, linking || next !== current);
  } finally {
    revoke();
  }
}

/**
 * The Send to toast (spec §7.4 step 3, brief §6). Its Undo takes the step back in the tool that got
 * the item, while that is still the tool's last step. Ctrl+Z means the toast only while that tool
 * is showing, where it is the tool's own undo anyway; elsewhere Ctrl+Z stays with the tool on screen.
 */
function announceSent(r: Runtime, next: unknown, name: string, use: Use, stepped: boolean): void {
  const to = r.def.id;
  if (!stepped) return void toast.show({ icon: 'input', message: sentMessage(name, use, r.def.label) });
  const onTop = () => rtOf(to) === r && r.doc.get() === next && !r.doc.inGesture();
  toast.show({
    icon: 'input',
    message: sentMessage(name, use, r.def.label),
    when: () => getState().active === to && onTop(),
    undo: () => {
      if (onTop()) r.doc.undo();
      else toast.show({ icon: 'info', message: `${receiveLabel(name, use)} is no longer the last step in ${r.def.label}.` });
    },
  });
}

/** read an item and check it (spec §5); null after a toast saying why not */
async function readItem(id: string, name: string): Promise<LoadedItem | null> {
  try {
    const item = await ipc.invoke('library.read', id);
    const problem = itemProblem(item);
    if (!problem) return item;
    toast.show({ kind: 'error', message: problem });
  } catch (e) {
    // main's own sentences name the item already ("Night isn't a readable palette.")
    const why = errorText(e);
    toast.show({ kind: 'error', message: why.startsWith(name) ? why : `Couldn't open ${name}: ${why}` });
  }
  return null;
}

/** read the item again and make it the document: one undoable step, no write */
async function reopen(r: Runtime, label: (name: string) => string): Promise<void> {
  endGesture(r);
  await idle(r);
  const src = r.doc.source();
  if (!src) return;
  const item = await readItem(src.itemId, src.name);
  if (!item) return;
  const data = await guard(`${r.def.label} couldn't read ${src.name}`, () => r.def.fromItem!(item));
  if (data === undefined) return;
  const source = sourceOf(item.ref);
  claim(r, source.itemId);
  r.paused.delete(src.itemId);
  r.failed = null;
  r.links.set(source.itemId, source);
  quietly(r, () => r.doc.receive(label(source.name), data, source));
  void enqueue(r, () => saveWorkspace(r));
  refreshAll();
}

/**
 * A new, empty document in place of the open one (a doc-kind tool's New): one undoable step, as
 * opening over a document is (brief rule 3), and nothing is written until its first commit makes
 * `Scratch/Untitled <kind> N` (spec §7.1). Undo brings the old one back, linked to its item.
 */
export async function newDoc(id: ToolId, name?: string): Promise<void> {
  const r = runtime(id);
  endGesture(r);
  await idle(r);
  r.newName = name;
  if (!r.doc.source() && isEmptyDoc(r, r.doc.get())) return;
  // an unlinked snapshot resolves through the '' link to the item the last first commit made; this
  // document is a new one, so its first commit must make its own (not write over that one)
  r.links.delete('');
  r.doc.receive(`New ${r.def.itemKind ?? 'document'}`, r.def.createEmptyDoc(), null);
}

/** OPEN IN <tool>: reload from the file and move ownership back (spec §7.3) */
export async function takeBack(id: ToolId): Promise<void> {
  const r = runtime(id);
  const src = r.doc.source();
  if (!src) return;
  const holder = getState().owners[src.itemId];
  const other = holder && holder !== id ? rtOf(holder) : undefined;
  if (other) {
    endGesture(other);
    await idle(other);
  }
  r.lostTo.delete(src.itemId);
  await reopen(r, (name) => `Take back ${name}`);
}

/** CHANGED ON DISK: the file wins; Ctrl+Z brings mine back (and writes it) */
export const reloadFromDisk = (id: ToolId): Promise<void> => reopen(runtime(id), (name) => `Reload ${name}`);

/** CHANGED ON DISK: mine forks into Scratch as "<name> copy" */
export async function keepMineAsCopy(id: ToolId): Promise<void> {
  const r = runtime(id);
  endGesture(r);
  await idle(r);
  await keepCopy(r);
}
