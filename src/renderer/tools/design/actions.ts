// Edits the row, the inspector and the keyboard share. Each is one history step (spec §8).
import { hexToOklch, type Oklch } from '../../../shared/color/index.ts';
import type { DocController } from '../../../shared/doc-api.ts';
import { fitChroma } from '../../../shared/palette/space.ts';
import { shell } from '../../shell/core/index.ts';
import { pickFromScreen, toast } from '../../ui/index.ts';
import { nextL } from './adjust.ts';
import { displayName, insertAfter, listNames, newSwatch, plural, recolour, removeIds, type DesignDoc, type DesignView } from './doc.ts';
import { clearProposals, dropProposals, type Proposal } from './proposals.ts';
import { armed, getView, patchView } from './view-state.ts';

export type Doc = DocController<DesignDoc>;

/** the selected swatches that still exist, in selection order; the first swatch when none is */
export function selection(d: DesignDoc, v: DesignView = getView()): string[] {
  const ids = v.selected.filter((id) => d.swatches.some((w) => w.id === id));
  return ids.length || !d.swatches.length ? ids : [d.swatches[0].id];
}

export const activeSwatch = (d: DesignDoc, v?: DesignView) => d.swatches.find((w) => w.id === selection(d, v)[0]) ?? null;

export const select = (ids: string[]): void => patchView({ selected: ids });

export const focusChip = (id: string | undefined): void =>
  void requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-swatch="${id}"]`)?.focus({ preventScroll: false }));

/** click: one; Ctrl: toggle, the active one staying first; Shift: the run from the active one */
export function clickSelect(d: DesignDoc, id: string, how: { ctrl: boolean; shift: boolean }): void {
  const cur = selection(d);
  if (how.shift && cur.length) {
    const ids = d.swatches.map((w) => w.id);
    const [a, b] = [ids.indexOf(cur[0]), ids.indexOf(id)].sort((x, y) => x - y);
    select([cur[0], ...ids.slice(a, b + 1).filter((x) => x !== cur[0])]);
  } else if (how.ctrl) select(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  else select([id]);
}

/** arrow keys: the neighbour becomes the one selected swatch */
export function step(doc: Doc, dir: -1 | 1): void {
  const d = doc.get();
  // the arrows belong to whatever has focus outside the tool (the rail, the Library)
  const el = document.activeElement;
  if (!d.swatches.length || (el && el !== document.body && !el.closest('[data-tool="design"]'))) return;
  const i = d.swatches.findIndex((w) => w.id === selection(d)[0]);
  const next = d.swatches[Math.min(d.swatches.length - 1, Math.max(0, i + dir))].id;
  select([next]);
  if (document.activeElement?.closest('[data-swatch]')) focusChip(next);
}

/** the active swatch's hue at the lightness the palette is missing most */
export function addSwatch(doc: Doc): void {
  const d = doc.get();
  const base = activeSwatch(d);
  const l = nextL(d.swatches.map((w) => w.oklch[0]));
  const w = newSwatch(base ? fitChroma([l, base.oklch[1], base.oklch[2]]) : [l, 0.12, 250]);
  doc.transact('Add swatch', (x) => insertAfter(x, base?.id ?? null, [w]));
  select([w.id]);
}

export function duplicate(doc: Doc): void {
  const d = doc.get();
  const ids = selection(d);
  if (!ids.length) return;
  const copies = d.swatches.filter((w) => ids.includes(w.id)).map((w) => ({ ...w, id: crypto.randomUUID(), name: w.name && `${w.name} copy` }));
  const last = d.swatches.filter((w) => ids.includes(w.id)).at(-1)!.id;
  doc.transact(copies.length === 1 ? 'Duplicate swatch' : `Duplicate ${copies.length} swatches`, (x) => insertAfter(x, last, copies));
  select(copies.map((w) => w.id));
}

/** after the armed confirm: one step, and an Undo toast (brief rule 3) */
export function deleteSelected(doc: Doc): void {
  armed.set(false);
  const d = doc.get();
  const ids = selection(d);
  const gone = d.swatches.filter((w) => ids.includes(w.id));
  if (!gone.length) return;
  const i = d.swatches.findIndex((w) => w.id === ids[0]);
  doc.transact(gone.length === 1 ? `Delete ${displayName(gone[0])}` : `Delete ${gone.length} swatches`, (x) => removeIds(x, ids));
  const after = doc.get();
  const next = after.swatches[Math.min(i, after.swatches.length - 1)]?.id;
  select(next ? [next] : []);
  focusChip(next);
  toast.show({
    icon: 'delete',
    message: gone.length === 1 ? `Removed swatch ${displayName(gone[0])}.` : `Removed ${listNames(gone.map(displayName).slice(0, 3))}${gone.length > 3 ? ` and ${gone.length - 3} more` : ''}.`,
    when: () => doc.get() === after,
    undo: () => {
      if (doc.get() !== after) return void toast.show({ icon: 'info', message: 'The delete is no longer the last step. Use Undo in the tool.' });
      doc.undo();
      select(ids);
    },
  });
}

export function addProposals(doc: Doc, items: Proposal[]): void {
  if (!items.length) return;
  const add = items.map((p) => newSwatch(p.oklch, p.name ?? ''));
  doc.transact(items.length === 1 ? 'Add colour' : `Add ${plural(items.length, 'colour')}`, (d) => insertAfter(d, null, add));
  dropProposals(items.map((p) => p.id));
  // the first one, in the inspector: selecting all would read as editing all of them
  select([add[0].id]);
}

/** an empty palette in place of this one: one undoable step; the first edit makes Scratch/Untitled palette N (spec §7.1) */
export async function newPalette(): Promise<void> {
  armed.set(false);
  clearProposals(); // they were built for the palette that was open
  select([]);
  await shell.newDoc('design');
}

export function setColours(doc: Doc, label: string, changes: Record<string, Oklch>): void {
  doc.transact(label, (d) => recolour(d, changes));
}

/** any pixel on screen (native EyeDropper): into the active swatch, or a new one */
export async function eyedrop(doc: Doc): Promise<void> {
  const hex = await pickFromScreen();
  if (!hex) return;
  const o = hexToOklch(hex);
  const active = activeSwatch(doc.get());
  if (active) setColours(doc, 'Pick colour from screen', { [active.id]: o });
  else {
    const w = newSwatch(o);
    doc.transact('Add swatch', (d) => insertAfter(d, null, [w]));
    select([w.id]);
  }
}

export const armDelete = (doc: Doc): void => void (selection(doc.get()).length && armed.set(true));
