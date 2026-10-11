// The Pattern tool's document (plan: Document) and the limits that keep every edit a valid pattern.
import type { Oklch } from '../../../shared/color/index.ts';
import { BUILTIN_SHAPES, type BuiltinShape } from '../../../shared/pattern/builtins.ts';
import { layoutTile } from '../../../shared/pattern/layout.ts';
import { previewSvg, PX_PER } from '../../../shared/pattern/svg.ts';
import { namespace, parseSize } from '../../../shared/svg/index.ts';
import type { PatternDoc, ShapeSlot, Unit } from '../../../shared/pattern/types.ts';
import { valueOf } from '../../../shared/color/value.ts';
import { isGround } from '../../../shared/palette/roles.ts';
import type { PatternPayload, Swatch } from '../../../shared/types.ts';
import { displayName } from '../common/names.ts';

export type { Arrangement, PatternDoc, ShapeSlot, Unit } from '../../../shared/pattern/types.ts';
export type Bounds = ShapeSlot['bounds'];
export { PX_PER };

export const MAX_SLOTS = 6;
/** shape colours in the palette: the Colour module's add stops here, and so does a palette sent in */
export const MAX_COLOURS = 12;
export const LIMIT = {
  count: [1, 20],
  size: [4, 600],
  gapMax: 500,
  jitter: [0, 200],
  weight: [0, 10],
  angle: [-180, 180],
  seed: [0, 99999],
  dpi: [72, 1200],
  /** artboard sides, px */
  side: [16, 32000],
} as const;

export const UNIT_STEP: Record<Unit, number> = { px: 1, mm: 0.1, in: 0.01 };

const PAPER: Oklch = [0.955, 0.012, 85];
const INK: Oklch = [0.3, 0.06, 262];

/** the gap may overlap shapes by up to half their size, never collapse the tile */
export const gapMin = (d: Pick<PatternDoc, 'sizeMax'>): number => -Math.floor(d.sizeMax / 2);

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** the rules no edit may break, applied after each one */
export function fix(d: PatternDoc): PatternDoc {
  const sizeMax = clamp(d.sizeMax, LIMIT.size);
  const g = [gapMin({ sizeMax }), LIMIT.gapMax] as const;
  return {
    ...d,
    cols: Math.round(clamp(d.cols, LIMIT.count)),
    rows: Math.round(clamp(d.rows, LIMIT.count)),
    sizeMax,
    sizeMin: clamp(Math.min(d.sizeMin, sizeMax), LIMIT.size),
    gapX: clamp(d.gapX, g),
    gapY: clamp(d.gapY, g),
  };
}

/** the viewBox: a built-in's is drawn tight to its artwork, and it stands in for bounds a hand-edited file left out */
const viewBounds = (svg: string): Bounds => {
  const [x, y, w, h] = parseSize(svg).viewBox;
  return { x, y, w, h };
};

/** built-ins are neutral marks, so they take palette colours from the start */
export const builtinSlot = (id: string, b: BuiltinShape): ShapeSlot => ({ id, svg: namespace(b.svg, id), name: b.name, weight: 1, recolour: true, colour: null, bounds: viewBounds(b.svg) });

/** a fresh slot id, which also prefixes the shape's own ids so two shapes never share one */
export const slotId = (): string => `s${crypto.randomUUID().slice(0, 8)}`;

/** Something is always on screen: a new pattern starts with one built-in shape (plan unit V). */
export const emptyDoc = (): PatternDoc => ({
  slots: [builtinSlot('s0', BUILTIN_SHAPES.find((b) => /star/i.test(b.name)) ?? BUILTIN_SHAPES[0])],
  arrangement: 'halfdrop',
  cols: 4,
  rows: 4,
  gapX: 28,
  gapY: 28,
  sizeMin: 56,
  sizeMax: 56,
  rotation: { mode: 'fixed', angle: 0, min: -30, max: 30 },
  jitter: 0,
  seed: 1,
  background: PAPER,
  palette: [INK],
  paletteMode: 'by-slot',
  exportUnit: 'px',
  dpi: 96,
  artboard: { w: 1920, h: 1080 },
});

