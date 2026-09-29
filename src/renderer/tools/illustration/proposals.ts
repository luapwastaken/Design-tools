// Colours offered as new base colours (plan unit V): from an image, a logo or SVG, or picked off the
// paint canvas. Never in the document until added; a module-level store so `receive` and the canvas
// can hand them to the view.
import type { Oklch } from '../../../shared/color/index.ts';
import { extractColours } from '../../../shared/palette/extract.ts';
import { createStore } from '../common/store.ts';
import { paints, pixelsOf, unique } from '../common/take.ts';

export type Proposal = { id: string; oklch: Oklch; name: string | null };
export type Proposals = { label: string; items: Proposal[] };

export const proposals = createStore<Proposals | null>(null);

/** a painting's base colours: a few, most common first */
const FROM_IMAGE = 6;
/** picks off the canvas gather in one set; past this the oldest goes */
const MAX_PICKS = 12;
export const CANVAS_LABEL = 'Picked from the canvas';

/** one set at a time: a new source replaces the last; picks off the canvas add to theirs */
export function propose(label: string, colours: Oklch[], names: (string | null)[] = []): void {
  const items = colours.map((oklch, i) => ({ id: crypto.randomUUID(), oklch, name: names[i] ?? null }));
  const cur = proposals.get();
  const next = label === CANVAS_LABEL && cur?.label === CANVAS_LABEL ? [...cur.items, ...items].slice(-MAX_PICKS) : items;
  proposals.set(next.length ? { label, items: next } : null);
}

export function dropProposals(ids: string[]): void {
  const p = proposals.get();
  if (!p) return;
  const items = p.items.filter((x) => !ids.includes(x.id));
  proposals.set(items.length ? { ...p, items } : null);
}

export const clearProposals = (): void => proposals.set(null);

/** proposals given back (their add was undone), ahead of what the same source still offers */
export function restoreProposals(label: string, items: Proposal[]): void {
  const cur = proposals.get();
  const rest = cur?.label === label ? cur.items.filter((x) => !items.some((y) => y.id === x.id)) : [];
  proposals.set({ label, items: [...items, ...rest] });
}

/** the paint canvas's Pick: the colour under the brush, offered as a base */
export const pickFromCanvas = (oklch: Oklch): void => propose(CANVAS_LABEL, [oklch]);

/** throws when the image has nothing to take (every pixel clear), keeping the proposals there were */
export async function takeImage(blob: Blob, name: string): Promise<void> {
  const px = await pixelsOf(blob, name);
  if (!px.data.some((a, i) => i % 4 === 3 && a >= 128)) throw new Error(`${name} has no opaque pixels to take colours from.`);
  propose(`From ${name}`, extractColours(px.data, px.width, px.height, FROM_IMAGE).map((f) => f.oklch));
}

/** a logo's or SVG's fill and stroke colours; throws when it has none */
export function takeSvg(svgs: (string | null | undefined)[], name: string): void {
  const colours = unique(svgs.filter(Boolean).flatMap((s) => paints(s!)));
  if (!colours.length) throw new Error(`${name} draws nothing with a colour to take.`);
  propose(`From ${name}`, colours);
}
