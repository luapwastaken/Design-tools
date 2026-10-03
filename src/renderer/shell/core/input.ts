import type { ToolId } from '../../../shared/types.ts';
import { ITEM_MIME } from '../../ui/index.ts';
import { guard } from './errors.ts';
import { isTextField } from './keys.ts';
import { offerToLibrary } from './library.ts';
import { findRef } from './ownership.ts';
import { rtOf } from './runtime.ts';
import { openItem } from './send.ts';
import { getState } from './store.ts';

// Drop and paste routing (spec §9). Views that take a drop themselves (the Library panel, a list's
// reorder target) call preventDefault in their dragover and drop handlers; everything else lands
// here, in the bubble phase. The guard: no drop ever navigates the window.

export function installInput(): void {
  addEventListener('dragover', onDragOver);
  addEventListener('drop', onDrop);
  addEventListener('paste', onPaste);
  // The drag-over highlight goes when the pointer enters something outside the tool (dragenter
  // fires before the matching dragleave), leaves the window (a dragleave with no dragenter), or
  // the drag ends. A view that takes the drag stops its dragover, so this can't wait for that.
  let entered: EventTarget | null = null;
  addEventListener('dragenter', (e) => {
    entered = e.target;
    if (!(e.target instanceof Node && lit?.contains(e.target))) light(null);
  });
  addEventListener('dragleave', (e) => e.target === entered && light(null));
  addEventListener('dragend', () => light(null));
}

/** the tool area a drop lands in: ToolHost marks each with data-tool */
function hostAt(target: EventTarget | null): HTMLElement | null {
  const host = target instanceof Element ? target.closest<HTMLElement>('[data-tool]') : null;
  const id = host?.dataset.tool as ToolId | undefined;
  return id && rtOf(id) && !getState().crashed[id] ? host : null;
}

/** brief §7 drag-over target: ToolHost's CSS draws it from data-drop */
let lit: HTMLElement | null = null;
function light(host: HTMLElement | null): void {
  if (lit === host) return;
  lit?.removeAttribute('data-drop');
  host?.setAttribute('data-drop', '');
  lit = host;
}

function onDragOver(e: DragEvent): void {
  if (e.defaultPrevented || !e.dataTransfer) return light(null); // a view took it
  e.preventDefault();
  const types = e.dataTransfer.types;
  const host = getState().ready && (types.includes('Files') || types.includes(ITEM_MIME)) ? hostAt(e.target) : null;
  e.dataTransfer.dropEffect = host ? 'copy' : 'none';
  light(host);
}

function onDrop(e: DragEvent): void {
  light(null);
  if (e.defaultPrevented) return;
  e.preventDefault();
  const id = hostAt(e.target)?.dataset.tool as ToolId | undefined;
  if (!id || !getState().ready || !e.dataTransfer) return;
  // a Library item: the same routing as double-click (spec §6.4); its drag data is the item id
  const itemId = e.dataTransfer.getData(ITEM_MIME);
  if (itemId) {
    const ref = findRef(getState().library, itemId);
    if (ref) void openItem(ref);
    return;
  }
  const files = [...e.dataTransfer.files];
  if (files.length) void routeFiles(id, files, 'drop');
}

function onPaste(e: ClipboardEvent): void {
  if (e.defaultPrevented || !getState().ready || isTextField(document.activeElement as HTMLElement | null)) return;
  const files = [...(e.clipboardData?.files ?? [])];
  if (!files.length) return;
  e.preventDefault();
  const s = getState();
  // a tool behind Settings or its crash panel can't show what a paste did: the Library takes it
  if (s.settingsOpen || s.crashed[s.active]) void offerToLibrary(files);
  else void routeFiles(s.active, files, 'paste');
}

/** the tool's onFiles first; what it declines is offered to the Library */
export async function routeFiles(id: ToolId, files: File[], how: 'drop' | 'paste'): Promise<void> {
  const r = rtOf(id);
  if (!r) return;
  const onFiles = r.def.onFiles;
  const took = onFiles ? await guard(`${r.def.label} couldn't take the files`, () => onFiles(files, how, r.doc), true) : false;
  // undefined: it threw, and the toast said so
  const left = took === false ? files : Array.isArray(took) ? took : [];
  if (left.length) await offerToLibrary(left);
}
