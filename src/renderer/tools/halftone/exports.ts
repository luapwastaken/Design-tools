// What each export writes, every one from the screen the view draws (screening.ts): the SVG from its
// cells, the screen PNG and the greyscale plates from the same dots drawn by draw.ts at their own
// sizes, the 1-bit plates from the same cells ranked pixel by pixel (shared/halftone/bilevel). Only
// the SVG has a dot cap (spec §6.2): the rasters go tile by tile, a screen too big to hold whole
// making its cells region by region.
import { dots, pagePx, splitOf } from '../../../shared/halftone/screen.ts';
import { svgParts, svgProblem } from '../../../shared/halftone/svg.ts';
import { writeTiff } from '../../../shared/halftone/tiff.ts';
import type { Cells, CellShape } from '../../../shared/halftone/types.ts';
import type { Tile } from '../../lib/gpu/index.ts';
import { withDpi } from '../../lib/png.ts';
import { encodeIndexedPng } from '../../lib/png-indexed.ts';
import { opaqueOf, overlapOf, printPx, type HalftoneDoc } from './doc.ts';
import { filmOf, lookOf, Painter, REGION_CELLS, TONE_AT, type Look } from './draw.ts';
import type { PlateDone, PlateJob, ScreenOf } from './plate.worker.ts';
import { sheetOf, SLUG_TEXT_MM, slugRoom, withMarks, type Slug } from './plates.ts';
import { screen, shownDots, svgMegabytes, svgOver, type Screened } from './screening.ts';

type Progress = (done: number, detail?: string) => void;

const MAX_PNG = 64e6;
const MAX_PLATE = 250e6;
/** rows drawn and read at once for a plate, so a big one never needs a second full-size copy in RGBA */
const BAND = 2048;

/** the screen PNG's width: the one set, or the page's print width at its dpi (so it opens at the size it prints), kept to what a PNG here can hold */
export const pngWidthOf = (d: HalftoneDoc, set: number | null): number => set ?? Math.max(16, Math.min(printPx(d).w, pngMaxWidth(d.size)));

/** the widest screen PNG this page can make inside the 64-megapixel limit (the W field stops here, so it never offers what the Export can't make) */
export const pngMaxWidth = (page: { w: number; h: number }): number => Math.max(16, Math.min(16384, Math.floor(Math.sqrt((MAX_PNG * page.w) / page.h))));

export const pngLimit = (w: number, h: number): string | null =>
  w * h > MAX_PNG ? `${w} × ${h} px is more than a PNG here can hold (64 megapixels). Make it narrower.` : null;

export function platesLimit(d: HalftoneDoc, marks = false): string | null {
  const p = pagePx(d.size);
  const [w, h] = [Math.round(p.w), Math.round(p.h)];
  // the marks put the plate on a larger sheet
  const sheet = marks ? sheetOf(w, h, d.size.dpi) : { w, h };
  return sheet.w * sheet.h > MAX_PLATE ? `A plate of ${sheet.w.toLocaleString('en')} × ${sheet.h.toLocaleString('en')} px at ${d.size.dpi} dpi is more than a plate file here can hold. Lower the DPI or the size.` : null;
}

