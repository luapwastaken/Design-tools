import { toast } from '../../ui/index.ts';
import { guardSync } from './errors.ts';
import { comboOf, fieldOwnsUndo, isTextField, matches, shellKey, type ShellKey, toolMayTake } from './keys.ts';
import { toolForShortcut } from './routing.ts';
import { allRuntimes, endGesture, rtOf } from './runtime.ts';
import { setActive } from './send.ts';
import { getState, setState } from './store.ts';

// The one window-level key listener (spec §9), plus the gesture fallbacks of spec §8. It listens
// in the BUBBLE phase: menus, drags and fields take their keys first and stop them (ui/index.ts).

export function installKeymap(): void {
  addEventListener('keydown', onKey);
  // Spec §8: the shell commits an open gesture on lost pointer capture and window blur (tool hide is
  // setActive). Only a fallback: controls commit their own gestures first, with their own labels.
  addEventListener('lostpointercapture', () => endGesture(rtOf(getState().active)));
  addEventListener('blur', () => setTimeout(() => allRuntimes().forEach(endGesture)));
}

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing || !getState().ready) return;
  const el = document.activeElement as HTMLElement | null;
  const combo = comboOf(e);
  const own = shellKey(combo);
  if (own) {
    if (runShellKey(own, el)) e.preventDefault();
    return;
  }
  const s = getState();
  const r = rtOf(s.active);
  if (!r?.def.shortcuts || s.settingsOpen || s.crashed[s.active] || !toolMayTake(combo, isTextField(el))) return;
  const list = guardSync(`${r.def.label}'s shortcuts failed`, () => r.def.shortcuts!(r.doc)) ?? [];
  const hit = list.find((sc) => matches(sc.keys, combo));
  if (!hit) return;
  e.preventDefault();
  guardSync(`${r.def.label}: ${hit.label} failed`, hit.run);
}

/** true when the shell took the key */
function runShellKey(k: ShellKey, el: HTMLElement | null): boolean {
  const s = getState();
  switch (k.t) {
    case 'tool': {
      const id = toolForShortcut(k.n, s.tools);
      if (id) setActive(id);
      return id !== null;
    }
    case 'library':
      setState({ libraryOpen: !s.libraryOpen });
      return true;
    case 'settings':
      setState({ settingsOpen: !s.settingsOpen });
      return true;
    case 'undo':
    case 'redo':
      return undoRedo(k.t === 'redo', el);
    case 'region':
      return cycleRegion(k.back, el);
  }
}

/** Spec §8 order: a field's uncommitted edit, then a live Undo toast, then the active tool's history. */
function undoRedo(redo: boolean, el: HTMLElement | null): boolean {
  if (fieldOwnsUndo(el)) return false; // native undo inside the field
  const live = redo ? null : toast.activeCtrlZ();
  if (live) {
    live.run();
    return true;
  }
  const s = getState();
  const r = rtOf(s.active);
  if (!r || s.settingsOpen || s.crashed[s.active]) return true; // nothing to undo on screen; keep the browser's out of it
  // handoff: always call undo(); during a gesture it cancels the gesture even with no history yet
  if (redo) r.doc.redo();
  else r.doc.undo();
  return true;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** F6 / Shift+F6 cycle the regions views mark with data-region (brief §6) */
function cycleRegion(back: boolean, el: HTMLElement | null): boolean {
  const regions = [...document.querySelectorAll<HTMLElement>('[data-region]')].filter((x) => x.getClientRects().length > 0 && !x.closest('[inert]'));
  if (!regions.length) return false;
  const at = regions.findIndex((x) => x.contains(el));
  const n = regions.length;
  const next = regions[at < 0 ? (back ? n - 1 : 0) : (at + (back ? n - 1 : 1)) % n];
  const target = [...next.querySelectorAll<HTMLElement>(FOCUSABLE)].find((x) => x.getClientRects().length > 0) ?? next;
  if (target === next && !next.hasAttribute('tabindex')) next.tabIndex = -1;
  target.focus();
  return true;
}
