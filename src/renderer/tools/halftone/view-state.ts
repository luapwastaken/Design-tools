// View state (foundation spec §7.1: never in history) and the bits of UI state several parts share.
import { useSyncExternalStore } from 'react';
import type { Oklch } from '../../../shared/color/index.ts';
import { shell } from '../../shell/core/index.ts';
import { asZoom, type Zoom } from '../../ui/index.ts';
import { createStore } from '../common/store.ts';

const ID = 'halftone';

export type Show = 'result' | 'separations' | 'original';

export type HalftoneView = {
  zoom: Zoom;
  /** the separations grid keeps its own place */
  sepZoom: Zoom;
  show: Show;
  inspector: number;
  /** the screen PNG's width, px */
  pngWidth: number;
  /** separations as greyscale or 1-bit TIFF plates (spec §5 q2) */
  bits: 8 | 1;
  /** the ink whose transfer curve is open */
  curve: string | null;
  last: { name: string; path: string; at: number } | null;
};

export const DEFAULT_VIEW: HalftoneView = { zoom: 'fit', sepZoom: 'fit', show: 'result', inspector: 380, pngWidth: 2048, bits: 8, curve: null, last: null };

const oneOf = <T,>(v: unknown, all: readonly T[], def: T): T => (all.includes(v as T) ? (v as T) : def);
const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);

function lastOf(v: unknown): HalftoneView['last'] {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return typeof r.name === 'string' && typeof r.path === 'string' && typeof r.at === 'number' ? { name: r.name, path: r.path, at: r.at } : null;
}

/** what a saved workspace holds, field by field; anything odd falls back to the default */
function sanitize(raw: unknown): HalftoneView {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_VIEW;
  return {
    zoom: asZoom(r.zoom),
    sepZoom: asZoom(r.sepZoom),
    show: oneOf(r.show, ['result', 'separations', 'original'] as const, d.show),
    inspector: num(r.inspector, d.inspector),
    pngWidth: Math.round(Math.min(16384, Math.max(16, num(r.pngWidth, d.pngWidth)))),
    bits: oneOf(r.bits, [8, 1] as const, d.bits),
    curve: typeof r.curve === 'string' ? r.curve : null,
    last: lastOf(r.last),
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

/** the palette the spot inks last came from (this session): the Inks from row names it while the inks are its colours */
export const inksFrom = createStore<{ name: string; swatches: { name: string; colour: Oklch }[] } | null>(null);

/** the status bar's readout, from the view: dots that print, the dpi of an FM screen, how long the screen took */
export const status = createStore<{ dots: number; about: boolean; fm: number | null; ms: number; busy: boolean; error: boolean } | null>(null);
