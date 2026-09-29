// What each export writes, every one from the screen the view draws (screening.ts): the SVG from its
// cells, the screen PNG and the greyscale plates from the same dots drawn by draw.ts at their own
// sizes, the 1-bit plates from the same cells ranked pixel by pixel (shared/halftone/bilevel).
import { halftoneSvg, svgProblem } from '../../../shared/halftone/svg.ts';
import { pagePx } from '../../../shared/halftone/screen.ts';
import { writeTiff } from '../../../shared/halftone/tiff.ts';
import { withDpi } from '../../lib/png.ts';
import type { CellShape } from '../../../shared/halftone/types.ts';
import type { Tile } from '../../lib/gpu/index.ts';
import { overlapOf, type HalftoneDoc } from './doc.ts';
import { filmOf, lookOf, Painter, type Look } from './draw.ts';
import type { PlateDone, PlateJob } from './plate.worker.ts';
import { screen, type Screened } from './screening.ts';

type Progress = (done: number, detail?: string) => void;

const MAX_PNG = 64e6;
const MAX_PLATE = 250e6;
/** rows drawn and read at once for a plate, so a big one never needs a second full-size copy in RGBA */
const BAND = 2048;

export const pngLimit = (w: number, h: number): string | null =>
  w * h > MAX_PNG ? `${w} × ${h} px is more than a PNG here can hold (64 megapixels). Make it narrower.` : null;

export function platesLimit(d: HalftoneDoc): string | null {
  const p = pagePx(d.size);
  const n = Math.round(p.w) * Math.round(p.h);
  return n > MAX_PLATE ? `A plate of ${Math.round(p.w).toLocaleString('en')} × ${Math.round(p.h).toLocaleString('en')} px at ${d.size.dpi} dpi is more than a TIFF here can hold. Lower the DPI or the size.` : null;
}

