// View state (foundation spec §7.1: never in history) and the bits of UI state several parts share.
import { useSyncExternalStore } from 'react';
import type { Swatch } from '../../../shared/types.ts';
import { shell } from '../../shell/core/index.ts';
import { asZoom, type Zoom } from '../../ui/index.ts';
import { createStore } from '../common/store.ts';
import { KINDS, VERSIONS, type LockupKind, type Role, type Version } from './doc.ts';

const ID = 'logo';

export type Surround = 'grey' | 'white' | 'black' | 'colour';

export type LogoView = {
  zoom: Zoom;
  /** one lockup large, or every lockup × version as a sheet */
  mode: 'edit' | 'sheet';
  /** the lockup being edited */
  lockup: LockupKind;
  /** the colour version the edit view and the small sizes show */
  version: Version;
  surround: Surround;
  clearspace: boolean;
  guides: boolean;
  inspector: number;
  /** written into exported PNGs */
  dpi: number;
};

export const DEFAULT_VIEW: LogoView = { zoom: 'fit', mode: 'edit', lockup: 'horizontal', version: 'original', surround: 'grey', clearspace: true, guides: false, inspector: 380, dpi: 72 };

const oneOf = <T extends string>(v: unknown, all: readonly T[], def: T): T => (all.includes(v as T) ? (v as T) : def);
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const num = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) ? v : def);

/** what a saved workspace holds, field by field; anything odd falls back to the default */
function sanitize(raw: unknown): LogoView {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_VIEW;
  return {
    zoom: asZoom(r.zoom),
    mode: oneOf(r.mode, ['edit', 'sheet'], d.mode),
    lockup: oneOf(r.lockup, KINDS, d.lockup),
    version: oneOf(r.version, VERSIONS, d.version),
    surround: oneOf(r.surround, ['grey', 'white', 'black', 'colour'], d.surround),
    clearspace: bool(r.clearspace, d.clearspace),
    guides: bool(r.guides, d.guides),
    inspector: num(r.inspector, d.inspector),
    dpi: num(r.dpi, d.dpi),
  };
}

let current: LogoView | null = null;
const subs = new Set<() => void>();

/** read lazily: the shell restores the workspace before the tool first shows */
export const getView = (): LogoView => (current ??= sanitize(shell.view(ID)));

export function patchView(patch: Partial<LogoView>): void {
  current = { ...getView(), ...patch };
  shell.setView(ID, current);
  subs.forEach((f) => f());
}

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => void subs.delete(fn);
};

export const useView = (): LogoView => useSyncExternalStore(subscribe, getView);

/** the part whose Remove confirm is armed (its row turns into it) */
export const armed = createStore<Role | null>(null);

/** the part a Library pick goes into, while its Send to is on the way (receive and `accepts` read it) */
export const target = createStore<Role | null>(null);

/** parts being read and measured, by role */
export const loading = createStore<Role[]>([]);

/** the last palette sent here: its colours to pick the one colour from (session only) */
export const palette = createStore<{ name: string; swatches: Swatch[] } | null>(null);
