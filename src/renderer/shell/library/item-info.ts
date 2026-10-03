import { useEffect, useSyncExternalStore } from 'react';
import { cssColor } from '../../../shared/color/index.ts';
import { toDataUrl } from '../../../shared/svg/index.ts';
import type { LibraryItemRef, LoadedItem } from '../../../shared/types.ts';
import { ipc } from '../core/ipc.ts';

/**
 * What a Library row shows beyond its ref: palette colours, a pattern tile, a logo preview, image
 * size. The index carries no payloads, so doc items are read lazily (only once their row is on
 * screen) and cached by id + mtime, so an edit on disk refreshes the thumbnail.
 */
export type ItemInfo = {
  colors?: string[];
  /** data: URL of a pattern tile or logo preview SVG */
  svg?: string;
  tile?: { w: number; h: number };
  /** after the kind: swatch count, tile size, pixel size */
  meta?: string;
  failed?: boolean;
};

const cache = new Map<string, { mtime: number; info: ItemInfo }>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

function put(ref: LibraryItemRef, info: ItemInfo) {
  cache.set(ref.id, { mtime: ref.mtimeMs, info });
  listeners.forEach((f) => f());
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

function describe(item: LoadedItem): ItemInfo {
  switch (item.kind) {
    case 'palette': {
      const colors = item.payload.swatches.map((w) => cssColor(w.oklch));
      return { colors, meta: String(colors.length) };
    }
    case 'pattern': {
      const { svg, tileWidth: w, tileHeight: h } = item.payload.preview;
      const [pw, ph] = [Math.round(w), Math.round(h)];
      return { svg: toDataUrl(svg), tile: { w, h }, meta: pw === ph ? `${pw} px tile` : `${pw} × ${ph} px tile` };
    }
    case 'logo':
      return { svg: toDataUrl(item.payload.preview.svg) };
    default:
      return {};
  }
}

async function load(ref: LibraryItemRef) {
  const key = `${ref.id}|${ref.mtimeMs}`;
  if (loading.has(key)) return;
  loading.add(key);
  try {
    put(ref, describe(await ipc.invoke('library.read', ref.id)));
  } catch {
    put(ref, { failed: true });
  } finally {
    loading.delete(key);
  }
}

/**
 * Images report their pixel size once their thumbnail has decoded. dt://thumb serves the file
 * itself, except TIFFs, which get a small Windows thumbnail: their size would be the thumbnail's.
 */
export function noteImageSize(ref: LibraryItemRef, w: number, h: number) {
  if (w && !/^tiff?$/i.test(ref.ext)) put(ref, { meta: `${w} × ${h}` });
}

export const swatchWord = (n: number) => `${n} swatch${n === 1 ? '' : 'es'}`;

/** the item's info if it's read and current, outside a component (a menu being built); `read` starts reading it if not */
export function itemInfo(ref: LibraryItemRef, read = false): ItemInfo | undefined {
  const hit = cache.get(ref.id);
  if (hit?.mtime === ref.mtimeMs) return hit.info;
  if (read) void load(ref);
  return undefined;
}

/** The row's info; `visible` starts the read for doc kinds. */
export function useItemInfo(ref: LibraryItemRef, visible = false): ItemInfo | undefined {
  const hit = useSyncExternalStore(subscribe, () => cache.get(ref.id));
  const fresh = hit?.mtime === ref.mtimeMs ? hit.info : undefined;
  const needsRead = ref.kind === 'palette' || ref.kind === 'pattern' || ref.kind === 'logo';
  useEffect(() => {
    if (visible && needsRead && !fresh) void load(ref);
  }, [visible, needsRead, fresh, ref]);
  return fresh;
}
