// Where Build's proposals come from outside the palette: an image, a logo or SVG, pasted text.
import { extractColours } from '../../../shared/palette/extract.ts';
import { parseColours } from '../../../shared/palette/paste.ts';
import { svgColours } from '../../../shared/svg/index.ts';
import { pixelsOf, unique } from '../common/take.ts';
import { createStore } from '../common/store.ts';
import { propose } from './proposals.ts';
import { getView, patchView } from './view-state.ts';

/** the last image the Image tab pulled from, kept small so a new count re-runs at once */
export const picture = createStore<{ name: string; pixels: ImageData } | null>(null);

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

/** a logo's or SVG's fill and stroke colours become proposals; throws when it has none */
export function takeSvg(svgs: (string | null | undefined)[], name: string): void {
  const colours = svgs.filter(Boolean).flatMap((s) => svgColours(s!));
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
