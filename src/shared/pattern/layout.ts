// Lays out one repeat tile: grid, half-drop, brick or scatter. Each tile is a true period of the
// pattern, so the pitch across its edges is the pitch inside it. v1 left the gap off the right and
// bottom edges and broke half-drop on odd counts (inventory, Pattern Maker).
import type { Oklch } from '../color/index.ts';
import { cellRandom, hashOf } from './seeds.ts';
import type { Item, PatternDoc, ShapeSlot, Tile } from './types.ts';

/** what layout reads from the document */
export type LayoutInput = Pick<
  PatternDoc,
  'slots' | 'arrangement' | 'cols' | 'rows' | 'gapX' | 'gapY' | 'sizeMin' | 'sizeMax' | 'rotation' | 'jitter' | 'seed' | 'palette' | 'paletteMode'
>;

// salts name a cell's draws; scatter's placement tries take SPOT and up
const SLOT = 1, SIZE = 2, TURN = 3, COLOUR = 4, JITTER_X = 5, JITTER_Y = 6, SPOT = 16;
/** a negative gap may overlap shapes down to a quarter of the cell but never collapses the tile (v1 went to 2 px) */
const MIN_PITCH = 0.25;
/** scatter cells are this much wider than the closest two items may sit, so nearly every cell finds room */
const SCATTER_ROOM = 1.25;
const SCATTER_TRIES = 64;

type Drawn = Omit<Item, 'x' | 'y'>;

const count = (n: number) => Math.max(1, Math.round(n) || 1);
const mod = (n: number, m: number) => ((n % m) + m) % m;
/** the shortest way from one point to another's nearest repeat */
const torus = (d: number, period: number) => d - period * Math.round(d / period);
const sizes = (d: LayoutInput) => [Math.max(0, Math.min(d.sizeMin, d.sizeMax)), Math.max(0, d.sizeMin, d.sizeMax)];
const turns = ({ rotation: r }: LayoutInput) => (r.mode === 'fixed' ? [r.angle, r.angle] : [Math.min(r.min, r.max), Math.max(r.min, r.max)]);

/** the slot's artwork box with its longest side 1 (size is the longest side) */
function unitBox({ bounds: b }: ShapeSlot): { w: number; h: number } {
  const long = Math.max(b.w, b.h);
  return long > 0 ? { w: b.w / long, h: b.h / long } : { w: 1, h: 1 };
}

/** how far the artwork reaches from its centre, turned any way, per px of size */
function unitReach(slot: ShapeSlot): number {
  const b = unitBox(slot);
  return Math.hypot(b.w, b.h) / 2;
}

/** each item's reach in px: nothing of it lies further than this from its centre */
export function reachOf(slots: ShapeSlot[]): (item: Item) => number {
  const per = new Map(slots.map((s) => [s.id, unitReach(s)]));
  return (item) => item.size * (per.get(item.slot) ?? Math.SQRT1_2);
}

/** the widest a w × h box gets along x, turned anywhere from a0 to a1 degrees */
function widest(w: number, h: number, a0: number, a1: number): number {
  if (a1 - a0 >= 180) return Math.hypot(w, h);
  const along = (deg: number) => w * Math.abs(Math.cos((deg * Math.PI) / 180)) + h * Math.abs(Math.sin((deg * Math.PI) / 180));
  // along() peaks, at the diagonal, at ±atan(h / w) every half turn; anywhere else the range's ends win
  const peak = (Math.atan2(h, w) * 180) / Math.PI;
  const hits = [peak, -peak].some((p) => p + 180 * Math.ceil((a0 - p) / 180) <= a1);
  return hits ? Math.hypot(w, h) : Math.max(along(a0), along(a1));
}

/** a grid cell fits the largest item of any slot at any turn it can take, so different proportions pack */
function cellOf(d: LayoutInput, active: ShapeSlot[]): { w: number; h: number } {
  const [a0, a1] = turns(d);
  const size = sizes(d)[1];
  if (!active.length) return { w: size, h: size };
  const boxes = active.map(unitBox);
  return {
    w: size * Math.max(...boxes.map((b) => widest(b.w, b.h, a0, a1))),
    h: size * Math.max(...boxes.map((b) => widest(b.h, b.w, a0, a1))),
  };
}

const pitch = (cell: number, gap: number) => Math.max(cell + gap, cell * MIN_PITCH, 1);

/**
 * A cell's slot, size, turn and colour, all from its own seeds; null with no slot to draw. Each slot
 * draws its own number for the cell, raised to 1 / weight, and the highest wins (Efraimidis and
 * Spirakis): a slot wins in proportion to its weight, and adding, removing or reweighting one shape
 * only changes the cells it wins or loses, never the rest (spec §4: no global reshuffle).
 */
