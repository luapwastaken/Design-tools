// SVG out: the Illustrator swatch (one tile), the artboard (real vectors) and the preview tile the
// Library shows. Each shape is a <symbol> per slot and colour, placed with <use>, so a tile of a
// hundred stars carries the star's paths once. `expand` writes plain groups instead (a copy of the
// artwork at each place), for tools that make symbols of <symbol> and <use> and won't edit them.
import { toHex, type Oklch } from '../color/index.ts';
import { namespace, recolour } from '../svg/index.ts';
import { isEl, parseSvg, serialize, type Attr, type XmlNode } from '../svg/xml.ts';
import { reachOf } from './layout.ts';
import type { Item, PatternDoc, ShapeSlot, Tile, Unit } from './types.ts';
import { wrapItems } from './wrap.ts';

/**
 * 1in = 96px, as SVG and CSS count them. The DPI only sets a PNG's pixels: were it to size the
 * vectors, changing it would change the design against its artboard (v1's Meteorite did).
 */
export const PX_PER: Record<Unit, number> = { px: 1, mm: 96 / 25.4, in: 96 };

export type SvgInput = Pick<PatternDoc, 'slots' | 'background'>;

/** past this many shapes an artboard SVG runs to tens of megabytes */
export const MAX_SHAPES = 200_000;
// a slot root's sizing and namespaces: its symbol and the file's root take these over
const ROOT_ONLY = /^(?:xmlns(?::.*)?|version|baseProfile|x|y|width|height|viewBox|preserveAspectRatio|id|overflow|enable-background)$/;
/** the shapes whose built symbols are kept */
const KEEP_BUILT = 24;

const n = (v: number) => String(+v.toFixed(3));
const length = (px: number, unit: Unit) => `${+(px / PX_PER[unit]).toFixed(4)}${unit}`;
const rect = (w: string, h: string, more = '') => `<rect width="${w}" height="${h}"${more}/>`;

/** what a slot's root holds that is drawn only when something refers to it (rules, gradients, clips) */
const DEFINITIONS = new Set(['style', 'defs', 'linearGradient', 'radialGradient', 'pattern', 'clipPath', 'mask', 'filter', 'marker']);

/** `text`: the <symbol>; `defs` and `art` are the same artwork apart, for the expanded form */
type Built = { text: string; defs: string; art: string; ns: Attr[] };
type Drawn = { ns: Attr[]; defs: string; uses: string };

/**
 * Back to front: by centre, the top row first, then left to right. That order is the same wherever
 * two shapes sit, so shapes that overlap stack alike at a seam and inside the tile, and the swatch,
 * the artboard and the PNGs agree. Centres compare as written (3 decimals), so the float noise of
 * adding a tile's width can't flip a pair.
 */
export function stacked(items: Item[]): Item[] {
  const at = (v: number) => Math.round(v * 1000);
  return items.slice().sort((a, b) => at(a.y) - at(b.y) || at(a.x) - at(b.x));
}

/** symbols already built, by markup, then id and bounds: a big shape rebuilt on every slider tick stalls the view */
const built = new Map<string, Map<string, Built>>();

/**
 * One slot in one colour. Namespaced again per symbol: two colours of one shape carry the same
 * style rules, and the later one would paint both.
 */
function symbol(id: string, slot: ShapeSlot, hex: string | null): Built {
  const b = slot.bounds;
  const key = `${id} ${b.x} ${b.y} ${b.w} ${b.h}`;
  let byKey = built.get(slot.svg);
  if (!byKey) {
    if (built.size >= KEEP_BUILT) built.delete(built.keys().next().value!);
    built.set(slot.svg, (byKey = new Map()));
  }
  const had = byKey.get(key);
  if (had) return had;
  const root = parseSvg(namespace(hex ? recolour(slot.svg, hex) : slot.svg, id));
  // what the root paints with (fill, class for its scoped style rules) moves onto a group
  const keep = root.attrs.filter((a) => !ROOT_ONLY.test(a.name));
  const art = keep.length ? serialize({ name: 'g', attrs: keep, children: root.children }) : root.children.map(serialize).join('');
  const defined = (c: XmlNode) => isEl(c) && DEFINITIONS.has(c.name);
  const drawn = root.children.filter((c) => !defined(c));
  const made = {
    defs: root.children.filter(defined).map(serialize).join(''),
    art: keep.length ? serialize({ name: 'g', attrs: keep, children: drawn }) : drawn.map(serialize).join(''),
    text: `<symbol id="${id}" viewBox="${n(b.x)} ${n(b.y)} ${n(b.w)} ${n(b.h)}" overflow="visible">${art}</symbol>`,
    ns: root.attrs.filter((a) => a.name.startsWith('xmlns:')),
  };
  byKey.set(key, made);
  return made;
}

/** an item: its slot's artwork bounds centred on it, turned, scaled to its size */
function use(id: string, b: ShapeSlot['bounds'], it: Item): string {
  const scale = +(it.size / (Math.max(b.w, b.h) || 1)).toPrecision(6);
  const turn = it.rotation ? ` rotate(${n(it.rotation)})` : '';
  return `<use xlink:href="#${id}" x="${n(-b.w / 2)}" y="${n(-b.h / 2)}" width="${n(b.w)}" height="${n(b.h)}" transform="translate(${n(it.x)} ${n(it.y)})${turn} scale(${scale})"/>`;
}