/** "12,859 dots · ≈ 0.6 MB": what the SVG will weigh */
export function svgWeight(s: Screened, d: HalftoneDoc): string {
  const dots = shownDots(s, d);
  const mb = svgMegabytes(s, d);
  return `${s.held ? '' : '≈ '}${dots.toLocaleString('en')} dots · ≈ ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** an ink's screen as the plate worker makes it */
const screenOf = (s: Screened, index: number): ScreenOf => ({
  plate: s.inks[index].plate,
  plateW: s.plate.w,
  plateH: s.plate.h,
  size: s.doc.size,
  screen: s.doc.screen,
  angle: s.doc.inks[index].angle,
});

function plateWorker<T>(job: PlateJob, take: (done: Exclude<PlateDone, { error: string }>) => T, transfer: Transferable[] = []): Promise<T> {
  const w = new Worker(new URL('./plate.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<T>((ok, fail) => {
    w.onmessage = ({ data }: MessageEvent<PlateDone>) => ('error' in data ? fail(new Error(data.error)) : ok(take(data)));
    w.onerror = (e) => fail(new Error(e.message || 'The plate worker stopped working.'));
    w.postMessage(job, transfer);
  }).finally(() => w.terminate());
}

/**
 * The SVG, in pieces joined as bytes (a page of dots can outgrow one string). `only` is one ink's
 * place in the list, for a file of that ink alone; `paper` draws the paper's rectangle (the file is
 * for the inks: the paper is a preview, so it is off unless asked).
 */
export async function svgFor(source: HalftoneDoc, { only, paper = false }: { only?: number; paper?: boolean } = {}): Promise<ArrayBuffer> {
  // the inks this file holds: the visible ones, or the one asked for
  const d = { ...source, inks: source.inks.map((ink, i) => ({ ...ink, visible: ink.visible && (only === undefined || i === only) })), paper: { ...source.paper, include: paper && source.paper.include } };
  const why = svgProblem(d);
  if (why) throw new Error(why);
  // the screen of the whole document: a file of one ink holds the dots that ink has in the view
  const s = await screen(source, true);
  const over = svgOver(shownDots(s, d), !s.held);
  if (over) throw new Error(over);
  const shown = await Promise.all(s.inks.map((ink, i) => (!d.inks[i].visible ? null : (ink.cells ?? plateWorker<Cells>({ cellsOf: screenOf(s, i) }, (r) => (r as { cells: Cells }).cells)))));
  const inks = d.inks.map((ink) => ({ ...ink, opaque: opaqueOf(ink) }));
  const doc = { ...d, inks, overlap: overlapOf(d) };
  if (!s.held) {
    // counted from the plates until now: the cells say for certain
    const exact = svgOver(shown.reduce((n, c) => n + (c ? dots(c, d.screen).count : 0), 0));
    if (exact) throw new Error(exact);
  }
  return new Blob(svgParts(doc, shown)).arrayBuffer();
}

/**
 * A raster's tile: smaller where a screen too big to hold whole makes its cells for each tile, so
 * no tile needs more than REGION_CELLS of them (where they are too small to show, the plate's tone
 * draws instead and the tile is as large as it goes).
 */
function tileFor(s: Screened, k: number, largest: number): number {
  const pitch = s.doc.size.dpi / s.doc.screen.lpi;
  if (s.held || s.doc.screen.shape === 'stochastic' || pitch * k < TONE_AT) return largest;
  return Math.max(256, Math.min(largest, Math.floor(k * pitch * Math.sqrt(REGION_CELLS / splitOf(s.doc.screen.shape)))));
}

/** an image `w` × `h` of the whole page drawn tile by tile */
async function raster(s: Screened, look: Look, w: number, h: number, y0 = 0, k = w / s.page.w, progress?: (share: number) => void): Promise<Uint8Array> {
  const painter = new Painter('halftone export');
  try {
    const size = tileFor(s, k, Math.min(4096, painter.g.maxSize));
    const total = Math.ceil(w / size) * Math.ceil(h / size);
    let done = 0;
    return await painter.g.renderTiled(
      w,
      h,
      'rgba8',
      (tile: Tile) => {
        const { x, y, w: tw, h: th } = tile.rect;
        painter.paint(s, look, [x, y0 + y], k, tile, { w: tw, h: th }, true);
        progress?.(++done / total);
      },
      { tile: size },
    );
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

/** an ink's 1-bit plate, ranked from its cells in a worker (made there band by band when not held): 0 where it prints, 255 for paper */
function bilevelPlate(s: Screened, index: number, W: number, H: number): Promise<Uint8Array> {
  const ink = s.inks[index];
  const at = { W, H, page: s.page, shape: s.doc.screen.shape as CellShape };
  const take = (r: Exclude<PlateDone, { error: string }>) => (r as { plate: Uint8Array }).plate;
  if (!ink.cells || !ink.dots) return plateWorker({ ...at, of: screenOf(s, index) }, take);
  const coverage = Float32Array.from({ length: ink.cells.n }, (_, k) => ink.dots![3 * k + 2]);
  return plateWorker({ ...at, cells: ink.cells, coverage }, take, [coverage.buffer]);
}

type PlateFile = { name: string; data: ArrayBuffer };

/** `marks`: each plate on a sheet with bleed, crop and registration marks and its ink's name; `png`: ink on a clear ground, not a TIFF */
export type PlateOptions = { marks?: boolean; png?: boolean };

/** the ink's name for the slug, as coverage, fitted to the room under the trim's left half */
function slugFor(text: string, room: { w: number; h: number }, dpi: number): Slug | null {
  if (room.w < 8 || room.h < 4) return null;
  const canvas = new OffscreenCanvas(room.w, room.h);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  let size = (SLUG_TEXT_MM * dpi) / 25.4;
  const font = (n: number) => `600 ${n}px "Instrument Sans Variable", "Instrument Sans", sans-serif`;
  g.font = font(size);
  // a long name shrinks to fit rather than running into the registration target
  const wide = g.measureText(text).width;
  if (wide > room.w) {
    size = Math.max(4, (size * room.w) / wide);
    g.font = font(size);
  }
  // the canvas's own black: coverage is read from alpha
  g.textBaseline = 'alphabetic';
  g.fillText(text, 0, Math.round(room.h * 0.75));
  const px = g.getImageData(0, 0, room.w, room.h).data;
  return { data: Uint8Array.from({ length: room.w * room.h }, (_, i) => px[i * 4 + 3]), w: room.w, h: room.h };
}

/** a plate as a PNG of its ink in black on a clear ground: the plate's tone is the alpha, so nothing is white paper */
async function platePng(grey: Uint8Array, w: number, h: number, dpi: number, bits: 8 | 1): Promise<Uint8Array> {
  const indices = new Uint8Array(grey.length);
  const palette: [number, number, number, number][] = bits === 1 ? [[0, 0, 0, 0], [0, 0, 0, 255]] : Array.from({ length: 256 }, (_, k) => [0, 0, 0, k]);
  for (let p = 0; p < grey.length; p++) indices[p] = bits === 1 ? (grey[p] < 128 ? 1 : 0) : 255 - grey[p];
  return new Uint8Array(await (await encodeIndexedPng(indices, w, h, palette, { dpi })).arrayBuffer());
}

/**
 * One plate file per visible ink at print resolution (a TIFF, or with `png` a PNG of the ink on a
 * clear ground): 0 where it prints, 255 where the paper shows. Knocked out, each plate is clear
 * wherever an ink printed after it shows, so the press lays down what the view shows (every plate
 * prints; nothing under the top ink may). With `sink` each file goes there as soon as it is made
 * and none is kept, so a big job never holds every plate at once.
 */
export async function platesFor(d: HalftoneDoc, bits: 8 | 1, name: string, progress?: Progress, sink?: (file: PlateFile) => Promise<void>, opts: PlateOptions = {}): Promise<PlateFile[]> {
  const why = platesLimit(d, opts.marks);
  if (why) throw new Error(why);
  const s = await screen(d, true);
  const [W, H] = [Math.round(s.page.w), Math.round(s.page.h)];
  const shown = d.inks.map((ink, index) => ({ ink, index })).filter((x) => x.ink.visible);
  const knockout = overlapOf(d) === 'knockout';
  // pixel by pixel, the inks printed later cover the plate: the top ink first, keeping what it covers
  const covered = knockout ? new Uint8Array(W * H) : null;
  const files: PlateFile[] = new Array(shown.length);
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
    const sheet = opts.marks ? sheetOf(W, H, d.size.dpi) : { w: W, h: H };
    if (opts.marks) {
      const angle = fm ? 'FM' : `${+d.inks[index].angle.toFixed(1)}°`;
      grey = withMarks(grey, W, H, d.size.dpi, slugFor(`${ink.name} · ${angle}`, slugRoom(W, d.size.dpi), d.size.dpi));
    }
    const channel = ink.process ? ink.process.toUpperCase() : `${index + 1}`;
    const bytes = opts.png ? await platePng(grey, sheet.w, sheet.h, d.size.dpi, bits) : writeTiff(grey, sheet.w, sheet.h, d.size.dpi, bits);
    const file = { name: `${name} ${channel} ${ink.name}.${opts.png ? 'png' : 'tif'}`, data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };
    if (sink) await sink(file);
    else files[n] = file;
  }
  return sink ? [] : files;
}
