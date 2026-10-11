// View state (foundation spec §7.1: never in history) and the bits of UI state several parts share.
import { useSyncExternalStore } from 'react';
import { shell } from '../../shell/core/index.ts';
import { asZoom, type Zoom } from '../../ui/index.ts';
import { recordOf, type ExportRecord } from '../common/exported.ts';
import { createStore } from '../common/store.ts';

const ID = 'pattern';

export type PatternView = {
  /** the Viewport's: Fit, or a zoom and centre */
  zoom: Zoom;
  /** line every tile edge in view, so a broken repeat shows at once */
  seams: boolean;
  inspector: number;
  /** what the PNG export draws */
  png: 'tile' | 'artboard';
  /** the SVGs write every shape as a plain group, not a symbol placed with <use> */
  expand: boolean;
  last: ExportRecord | null;
};

export const DEFAULT_VIEW: PatternView = { zoom: 'fit', seams: false, inspector: 380, png: 'artboard', expand: false, last: null };

/** what a saved workspace holds, field by field; anything odd falls back to the default */
function sanitize(raw: unknown): PatternView {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    zoom: asZoom(r.zoom),
    seams: typeof r.seams === 'boolean' ? r.seams : DEFAULT_VIEW.seams,
    inspector: typeof r.inspector === 'number' && Number.isFinite(r.inspector) ? r.inspector : DEFAULT_VIEW.inspector,
    png: r.png === 'tile' || r.png === 'artboard' ? r.png : DEFAULT_VIEW.png,
    expand: typeof r.expand === 'boolean' ? r.expand : DEFAULT_VIEW.expand,
    last: recordOf(r.last),
  };
}

let current: PatternView | null = null;
const subs = new Set<() => void>();

/** read lazily: the shell restores the workspace before the tool first shows */
export const getView = (): PatternView => (current ??= sanitize(shell.view(ID)));

export function patchView(patch: Partial<PatternView>): void {
  current = { ...getView(), ...patch };
  shell.setView(ID, current);
  subs.forEach((f) => f());
}

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export const useView = (): PatternView => useSyncExternalStore(subscribe, getView);

/** the slot whose Remove confirm is armed (its row turns into it) */
export const armed = createStore<string | null>(null);

/** the slot a Library pick replaces, while its Send to is on the way (receive reads it) */
export const replacing = createStore<string | null>(null);

/** shapes being read and measured (a file, a paste, a Library item) */
export const loading = createStore(0);
