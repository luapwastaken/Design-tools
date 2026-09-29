// Taking colours from outside a palette: an image's pixels (an SVG's paints are shared/svg's
// svgColours). Shared by the colour tools.
import { toHex, type Oklch } from '../../../shared/color/index.ts';
import { decodeImage } from '../../lib/load.ts';

/** a Library item's file (dt://) */
export async function fetchBlob(url: string, name: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't read ${name}.`);
  return res.blob();
}

/** extractColours subsamples to this many pixels anyway; shrinking first keeps re-runs instant */
const MAX_PX = 40_000;

/** the image as it looks, shrunk to at most MAX_PX pixels */
export async function pixelsOf(blob: Blob, name: string): Promise<ImageData> {
  // colours as the image looks, so a Display P3 screenshot isn't read as if it were sRGB
  const bmp = await decodeImage(blob, name, { asShown: true });
  const k = Math.min(1, Math.sqrt(MAX_PX / (bmp.width * bmp.height)));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const ctx = new OffscreenCanvas(w, h).getContext('2d')!;
  ctx.imageSmoothingEnabled = false; // real pixels, not blends of neighbours
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return ctx.getImageData(0, 0, w, h);
}

export const unique = (list: Oklch[]): Oklch[] => [...new Map(list.map((o) => [toHex(o), o])).values()];
