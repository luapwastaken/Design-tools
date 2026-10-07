// View state (spec §7.1: never in history) and the small bits of UI state several parts share.
import { useSyncExternalStore } from 'react';
import { ACCENTS } from '../../../shared/palette/brand.ts';
import { PRESETS } from '../../../shared/palette/generate.ts';
import { shell } from '../../shell/core/index.ts';
import { EXPORT_FORMATS } from '../common/ExportPalette.tsx';
import { createStore } from '../common/store.ts';
import type { DesignView } from './doc.ts';

const ID = 'design';

/** the two draggable seams: palette height (top of the lower row) and picker width */
export const PALETTE_H = { min: 200, max: 520, reset: 300 };
export const PICKER_W = { min: 420, max: 900, reset: 560 };
const clamp = (v: number, r: { min: number; max: number }) => Math.round(Math.min(r.max, Math.max(r.min, v)));

export const DEFAULT_VIEW: DesignView = {
  selected: [],
  tab: 'contrast',
  tabChosen: false,
  cvd: 'deutan',
  sim: 'normal',
  locked: [],
  intended: [],
  surround: 'plain',
  chipData: 'hex',
  paletteH: PALETTE_H.reset,
  pickerW: PICKER_W.reset,
  flagL: 6,
  flagE: 10,
  format: 'ase',
  preset: PRESETS[0]?.id ?? '',
  suggestStyle: 'bold',
  suggestFrom: 'all',
  accent: 'split',
  count: 6,
  seed: 1,
  k: 6,
  stops: 3,
  space: 'oklch',
};

const ENUMS: Partial<Record<keyof DesignView, readonly string[]>> = {
  tab: ['contrast', 'check', 'preview', 'harmonies', 'notes'],
  accent: ACCENTS.map((a) => a.value),
  suggestFrom: ['all', 'selected'],
  surround: ['grey', 'ground', 'plain'],
  chipData: ['hex', 'lch', 'table'],
  cvd: ['protan', 'deutan', 'tritan', 'achromat'],
  sim: ['normal', 'protan', 'deutan', 'tritan', 'achromat'],
  format: EXPORT_FORMATS,
  space: ['oklch', 'oklab'],
};

/** what a saved workspace holds, field by field; anything odd falls back to the default (a dropped field, like `picker`, is left behind) */
function sanitize(raw: unknown): DesignView {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  // the Harmonies tab was Tints & harmonies
  const out: Record<string, unknown> = { ...DEFAULT_VIEW, ...(r.tab === 'tints' && { tab: 'harmonies' }) };
  for (const [key, def] of Object.entries(DEFAULT_VIEW) as [keyof DesignView, unknown][]) {
    const v = r[key];
    const ok = Array.isArray(def)
      ? Array.isArray(v) && v.every((x) => typeof x === 'string')
      : def === null
        ? ENUMS[key]!.includes(v as string)
        : typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v)) && (!ENUMS[key] || ENUMS[key]!.includes(v as string));
    if (ok) out[key] = v;
  }
  out.paletteH = clamp(out.paletteH as number, PALETTE_H);
  out.pickerW = clamp(out.pickerW as number, PICKER_W);
  if (!PRESETS.some((p) => p.id === out.preset)) out.preset = DEFAULT_VIEW.preset;
  if (!PRESETS.some((p) => p.id === out.suggestStyle)) out.suggestStyle = DEFAULT_VIEW.suggestStyle;
  return out as DesignView;
}

let current: DesignView | null = null;
const subs = new Set<() => void>();

/** read lazily: the shell restores the workspace before the tool first shows */
export const getView = (): DesignView => (current ??= sanitize(shell.view(ID)));

export function patchView(patch: Partial<DesignView>): void {
  current = { ...getView(), ...patch };
  shell.setView(ID, current);
  subs.forEach((f) => f());
}

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export const useView = (): DesignView => useSyncExternalStore(subscribe, getView);

/** swatch ids a check row or ruler pin points at, outlined on the artboard while hovered */
export const hot = createStore<string[]>([]);

/** hovering or focusing a check's row lights its swatches in the row above */
export const pointAt = (ids: string[]) => ({
  onPointerEnter: () => hot.set(ids),
  onPointerLeave: () => hot.set([]),
  onFocus: () => hot.set(ids),
  onBlur: () => hot.set([]),
});

/** the Delete confirm is armed (Delete key, the inspector's delete button, the chip menu) */
export const armed = createStore(false);
