// Edits the ramps, the inspector and the keyboard share. Each is one history step (foundation spec §8).
import { hexToOklch, type Oklch } from '../../../shared/color/index.ts';
import type { DocController } from '../../../shared/doc-api.ts';
import { fitChroma, wrapHue } from '../../../shared/palette/space.ts';
import type { MaterialId, Swatch } from '../../../shared/types.ts';
import { shell } from '../../shell/core/index.ts';
import { pickFromScreen, toast } from '../../ui/index.ts';
import { plural } from '../common/names.ts';
import { addRamp, addSet, baseOf, carryLight, duplicateRamp, lightForAll, isLayer, LAYER_COLOURS, looseOf, looseSets, makeRamps, MAX_RAMPS, moveRamp, nameOf, rampName, rampOf, removeLoose, removeRamp, stepsOf, type IllustrationDoc } from './doc.ts';
import { materialFromName, sceneLight } from './scene.ts';
import { clearProposals, dropProposals, keptLoose, LAYERS_LABEL, proposals, restoreProposals, type Proposal } from './proposals.ts';
import { armed, getView, patchView } from './view-state.ts';

export type Doc = DocController<IllustrationDoc>;

/** the ramp of the last selection seen, so a step that goes (fewer steps, an undo) leaves its ramp's base selected */
let lastRamp: string | undefined;

/** the selected swatch while it exists; else the base of its ramp, the first ramp's, or the first loose colour */
export function selected(d: IllustrationDoc, id: string | null = getView().selected): Swatch | null {
  const w = d.swatches.find((x) => x.id === id);
  if (w) lastRamp = w.group;
  return w ?? (lastRamp !== undefined ? baseOf(d, lastRamp) : null) ?? (d.ramps[0] && baseOf(d, d.ramps[0].id)) ?? d.swatches[0] ?? null;
}

export const select = (id: string | null): void => patchView({ selected: id });

