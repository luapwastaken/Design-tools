// What a one-click check fix says it did: a toast naming each colour that moved, with Undo.
import { toHex, type Oklch } from '../../../shared/color/index.ts';
import { valueOf } from '../../../shared/color/value.ts';
import type { Swatch } from '../../../shared/types.ts';
import { toast } from '../../ui/index.ts';
import { listNames } from './names.ts';

/** a fix is one history step: the toast's Undo answers only while it is still the last */
type Undoable = { get(): unknown; undo(): void };

/**
 * `before` is the palette as the checks name it (blank names filled in); `changes` is what the fix
 * wrote, by swatch id. "Moved Wine L 21 to 27." for a contrast fix (`measure` L), V for value moves.
 */
export function toastMoved(doc: Undoable, before: Swatch[], changes: Record<string, Oklch>, measure: 'L' | 'V' = 'L', extra = ''): void {
  const moved = before.filter((w) => changes[w.id] && changes[w.id].some((x, i) => x !== w.oklch[i]));
  if (!moved.length) return;
  const num = (o: Oklch) => Math.round((measure === 'L' ? o[0] : valueOf(o)) * 100);
  const one = (w: Swatch) => `${w.name || toHex(w.oklch)} ${measure} ${num(w.oklch)} to ${num(changes[w.id])}`;
  const after = doc.get();
  toast.show({
    icon: 'swap_horiz',
    message: `${moved.length > 3 ? `Moved ${moved.length} colours.` : `Moved ${listNames(moved.map(one))}.`}${extra}`,
    when: () => doc.get() === after,
    undo: () => void (doc.get() === after && doc.undo()),
  });
}
