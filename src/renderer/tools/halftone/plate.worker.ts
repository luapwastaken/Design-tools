// 1-bit plates off the window's thread: a print-size plate is millions of pixels ranked cell by cell
// (shared/halftone/bilevel).
import { bilevel } from '../../../shared/halftone/bilevel.ts';
import type { Cells, CellShape } from '../../../shared/halftone/types.ts';

export type PlateJob = { cells: Cells; coverage: Float32Array; shape: CellShape; W: number; H: number; page: { w: number; h: number } };
export type PlateDone = { plate: Uint8Array } | { error: string };

self.onmessage = ({ data: j }: MessageEvent<PlateJob>) => {
  try {
    const plate = bilevel(j.cells, j.coverage, j.shape, j.W, j.H, j.page);
    self.postMessage({ plate } satisfies PlateDone, { transfer: [plate.buffer] });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) } satisfies PlateDone);
  }
};