function drawer(d: LayoutInput, active: ShapeSlot[]): (col: number, row: number) => Drawn | null {
  const [lo, hi] = sizes(d);
  const [a0, a1] = turns(d);
  const keys = active.map((s) => (d.seed ^ hashOf(s.id)) | 0);
  if (!active.length) return () => null;
  return (col, row) => {
    const draw = (salt: number) => cellRandom(d.seed, col, row, salt);
    let slot = active[0];
    let best = -Infinity;
    active.forEach((s, i) => {
      const k = Math.log(cellRandom(keys[i], col, row, SLOT)) / s.weight;
      if (k > best) [slot, best] = [s, k];
    });
    return { slot: slot.id, size: lo + draw(SIZE) * (hi - lo), rotation: a0 + draw(TURN) * (a1 - a0), colour: colourOf(d, slot, draw(COLOUR)) };
  };
}

/**
 * null keeps the SVG's own colours. A slot's own colour wins; otherwise the palette, at random or by
 * slot: the slots that take palette colours get them in order. One given its own colour keeps its
 * place, so picking a colour for one shape never moves the others' (the tool's paletteColour agrees).
 */
function colourOf(d: LayoutInput, slot: ShapeSlot, draw: number): Oklch | null {
  if (!slot.recolour) return null;
  if (slot.colour) return slot.colour;
  if (!d.palette.length) return null;
  const i = d.paletteMode === 'random' ? Math.floor(draw * d.palette.length) : d.slots.filter((s) => s.recolour).indexOf(slot);
  return d.palette[i % d.palette.length];
}

function lattice(d: LayoutInput, active: ShapeSlot[]): Tile {
  const cell = cellOf(d, active);
  const px = pitch(cell.w, d.gapX);
  const py = pitch(cell.h, d.gapY);
  const drop = d.arrangement === 'halfdrop';
  const brick = d.arrangement === 'brick';
  // shifted columns (rows) can't alternate across the seam with an odd count, so the tile doubles instead
  const cols = count(d.cols) * (drop && count(d.cols) % 2 ? 2 : 1);
  const rows = count(d.rows) * (brick && count(d.rows) % 2 ? 2 : 1);
  const jitter = Math.max(0, d.jitter);
  const draw = drawer(d, active);
  const items: Item[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const drawn = draw(col, row);
      if (!drawn) continue;
      const nudge = (salt: number) => (cellRandom(d.seed, col, row, salt) * 2 - 1) * jitter;
      // half the gap on every side of every cell, so the tile's edges carry the gap too
      items.push({
        ...drawn,
        x: (col + 0.5 + (brick && row % 2 ? 0.5 : 0)) * px + nudge(JITTER_X),
        y: (row + 0.5 + (drop && col % 2 ? 0.5 : 0)) * py + nudge(JITTER_Y),
      });
    }
  }
  return { width: cols * px, height: rows * py, items };
}

/**
 * Poisson-disc on the torus, one try-list per cell: each cell tries spots inside itself from its own
 * seeds and keeps the first one clear of every placed item, measured to their nearest repeat, so
 * nothing overlaps across the seam either. Best effort: a cell that finds no room stays empty.
 */
function scatter(d: LayoutInput, active: ShapeSlot[]): Tile {
  const cols = count(d.cols);
  const rows = count(d.rows);
  const gap = Math.max(0, (d.gapX + d.gapY) / 2);
  const far = sizes(d)[1] * (active.length ? Math.max(...active.map(unitReach)) : Math.SQRT1_2);
  const p = Math.max(1, (2 * far + gap) * SCATTER_ROOM);
  const width = cols * p;
  const height = rows * p;
  const reach = reachOf(active);
  const draw = drawer(d, active);
  const placed: (Item | undefined)[] = new Array(cols * rows);
  // only neighbouring cells can clash: between cells further apart lies a whole cell, wider than any spacing
  const clear = (it: Item, col: number, row: number) => {
    for (let dc = -1; dc <= 1; dc++) {
      for (let dr = -1; dr <= 1; dr++) {
        const q = placed[mod(col + dc, cols) * rows + mod(row + dr, rows)];
        if (q && Math.hypot(torus(it.x - q.x, width), torus(it.y - q.y, height)) < reach(it) + reach(q) + gap) return false;
      }
    }
    return true;
  };
  // column by column, so adding a column leaves every column but the old last one as it was
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const drawn = draw(col, row);
      if (!drawn) continue;
      for (let k = 0; k < SCATTER_TRIES; k++) {
        const spot = (salt: number) => cellRandom(d.seed, col, row, SPOT + 2 * k + salt);
        const it = { ...drawn, x: (col + spot(0)) * p, y: (row + spot(1)) * p };
        if (clear(it, col, row)) {
          placed[col * rows + row] = it;
          break;
        }
      }
    }
  }
  return { width, height, items: placed.filter((it): it is Item => it !== undefined) };
}

/** One tile of the pattern, in pixels at 100%. */
export function layoutTile(doc: LayoutInput): Tile {
  const active = doc.slots.filter((s) => s.weight > 0);
  return doc.arrangement === 'scatter' ? scatter(doc, active) : lattice(doc, active);
}
