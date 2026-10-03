// The canvas's undo keys: Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z are the painting's while the pointer is
// over the paper or the canvas has focus, wherever the keyboard focus is (a tray chip, a slider).
// A window listener in the capture phase, so they reach no palette control and not the shell, which
// is why no toast shows its Ctrl Z hint meanwhile: pressing it would undo a stroke, not the toast.
import { useEffect, useRef, type RefObject } from 'react';
import { comboOf, fieldOwnsUndo } from '../../shell/core/keys.ts';
import { toast } from '../../ui/index.ts';
import { createStore } from '../common/store.ts';
import { paintUndoKey } from './paint-keys.ts';

/** the canvas owns Ctrl+Z right now */
const owns = createStore(false);
toast.ctrlZOff = () => owns.get();

export function useCanvasKeys(active: boolean, view: RefObject<HTMLElement | null>, canvas: RefObject<HTMLElement | null>, act: { undo(): void; redo(): void }) {
  const live = useRef(act);
  live.current = act;
  useEffect(() => {
    const el = view.current;
    if (!active || !el) return;
    let over = el.matches(':hover');
    const sync = () => {
      const now = over || (!!canvas.current && document.activeElement === canvas.current);
      if (now === owns.get()) return;
      owns.set(now);
      toast.refresh();
    };
    const enter = () => {
      over = true;
      sync();
    };
    const leave = () => {
      over = false;
      sync();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const focus = document.activeElement as HTMLElement | null;
      const key = paintUndoKey(comboOf(e), { over, focused: !!focus && focus === canvas.current, fieldOwnsUndo: fieldOwnsUndo(focus) });
      if (!key) return;
      e.preventDefault();
      e.stopPropagation();
      live.current[key]();
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    addEventListener('keydown', onKey, true);
    addEventListener('focusin', sync);
    addEventListener('focusout', sync);
    sync();
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      removeEventListener('keydown', onKey, true);
      removeEventListener('focusin', sync);
      removeEventListener('focusout', sync);
      if (owns.get()) {
        owns.set(false);
        toast.refresh();
      }
    };
  }, [active]);
}