/** an item as a group: the same placing as `use`, with the artwork's own corner as the origin the <use> would have moved */
function place(art: string, b: ShapeSlot['bounds'], it: Item): string {
  const scale = +(it.size / (Math.max(b.w, b.h) || 1)).toPrecision(6);
  const turn = it.rotation ? ` rotate(${n(it.rotation)})` : '';
  return `<g transform="translate(${n(it.x)} ${n(it.y)})${turn} scale(${scale}) translate(${n(-b.w / 2 - b.x)} ${n(-b.h / 2 - b.y)})">${art}</g>`;
}

/**
 * items as <use>s of the symbols they need (a symbol's id is its slot's place and its colour, so it
 * stays put between edits); with `expand`, as a group each, the shared rules and gradients once in <defs>
 */
function draw(doc: SvgInput, items: Item[], expand = false): Drawn {
  const at = new Map(doc.slots.map((s, i) => [s.id, i]));
  const hexes = new Map<Oklch, string>();
  const symbols = new Map<string, Built>();
  let uses = '';
  for (const it of items) {
    const i = at.get(it.slot);
    if (i === undefined) continue;
    const slot = doc.slots[i];
    let hex: string | null = null;
    if (it.colour) {
      hex = hexes.get(it.colour) ?? toHex(it.colour);
      hexes.set(it.colour, hex);
    }
    const id = `dtp-${i}${hex ? `-${hex.slice(1)}` : ''}`;
    if (!symbols.has(id)) symbols.set(id, symbol(id, slot, hex));
    uses += expand ? place(symbols.get(id)!.art, slot.bounds, it) : use(id, slot.bounds, it);
  }
  const ns: Attr[] = [];
  for (const s of symbols.values()) for (const a of s.ns) if (!ns.some((x) => x.name === a.name)) ns.push(a);
  return { ns, defs: [...symbols.values()].map((s) => (expand ? s.defs : s.text)).join(''), uses };
}

function file(width: string, height: string, viewW: string, viewH: string, ns: Attr[], body: string): string {
  const attrs = [
    { name: 'xmlns', value: 'http://www.w3.org/2000/svg' },
    { name: 'xmlns:xlink', value: 'http://www.w3.org/1999/xlink' },
    ...ns.filter((a) => a.name !== 'xmlns:xlink'),
    { name: 'width', value: width },
    { name: 'height', value: height },
    { name: 'viewBox', value: `0 0 ${viewW} ${viewH}` },
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize({ name: 'svg', attrs, children: [{ text: body }] })}`;
}

const background = (doc: SvgInput, w: string, h: string) => (doc.background ? rect(w, h, ` fill="${toHex(doc.background)}"`) : '');

/**
 * The Illustrator swatch: one tile, sized in `unit`, with the items over its edges copied to the far
 * side and clipped. Illustrator takes the backmost unfilled, unstroked rectangle as a dragged
 * swatch's tile, so the edges keep their half gaps and the swatch repeats at the true pitch.
 */
export function tileSvg(doc: SvgInput, tile: Tile, unit: Unit, expand = false): string {
  const { ns, defs, uses } = draw(doc, stacked(wrapItems(tile.items, tile.width, tile.height, reachOf(doc.slots))), expand);
  const [w, h] = [n(tile.width), n(tile.height)];
  return file(length(+w, unit), length(+h, unit), w, h, ns,
    `<defs><clipPath id="dtp-clip">${rect(w, h)}</clipPath>${defs}</defs>` +
    `${rect(w, h, ' fill="none" stroke="none"')}${background(doc, w, h)}<g clip-path="url(#dtp-clip)">${uses}</g>`);
}

/** about how many shapes a w × h px artboard holds: each item once for every repeat that can reach it */
const shapesOn = (tile: Tile, w: number, h: number) => tile.items.length * (Math.ceil(w / tile.width) + 1) * (Math.ceil(h / tile.height) + 1);

/** why a w × h artboard (in `unit`) of this tile can't be written, or null */
export function artboardProblem(tile: Tile, w: number, h: number, unit: Unit): string | null {
  const count = shapesOn(tile, w * PX_PER[unit], h * PX_PER[unit]);
  if (count <= MAX_SHAPES) return null;
  return `That artboard would hold about ${count.toLocaleString('en')} shapes, more than ${MAX_SHAPES.toLocaleString('en')}. Make the tile bigger or the artboard smaller.`;
}

/**
 * A w × h artboard (in `unit`) of real vectors: every shape the repeat puts on it, whole and in the
 * swatch's stacking order, clipped once at the artboard's edge. No clip runs along a seam: clipping
 * each tile on its own leaves an antialiased hairline at every seam that falls between pixels.
 */
export function artboardSvg(doc: SvgInput, tile: Tile, w: number, h: number, unit: Unit, expand = false): string {
  const why = artboardProblem(tile, w, h, unit);
  if (why) throw new Error(why);
  const [aw, ah] = [+n(w * PX_PER[unit]), +n(h * PX_PER[unit])];
  const { ns, defs, uses } = draw(doc, stacked(wrapItems(tile.items, tile.width, tile.height, reachOf(doc.slots), { w: aw, h: ah })), expand);
  return file(`${+w.toFixed(4)}${unit}`, `${+h.toFixed(4)}${unit}`, n(aw), n(ah), ns,
    `<defs><clipPath id="dtp-board">${rect(n(aw), n(ah))}</clipPath>${defs}</defs>` +
    `${background(doc, n(aw), n(ah))}<g clip-path="url(#dtp-board)">${uses}</g>`);
}

/** The Library's picture of one tile, in pixels, so thumbnails and image tools need no Pattern code (spec §6.1). */
export function previewSvg(doc: SvgInput, tile: Tile): { svg: string; tileWidth: number; tileHeight: number } {
  return { svg: tileSvg(doc, tile, 'px'), tileWidth: tile.width, tileHeight: tile.height };
}
