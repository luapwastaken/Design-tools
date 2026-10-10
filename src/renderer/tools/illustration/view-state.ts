// View state (foundation spec §7.1: never in history) and the small bits of UI state several parts share.
import { useSyncExternalStore } from 'react';
import type { Cvd, Oklch } from '../../../shared/color/index.ts';
import { customPigment, PIGMENTS, type CustomPigment } from '../../../shared/paint/pigments.ts';
import { shell } from '../../shell/core/index.ts';
import { EXPORT_FORMATS, type ExportFormat } from '../common/ExportPalette.tsx';
import { createStore } from '../common/store.ts';
import type { Surround } from '../common/surround.ts';
import { cleanCell, cleanLocks, cleanPath, cleanPicture } from './variations.ts';

const ID = 'illustration';

export type IllustrationView = {
  /** the selected step or loose swatch (swatch id); null: the first ramp's base */
  selected: string | null;
  /** the tab of the tabbed section (Alt+1-5) */
  tab: 'settings' | 'light' | 'check' | 'paint' | 'variations' | 'notes';
  /** the Ramps section's width, the Selected ramp section's height and the Colour picker's width, in px (drag handles) */
  rampsWidth: number;
  rampHeight: number;
  pickerWidth: number;
  /** Selected ramp: what is printed under each step */
  show: 'hex' | 'name' | 'off';
  /** the lens the steps and the lit object are seen through  */
  proof: 'off' | Cvd;
  /** what the lit preview and the checks sit on */
  surround: Surround;
  /** what the Selected ramp's steps sit on (18% grey by default, as the ramps board was) */
  board: Surround;
  format: ExportFormat;
  /** Value check: flag pairs closer than this, in value × 100 */
  flagL: number;
  /** Colour vision check: flag pairs closer than this ΔE */
  flagE: number;
  cvd: Cvd;
  /** Recipes: for the selected colour, or one for every ramp's base */
  recipesFor: 'selected' | 'bases';
  maxPaints: 1 | 2 | 3;
  /** ids of the paints you own (the 14 and your own); recipes and the canvas tray use only these */
  owned: string[];
  /** paints you added by colour and name */
  custom: CustomPigment[];
  /** the lit preview's own settings (LitPreview owns their shape) */
  preview: Record<string, unknown>;
  /** the paint canvas's own settings (PaintCanvas owns their shape) */
  canvas: Record<string, unknown>;
  /** the painting kept for each palette: item id → its PNG workspace asset url (dt://asset/illustration/<sha256>.png) */
  paintings: Record<string, string>;
  /** Variations: the grid's seed, what it varies, the narrowing path (cell numbers), the open cell (0: none) and the ramp whose other-colours row is open */
  varSeed: number;
  varMode: 'colours' | 'light';
  varPath: number[];
  varOpen: number;
  swapRamp: string;
  /** ramp ids locked in every cell; an id with no ramp does nothing (see lockedIn) */
  lockedRamps: string[];
  /** What's in the picture: the subjects ticked, and the tone chosen for skin and hair */
  pictureOn: string[];
  pictureTones: Record<string, string>;
  /** What's in the picture shows its ticks (closed, it is one line that says how many are ticked) */
  pictureOpen: boolean;
};

/** [min, max, default] of the three panel sizes */
export const SIZES = { rampsWidth: [260, 520, 320], rampHeight: [200, 520, 300], pickerWidth: [420, 900, 560] } as const;

export const DEFAULT_VIEW: IllustrationView = {
  selected: null,
  tab: 'settings',
  rampsWidth: SIZES.rampsWidth[2],
  rampHeight: SIZES.rampHeight[2],
  pickerWidth: SIZES.pickerWidth[2],
  show: 'hex',
  proof: 'off',
  surround: 'grey',
  board: 'grey',
  format: 'kpl',
  // lower than Design's 6 and 10: a painting's bases often sit close in value (skin and cloth mid-tones),
  // and its steps pack twenty colours or more
  flagL: 3,
  flagE: 6,
  cvd: 'deutan',
  recipesFor: 'selected',
  maxPaints: 3,
  owned: PIGMENTS.map((p) => p.id),
  custom: [],
  preview: {},
  canvas: {},
  paintings: {},
  varSeed: 4242,
  varMode: 'colours',
  varPath: [],
  varOpen: 0,
  swapRamp: '',
  lockedRamps: [],
  pictureOn: [],
  pictureTones: {},
  pictureOpen: false,
};