// -- the Library file --

type Settings = Omit<PatternPayload, 'kind' | 'id' | 'version' | 'preview'>;

/** The file: the settings, and one tile as a picture so the Library and the image tools need no Pattern code (spec §6.1). */
export const toPayload = (d: PatternDoc): Omit<PatternPayload, 'kind' | 'id' | 'version'> => ({ ...d, preview: previewSvg(d, layoutTile(d)) });

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
const isOklch = (v: unknown): v is Oklch => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const oneOf = <T extends string>(v: unknown, all: readonly T[], def: T): T => (all.includes(v as T) ? (v as T) : def);

function slotOf(raw: unknown): ShapeSlot | null {
  if (!isObj(raw) || typeof raw.svg !== 'string' || !raw.svg.includes('<svg')) return null;
  const b = isObj(raw.bounds) ? raw.bounds : {};
  const bounds = { x: num(b.x, 0), y: num(b.y, 0), w: num(b.w, 0), h: num(b.h, 0) };
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : slotId(),
    svg: raw.svg,
    name: typeof raw.name === 'string' ? raw.name : 'Shape',
    weight: clamp(num(raw.weight, 1), LIMIT.weight),
    recolour: raw.recolour === true,
    colour: isOklch(raw.colour) ? raw.colour : null,
    // a file written by hand may leave them out: the viewBox stands in
    bounds: bounds.w > 0 && bounds.h > 0 ? bounds : viewBounds(raw.svg),
  };
}

/** A pattern file as a document; anything missing or odd takes the default, so a hand-edited file still opens. */
export function fromPayload(p: Settings): PatternDoc {
  const def = emptyDoc();
  const r = isObj(p.rotation) ? p.rotation : {};
  const a = isObj(p.artboard) ? p.artboard : {};
  const slots = (Array.isArray(p.slots) ? p.slots : []).map(slotOf).filter((x): x is ShapeSlot => x !== null).slice(0, MAX_SLOTS);
  return fix({
    slots: slots.length ? slots : def.slots,
    arrangement: oneOf(p.arrangement, ['grid', 'halfdrop', 'brick', 'scatter'], def.arrangement),
    cols: num(p.cols, def.cols),
    rows: num(p.rows, def.rows),
    gapX: num(p.gapX, def.gapX),
    gapY: num(p.gapY, def.gapY),
    sizeMin: num(p.sizeMin, def.sizeMin),
    sizeMax: num(p.sizeMax, def.sizeMax),
    rotation: {
      mode: oneOf(r.mode, ['fixed', 'random'], 'fixed'),
      angle: clamp(num(r.angle, 0), LIMIT.angle),
      min: clamp(num(r.min, def.rotation.min), LIMIT.angle),
      max: clamp(num(r.max, def.rotation.max), LIMIT.angle),
    },
    jitter: clamp(num(p.jitter, 0), LIMIT.jitter),
    seed: Math.round(clamp(num(p.seed, 1), LIMIT.seed)),
    background: p.background === null ? null : isOklch(p.background) ? p.background : def.background,
    palette: Array.isArray(p.palette) ? p.palette.filter(isOklch) : def.palette,
    paletteMode: oneOf(p.paletteMode, ['by-slot', 'random'], 'by-slot'),
    exportUnit: oneOf(p.exportUnit, ['px', 'mm', 'in'], def.exportUnit),
    dpi: Math.round(clamp(num(p.dpi, def.dpi), LIMIT.dpi)),
    artboard: { w: artSide(num(a.w, 0), def.artboard.w), h: artSide(num(a.h, 0), def.artboard.h) },
  });
}

