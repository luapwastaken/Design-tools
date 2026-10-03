// Pattern SVG to pixels: through an <img> from a Blob URL, a document of its own (spec §10.3), at
// the exact pixel size asked, so the vectors render sharp at it.
import { artboardProblem, artboardSvg, tileSvg, type SvgInput } from '../../../shared/pattern/svg.ts';
import type { Tile } from '../../../shared/pattern/types.ts';
import { framed, type ViewBox } from '../../../shared/svg/index.ts';
import { withDpi } from '../../lib/png.ts';
import { fmtPx } from '../common/names.ts';

/** what one canvas can hold here, and what a PNG export may ask for */
export const MAX_SIDE = 16384;
export const MAX_PIXELS = 16384 * 8192;

/** `box` of the SVG's user space (its viewBox by default) drawn at w × h px */
export async function drawSvg(svg: string, w: number, h: number, box?: ViewBox): Promise<OffscreenCanvas> {
  const url = URL.createObjectURL(new Blob([framed(svg, w, h, box)], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** why a PNG this size can't be made, or null */
export function tooBig(w: number, h: number): string | null {
  if (w <= MAX_SIDE && h <= MAX_SIDE && w * h <= MAX_PIXELS) return null;
  return `That PNG would be ${fmtPx(w, h)}. PNGs stop at ${MAX_SIDE} px a side and ${Math.round(MAX_PIXELS / 1e6)} megapixels: lower the DPI or the size.`;
}

const whole = (v: number) => Math.max(1, Math.round(v));

/** one tile, `k` device px per design px */
export async function tilePng(svg: string, tile: { w: number; h: number }, k: number, dpi: number): Promise<Blob> {
  const [w, h] = [whole(tile.w * k), whole(tile.h * k)];
  const why = tooBig(w, h);
  if (why) throw new Error(why);
  return withDpi(await (await drawSvg(svg, w, h)).convertToBlob({ type: 'image/png' }), dpi);
}

/**
 * The artboard (px) from the top left: its own vectors drawn at its pixels, so every edge is sharp.
 * Past the artboard SVG's shape limit, the tile drawn once and repeated as a canvas pattern, scaled
 * back from whole pixels to its true pitch (edges soften a little, seams stay exact).
 */
export async function boardPng(d: SvgInput, tile: Tile, board: { w: number; h: number }, k: number, dpi: number): Promise<Blob> {
  const [w, h] = [whole(board.w * k), whole(board.h * k)];
  const why = tooBig(w, h);
  if (why) throw new Error(why);
  if (!artboardProblem(tile, board.w, board.h, 'px')) {
    return withDpi(await (await drawSvg(artboardSvg(d, tile, board.w, board.h, 'px'), w, h)).convertToBlob({ type: 'image/png' }), dpi);
  }
  const [tw, th] = [whole(tile.width * k), whole(tile.height * k)];
  if (tooBig(tw, th)) throw new Error(`One tile would be ${fmtPx(tw, th)} at this DPI, too big to draw. Lower the DPI.`);
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const p = ctx.createPattern(await drawSvg(tileSvg(d, tile, 'px'), tw, th), 'repeat')!;
  p.setTransform(new DOMMatrix().scale((tile.width * k) / tw, (tile.height * k) / th));
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, w, h);
  return withDpi(await c.convertToBlob({ type: 'image/png' }), dpi);
}
