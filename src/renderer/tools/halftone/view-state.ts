// View state (foundation spec §7.1: never in history) and the bits of UI state several parts share.
import { useSyncExternalStore } from 'react';
import { shell } from '../../shell/core/index.ts';
import { asZoom, type Zoom } from '../../ui/index.ts';
import { recordOf, type ExportRecord } from '../common/exported.ts';
import { createStore } from '../common/store.ts';

const ID = 'halftone';

export type Show = 'result' | 'separations' | 'original';

export type HalftoneView = {
  zoom: Zoom;
  /** the separations grid keeps its own place */
  sepZoom: Zoom;
  show: Show;
  inspector: number;
  /** the screen PNG's width, px; null follows the page's print width at its dpi, so the PNG opens at the size it prints */
  pngWidth: number | null;
  /** the SVG draws the paper's rectangle (a preview; the file is for the inks) */
  svgPaper: boolean;
  /** separations as greyscale or 1-bit plates (spec §5 q2) */
  bits: 8 | 1;
  /** the plates' files: TIFF, or PNG with the ink on a clear ground */
  plateFile: 'tiff' | 'png';
  /** plates on a sheet with bleed, crop and registration marks and the ink's name */
  marks: boolean;
  /** the ink whose transfer curve is open */
  curve: string | null;
  last: ExportRecord | null;
};

export const DEFAULT_VIEW: HalftoneView = { zoom: 'fit', sepZoom: 'fit', show: 'result', inspector: 380, pngWidth: null, svgPaper: false, bits: 8, plateFile: 'tiff', marks: false, curve: null, last: null };

const oneOf = <T,>(v: unknown, all: readonly T[], def: T): T => (all.includes(v as T) ? (v as T) : def);
const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);

/** what a saved workspace holds, field by field; anything odd falls back to the default */
function sanitize(raw: unknown): HalftoneView {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_VIEW;
  return {
    zoom: asZoom(r.zoom),
    sepZoom: asZoom(r.sepZoom),
    show: oneOf(r.show, ['result', 'separations', 'original'] as const, d.show),
    inspector: num(r.inspector, d.inspector),
    pngWidth: typeof r.pngWidth === 'number' && Number.isFinite(r.pngWidth) ? Math.round(Math.min(16384, Math.max(16, r.pngWidth))) : null,
    svgPaper: typeof r.svgPaper === 'boolean' ? r.svgPaper : d.svgPaper,
    bits: oneOf(r.bits, [8, 1] as const, d.bits),
    plateFile: oneOf(r.plateFile, ['tiff', 'png'] as const, d.plateFile),
    marks: typeof r.marks === 'boolean' ? r.marks : d.marks,
    curve: typeof r.curve === 'string' ? r.curve : null,
    last: recordOf(r.last),
  };
}

let current: HalftoneView | null = null;
const subs = new Set<() => void>();

/** read lazily: the shell restores the workspace before the tool first shows */
export const getView = (): HalftoneView => (current ??= sanitize(shell.view(ID)));

export function patchView(patch: Partial<HalftoneView>): void {
  current = { ...getView(), ...patch };
  shell.setView(ID, current);
  subs.forEach((f) => f());
}

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export const useView = (): HalftoneView => useSyncExternalStore(subscribe, getView);

/** the status bar's readout, from the view: dots that print, the dpi of an FM screen, how long the screen took */
export const status = createStore<{ dots: number; about: boolean; fm: number | null; ms: number; busy: boolean; error: boolean } | null>(null);
