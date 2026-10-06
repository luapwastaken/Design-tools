// The Halftone document (plan: Document) and the limits that keep every edit printable.
import type { Oklch } from '../../../shared/color/index.ts';
import { curveAt } from '../../../shared/halftone/tone.ts';
import type { Process, Shape } from '../../../shared/halftone/types.ts';

export type { Process, Shape } from '../../../shared/halftone/types.ts';
export { curveAt };
export type Unit = 'mm' | 'in';

export type Ink = {
  id: string;
  name: string;
  colour: Oklch;
  /** screen angle, degrees */
  angle: number;
  visible: boolean;
  /** transfer curve, [in, out] pairs 0..1 in rising order: identity is [[0, 0], [1, 1]] */
  curve: [number, number][];
  process?: Process;
  /** a spot ink that covers what is under it (spec §6.3); unset, near-white inks do */
  opaque?: boolean;
};

/** the palette the spot inks came from: the Inks from row names it, and its colours are offered when an ink is added or swapped */
export type InksFrom = { name: string; swatches: { name: string; colour: Oklch }[] };

export type HalftoneDoc = {
  /** the image, copied into the workspace (foundation spec §7.2); `asset` is its dt:// url */
  source: { asset: string; name: string; w: number; h: number } | null;
  /** the physical output: w and h are always mm, `unit` is only how they show (so switching never drifts A4) */
  size: { w: number; h: number; unit: Unit; dpi: number };
  fit: 'cover' | 'contain';
  screen: { shape: Shape; lpi: number; minDot: number; gain: number };
  mode: 'process' | 'spot';
  inks: Ink[];
  overlap: 'overprint' | 'knockout';
  paper: { colour: Oklch; include: boolean };
  tone: { black: number; white: number; gamma: number; contrast: number };
  /** preview only, and the screen PNG when `bake` */
  feel: { misregister: number; texture: number; bake: boolean };
  /** in the document, so a restart keeps it and Undo takes it back with the inks it came with */
  inksFrom?: InksFrom | null;
};

export const MM_PER: Record<Unit, number> = { mm: 1, in: 25.4 };
export const UNIT_STEP: Record<Unit, number> = { mm: 0.1, in: 0.01 };

export const LIMIT = {
  side: [10, 2000] as [number, number],
  dpi: [72, 2400] as [number, number],
  lpi: [2, 300] as [number, number],
  minDot: [0, 0.2] as [number, number],
  gain: [0, 0.3] as [number, number],
  angle: [0, 180] as [number, number],
  spot: 6,
  misregister: [0, 2] as [number, number],
};

/** Illustrator-style transfer points: the curve is edited at these inputs */
export const CURVE_AT = [0, 0.25, 0.5, 0.75, 1];
export const IDENTITY: [number, number][] = [
  [0, 0],
  [1, 1],
];

// Process inks as printed on coated stock (their usual screen stand-ins), and Bone paper. Six
// decimals, so each sits exactly in sRGB (the 4-decimal values that stood here put the cyan just outside it).
const PROCESS: Record<Process, { name: string; colour: Oklch; angle: number }> = {
  c: { name: 'Cyan', colour: [0.707952, 0.14888, 234.36279], angle: 15 },
  m: { name: 'Magenta', colour: [0.61572, 0.25269, 355.142243], angle: 75 },
  y: { name: 'Yellow', colour: [0.941183, 0.200377, 105.688863], angle: 0 },
  k: { name: 'Black', colour: [0.24419, 0.00638, 0.593542], angle: 45 },
};
export const BONE: Oklch = [0.9354, 0.0173, 84.59];

export const processInks = (): Ink[] =>
  (['c', 'm', 'y', 'k'] as const).map((p) => ({ id: p, ...PROCESS[p], visible: true, curve: IDENTITY, process: p }));

/** spot screens in the order Riso and screen printers space them, so neighbours never share an angle */
export const SPOT_ANGLES = [45, 75, 15, 0, 60, 30];

export const inkId = (): string => `i${crypto.randomUUID().slice(0, 8)}`;

export const spotInk = (name: string, colour: Oklch, index: number): Ink => ({ id: inkId(), name, colour, angle: SPOT_ANGLES[index % SPOT_ANGLES.length], visible: true, curve: IDENTITY });

/** A4 portrait at 300 DPI and 60 LPI, CMYK on Bone (spec §5 q5) */
export const emptyDoc = (): HalftoneDoc => ({
  source: null,
  size: { w: 210, h: 297, unit: 'mm', dpi: 300 },
  fit: 'contain',
  // no drop-out and no compensation until asked: both change what the plate holds
  screen: { shape: 'round', lpi: 60, minDot: 0, gain: 0 },
  mode: 'process',
  inks: processInks(),
  overlap: 'overprint',
  paper: { colour: BONE, include: true },
  tone: { black: 0, white: 1, gamma: 1, contrast: 0 },
  feel: { misregister: 0, texture: 0, bake: false },
});

