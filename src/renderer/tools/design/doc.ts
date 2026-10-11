// The Design tool's document and view state (plan: Document and view).
import type { Cvd, Oklch } from '../../../shared/color/index.ts';
import type { Accent } from '../../../shared/palette/brand.ts';
import { ROLES, type Role } from '../../../shared/palette/roles.ts';
import type { PalettePayload, RampSpec, Swatch } from '../../../shared/types.ts';
import type { ExportFormat } from '../common/ExportPalette.tsx';

import type { Surround } from '../common/surround.ts';
import { displayName, named } from '../common/names.ts';

export { displayName, listNames, named, plural } from '../common/names.ts';

/** `ramps` and `scene`: Illustration's ramp settings and scene light, kept so they go back into the file unchanged */
export type DesignDoc = {
  swatches: Swatch[];
  notes: string;
  ramps?: RampSpec[];
  scene?: PalettePayload['scene'];
  /** the last lock change (L): the pinned list before and after it, so Undo and Redo can put the view's locks back. Never saved in the file. */
  locking?: { before: string[]; after: string[] };
};

export type BuildMethod = 'harmony' | 'generate' | 'image' | 'logo' | 'gradient' | 'paste' | 'complete';
/** the tabs under the palette and picker; the active one is saved in the view */
export type DesignTab = 'contrast' | 'check' | 'preview' | 'harmonies' | 'variations' | 'notes';
/** the tab strip's names, and its order: Notes only while the file has notes. Alt+N follows this order. */
export const TAB_LABEL: Record<DesignTab, string> = { contrast: 'Contrast', check: 'Check palette', preview: 'Preview in use', harmonies: 'Harmonies', variations: 'Variations', notes: 'Notes' };
export const tabsOf = (d: Pick<DesignDoc, 'notes'>): DesignTab[] => ['contrast', 'check', 'preview', 'harmonies', 'variations', ...(d.notes ? (['notes'] as const) : [])];
/** what each palette chip says: Hex; Hex and L C H; the Table adds RGB and ≈CMYK */
export type ChipData = 'hex' | 'lch' | 'table';
/** the view filter over the artboard and the In use page; never written to the document */
export type Simulate = 'normal' | Cvd;
export type CheckId = 'contrast' | 'preview' | 'value' | 'vision' | 'print';

/** Never in history: saved with the workspace through shell.setView (spec §7.1). */
export type DesignView = {
  /** swatch ids; the first is the active one (inspector) */
  selected: string[];
  tab: DesignTab;
  /** the user has picked a tab themselves; until then a first build shows Preview in use */
  tabChosen: boolean;
  /** the Colour vision card's chosen simulation */
  cvd: Cvd;
  /** the view filter on the palette row and the Preview tab */
  sim: Simulate;
  /** swatch ids pinned with L: Space (a reroll) and Delete leave them */
  locked: string[];
  /** value pairs marked intended ("idA:idB", sorted): a painter's matched values, left out of the Value check */
  intended: string[];
  /** the surround the palette is judged on */
  surround: Surround;
  chipData: ChipData;
  /** the Palette section's height and the Colour picker section's width, dragged on their seams */
  paletteH: number;
  pickerW: number;
  /** Value check: flag pairs closer than this, in value × 100 */
  flagL: number;
  /** Colour vision check: flag pairs closer than this ΔE */
  flagE: number;
  format: ExportFormat;
  /** Style: a role palette's neutral lean, chroma and accent boldness (shared/palette/brand); also Suggest more colours' preset */
  preset: string;
  /** Suggest more colours: its own style (a generator preset), and whose hues it follows; the Style above is the role builder's */
  suggestStyle: string;
  suggestFrom: 'all' | 'selected';
  /** the harmony the Accent and Highlight follow */
  accent: Accent;
  /** Suggest more colours: how many */
  count: number;
  seed: number;
  /** Image: how many colours to pull */
  k: number;
  stops: number;
  space: 'oklch' | 'oklab';
  /** Variations: the grid's seed, and what may change from cell to cell (the Style, the Accent, a light or dark page) */
  varSeed: number;
  varStyle: boolean;
  varAccent: boolean;
  varGround: boolean;
  /** the cell More like this was pressed on, once per step (so its length is the depth); the grid is worked out from these */
  varPath: number[];
  /** the cell shown large (1 to 6), 0 for none */
  varOpen: number;
  /** the role whose other-colours row is open under the Palette title, '' for none */
  swapRole: string;
};

