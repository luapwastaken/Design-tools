// Variations, the parts that need no screen: the six cells for a palette and the view, a cell written into the
// palette, the ramp locks, the other colours a ramp could take, the ramps a picture's subjects make. Seeded and
// pure, so it is unit tested (test/illustration-variations.test.ts); what the buttons and keys do with them is
// in variation-actions.ts.
import { toHex, type Oklch } from '../../../shared/color/index.ts';
import {
  COUNT, KINDS, MAX_DEPTH, pickedIds, rampAlternatives, rampsFor, relatives, sameLightPair, subjectBases, colourCells, lightCells,
  type Base, type ColourCell, type LightCell, type Ramp, type RampAlt,
} from '../../../shared/palette/variations.ts';
import type { RampSpec } from '../../../shared/types.ts';
import { baseOf, rampName, rampOf, recolour, replaceRamps, setScene, type IllustrationDoc } from './doc.ts';
import { lookOf, type Look } from './shade.ts';
import { presetOf, sceneLight, type LightPair } from './scene.ts';
import type { IllustrationView } from './view-state.ts';

export { MAX_DEPTH };

/** a cell of either grid: the colours' (bases under the current light) or the light's (the current bases under a light) */
export type Cell = ColourCell | LightCell;

// ── ramp locks ───────────────────────────────────────────────────────────────────────────────────

/** a view holds at most this many ramp ids: the oldest go, so a workspace does not collect every ramp ever locked */
const LOCK_CAP = 64;

/**
 * The ramps that are locked now: the saved ids that name a ramp of this palette. An id for a ramp that is not
 * here is kept, not dropped, and does nothing: Make ramps gives every ramp a new id, so the locks are gone, and
 * an undo brings the old ramps back with their ids, and so their locks. That is why the view is never tidied
 * against the palette.
 */
export const lockedIn = (d: IllustrationDoc, v: Pick<IllustrationView, 'lockedRamps'>): string[] => v.lockedRamps.filter((id) => d.ramps.some((r) => r.id === id));

/** the saved lock list as a workspace may hold it: ids only, each once, the newest 64 */
export const cleanLocks = (raw: unknown): string[] => (Array.isArray(raw) ? [...new Set(raw.filter((x): x is string => typeof x === 'string' && x !== ''))].slice(-LOCK_CAP) : []);

/** the list with `id` locked, or unlocked if it was */
export const toggled = (list: string[], id: string): string[] => cleanLocks(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

// ── what the view holds ──────────────────────────────────────────────────────────────────────────

/** the narrowing path as a workspace may hold it: cell numbers, at most MAX_DEPTH */
export const cleanPath = (raw: unknown): number[] => (Array.isArray(raw) ? raw.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= COUNT).slice(0, MAX_DEPTH) : []);

/** the cell number, or 0 for none */
export const cleanCell = (n: unknown): number => (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= COUNT ? n : 0);

/** What's in the picture as a workspace may hold it: only the nine subjects, and a tone only for skin and hair, only one of theirs */
export function cleanPicture(on: unknown, tones: unknown): { pictureOn: string[]; pictureTones: Record<string, string> } {
  const kinds = KINDS.map((k) => k.kind);
  const raw = typeof tones === 'object' && tones !== null && !Array.isArray(tones) ? (tones as Record<string, unknown>) : {};
  return {
    pictureOn: Array.isArray(on) ? kinds.filter((k) => on.includes(k)) : [],
    pictureTones: Object.fromEntries(KINDS.flatMap((k) => (k.tones?.some((t) => t.id === raw[k.kind]) ? [[k.kind, raw[k.kind] as string]] : []))),
  };
}

// ── the cells ────────────────────────────────────────────────────────────────────────────────────

/** the palette's ramps as the bases the grid starts from, a locked ramp marked so it is in every cell */
export function basesOf(d: IllustrationDoc, v: Pick<IllustrationView, 'lockedRamps'>): Base[] {
  const locks = new Set(lockedIn(d, v));
  return d.ramps.map((r) => ({ name: rampName(d, r), base: baseOf(d, r.id)?.oklch ?? r.base, material: r.material, ...(locks.has(r.id) && { locked: true }) }));
}

/** the ramp a cell's ramps are built like: the scene's own steps, intensity, push, hue shift and saturation */
const likeOf = (d: IllustrationDoc): RampSpec | null => d.ramps.at(-1) ?? null;

/** the subjects ticked in What's in the picture, as SUBJECTS ids in the order their ramps are made */
export const pictureOf = (v: Pick<IllustrationView, 'pictureOn' | 'pictureTones'>): string[] => pickedIds(v.pictureOn, v.pictureTones);

let made: { key: string; cells: Cell[] } | null = null;

/**
 * The grid for this palette: six palettes (Vary the colours: sets, mixes and presets, or, while anything is
 * ticked, the ticked subjects varied; Vary the light: five presets and an in-between light), then as many More
 * like this steps as the path holds, each the cell chosen before as cell 1 with its relatives. Locked ramps are
 * in every cell. Worked out once per state: a key lists only what the grid reads.
 */