export const PAGES: { label: string; w: number; h: number }[] = [
  { label: 'A5', w: 148, h: 210 },
  { label: 'A4', w: 210, h: 297 },
  { label: 'A3', w: 297, h: 420 },
  { label: 'A2', w: 420, h: 594 },
  { label: 'Letter', w: 215.9, h: 279.4 },
];

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** the output in print pixels: the Viewport's content, the separations' plates */
export function printPx(d: Pick<HalftoneDoc, 'size'>): { w: number; h: number } {
  const k = d.size.dpi / 25.4;
  return { w: Math.max(1, Math.round(d.size.w * k)), h: Math.max(1, Math.round(d.size.h * k)) };
}

/** the rules no edit may break, applied after each one */
export function fix(d: HalftoneDoc): HalftoneDoc {
  return {
    ...d,
    size: { ...d.size, w: clamp(d.size.w, LIMIT.side), h: clamp(d.size.h, LIMIT.side), dpi: Math.round(clamp(d.size.dpi, LIMIT.dpi)) },
    screen: { ...d.screen, lpi: clamp(d.screen.lpi, LIMIT.lpi), minDot: clamp(d.screen.minDot, LIMIT.minDot), gain: clamp(d.screen.gain, LIMIT.gain) },
    feel: { ...d.feel, misregister: clamp(d.feel.misregister, LIMIT.misregister), texture: clamp(d.feel.texture, [0, 1]) },
  };
}

/** process inks always overprint (CMYK builds its colours by overprinting), so knockout is for spot inks only */
export const overlapOf = (d: Pick<HalftoneDoc, 'mode' | 'overlap'>): HalftoneDoc['overlap'] => (d.mode === 'process' ? 'overprint' : d.overlap);

/** OKLCH lightness past which a spot ink is opaque until told otherwise: white and near-white inks only show by covering */
export const NEAR_WHITE = 0.9;

/**
 * Whether a palette's ground can be the paper for its inks: every ink is darker than it, or one is
 * white enough to be opaque and print the lights on it (transparent inks only darken their paper,
 * so on a dark ground alone they would print almost black).
 */
export const groundIsPaper = (ground: Oklch, inks: Oklch[]): boolean => inks.every((c) => c[0] < ground[0]) || inks.some((c) => c[0] > NEAR_WHITE);

/**
 * Whether a spot ink covers what is under it; process inks are transparent by nature. Opaque changes
 * the plates' tones (the separation is refitted when an ink covers, since the paper's tint is then
 * spent only under it) but not how a plate is drawn: an opaque ink cuts nothing out of the others.
 */
export const opaqueOf = (ink: Pick<Ink, 'process' | 'opaque' | 'colour'>): boolean => !ink.process && (ink.opaque ?? ink.colour[0] > NEAR_WHITE);

export const mapInk = (d: HalftoneDoc, id: string, fn: (i: Ink) => Ink): HalftoneDoc => ({ ...d, inks: d.inks.map((i) => (i.id === id ? fn(i) : i)) });

/** the angle folded into 0..180, the way a screen repeats */
export const foldAngle = (a: number): number => ((a % 180) + 180) % 180;

/**
 * Two printing inks on the same screen, or null: dots that look the same turned a quarter (round,
 * square, diamond, cross) repeat every 90°, so inks 90° apart print their dots on top of each other.
 */
export function sharedScreen(d: Pick<HalftoneDoc, 'screen' | 'inks'>): [Ink, Ink] | null {
  if (d.screen.shape === 'stochastic') return null;
  const shown = d.inks.filter((i) => i.visible);
  for (const [n, a] of shown.entries()) {
    for (const b of shown.slice(n + 1)) if (apart(d.screen.shape, a.angle, b.angle) < 0.5) return [a, b];
  }
  return null;
}

/** how far apart two screen angles are, as the shape repeats */
function apart(shape: Shape, a: number, b: number): number {
  const turn = shape === 'line' || shape === 'ellipse' ? 180 : 90;
  const d = Math.abs(a - b) % turn;
  return Math.min(d, turn - d);
}

/** the first spot angle no showing ink screens at, so a new ink never lands on a screen in use */
export function freeAngle(d: Pick<HalftoneDoc, 'screen' | 'inks'>): number {
  const shown = d.inks.filter((i) => i.visible);
  return SPOT_ANGLES.find((a) => shown.every((i) => apart(d.screen.shape, a, i.angle) >= 0.5)) ?? SPOT_ANGLES[d.inks.length % SPOT_ANGLES.length];
}

export const isIdentity = (curve: [number, number][]): boolean => CURVE_AT.every((x) => Math.abs(curveAt(curve, x) - x) < 1e-6);

/** one transfer point moved: the curve comes back as the five points it is edited at */
export function withPoint(curve: [number, number][], at: number, out: number): [number, number][] {
  return CURVE_AT.map((x, i) => [x, i === at ? clamp(out, [0, 1]) : curveAt(curve, x)]);
}
