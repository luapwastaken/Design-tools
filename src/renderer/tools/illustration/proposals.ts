// Colours offered as new base colours (plan unit V): from an image, a logo or SVG, or picked off the
// paint canvas. Never in the document until added; a module-level store so `receive` and the canvas
// can hand them to the view.
import { toOklch, type Oklch } from '../../../shared/color/index.ts';
import { valueOf } from '../../../shared/color/value.ts';
import { extractColours } from '../../../shared/palette/extract.ts';
import type { MaterialId } from '../../../shared/types.ts';
import { createStore } from '../common/store.ts';
import { svgColours } from '../../../shared/svg/index.ts';
import { pixelsOf, unique } from '../common/take.ts';

/** `material`: what the ramp made from it is (a Library palette's own ramps, a subject); `set`: the group of loose swatches it joins when kept (a row of Light zones) */
export type Proposal = { id: string; oklch: Oklch; name: string | null; material?: MaterialId; set?: string };
/** `from`: the source whose popover shows these; `note`: what it left out, in a sentence */
export type Proposals = { label: string; items: Proposal[]; from?: Source; note?: string };

export const proposals = createStore<Proposals | null>(null);

/** the sources that stage several colours before any ramp is made: each has a popover under Add colour */
export type Source = 'image' | 'paste' | 'library' | 'set';
/** the popover that shows; `text`: what was pasted into the tool, `set`: which limited set */
export type SourcePop = { source: Source; text?: string; set?: string };
export const sourcePop = createStore<SourcePop | null>(null);

/** the last picture an image popover took colours from, kept small so a new count re-runs at once */
export const picture = createStore<{ name: string; pixels: ImageData; k: number } | null>(null);
export const COLOURS = { min: 3, max: 12, start: 6 };
/** picks off the canvas gather in one set; past this the oldest goes */
const MAX_PICKS = 12;
/** a few rows of seven */
const MAX_ZONES = 28;
export const CANVAS_LABEL = 'Picked from the canvas';
/** colours clicked in the Light zones grid gather in one set too */
export const ZONES_LABEL = 'From Light zones';
/** the layer colours offered from the Layers tab: one set, replaced when offered again */
export const LAYERS_LABEL = 'From Layers';
/** these are kept as groups of loose swatches, never as ramps */
export const keptLoose = (label: string | undefined): boolean => label === LAYERS_LABEL || label === ZONES_LABEL;

/** one set at a time: a new source replaces the last; picks off the canvas add to theirs. `sort`: light to dark, names and materials along */
export function propose(label: string, colours: Oklch[], names: (string | null)[] = [], more: { from?: Source; sort?: boolean; note?: string; materials?: (MaterialId | undefined)[]; set?: string } = {}): void {
  let items: Proposal[] = colours.map((oklch, i) => ({ id: crypto.randomUUID(), oklch, name: names[i] ?? null, ...(more.materials?.[i] && { material: more.materials[i] }), ...(more.set && { set: more.set }) }));
  if (more.sort) items = items.sort((a, b) => valueOf(b.oklch) - valueOf(a.oklch));
  if (more.from !== 'image') picture.set(null); // another source: the picture's pixels go
  const cur = proposals.get();
  const next = (label === CANVAS_LABEL || label === ZONES_LABEL) && cur?.label === label ? [...cur.items, ...items].slice(-(label === ZONES_LABEL ? MAX_ZONES : MAX_PICKS)) : items;
  proposals.set(next.length ? { label, items: next, ...(more.from && { from: more.from }), ...(more.note && { note: more.note }) } : null);
}

export function dropProposals(ids: string[]): void {
  const p = proposals.get();
  if (!p) return;
  const items = p.items.filter((x) => !ids.includes(x.id));
  proposals.set(items.length ? { ...p, items } : null);
}

export const clearProposals = (): void => {
  picture.set(null);
  sourcePop.set(null);
  proposals.set(null);
};

/** proposals given back (their add was undone), ahead of what the same source still offers */
export function restoreProposals(label: string, items: Proposal[], from?: Source): void {
  const cur = proposals.get();
  const rest = cur?.label === label ? cur.items.filter((x) => !items.some((y) => y.id === x.id)) : [];
  const source = cur?.label === label ? cur.from : from;
  proposals.set({ label, items: [...items, ...rest], ...(source && { from: source }) });
}

/** the paint canvas's Pick: the colour under the brush, offered as a base */
export const pickFromCanvas = (oklch: Oklch): void => propose(CANVAS_LABEL, [oklch]);

/** throws when the image has nothing to take (every pixel clear), keeping the proposals there were; its popover opens */
export async function takeImage(blob: Blob, name: string): Promise<void> {
  const px = await pixelsOf(blob, name);
  if (!px.data.some((a, i) => i % 4 === 3 && a >= 128)) throw new Error(`${name} has no opaque pixels to take colours from.`);
  picture.set({ name, pixels: px, k: picture.get()?.k ?? COLOURS.start });
  extract();
  sourcePop.set({ source: 'image' });
}

/** the picture's `k` main colours (k-means in OKLab), light to dark; the popover's Colours field */
export function extract(k = picture.get()?.k ?? COLOURS.start): void {
  const p = picture.get();
  if (!p) return;
  const count = Math.min(COLOURS.max, Math.max(COLOURS.min, Math.round(k)));
  picture.set({ ...p, k: count });
  const found = extractColours(p.pixels.data, p.pixels.width, p.pixels.height, count);
  propose(`From ${p.name}`, found.map((f) => f.oklch), [], { from: 'image', sort: true });
}

/** the colour of the picture's pixel (x, y), staged with the others (light to dark); false over a clear pixel or with no picture */
export function pickPixel(x: number, y: number): boolean {
  const p = picture.get();
  const cur = proposals.get();
  if (!p || cur?.from !== 'image' || x < 0 || y < 0 || x >= p.pixels.width || y >= p.pixels.height) return false;
  const i = (Math.floor(y) * p.pixels.width + Math.floor(x)) * 4;
  const [r, g, b, a] = p.pixels.data.slice(i, i + 4);
  if (a < 128) return false;
  const oklch = toOklch({ mode: 'rgb', r: r / 255, g: g / 255, b: b / 255 });
  const items = [...cur.items, { id: crypto.randomUUID(), oklch, name: null }].sort((m, n) => valueOf(n.oklch) - valueOf(m.oklch));
  proposals.set({ ...cur, items });
  return true;
}

/** a logo's or SVG's fill and stroke colours; throws when it has none */
export function takeSvg(svgs: (string | null | undefined)[], name: string): void {
  const colours = unique(svgs.filter(Boolean).flatMap((s) => svgColours(s!)));
  if (!colours.length) throw new Error(`${name} draws nothing with a colour to take.`);
  propose(`From ${name}`, colours);
}
