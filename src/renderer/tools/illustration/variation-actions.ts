// What the Variations buttons and keys do: show, step, narrow and use a cell, lock a ramp, swap one colour,
// make ramps from what is in the picture. Each is a view change or one doc step; the grid itself is worked out
// in variations.ts.
import type { Oklch } from '../../../shared/color/index.ts';
import { nextSeed } from '../../../shared/palette/variations.ts';
import type { Shortcut } from '../../shell/tool.ts';
import { toast } from '../../ui/index.ts';
import { plural } from '../common/names.ts';
import { select, selected, type Doc } from './actions.ts';
import { baseOf, rampName, rampOf, recolour, type IllustrationDoc } from './doc.ts';
import { applyCell, cellsOf, fitsPicture, makeRamps, MAX_DEPTH, openCell, pictureOf, toggled, type Cell } from './variations.ts';
import { getView, patchView, type IllustrationView } from './view-state.ts';

/** Use this palette: one step, and a toast offers Undo (Ctrl+Z does the same) */
export function adoptCell(doc: Doc, cell: Cell): void {
  const v = getView();
  if (!fitsPicture(doc.get(), v)) return void toast.show({ icon: 'info', message: 'Press Make ramps first, so the ramps match what is ticked.' });
  patchView({ varOpen: 0 });
  if (applyCell(doc.get(), v, cell) === doc.get()) return void toast.show({ icon: 'info', message: 'The palette already has these.' });
  doc.transact(`Use variation ${cell.n}`, (d) => applyCell(d, getView(), cell));
  const after = doc.get();
  toast.show({
    icon: 'palette',
    message: `Using variation ${cell.n}, ${cell.label}.`,
    when: () => doc.get() === after,
    undo: () => void (doc.get() === after && doc.undo()),
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

/** a changed mode makes a new grid, which no open cell or narrowing belongs to */
export const setMode = (varMode: IllustrationView['varMode']): void => patchView({ varMode, varPath: [], varOpen: 0 });

/** More like this: the open cell stays as cell 1 and five close relatives follow it */
export function moreLikeThis(d: IllustrationDoc): void {
  const v = getView();
  if (!v.varOpen) return;
  if (v.varPath.length >= MAX_DEPTH) return void toast.show({ icon: 'info', message: 'That is as close as these get. Back to all starts again.' });
  const next = { ...v, varPath: [...v.varPath, v.varOpen], varOpen: 0 };
  if (cellsOf(d, next).length < 2) return void toast.show({ icon: 'lock', message: 'Every ramp is locked, so there is nothing to vary. Press L on one to unlock it.' });
  patchView({ varPath: next.varPath, varOpen: 0 });
}

// ── ramp locks ───────────────────────────────────────────────────────────────────────────────────

/** lock or unlock a ramp: it keeps its colour in every cell and every relative */
export const toggleRampLock = (id: string): void => patchView({ lockedRamps: toggled(getView().lockedRamps, id) });

/** L: the selected ramp */
export function lockSelected(doc: Doc): void {
  const id = selected(doc.get())?.group;
  if (id && rampOf(doc.get(), id)) toggleRampLock(id);
}

// ── the keys ─────────────────────────────────────────────────────────────────────────────────────

/** a button, link or field has the focus: Enter belongs to it */
const onControl = (): boolean => !!document.activeElement?.closest('button, a[href], input, textarea, [role="tab"], [role="menuitem"]');

/**
 * The Variations tab's keys (spec: Asked and answered 1): 1 to 6 open a cell, Space refills the grid, and
 * while one is open the arrows step, M narrows, Enter uses it and Esc closes it. They exist only while the
 * tab shows, so every other tab keeps the arrows' own steps. The other-colours row closes on Esc from any
 * tab, before the large view does. The keymap takes the first match, so these go first.
 */
export function variationKeys(doc: Doc): Shortcut[] {
  const v = getView();
  const swap: Shortcut[] = v.swapRamp && rampOf(doc.get(), v.swapRamp) ? [{ keys: 'Escape', label: 'Close the other-colours row', run: closeSwap }] : [];
  const d = doc.get();
  if (v.tab !== 'variations' || !d.ramps.length) return swap;
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

export const toggleSwap = (id: string): void => patchView({ swapRamp: getView().swapRamp === id ? '' : id });
export const closeSwap = (): void => patchView({ swapRamp: '' });

/** a swapped colour: one step, the row stays open on the new ramp so several can be tried */
export function swapTo(doc: Doc, id: string, colour: Oklch): void {
  const d = doc.get();
  const [r, base] = [rampOf(d, id), baseOf(d, id)];
  if (r && base) doc.transact(`Swap ${rampName(d, r)}`, (x) => recolour(x, base.id, colour));
}

// ── What's in the picture ────────────────────────────────────────────────────────────────────────

/** tick or untick one subject */
export function toggleKind(kind: string): void {
  const { pictureOn } = getView();
  patchView({ pictureOn: pictureOn.includes(kind) ? pictureOn.filter((k) => k !== kind) : [...pictureOn, kind], varPath: [], varOpen: 0 });
}

/** the tone skin or hair takes (a changed picture makes a new grid, which no open cell or narrowing belongs to) */
export const setTone = (kind: string, tone: string): void => patchView({ pictureTones: { ...getView().pictureTones, [kind]: tone }, varPath: [], varOpen: 0 });

/**
 * Make ramps: the scene's ramps replaced by one per ticked subject, one undo step. The locks are not touched:
 * they name the old ramps, which are gone, so they do nothing, and Undo brings the ramps and their locks back
 * together (see lockedIn).
 */
export function makeFromPicture(doc: Doc): void {
  const v = getView();
  const picked = pictureOf(v);
  if (!picked.length) return;
  const before = doc.get();
  doc.transact(`Make ${plural(picked.length, 'ramp')}`, (d) => makeRamps(d, getView()));
  const after = doc.get();
  patchView({ swapRamp: '', varPath: [], varOpen: 0 });
  select(baseOf(after, after.ramps[0]?.id)?.id ?? null);
  toast.show({
    icon: 'auto_awesome_motion',
    message: `Made ${plural(picked.length, 'ramp')}.${before.ramps.length ? ` Undo brings back the ${before.ramps.length} before.` : ''}`,
    when: () => doc.get() === after,
    undo: () => void (doc.get() === after && doc.undo()),
  });
}
