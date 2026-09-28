// Where Build's proposals come from outside the palette: an image, a logo or SVG, pasted text.
import { parseCss, toHex, type Oklch } from '../../../shared/color/index.ts';
import { extractColours } from '../../../shared/palette/extract.ts';
import { parseColours } from '../../../shared/palette/paste.ts';
import { decodeImage } from '../../lib/load.ts';
import { propose } from './proposals.ts';
import { createStore } from './store.ts';
import { getView, patchView } from './view-state.ts';

/** extractColours subsamples to this many pixels anyway; shrinking first keeps re-runs instant */
const MAX_PX = 40_000;

/** the last image the Image tab pulled from, kept small so a new count re-runs at once */
export const picture = createStore<{ name: string; pixels: ImageData } | null>(null);

async function pixelsOf(blob: Blob, name: string): Promise<ImageData> {
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

/** throws when the image has nothing to take (every pixel clear), keeping the proposals there were */
export async function takeImage(blob: Blob, name: string): Promise<void> {
  const pixels = await pixelsOf(blob, name);
  if (!pixels.data.some((a, i) => i % 4 === 3 && a >= 128)) throw new Error(`${name} has no opaque pixels to take colours from.`);
  picture.set({ name, pixels });
  patchView({ build: 'image' });
  extract();
}

/** k-means in OKLab (shared/palette/extract), most common first */
export function extract(k = getView().k): void {
  const p = picture.get();
  if (!p) return;
  const found = extractColours(p.pixels.data, p.pixels.width, p.pixels.height, k);
  propose('image', `From ${p.name}`, found.map((f) => f.oklch));
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
function paints(svg: string): Oklch[] {
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

const unique = (list: Oklch[]): Oklch[] => [...new Map(list.map((o) => [toHex(o), o])).values()];

/** a logo's or SVG's fill and stroke colours become proposals; throws when it has none */
export function takeSvg(svgs: (string | null | undefined)[], name: string): void {
  const colours = svgs.filter(Boolean).flatMap((s) => paints(s!));
  if (!colours.length) throw new Error(`${name} draws nothing with a colour to take.`);
  propose('logo', `From ${name}`, unique(colours));
  patchView({ build: 'logo' });
}

/** pasted text: hex lists, rgb(), hsl(), oklch()… (shared/palette/paste) */
export function takeText(text: string): { found: number; rejected: string[] } {
  const r = parseColours(text);
  if (r.colours.length) propose('paste', r.colours.length === 1 ? 'Pasted colour' : 'Pasted colours', r.colours, r.names);
  return { found: r.colours.length, rejected: r.rejected };
}