/** a side in px, inside the limits; `def` when it isn't one */
const artSide = (v: number, def: number): number => (v > 0 ? clamp(v, LIMIT.side) : def);

/**
 * The export unit. The artboard stays in px, so this changes only how its size is shown and
 * written: rounding it to the new unit's steps drifted A4 to 210.1 × 296.9 mm by looking at inches.
 */
export const withUnit = (d: PatternDoc, unit: Unit): PatternDoc => ({ ...d, exportUnit: unit });

/** the artboard's limits in its unit, on its steps and inside the px limits */
export function sideRange(unit: Unit): [number, number] {
  const k = 1 / UNIT_STEP[unit];
  // toFixed first: float error would push an exact step up or down one
  const at = (px: number, round: (n: number) => number) => round(+((px / PX_PER[unit]) * k).toFixed(6)) / k;
  return [at(LIMIT.side[0], Math.ceil), at(LIMIT.side[1], Math.floor)];
}

export const mapSlot = (d: PatternDoc, id: string, fn: (s: ShapeSlot) => ShapeSlot): PatternDoc => ({ ...d, slots: d.slots.map((s) => (s.id === id ? fn(s) : s)) });

/** the palette colour a slot takes by slot: the next one among the recolouring slots, as layout gives it */
export function paletteColour(d: PatternDoc, id: string): Oklch | null {
  const i = d.slots.filter((s) => s.recolour).findIndex((s) => s.id === id);
  return i < 0 || !d.palette.length ? null : d.palette[i % d.palette.length];
}

/** a shape colour this close to the background in value (0..1) disappears into it */
export const GROUND_GAP = 0.06;

/**
 * A palette as the shape colours (Send to: SHAPE COLOURS). A swatch whose job is a ground becomes the
 * background; the rest colour the shapes, every recolouring shape following the palette again. A
 * shape that keeps its own colours keeps them (spec §5 q2): flattening a many-coloured logo is its
 * own switch's job, never a side effect. A colour too close to the background in value would draw
 * as nothing, so it stays out (`skipped` names them). An Illustration palette sends each ramp's
 * base first, then its loose colours, then the other steps, so a cap cuts the steps, not the brand
 * (`bases` is how many ramps went). Up to MAX_COLOURS; `left` is how many the cap kept out.
 */
export function withPalette(d: PatternDoc, swatches: Swatch[]): { doc: PatternDoc; left: number; skipped: string[]; bases: number } {
  const ground = swatches.find((w) => w.role === 'Background') ?? swatches.find((w) => isGround(w.role));
  const rest = swatches.filter((w) => w !== ground);
  const isBase = (w: Swatch) => w.group !== undefined && w.step === 0;
  const isStep = (w: Swatch) => w.group !== undefined && w.step !== 0;
  const bases = rest.filter(isBase);
  const ordered = bases.length ? [...bases, ...rest.filter((w) => !isBase(w) && !isStep(w)), ...rest.filter(isStep)] : rest;
  const gv = ground ? valueOf(ground.oklch) : 0;
  const shows = (w: Swatch) => !ground || Math.abs(valueOf(w.oklch) - gv) >= GROUND_GAP;
  const kept = ordered.filter(shows);
  // when every colour would vanish, the palette still goes in: a pattern with no colours is worse
  const skippedSw = kept.length ? ordered.filter((w) => !shows(w)) : [];
  const inks: Oklch[] = (kept.length ? kept : ordered).map((w) => w.oklch);
  const all = inks.length ? inks : swatches.map((w) => w.oklch);
  return {
    doc: {
      ...d,
      palette: all.slice(0, MAX_COLOURS),
      background: ground ? ground.oklch : d.background,
      slots: d.slots.map((s) => (s.recolour ? { ...s, colour: null } : s)),
    },
    left: Math.max(0, all.length - MAX_COLOURS),
    skipped: skippedSw.map(displayName),
    bases: bases.length,
  };
}