/** the lock list Undo or Redo puts back: only when the step it crossed was a lock change, so undoing an edit leaves the locks as they are */
export function lockedAfter(cause: 'undo' | 'redo', was: DesignDoc, now: DesignDoc): string[] | null {
  if (cause === 'undo') return was.locking && was.locking !== now.locking ? was.locking.before : null;
  return now.locking && now.locking !== was.locking ? now.locking.after : null;
}

export const emptyDoc = (): DesignDoc => ({ swatches: [], notes: '' });

/** each swatch's name as the palette shows it: blank ones filled in, an Illustration ramp step by its ramp ("Cloth shadow") */
export const namesOf = (d: DesignDoc): Map<string, string> => new Map(named(d.swatches, d.ramps).map((w) => [w.id, w.name]));
export const nameIn = (d: DesignDoc, w: Swatch): string => (w.name.trim() ? w.name : (namesOf(d).get(w.id) ?? displayName(w)));

// a hand-edited or imported file may leave these out
const tidy = (w: Swatch): Swatch => ({ ...w, role: w.role ?? null, type: w.type ?? 'process' });

/** The palette file's contents. An Illustration palette's ramps, scene light and each swatch's group, step and edited go back as they came. */
export const toPayload = (d: DesignDoc): Pick<PalettePayload, 'swatches' | 'notes' | 'ramps' | 'scene'> => ({ swatches: d.swatches, notes: d.notes, ...(d.ramps && { ramps: d.ramps }), ...(d.scene && { scene: d.scene }) });

export function fromPayload(p: Pick<PalettePayload, 'swatches' | 'notes' | 'ramps' | 'scene'>): DesignDoc {
  return { swatches: p.swatches.map(tidy), notes: p.notes ?? '', ...(p.ramps && { ramps: p.ramps }), ...(p.scene && { scene: p.scene }) };
}

export const newSwatch = (oklch: Oklch, name = '', role: string | null = null): Swatch => ({
  id: crypto.randomUUID(),
  name,
  role,
  oklch,
  type: 'process',
});

export const mapSwatch = (d: DesignDoc, id: string, fn: (w: Swatch) => Swatch): DesignDoc => ({
  ...d,
  swatches: d.swatches.map((w) => (w.id === id ? fn(w) : w)),
});

/**
 * New colours; an edited colour is no longer the imported one, so its original values go
 * (Swatch.source). A "change" to the same colour changes nothing, so the imported values stay.
 * A step of an Illustration ramp becomes a hand-edited one, which regenerating the ramp leaves alone.
 */
export const recolour = (d: DesignDoc, changes: Record<string, Oklch>): DesignDoc => ({
  ...d,
  swatches: d.swatches.map((w) => {
    const next = changes[w.id];
    if (!next || next.every((v, i) => v === w.oklch[i])) return w;
    const { source: _, ...rest } = w;
    return { ...rest, oklch: next, ...(w.group !== undefined && { edited: true }) };
  }),
});

/** after `afterId` (the end when null or unknown) */
export function insertAfter(d: DesignDoc, afterId: string | null, add: Swatch[]): DesignDoc {
  const at = d.swatches.findIndex((w) => w.id === afterId);
  const i = at < 0 ? d.swatches.length : at + 1;
  return { ...d, swatches: [...d.swatches.slice(0, i), ...add, ...d.swatches.slice(i)] };
}

export const removeIds = (d: DesignDoc, ids: string[]): DesignDoc => ({ ...d, swatches: d.swatches.filter((w) => !ids.includes(w.id)) });

/** move `ids` (kept in palette order) to sit before the swatch at `index` of the current list */
export function moveIds(d: DesignDoc, ids: string[], index: number): DesignDoc {
  const moving = d.swatches.filter((w) => ids.includes(w.id));
  const before = d.swatches.slice(0, index).filter((w) => !ids.includes(w.id));
  const after = d.swatches.slice(index).filter((w) => !ids.includes(w.id));
  return { ...d, swatches: [...before, ...moving, ...after] };
}

/** the swatch that holds each of the seven jobs (the first, should an import give two the same one) */
export const jobHolders = (swatches: Swatch[]): [Role, Swatch][] =>
  ROLES.flatMap((role) => swatches.filter((w) => w.role === role).slice(0, 1).map((w): [Role, Swatch] => [role, w]));
