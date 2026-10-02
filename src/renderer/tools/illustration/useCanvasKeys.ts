// The canvas's undo keys: Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z are the painting's while the pointer is
// over the paper or the canvas has focus, wherever the keyboard focus is (a tray chip, a slider).
// A window listener in the capture phase, so they reach no palette control and not the shell.
import { useEffect, useRef, type RefObject } from 'react';
import { comboOf, fieldOwnsUndo } from '../../shell/core/keys.ts';
import { paintUndoKey } from './paint-keys.ts';

export function useCanvasKeys(active: boolean, view: RefObject<HTMLElement | null>, canvas: RefObject<HTMLElement | null>, act: { undo(): void; redo(): void }) {
  const live = useRef(act);
  live.current = act;
  useEffect(() => {
    const el = view.current;
    if (!active || !el) return;
    let over = el.matches(':hover');
    const enter = () => (over = true);
    const leave = () => (over = false);
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
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      removeEventListener('keydown', onKey, true);
    };
  }, [active]);
}
