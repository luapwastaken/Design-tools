// View state (foundation spec §7.1: never in history) and the bits of UI state several parts share.
import { useSyncExternalStore } from 'react';
import { shell } from '../../shell/core/index.ts';
import { asZoom, type Zoom } from '../../ui/index.ts';
import { recordOf, type ExportRecord } from '../common/exported.ts';
import { createStore } from '../common/store.ts';

const ID = 'dither';

export type Show = 'result' | 'original';

export type DitherView = {
  zoom: Zoom;
  show: Show;
  inspector: number;
  /**
   * The export's scale: each block in the files is the pixel size times this, so a new pixel size is
   * never exported at an old block (spec §3). 0 is one pixel a block, the working image itself.
   */
  times: number;
  /** how many colours Extract takes from the image */
  extract: number;
  last: ExportRecord | null;
};

export const DEFAULT_VIEW: DitherView = { zoom: 'fit', show: 'result', inspector: 380, times: 1, extract: 8, last: null };

export const TIMES_MAX = 16;

const oneOf = <T,>(v: unknown, all: readonly T[], def: T): T => (all.includes(v as T) ? (v as T) : def);
const int = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(hi, Math.max(lo, v))) : def);

/** what a saved workspace holds, field by field; anything odd falls back to the default */
function sanitize(raw: unknown): DitherView {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_VIEW;
  return {
    zoom: asZoom(r.zoom),
    show: oneOf(r.show, ['result', 'original'] as const, d.show),
    inspector: int(r.inspector, 340, 460, d.inspector),
    times: int(r.times, 0, TIMES_MAX, d.times),
    extract: int(r.extract, 2, 32, d.extract),
    last: recordOf(r.last),
  };
}

let current: DitherView | null = null;
const subs = new Set<() => void>();

/** read lazily: the shell restores the workspace before the tool first shows */
export const getView = (): DitherView => (current ??= sanitize(shell.view(ID)));

export function patchView(patch: Partial<DitherView>): void {
  current = { ...getView(), ...patch };
  shell.setView(ID, current);
  subs.forEach((f) => f());
}

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export const useView = (): DitherView => useSyncExternalStore(subscribe, getView);

/** the frame on screen and whether it plays (this session: a relaunch opens paused on the first) */
export const playhead = createStore<{ frame: number; playing: boolean }>({ frame: 0, playing: false });

/** the palette index under the pointer, so its chip lights */
export const under = createStore<number | null>(null);

/** the status bar's readout, from the view */
export const status = createStore<{ w: number; h: number; colours: number; ms: number; busy: boolean; error: boolean } | null>(null);
