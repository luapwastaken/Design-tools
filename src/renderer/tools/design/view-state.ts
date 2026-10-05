// View state (spec §7.1: never in history) and the small bits of UI state several parts share.
import { useSyncExternalStore } from 'react';
import { PRESETS } from '../../../shared/palette/generate.ts';
import { shell } from '../../shell/core/index.ts';
import { EXPORT_FORMATS } from '../common/ExportPalette.tsx';
import { createStore } from '../common/store.ts';
import type { DesignView } from './doc.ts';

const ID = 'design';

export const DEFAULT_VIEW: DesignView = {
  selected: [],
  surround: 'grey',
  chipData: 'short',
  stage: 'swatches',
  // closed to its summary chips until opened; the choice is kept
  dock: false,
  cvd: 'deutan',
  sim: 'normal',
  locked: [],
  inks: false,
  lockL: false,
  lockH: false,
  flagL: 6,
  flagE: 10,
  inspector: 380,
  format: 'ase',
  preset: PRESETS[0]?.id ?? '',
  count: 6,
  seed: 1,
  k: 6,
  stops: 3,
  space: 'oklch',
};

const ENUMS: Partial<Record<keyof DesignView, readonly string[]>> = {
  surround: ['grey', 'ground', 'plain'],
  chipData: ['short', 'full'],
  stage: ['swatches', 'inuse'],
  cvd: ['protan', 'deutan', 'tritan', 'achromat'],
  sim: ['normal', 'protan', 'deutan', 'tritan', 'achromat', 'greyscale'],
  format: EXPORT_FORMATS,
  space: ['oklch', 'oklab'],
};

/** before the Bone Ember pass the work area's switch was `tab` (Preview is In use now), and before the UX pass `lower` */
const IN_USE = new Set(['preview', 'context']);

/** what a saved workspace holds, field by field; anything odd falls back to the default (a dropped field, like `picker`, is left behind) */
function sanitize(raw: unknown): DesignView {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const was = typeof r.tab === 'string' ? r.tab : typeof r.lower === 'string' ? r.lower : '';
  const out: Record<string, unknown> = { ...DEFAULT_VIEW, ...(IN_USE.has(was) && { stage: 'inuse' }) };
  for (const [key, def] of Object.entries(DEFAULT_VIEW) as [keyof DesignView, unknown][]) {
    const v = r[key];
    const ok = Array.isArray(def)
      ? Array.isArray(v) && v.every((x) => typeof x === 'string')
      : def === null
        ? ENUMS[key]!.includes(v as string)
        : typeof v === typeof def && (typeof v !== 'number' || Number.isFinite(v)) && (!ENUMS[key] || ENUMS[key]!.includes(v as string));
    if (ok) out[key] = v;
  }
  if (!PRESETS.some((p) => p.id === out.preset)) out.preset = DEFAULT_VIEW.preset;
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
