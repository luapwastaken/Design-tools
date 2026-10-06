// Edits the row, the inspector and the keyboard share. Each is one history step (spec §8).
import { hexToOklch, toHex, type Oklch } from '../../../shared/color/index.ts';
import { holdValue, valueOf } from '../../../shared/color/value.ts';
import type { DocController } from '../../../shared/doc-api.ts';
import { generate } from '../../../shared/palette/generate.ts';
import { gradientStops } from '../../../shared/palette/gradient.ts';
import { ROLES } from '../../../shared/palette/roles.ts';
import type { Swatch } from '../../../shared/types.ts';
import { shell } from '../../shell/core/index.ts';
import { pickFromScreen, toast } from '../../ui/index.ts';
import { nextV } from './adjust.ts';
import { suggestRoles } from './artboard.ts';
import { runGenerate } from './build.ts';
import { displayName, insertAfter, listNames, moveIds, newSwatch, plural, recolour, removeIds, type DesignDoc, type DesignView } from './doc.ts';
import { clearProposals, dropProposals, proposals, proposalsFrom, type Proposal } from './proposals.ts';
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

/** the active swatch's hue at the value the palette is missing most */
export function addSwatch(doc: Doc): void {
  const d = doc.get();
  const base = activeSwatch(d);
  const v = nextV(d.swatches.map((w) => valueOf(w.oklch)));
  const w = newSwatch(base ? holdValue(v, base.oklch[1], base.oklch[2]) : holdValue(v, 0.12, 250));
  doc.transact('Add swatch', (x) => insertAfter(x, base?.id ?? null, [w]));
  select([w.id]);
}

export function duplicate(doc: Doc): void {
  const d = doc.get();
  const ids = selection(d);
  if (!ids.length) return;
  // a copy is a new colour, never a second Illustration ramp step in the same place
  const copies = d.swatches.filter((w) => ids.includes(w.id)).map(({ group: _g, step: _s, edited: _e, ...w }) => ({ ...w, id: crypto.randomUUID(), name: w.name && `${w.name} copy` }));
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

/** a pinned (L) swatch is left alone: the toast says how to free it */
export function armDelete(doc: Doc): void {
  const d = doc.get();
  const ids = selection(d);
  if (!ids.length) return;
  const pinned = d.swatches.filter((w) => ids.includes(w.id) && getView().locked.includes(w.id));
  if (pinned.length) return void toast.show({ icon: 'lock', message: `${listNames(pinned.map(displayName))} ${pinned.length === 1 ? 'is' : 'are'} locked. Press L to unlock before deleting.` });
  armed.set(true);
}

/** L: pin or free the selected swatches (a view setting; the file never holds it) */
export function toggleLocked(doc: Doc): void {
  const d = doc.get();
  const ids = selection(d);
  if (!ids.length) return;
  const have = getView().locked.filter((id) => d.swatches.some((w) => w.id === id));
  const all = ids.every((id) => have.includes(id));
  patchView({ locked: all ? have.filter((id) => !ids.includes(id)) : [...new Set([...have, ...ids])] });
}

export function copyHex(w: Swatch): void {
  void navigator.clipboard.writeText(toHex(w.oklch).toUpperCase()).then(
    () => toast.show({ icon: 'content_copy', message: 'Copied hex.' }),
    () => toast.show({ kind: 'error', message: "Couldn't copy the hex." }),
  );
}

/** a job role belongs to one swatch: giving it to another takes it from the first (Undo brings it back) */
export function setRole(doc: Doc, id: string, role: string | null): void {
  const d = doc.get();
  const w = d.swatches.find((x) => x.id === id);
  if (!w || w.role === role) return;
  const job = role !== null && (ROLES as readonly string[]).includes(role);
  const from = job ? d.swatches.filter((x) => x.id !== id && x.role === role) : [];
  doc.transact(role ? `Set ${displayName(w)} to ${role}` : `Clear ${displayName(w)}'s role`, (x) => ({
    ...x,
    swatches: x.swatches.map((s) => (s.id === id ? { ...s, role } : job && s.role === role ? { ...s, role: null } : s)),
  }));
  if (!from.length) return;
  const after = doc.get();
  toast.show({
    icon: 'swap_horiz',
    message: `${role} moved from ${displayName(from[0])} to ${displayName(w)}.`,
    when: () => doc.get() === after,
    undo: () => void (doc.get() === after && doc.undo()),
  });
}

/** a "+" on the seam after `afterId`: a colour half way to the next one, in the gradient's space */
export function insertBetween(doc: Doc, afterId: string): void {
  const d = doc.get();
  const i = d.swatches.findIndex((w) => w.id === afterId);
  const [a, b] = [d.swatches[i], d.swatches[i + 1]];
  if (!a || !b) return;
  const w = newSwatch(gradientStops(a.oklch, b.oklch, 1, getView().space)[0]);
  doc.transact('Insert swatch', (x) => insertAfter(x, a.id, [w]));
  select([w.id]);
}

/** Alt+arrows: the selection one place along (a transform only, one history step) */
export function nudge(doc: Doc, dir: -1 | 1): void {
  const d = doc.get();
  const ids = selection(d);
  const at = d.swatches.map((w, i) => (ids.includes(w.id) ? i : -1)).filter((i) => i >= 0);
  if (!at.length || (dir < 0 ? at[0] === 0 : at.at(-1) === d.swatches.length - 1)) return;
  doc.transact(ids.length === 1 ? 'Reorder swatch' : `Reorder ${ids.length} swatches`, (x) => moveIds(x, ids, dir < 0 ? at[0] - 1 : at.at(-1)! + 2));
}

export function copySelected(doc: Doc): void {
  const w = activeSwatch(doc.get());
  if (w) copyHex(w);
}

/** A: every proposal on the board joins the palette */
export function keepAll(doc: Doc): void {
  const p = proposals.get();
  if (p) addProposals(doc, p.items);
}

/** Esc: the armed Delete first, then the proposals, then the selection */
export function escape(): void {
  if (armed.get()) return armed.set(false);
  if (proposals.get()) return clearProposals();
  select([]);
}

/** 1 to 7 and 0: the selected swatch's role */
export function roleSelected(doc: Doc, role: string | null): void {
  const w = activeSwatch(doc.get());
  if (w) setRole(doc, w.id, role);
}

/** a changed Style, Colours or Seed redoes the proposals Generate last made (and only those) */
export function regenerate(doc: Doc, patch: Partial<DesignView>): void {
  patchView(patch);
  if (proposalsFrom('generate')) runGenerate(doc.get().swatches, getView());
}

/**
 * Generate (Space), always with a new seed. On a palette that has colours the new ones land as
 * proposals beside its own (a locked proposal is kept through a reroll); an empty palette is made
 * in one step, roles suggested. Locks are view-state (L): the palette's own colours already count as
 * locked slots, so there is nothing to reroll in place.
 */
export function generateNow(doc: Doc, seed = 1 + Math.floor(Math.random() * 99999)): void {
  patchView({ seed });
  const v = getView();
  const d = doc.get();
  if (proposalsFrom('generate') || d.swatches.length) return runGenerate(d.swatches, v);
  const made = generate({ seed, count: v.count, preset: v.preset, locked: Array.from({ length: v.count }, () => null) });
  const roles = suggestRoles(made, new Set(), new Set());
  const next = made.map((o, i) => newSwatch(o, '', roles[i]));
  doc.transact('Generate palette', (x) => ({ ...x, swatches: next }));
  select([next[0].id]);
}
