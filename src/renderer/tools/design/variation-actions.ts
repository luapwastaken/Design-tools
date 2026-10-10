// What the Variations buttons and keys do: show, step, narrow and use a cell, swap one colour. Each is a view
// change or one doc step; the grid itself is worked out in variations.ts.
import type { Oklch } from '../../../shared/color/index.ts';
import type { Role } from '../../../shared/palette/roles.ts';
import { nextSeed, type DesignCell } from '../../../shared/palette/variations.ts';
import type { Shortcut } from '../../shell/tool.ts';
import { toast } from '../../ui/index.ts';
import type { Doc } from './actions.ts';
import { jobHolders, recolour, type DesignDoc } from './doc.ts';
import { applyRoles, cellsOf, MAX_DEPTH, openCell } from './variations.ts';
import { getView, patchView } from './view-state.ts';

/** Use this palette: one step, the Style and Accent it was built with come along, and a toast offers Undo that takes them back too */
export function adoptCell(doc: Doc, cell: DesignCell): void {
  const v = getView();
  const before = { preset: v.preset, accent: v.accent };
  patchView({ varOpen: 0 });
  if (applyRoles(doc.get(), cell.roles, v.locked) === doc.get()) return void toast.show({ icon: 'info', message: 'The palette already has these colours.' });
  doc.transact(`Use variation ${cell.n}`, (d) => applyRoles(d, cell.roles, getView().locked));
  patchView({ preset: cell.style, accent: cell.accent });
  const after = doc.get();
  toast.show({
    icon: 'palette',
    message: `Using variation ${cell.n}, ${cell.label}.`,
    when: () => doc.get() === after,
    undo: () => {
      if (doc.get() !== after) return;
      doc.undo();
      patchView(before);
    },
  });
}

// ── moving about the grid ────────────────────────────────────────────────────────────────────────

export const showCell = (n: number): void => patchView({ varOpen: n });
export const closeCell = (): void => patchView({ varOpen: 0 });

/** Previous and Next: round the cells */
export function stepCell(count: number, dir: -1 | 1): void {
  const at = getView().varOpen;
  if (at) patchView({ varOpen: ((at - 1 + dir + count) % count) + 1 });
}

/** New set (Space): six new palettes, and the way back from More like this */
export const newSet = (): void => patchView({ varSeed: nextSeed(getView().varSeed), varPath: [], varOpen: 0 });

/** Back to all: the six this grid began with */
export const backToAll = (): void => patchView({ varPath: [], varOpen: 0 });

/** More like this: the open cell stays as cell 1 and five close relatives follow it */
export function moreLikeThis(d: DesignDoc): void {
  const v = getView();
  if (!v.varOpen) return;
  if (v.varPath.length >= MAX_DEPTH) return void toast.show({ icon: 'info', message: 'That is as close as these get. Back to all starts again.' });
  const next = { ...v, varPath: [...v.varPath, v.varOpen], varOpen: 0 };
  if (cellsOf(d, next).length < 2) return void toast.show({ icon: 'lock', message: 'Every colour is locked, so there is nothing to vary. Press L on one to unlock it.' });
  patchView({ varPath: next.varPath, varOpen: 0 });
}

// ── the keys ─────────────────────────────────────────────────────────────────────────────────────

/** a button, link or field has the focus: Enter belongs to it */
const onControl = (): boolean => !!document.activeElement?.closest('button, a[href], input, textarea, [role="tab"], [role="menuitem"]');

/**
 * The Variations tab's keys (spec: Asked and answered 1): 1 to 6 open a cell, Space refills the grid, and
 * while one is open the arrows step, M narrows, Enter uses it and Esc closes it. They exist only while the
 * tab shows, so every other tab keeps Design's own 1 to 7, arrows and Space. The other-colours row closes on
 * Esc from any tab, before the large view does. The keymap takes the first match, so these go first.
 */
export function variationKeys(doc: Doc): Shortcut[] {
  const v = getView();
  const swap: Shortcut[] = v.swapRole ? [{ keys: 'Escape', label: 'Close the other-colours row', run: closeSwap }] : [];
  const d = doc.get();
  if (v.tab !== 'variations' || !d.swatches.length) return swap;
  const cells = cellsOf(d, v);
  const open = openCell(cells, v);
  return [
    ...swap,
    ...cells.map((c): Shortcut => ({ keys: String(c.n), label: `Variations: show ${c.n} larger`, run: () => showCell(c.n) })),
    { keys: 'Space', label: 'Variations: a new set', run: newSet },
    ...(open
      ? [
          { keys: 'ArrowLeft', label: 'Variations: previous', run: () => stepCell(cells.length, -1) },
          { keys: 'ArrowRight', label: 'Variations: next', run: () => stepCell(cells.length, 1) },
          { keys: 'M', label: 'Variations: more like this', run: () => moreLikeThis(d) },
          { keys: 'Escape', label: 'Variations: close', run: closeCell },
          // a focused button keeps its own Enter
          ...(onControl() ? [] : [{ keys: 'Enter', label: 'Variations: use this palette', run: () => adoptCell(doc, open) }]),
        ]
      : []),
  ];
}

// ── Swap one colour ──────────────────────────────────────────────────────────────────────────────

export const toggleSwap = (role: Role): void => patchView({ swapRole: getView().swapRole === role ? '' : role });
export const closeSwap = (): void => patchView({ swapRole: '' });

/** a swapped colour: one step, the row stays open on the new palette so several can be tried */
export function swapTo(doc: Doc, role: Role, colour: Oklch): void {
  const w = jobHolders(doc.get().swatches).find(([r]) => r === role)?.[1];
  if (!w) return;
  doc.transact(`Swap ${role}`, (d) => recolour(d, { [w.id]: colour }));
}