export function cellsOf(d: IllustrationDoc, v: IllustrationView): Cell[] {
  if (!d.ramps.length) return [];
  const bases = basesOf(d, v);
  const { pair } = sceneLight(d);
  const subjects = v.varMode === 'colours' ? pictureOf(v) : [];
  const like = likeOf(d);
  const key = JSON.stringify([v.varSeed, v.varMode, v.varPath, subjects, bases, pair, like && [like.steps, like.intensity, like.push, like.hueShift, like.chromaCurve]]);
  if (made?.key === key) return made.cells;
  let cells: Cell[] = v.varMode === 'light' ? lightCells({ seed: v.varSeed, bases, current: pair }) : colourCells({ seed: v.varSeed, current: bases, light: pair, subjects });
  v.varPath.forEach((pick, i) => {
    const parent = cells[pick - 1];
    if (!parent) return;
    cells = v.varMode === 'light' ? relatives(parent as LightCell, i + 1, v.varSeed + i + 1) : relatives(parent as ColourCell, i + 1, v.varSeed + i + 1);
  });
  made = { key, cells };
  return cells;
}

/** the cell shown large, if one is and still exists */
export const openCell = (cells: Cell[], v: Pick<IllustrationView, 'varOpen'>): Cell | null => cells[v.varOpen - 1] ?? null;

const rampsOfCell = new WeakMap<Cell, Ramp[]>();

/** a cell's ramps: its bases developed under its light, built as the scene's ramps are */
export function cellRamps(d: IllustrationDoc, cell: Cell): Ramp[] {
  let list = rampsOfCell.get(cell);
  if (!list) rampsOfCell.set(cell, (list = rampsFor(cell.bases, cell.light, likeOf(d))));
  return list;
}

const looks = new WeakMap<Ramp, Look>();

/** a ramp lit as the cell's light says, made once per ramp: the same Look draws its small ball and its large one */
export function lookFor(ramp: Ramp, light: LightPair): Look {
  let look = looks.get(ramp);
  if (!look) looks.set(ramp, (look = lookOf({ steps: ramp.steps.map((s) => s.oklch), material: ramp.material, light: light.light })));
  return look;
}

/** the light's name: the preset it is, or what the cell calls it, or Custom */
export const lightName = (cell: Cell): string => ('presetId' in cell ? cell.label : (presetOf(cell.light)?.label ?? 'Custom light'));

/** the palette already is this cell: its bases (Vary the colours) or its light (Vary the light) */
export function inUse(d: IllustrationDoc, v: IllustrationView, cell: Cell): boolean {
  if (v.varMode === 'light') {
    const s = sceneLight(d);
    return !s.mixed && sameLightPair(s.pair, cell.light);
  }
  const mine = basesOf(d, v);
  return mine.length === cell.bases.length && mine.every((b, i) => toHex(b.base) === toHex(cell.bases[i].base));
}

// ── using a cell ─────────────────────────────────────────────────────────────────────────────────

/**
 * The cell written into the palette. Vary the colours: each unlocked ramp's base takes the cell's colour (its
 * unedited steps follow; steps edited by hand stay, as regenerate promises). Vary the light: the cell's light
 * pair goes to every ramp. The very same doc comes back when nothing would change.
 */
export function applyCell(d: IllustrationDoc, v: IllustrationView, cell: Cell): IllustrationDoc {
  if (v.varMode === 'light') return inUse(d, v, cell) ? d : setScene(d, cell.light.light, cell.light.shadow);
  const locks = new Set(lockedIn(d, v));
  return d.ramps.reduce((x, r, i) => {
    const to = cell.bases[i];
    const base = baseOf(x, r.id);
    return to && base && !locks.has(r.id) ? recolour(x, base.id, to.base) : x;
  }, d);
}

// ── What's in the picture ────────────────────────────────────────────────────────────────────────

/** Make ramps: one ramp per ticked subject, in order, each with its material, under the light the scene has */
export const makeRamps = (d: IllustrationDoc, v: Pick<IllustrationView, 'pictureOn' | 'pictureTones'>): IllustrationDoc => replaceRamps(d, subjectBases(pictureOf(v)), sceneLight(d).pair);

// ── Swap one colour ──────────────────────────────────────────────────────────────────────────────

/** every swap row reads the same seed, so reopening a ramp shows the same alternatives */
const SWAP_SEED = 1;

let swapped: { key: string; list: RampAlt[] } | null = null;

/** about eight other colours at the base's grey value, each shown as its ramp; worked out once per ramp state, not per frame */
export function alternatives(d: IllustrationDoc, id: string): RampAlt[] {
  const r = rampOf(d, id);
  if (!r) return [];
  const base: Oklch = baseOf(d, r.id)?.oklch ?? r.base;
  const key = JSON.stringify([base, r.material, r.light, r.shadow, r.steps, r.intensity, r.push, r.hueShift, r.chromaCurve]);
  if (swapped?.key !== key) swapped = { key, list: rampAlternatives({ seed: SWAP_SEED, base: { name: rampName(d, r), base, material: r.material }, light: { light: r.light, shadow: r.shadow }, like: r }) };
  return swapped.list;
}