export const focusStep = (id: string | undefined): void =>
  void requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-step="${id}"]`)?.focus({ preventScroll: false }));

/** the rows as the ramps area shows them: each ramp's steps, then each group of loose colours as a row */
export const rows = (d: IllustrationDoc): Swatch[][] => [...d.ramps.map((r) => stepsOf(d, r.id)), ...looseSets(d).map((g) => g.list)];

/**
 * Arrows: left and right along a ramp, up and down to the neighbouring ramp at the same place. Only
 * while focus is in the tool or nowhere, so the rail and the Library keep theirs.
 */
export function move(doc: Doc, dx: number, dy: number): void {
  const d = doc.get();
  const el = document.activeElement;
  if (!d.swatches.length || (el && el !== document.body && !el.closest('[data-tool="illustration"]'))) return;
  const grid = rows(d);
  const cur = selected(d);
  const y = Math.max(0, grid.findIndex((r) => r.some((w) => w.id === cur?.id)));
  const x = Math.max(0, grid[y].findIndex((w) => w.id === cur?.id));
  const ny = Math.min(grid.length - 1, Math.max(0, y + dy));
  // up and down keep the step (base to base), not the column
  const row = grid[ny];
  const target = dy && cur?.step !== undefined ? (row.find((w) => w.step === cur.step) ?? row[Math.min(x, row.length - 1)]) : row[Math.min(row.length - 1, Math.max(0, x + dx))];
  select(target.id);
  if (document.activeElement?.closest('[data-step]')) focusStep(target.id);
}

/** the middle of the widest gap the bases leave in 0.4..0.8, so a new ramp doesn't share their values */
function freeL(ls: number[]): number {
  const stops = [0.4, ...ls.filter((l) => l > 0.4 && l < 0.8).sort((a, b) => a - b), 0.8];
  const i = stops.slice(1).reduce((best, s, j) => (s - stops[j] > stops[best + 1] - stops[best] ? j : best), 0);
  return (stops[i] + stops[i + 1]) / 2;
}

/** a golden-angle step in hue from the last base, at a lightness the others leave free */
export const nextBase = (d: IllustrationDoc): Oklch => {
  const last = d.ramps.at(-1);
  if (!last) return fitChroma([0.62, 0.12, 40]);
  return fitChroma([freeL(d.ramps.map((r) => r.base[0])), Math.max(0.08, last.base[1]), wrapHue(last.base[2] + 137.5)]);
};

/**
 * the picker's colour field takes focus, so making a colour exactly yours is: Add, type, Enter.
 * Only after an add from the button, a menu row or the hex field: Shift+A, repeated, keeps the keys.
 */
export function focusPickerColour(): void {
  const find = () => [...document.querySelectorAll('[data-tool="illustration"] section')].find((x) => x.querySelector('h2')?.textContent === 'Colour picker');
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (find()) return void find()!.querySelector<HTMLInputElement>('input[aria-label$="colour" i]')?.focus({ preventScroll: true });
      // Variations, Light zones and Layers hide the picker: go back to the first tab, where it is, and focus it there
      patchView({ tab: 'settings' });
      requestAnimationFrame(() => find()?.querySelector<HTMLInputElement>('input[aria-label$="colour" i]')?.focus({ preventScroll: true }));
    }),
  );
}

/** true (and says why) when the palette has no room for another ramp: every way of adding one asks first */
export function paletteFull(d: IllustrationDoc): boolean {
  if (d.ramps.length < MAX_RAMPS) return false;
  toast.show({ icon: 'info', message: `This palette already holds ${MAX_RAMPS} ramps. Delete one to add more.` });
  return true;
}

/**
 * a new ramp after the selected one; the colour: given, or the one the picker shows (a hue well away from
 * the last when there is none). Lit as the others are. `material`: given, or guessed from a subject's name,
 * else Cloth; `focus`: see the sources
 */
export function addBase(doc: Doc, oklch: Oklch = selected(doc.get())?.oklch ?? nextBase(doc.get()), name = '', opts: { material?: MaterialId; focus?: boolean } = {}): void {
  if (paletteFull(doc.get())) return;
  const after = selected(doc.get())?.group ?? null;
  let base = '';
  doc.transact('Add base colour', (d) => {
    const r = addRamp(d, oklch, name, rampOf(d, after ?? undefined) ? after : null, opts.material ?? materialFromName(name));
    base = r.base;
    return r.doc;
  });
  select(base);
  if (opts.focus) focusPickerColour();
}

/** `keepAll`: the Keep all button, not a chip: for the layer colours that replaces the set kept before */
export function addProposals(doc: Doc, all: Proposal[], keepAll = false): void {
  // the layer colours and the zone colours are not flats: they land as groups of loose swatches (they still travel in the exports) and never feed the recipe
  const label = proposals.get()?.label;
  const loose = keptLoose(label);
  const room = MAX_RAMPS - doc.get().ramps.length;
  const items = loose ? all : all.slice(0, Math.max(0, room));
  if (items.length < all.length) toast.show({ kind: 'error', message: room > 0 ? `A palette holds ${MAX_RAMPS} ramps: ${plural(items.length, 'colour')} added, ${all.length - items.length} left out.` : `This palette already holds ${MAX_RAMPS} ramps. Delete one to add more.` });
  if (!items.length) return;
  const was = proposals.get();
  const before = doc.get();
  let first = '';
  // Keep all of the layer colours stands for the set before it (a changed Light made that stale); a chip joins the set
  const everyLayer = label === LAYERS_LABEL && keepAll;
  doc.transact(loose ? `Add ${plural(items.length, label === LAYERS_LABEL ? 'layer colour' : 'zone colour')}` : items.length === 1 ? 'Add base colour' : `Add ${plural(items.length, 'base colour')}`, (d) => {
    if (loose) {
      const r = addSet(d, items.map((p) => ({ oklch: p.oklch, name: p.name ?? '', set: label === LAYERS_LABEL ? LAYER_COLOURS : (p.set ?? 'Zones') })), everyLayer);
      first = r.id;
      return r.doc;
    }
    return items.reduce((x, p, i) => {
      const r = addRamp(x, p.oklch, p.name ?? '', null, p.material ?? materialFromName(p.name));
      if (!i) first = r.base;
      return r.doc;
    }, d);
  });
  const after = doc.get();
  dropProposals(items.map((p) => p.id));
  select(first);
  // undoing the add offers them again; any other change ends that
  const off = doc.subscribe(() => {
    const now = doc.get();
    if (now === after) return;
    off();
    if (now === before) restoreProposals(was?.label ?? '', items, was?.from);
  });
}

/** a flat palette's colours (or the loose ones of this; `ids`: just those) each become a ramp's base */
export function rampsFromLoose(doc: Doc, ids = looseOf(doc.get()).filter((w) => !isLayer(w)).map((w) => w.id)): void {
  if (!ids.length || paletteFull(doc.get())) return;
  const room = MAX_RAMPS - doc.get().ramps.length;
  if (ids.length > room) {
    toast.show({ icon: 'info', message: `A palette holds ${MAX_RAMPS} ramps: ${plural(room, 'colour')} made, ${ids.length - room} left as they are.` });
    ids = ids.slice(0, room);
  }
  doc.transact(ids.length === 1 ? 'Make a ramp' : `Make ${ids.length} ramps`, (d) => makeRamps(d, ids));
  select(ids[0]);
}

/** the ramp's light and shadow on every ramp, one step */
export function lightEveryRamp(doc: Doc, id: string): void {
  const r = rampOf(doc.get(), id);
  if (r) doc.transact(`Light every ramp as ${rampName(doc.get(), r)}`, (d) => lightForAll(d, id));
}

export function duplicate(doc: Doc, id = selected(doc.get())?.group): void {
  if (!id || !rampOf(doc.get(), id) || paletteFull(doc.get())) return;
  let copy = '';
  doc.transact(`Duplicate ${rampName(doc.get(), rampOf(doc.get(), id)!)}`, (d) => {
    const r = duplicateRamp(d, id);
    copy = r.id;
    return r.doc;
  });
  select(baseOf(doc.get(), copy)?.id ?? null);
}

export function reorder(doc: Doc, id: string, index: number): void {
  const d = doc.get();
  const r = rampOf(d, id);
  if (!r) return;
  doc.transact(`Move ${rampName(d, r)}`, (x) => moveRamp(x, id, index));
}

/** Delete's confirm: on the selected ramp, or on the selected colour when it is in no ramp */
export function arm(doc: Doc, id?: string): void {
  const d = doc.get();
  const w = selected(d);
  const target = id ?? (rampOf(d, w?.group) ? w!.group : w?.id);
  if (target && (rampOf(d, target) || looseOf(d).some((x) => x.id === target))) armed.set(target);
}

/** after the armed confirm on a colour in no ramp: one step, and an Undo toast (brief rule 3) */
export function deleteLoose(doc: Doc, id: string): void {
  armed.set(null);
  const d = doc.get();
  const loose = looseOf(d);
  const w = loose.find((x) => x.id === id);
  if (!w) return;
  const name = nameOf(d, w);
  const i = loose.indexOf(w);
  doc.transact(`Delete ${name}`, (x) => removeLoose(x, id));
  const after = doc.get();
  const rest = looseOf(after);
  const land = rest[Math.min(i, rest.length - 1)]?.id ?? (after.ramps[0] && baseOf(after, after.ramps[0].id)?.id);
  select(land ?? null);
  focusStep(land);
  toast.show({
    icon: 'delete',
    message: `Removed ${name}.`,
    when: () => doc.get() === after,
    undo: () => {
      if (doc.get() !== after) return void toast.show({ icon: 'info', message: 'The delete is no longer the last step. Use Undo in the tool.' });
      doc.undo();
      select(id);
    },
  });
}

/** after the armed confirm: one step, and an Undo toast (brief rule 3) */
export function deleteRamp(doc: Doc, id: string): void {
  armed.set(null);
  const d = doc.get();
  const r = rampOf(d, id);
  if (!r) return;
  const name = rampName(d, r);
  const i = d.ramps.indexOf(r);
  doc.transact(`Delete ${name}`, (x) => removeRamp(x, id));
  const after = doc.get();
  const next = after.ramps[Math.min(i, after.ramps.length - 1)];
  const land = next ? baseOf(after, next.id)?.id : after.swatches[0]?.id;
  select(land ?? null);
  focusStep(land);
  toast.show({
    icon: 'delete',
    message: `Removed the ${name} ramp.`,
    when: () => doc.get() === after,
    undo: () => {
      if (doc.get() !== after) return void toast.show({ icon: 'info', message: 'The delete is no longer the last step. Use Undo in the tool.' });
      doc.undo();
      select(baseOf(doc.get(), id)?.id ?? null);
    },
  });
}

/**
 * an empty palette in place of this one: one undoable step; the first edit makes Scratch/Untitled palette N (or `name`).
 * It starts in the light this one is in (unless its ramps disagree): a scene is often several palettes.
 */
export async function newPalette(doc: Doc, name?: string): Promise<void> {
  const { pair, mixed } = sceneLight(doc.get());
  if (!mixed) carryLight(pair);
  armed.set(null);
  clearProposals();
  select(null);
  await shell.newDoc('illustration', name);
}

/** any pixel on screen (native EyeDropper): always a new base, never over the selected colour (the picker's own eyedropper does that) */
export async function eyedrop(doc: Doc, pick: () => Promise<string | null> = pickFromScreen): Promise<void> {
  const hex = await pick();
  if (hex) addBase(doc, hexToOklch(hex), '', { focus: true });
}
