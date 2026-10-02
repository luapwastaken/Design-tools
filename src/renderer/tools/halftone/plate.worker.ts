// Off the window's thread: 1-bit plates (a print-size plate is millions of pixels ranked cell by
// cell, shared/halftone/bilevel), and the cells of a screen too big to hold whole, made from its
// ink's plate (the SVG's, or a 1-bit plate's band by band).
import { bilevel } from '../../../shared/halftone/bilevel.ts';
import { cells, dotData, splitOf } from '../../../shared/halftone/screen.ts';
import type { Cells, CellShape, Screen, Size } from '../../../shared/halftone/types.ts';

/** an ink's screen to make here: its plate, as the screen worker separated it */
export type ScreenOf = { plate: Float32Array; plateW: number; plateH: number; size: Size; screen: Screen; angle: number };
export type PlateJob =
  | { W: number; H: number; page: { w: number; h: number }; shape: CellShape; cells: Cells; coverage: Float32Array }
  | { W: number; H: number; page: { w: number; h: number }; shape: CellShape; of: ScreenOf }
  | { cellsOf: ScreenOf };
export type PlateDone = { plate: Uint8Array } | { cells: Cells } | { error: string };

/** cells made at once for a band of a 1-bit plate */
const BAND_CELLS = 2e6;

const cellsIn = (o: ScreenOf, clip?: Parameters<typeof cells>[7]) => cells(o.plate, o.size, o.screen.lpi, o.angle, o.plateW, o.plateH, splitOf(o.screen.shape), clip);

/** a 1-bit plate in bands of rows, each from the cells over it (a cell reaches at most its pitch) */
function banded(j: Extract<PlateJob, { of: ScreenOf }>): Uint8Array {
  const out = new Uint8Array(j.W * j.H);
  const pitch = j.of.size.dpi / j.of.screen.lpi;
  const rows = Math.max(1, Math.floor((BAND_CELLS * pitch * pitch) / splitOf(j.shape) / (j.page.w + 2 * pitch)));
  for (let y0 = 0; y0 < j.H; y0 += rows) {
    const h = Math.min(rows, j.H - y0);
    const c = cellsIn(j.of, { x0: -pitch, y0: y0 - pitch, x1: j.page.w + pitch, y1: y0 + h + pitch });
    const d = dotData(c, j.of.screen).data;
    out.set(bilevel(c, Float32Array.from({ length: c.n }, (_, k) => d[3 * k + 2]), j.shape, j.W, j.H, j.page, { y0, h }), y0 * j.W);
  }
  return out;
}

self.onmessage = ({ data: j }: MessageEvent<PlateJob>) => {
  try {
    if ('cellsOf' in j) {
      const c = cellsIn(j.cellsOf);
      self.postMessage({ cells: c } satisfies PlateDone, { transfer: [c.x.buffer, c.y.buffer, c.coverage.buffer] });
      return;
    }
    const plate = 'of' in j ? banded(j) : bilevel(j.cells, j.coverage, j.shape, j.W, j.H, j.page);
    self.postMessage({ plate } satisfies PlateDone, { transfer: [plate.buffer] });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) } satisfies PlateDone);
  }
};