const ENUMS: Partial<Record<keyof IllustrationView, readonly unknown[]>> = {
  tab: ['settings', 'light', 'check', 'paint', 'variations', 'notes'],
  varMode: ['colours', 'light'],
  show: ['hex', 'name', 'off'],
  proof: ['off', 'protan', 'deutan', 'tritan', 'achromat'],
  surround: ['grey', 'ground', 'plain'],
  board: ['grey', 'ground', 'plain'],
  format: EXPORT_FORMATS,
  cvd: ['protan', 'deutan', 'tritan', 'achromat'],
  recipesFor: ['selected', 'bases'],
  maxPaints: [1, 2, 3],
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isOklch = (v: unknown): v is Oklch => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** a part's own settings (the lit preview's, the canvas's) over its defaults: only keys it has, with its types */
export const shaped = <T extends object>(raw: unknown, def: T): T => ({
  ...def,
  ...Object.fromEntries(Object.entries(isObj(raw) ? raw : {}).filter(([k, x]) => k in def && typeof x === typeof def[k as keyof T] && (typeof x !== 'number' || Number.isFinite(x)))),
});

/** your own paints, rebuilt from what a saved workspace holds; anything odd is left out */
const customOf = (raw: unknown): CustomPigment[] =>
  Array.isArray(raw) ? raw.filter((p) => isObj(p) && typeof p.id === 'string' && typeof p.name === 'string' && isOklch(p.oklch)).map((p) => customPigment(p.name as string, p.oklch as Oklch, p.id as string)) : [];

/** what a saved workspace holds, field by field; anything odd falls back to the default */
function sanitize(raw: unknown): IllustrationView {
  const saved = isObj(raw) ? raw : {};
  // the tab was once the mode switch (`ramps` is now Ramp settings), and before that `lower` (Light | Paint)
  const r0 = 'tab' in saved || !('lower' in saved) ? saved : { ...saved, tab: saved.lower };
  const r = r0.tab === 'ramps' ? { ...r0, tab: 'settings' } : r0;
  const out: Record<string, unknown> = { ...DEFAULT_VIEW };
  for (const [key, def] of Object.entries(DEFAULT_VIEW) as [keyof IllustrationView, unknown][]) {
    const v = r[key];
    const ok =
      key === 'selected'
        ? v === null || typeof v === 'string'
        : Array.isArray(def)
          ? Array.isArray(v) && v.every((x) => typeof x === 'string')
          : isObj(def)
            ? isObj(v)
            : typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v)) && (!ENUMS[key] || ENUMS[key]!.includes(v));
    if (ok) out[key] = v;
  }
  // a saved size from before the handles is just missing; one outside its range is pulled in
  for (const k of ['rampsWidth', 'rampHeight', 'pickerWidth'] as const) out[k] = Math.round(Math.min(SIZES[k][1], Math.max(SIZES[k][0], out[k] as number)));
  out.custom = customOf(r.custom);
  out.paintings = Object.fromEntries(Object.entries(out.paintings as object).filter(([, h]) => typeof h === 'string'));
  // Variations: the path is a list of cells, not of ids; the seed and the open cell are whole numbers in range; the ticks are the nine subjects
  out.varPath = cleanPath(r.varPath);
  out.varOpen = cleanCell(out.varOpen);
  out.varSeed = Math.abs(Math.floor(out.varSeed as number)) || DEFAULT_VIEW.varSeed;
  out.lockedRamps = cleanLocks(r.lockedRamps);
  Object.assign(out, cleanPicture(r.pictureOn, r.pictureTones));
  return out as IllustrationView;
}

let current: IllustrationView | null = null;
const subs = new Set<() => void>();

/** read lazily: the shell restores the workspace before the tool first shows */
export const getView = (): IllustrationView => (current ??= sanitize(shell.view(ID)));

// a painting follows its palette: a rename or move takes it along, and a fork (an edit of a
// palette another tool holds, or a locked or missing one) starts with a copy of it
shell.onRelink(ID, (from, to, fork) => {
  const { paintings } = getView();
  if (!paintings[from]) return;
  const { [from]: url, ...rest } = paintings;
  patchView({ paintings: { ...(fork ? paintings : rest), [to]: url } });
});

export function patchView(patch: Partial<IllustrationView>): void {
  current = { ...getView(), ...patch };
  shell.setView(ID, current);
  subs.forEach((f) => f());
}

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export const useView = (): IllustrationView => useSyncExternalStore(subscribe, getView);

/** swatch ids a check row points at, lit in the ramps while hovered */
export const hot = createStore<string[]>([]);

/** hovering or focusing a check's row lights its swatches in the ramps above */
export const pointAt = (ids: string[]) => ({
  onPointerEnter: () => hot.set(ids),
  onPointerLeave: () => hot.set([]),
  onFocus: () => hot.set(ids),
  onBlur: () => hot.set([]),
});

/** the ramp whose Delete confirm is armed (its row turns into it) */
export const armed = createStore<string | null>(null);

/** the last ramp step clicked (or chosen with Enter or Space), even the one already selected: Paint loads it on the brush */
export const clicked = createStore<{ id: string; at: number } | null>(null);
