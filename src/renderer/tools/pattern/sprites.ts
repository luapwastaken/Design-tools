// A quick picture of the tile for shapes too heavy to redraw as vectors on every change (a traced
// 20,000-path shape took over a second a slider tick): each shape drawn once to a bitmap, the tile
// built from those in the swatch's order. The canvas shows it while edits come in and draws the
// vectors again once they stop.
import { toHex } from '../../../shared/color/index.ts';
import { reachOf } from '../../../shared/pattern/layout.ts';
import { stacked } from '../../../shared/pattern/svg.ts';
import type { PatternDoc, ShapeSlot, Tile } from '../../../shared/pattern/types.ts';
import { wrapItems } from '../../../shared/pattern/wrap.ts';
import { recolour } from '../../../shared/svg/index.ts';
import { drawSvg } from './raster.ts';

/** bitmaps by markup, then colour and size; each tile keeps only the ones it drew with */
type Cache = Map<string, Map<string, Promise<ImageBitmap>>>;
let cache: Cache = new Map();

async function paint(slot: ShapeSlot, hex: string | null, edge: number): Promise<ImageBitmap> {
  const b = slot.bounds;
  const k = edge / Math.max(b.w, b.h);
  const c = await drawSvg(hex ? recolour(slot.svg, hex) : slot.svg, Math.max(1, Math.round(b.w * k)), Math.max(1, Math.round(b.h * k)), [b.x, b.y, b.w, b.h]);
  return c.transferToImageBitmap();
}

function sprite(next: Cache, slot: ShapeSlot, hex: string | null, edge: number): Promise<ImageBitmap> {
  const key = `${hex} ${edge}`;
  const got = next.get(slot.svg)?.get(key) ?? cache.get(slot.svg)?.get(key) ?? paint(slot, hex, edge);
  if (!next.has(slot.svg)) next.set(slot.svg, new Map());
  next.get(slot.svg)!.set(key, got);
  return got;
}

/** let go of every bitmap (the tool hid) */
export function dropSprites(): void {
  for (const m of cache.values()) for (const p of m.values()) void p.then((b) => b.close(), () => {});
  cache = new Map();
}

/** the tile at w × h px from the shapes' bitmaps, each drawn at the next power of two above its largest size */
export async function spriteTile(d: PatternDoc, tile: Tile, w: number, h: number): Promise<ImageBitmap> {
  const [kx, ky] = [w / tile.width, h / tile.height];
  const edge = 2 ** Math.ceil(Math.log2(Math.min(2048, Math.max(32, d.sizeMax * Math.max(kx, ky)))));
  const slots = new Map(d.slots.map((s) => [s.id, s]));
  const items = stacked(wrapItems(tile.items, tile.width, tile.height, reachOf(d.slots))).filter((it) => slots.has(it.slot));
  const next: Cache = new Map();
  const art = await Promise.all(items.map((it) => sprite(next, slots.get(it.slot)!, it.colour && toHex(it.colour), edge)));
  for (const [svg, m] of cache) for (const [key, p] of m) if (!next.get(svg)?.has(key)) void p.then((b) => b.close(), () => {});
  cache = next;

  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.scale(kx, ky);
  if (d.background) {
    ctx.fillStyle = toHex(d.background);
    ctx.fillRect(0, 0, tile.width, tile.height);
  }
  items.forEach((it, i) => {
    const b = slots.get(it.slot)!.bounds;
    const s = it.size / Math.max(b.w, b.h);
    ctx.save();
    ctx.translate(it.x, it.y);
    ctx.rotate((it.rotation * Math.PI) / 180);
    ctx.scale(s, s);
    ctx.drawImage(art[i], -b.w / 2, -b.h / 2, b.w, b.h);
    ctx.restore();
  });
  return c.transferToImageBitmap();
}