/** "12,859 dots · ≈ 0.6 MB": what the SVG will weigh */
export function svgWeight(s: Screened, d: HalftoneDoc): string {
  const dots = s.inks.reduce((n, ink, i) => n + (d.inks[i]?.visible ? ink.count : 0), 0);
  const mb = (dots * (d.screen.shape === 'cross' ? 150 : d.screen.shape === 'round' || d.screen.shape === 'ellipse' ? 70 : 50)) / 1e6;
  return `${dots.toLocaleString('en')} dots · ≈ ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export async function svgFor(d: HalftoneDoc): Promise<string> {
  const why = svgProblem(d);
  if (why) throw new Error(why);
  const s = await screen(d, true);
  return halftoneSvg({ ...d, overlap: overlapOf(d) }, s.inks.map((ink) => ink.cells));
}

/** an image `w` × `h` of the whole page drawn tile by tile */
async function raster(s: Screened, look: Look, w: number, h: number, y0 = 0, k = w / s.page.w, progress?: (share: number) => void): Promise<Uint8Array> {
  const painter = new Painter('halftone export');
  try {
    const size = Math.min(4096, painter.g.maxSize);
    const total = Math.ceil(w / size) * Math.ceil(h / size);
    let done = 0;
    return await painter.g.renderTiled(w, h, 'rgba8', (tile: Tile) => {
      const { x, y, w: tw, h: th } = tile.rect;
      painter.paint(s, look, [x, y0 + y], k, tile, { w: tw, h: th }, true);
      progress?.(++done / total);
    });
  } finally {
    painter.release();
  }
}

/** The screen PNG at `width` px, the DPI written in so it opens at the page's size. */
export async function pngBlob(d: HalftoneDoc, width: number, progress?: Progress): Promise<Blob> {
  const s = await screen(d, true);
  const height = Math.max(1, Math.round((width * s.page.h) / s.page.w));
  const why = pngLimit(width, height);
  if (why) throw new Error(why);
  const px = await raster(s, lookOf(d, d.feel.bake, !d.paper.include), width, height, 0, width / s.page.w, (f) => progress?.(f * 0.9, `${width} × ${height} px`));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.length), width, height), 0, 0);
  return withDpi(await canvas.convertToBlob({ type: 'image/png' }), width / (d.size.w / 25.4));
}

export const pngFor = async (d: HalftoneDoc, width: number, progress?: Progress): Promise<ArrayBuffer> => (await pngBlob(d, width, progress)).arrayBuffer();

/** an ink's 1-bit plate, ranked from its cells in a worker: 0 where it prints, 255 for paper */
function bilevelPlate(s: Screened, index: number, W: number, H: number): Promise<Uint8Array> {
  const ink = s.inks[index];
  const coverage = Float32Array.from({ length: ink.cells!.n }, (_, k) => ink.dots![3 * k + 2]);
  const job: PlateJob = { cells: ink.cells!, coverage, shape: s.doc.screen.shape as CellShape, W, H, page: s.page };
  const w = new Worker(new URL('./plate.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<Uint8Array>((ok, fail) => {
    w.onmessage = ({ data }: MessageEvent<PlateDone>) => ('error' in data ? fail(new Error(data.error)) : ok(data.plate));
    w.onerror = (e) => fail(new Error(e.message || 'The 1-bit plate stopped working.'));
    w.postMessage(job, [coverage.buffer]);
  }).finally(() => w.terminate());
}

/**
 * One TIFF per visible ink at print resolution: 0 where it prints, 255 where the paper shows.
 * Knocked out, each plate is clear wherever an ink printed after it shows, so the press lays down
 * what the view shows (every plate prints; nothing under the top ink may).
 */
export async function platesFor(d: HalftoneDoc, bits: 8 | 1, name: string, progress?: Progress): Promise<{ name: string; data: ArrayBuffer }[]> {
  const why = platesLimit(d);
  if (why) throw new Error(why);
  const s = await screen(d, true);
  const [W, H] = [Math.round(s.page.w), Math.round(s.page.h)];
  const shown = d.inks.map((ink, index) => ({ ink, index })).filter((x) => x.ink.visible);
  const knockout = overlapOf(d) === 'knockout';
  // pixel by pixel, the inks printed later cover the plate: the top ink first, keeping what it covers
  const covered = knockout ? new Uint8Array(W * H) : null;
  const files: { name: string; data: ArrayBuffer }[] = new Array(shown.length);
  const order = [...shown.entries()].reverse();
  for (const [done, [n, { ink, index }]] of order.entries()) {
    const label = `Plate ${done + 1} of ${shown.length}: ${ink.name}`;
    let grey: Uint8Array;
    const fm = s.inks[index].fm;
    if (fm || bits === 1) {
      grey = fm ? fm.slice() : await bilevelPlate(s, index, W, H);
      if (covered) {
        for (let p = 0; p < grey.length; p++) {
          if (grey[p] !== 0) continue;
          if (covered[p]) grey[p] = 255;
          covered[p] = 1;
        }
      }
    } else {
      grey = new Uint8Array(W * H);
      for (let y0 = 0; y0 < H; y0 += BAND) {
        const h = Math.min(BAND, H - y0);
        const px = await raster(s, filmOf(d, index), W, h, y0, 1, (f) => progress?.((done + (y0 + f * h) / H) / shown.length, label));
        for (let p = 0; p < W * h; p++) grey[y0 * W + p] = px[p * 4];
      }
    }
    progress?.((done + 1) / shown.length, label);
    const tiff = writeTiff(grey, W, H, d.size.dpi, bits);
    const channel = ink.process ? ink.process.toUpperCase() : `${index + 1}`;
    files[n] = { name: `${name} ${channel} ${ink.name}.tif`, data: tiff.buffer.slice(tiff.byteOffset, tiff.byteOffset + tiff.byteLength) as ArrayBuffer };
  }
  return files;
}
