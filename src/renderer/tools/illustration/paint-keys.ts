// The canvas's own undo keys, as a pure decision so it can be tested.
import type { Combo } from '../../shell/core/keys.ts';

export type PaintKeyContext = {
  /** the pointer is over the paper */
  over: boolean;
  /** the canvas has focus */
  focused: boolean;
  /** a field with an edit of its own under way keeps Ctrl+Z */
  fieldOwnsUndo: boolean;
};

/**
 * Ctrl+Z undoes a stroke, Ctrl+Shift+Z and Ctrl+Y redo one, while the pointer is over the paper or
 * the canvas has focus. They are the painting's even with nothing to undo: a painter's reflex
 * must never edit the palette.
 */
export function paintUndoKey(c: Combo, x: PaintKeyContext): 'undo' | 'redo' | null {
  if (!c.ctrl || c.alt || x.fieldOwnsUndo || !(x.over || x.focused)) return null;
  if (c.key === 'Z') return c.shift ? 'redo' : 'undo';
  return c.key === 'Y' && !c.shift ? 'redo' : null;
}
