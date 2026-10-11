// What the keys do, apart from the screen (so a test can run them): the playhead and its steps, the pixel
// sizes and the seed, and the Copy the PNG the mounted view hands over.
import { ALGORITHMS } from '../../../shared/dither/algorithms.ts';
import { createStore } from '../common/store.ts';
import type { DocController } from '../../../shared/doc-api.ts';
import { LIMIT, type DitherDoc } from './doc.ts';

export const playhead = createStore<{ frame: number; playing: boolean }>({ frame: 0, playing: false });

export const stepFrame = (d: DitherDoc, by: number): void => {
  const n = d.source?.frames ?? 1;
  playhead.set({ frame: (((playhead.get().frame + by) % n) + n) % n, playing: false });
};

export const togglePlay = (): void => playhead.set({ ...playhead.get(), playing: !playhead.get().playing });

/** the Copy the PNG that Ctrl+Shift+C runs: the mounted view's own, and why it can't go now */
export const copier: { run: (() => Promise<unknown>) | null; why: string | null } = { run: null, why: 'Open an image first.' };

/** the pixel sizes the Pixel size row offers, which , and . step through */
export const PIXEL_PICKS = [1, 2, 4, 8];

/** the next pick up or down from a size (a size of your own steps to the pick beside it), or null at the end */
export function nextPixel(pixel: number, by: 1 | -1): number | null {
  return (by > 0 ? PIXEL_PICKS.find((n) => n > pixel) : [...PIXEL_PICKS].reverse().find((n) => n < pixel)) ?? null;
}

export const stepPixel = (doc: DocController<DitherDoc>, by: 1 | -1): void => {
  const n = nextPixel(doc.get().pixel, by);
  if (n !== null) doc.transact(`Pixel size ${n}`, (x) => ({ ...x, pixel: n }));
};

/** whether the algorithm reads a seed */
export const hasSeed = (d: DitherDoc): boolean => !!ALGORITHMS.find((x) => x.id === d.algorithm)?.seed;

export const reseed = (doc: DocController<DitherDoc>): void => doc.transact('New seed', (x) => ({ ...x, seed: (x.seed * 7919 + 13) % (LIMIT.seed[1] + 1) }));
