// Taking colours from outside a palette: an image's pixels, an SVG's paints. Shared by the colour tools.
import { parseCss, toHex, type Oklch } from '../../../shared/color/index.ts';
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

const PAINT = /(?:^|[;\s{])(?:fill|stroke|stop-color|flood-color)\s*:\s*([^;}]+)/g;
const SKIP = /^(none|transparent|inherit|currentcolor|context-fill|context-stroke)$|^url\(/i;

const SHAPES = 'path, rect, circle, ellipse, polygon, polyline, text';
const BLACK: Oklch = [0, 0, 0];

/**
 * Every paint an SVG names, as colours, read with DOMParser (it never enters the page, spec §10.3).
 * Any CSS colour counts, keywords too (Figma writes fill="white"). Shapes that name no paint at
 * all draw black, the SVG default.
 */
export function paints(svg: string): Oklch[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const found: Oklch[] = [];
  const take = (v: string | null | undefined) => {
    const t = v?.trim();
    const o = t && !SKIP.test(t) ? parseCss(t) : null;
    if (o) found.push(o);
  };
  for (const el of doc.querySelectorAll('*')) {
    for (const a of ['fill', 'stroke', 'stop-color', 'flood-color']) take(el.getAttribute(a));
    for (const m of (el.getAttribute('style') ?? '').matchAll(PAINT)) take(m[1]);
  }
  for (const st of doc.querySelectorAll('style')) for (const m of (st.textContent ?? '').matchAll(PAINT)) take(m[1]);
  return found.length || !doc.querySelector(SHAPES) ? found : [BLACK];
}

export const unique = (list: Oklch[]): Oklch[] => [...new Map(list.map((o) => [toHex(o), o])).values()];
