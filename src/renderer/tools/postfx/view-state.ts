// View state (foundation spec §7.1: never in history) and the bits of UI state several parts share.
import { useSyncExternalStore } from 'react';
import { shell } from '../../shell/core/index.ts';
import { asZoom, type Zoom } from '../../ui/index.ts';
import { createStore } from '../common/store.ts';
import { frameAt, startOf, type Timeline } from './doc.ts';

const ID = 'postfx';

/** what the image shows: the result, the original, or both either side of the divider */
export type Compare = 'split' | 'after' | 'before';

export type PostFxView = {
  zoom: Zoom;
  compare: Compare;
  /** where the divider sits, 0 to 1 across the image (image space, so it lines up at any zoom) */
  split: number;
  inspector: number;
  /**
   * where the paused frame sits, seconds into the timeline: what shows, what exports and what a relaunch
   * opens on. The view's, not the document's, so moving it is no step for Undo to go back over.
   */
  time: number;
  /** the layer whose settings show */
  selected: string | null;
  last: { name: string; path: string; at: number } | null;
};

export const DEFAULT_VIEW: PostFxView = { zoom: 'fit', compare: 'split', split: 0.5, inspector: 380, time: 0, selected: null, last: null };

const oneOf = <T,>(v: unknown, all: readonly T[], def: T): T => (all.includes(v as T) ? (v as T) : def);
const num = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def);

function lastOf(v: unknown): PostFxView['last'] {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return typeof r.name === 'string' && typeof r.path === 'string' && typeof r.at === 'number' ? { name: r.name, path: r.path, at: r.at } : null;
}

/** what a saved workspace holds, field by field; anything odd falls back to the default */
function sanitize(raw: unknown): PostFxView {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_VIEW;
  return {
    zoom: asZoom(r.zoom),
    compare: oneOf(r.compare, ['split', 'after', 'before'] as const, d.compare),
    split: num(r.split, 0, 1, d.split),
    inspector: Math.round(num(r.inspector, 340, 460, d.inspector)),
    time: num(r.time, 0, 1e6, d.time),
    selected: typeof r.selected === 'string' ? r.selected : null,
    last: lastOf(r.last),
  };
}

let current: PostFxView | null = null;
const subs = new Set<() => void>();

/** read lazily: the shell restores the workspace before the tool first shows */
export const getView = (): PostFxView => (current ??= sanitize(shell.view(ID)));

export function patchView(patch: Partial<PostFxView>): void {
  current = { ...getView(), ...patch };
  shell.setView(ID, current);
  subs.forEach((f) => f());
}

/** the frame the view rests on when nothing plays: its saved time, kept on the timeline (a still holds 0, past the end holds the last frame) */
export function pausedFrame(t: Timeline): number {
  return t.count < 2 ? 0 : frameAt(t, Math.min(getView().time, startOf(t, t.count - 1)));
}

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export const useView = (): PostFxView => useSyncExternalStore(subscribe, getView);

/**
 * The frame on screen while it plays or is scrubbed (this session). Paused, the document's `time`
 * holds it, so what shows, what exports and what a relaunch opens on are the same frame.
 */
export const playhead = createStore<{ frame: number; playing: boolean }>({ frame: 0, playing: false });

/** the status bar's readout, from the view */
export const status = createStore<{ layers: number; on: number; ms: number; busy: boolean; error: boolean } | null>(null);
