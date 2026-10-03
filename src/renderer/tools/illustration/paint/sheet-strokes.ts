// The stroke sheet's strokes (plan §4.7): fixed paths, durations and pointers, pure so the node
// tests run their CPU half. A 4 × 3 grid of 512 × 426 cells on one painting: columns Round, Flat,
// Dry brush, Smudge; rows Watercolour, Gouache, and behaviour (glaze, detail, taper and tilt, load).
import { paintOf } from '../../../../shared/paint/km.ts';
import { PIGMENTS } from '../../../../shared/paint/pigments.ts';
import { rng } from './bristles.ts';
import type { BrushKind, Loaded, Medium, PointerSample, StrokeOptions } from './types.ts';

export const CELL = { w: 512, h: 426 };

export type Path = (u: number) => [number, number];
export type SheetStroke = {
  name: string;
  /** column, row */
  cell: [number, number];
  tool: 'paint' | 'smudge';
  medium: Medium;
  brush: BrushKind;
  size: number;
  load: number;
  pigment: string | null;
  /** cell px */
  path: Path;
  ms: number;
  pointer: 'pen' | 'mouse';
  pressure?: (u: number) => number;
  tilt?: { altitude: number; azimuth: number };
};

export const loadedOf = (id: string): Loaded => {
  const p = PIGMENTS.find((x) => x.id === id)!;
  return { paint: paintOf(p), opacity: p.opacity, granulation: p.granulation, staining: p.staining };
};

/** a line from a to b with `waves` sine waves of `amp` px across it */
export const line = (x0: number, y0: number, x1: number, y1: number, amp = 0, waves = 1): Path => (u) => {
  const nx = -(y1 - y0);
  const ny = x1 - x0;
  const l = Math.hypot(nx, ny) || 1;
  const w = Math.sin(u * Math.PI * 2 * waves) * amp;
  return [x0 + (x1 - x0) * u + (nx / l) * w, y0 + (y1 - y0) * u + (ny / l) * w];
};

const wc = { tool: 'paint', medium: 'wet', pointer: 'pen' } as const;
const gw = { tool: 'paint', medium: 'dry', pointer: 'pen' } as const;
const smudge = (cell: [number, number], x: number, n: number, medium: Medium): SheetStroke => ({
  name: `smudge ${n}`,
  cell,
  tool: 'smudge',
  medium,
  brush: medium === 'wet' ? 'round' : 'flat',
  size: 80,
  load: 0.8,
  pigment: null,
  path: line(x, 40, x + 30, 390, 8, 0.5),
  ms: 600,
  pointer: 'pen',
});
/** a pen stroke's pressure: from `lo` up to full and back down */
const swell = (lo: number) => (u: number) => lo + (1 - lo) * Math.sin(Math.PI * u) ** 0.8;

export const SHEET: SheetStroke[] = [
  // watercolour
  { ...wc, name: 'ultramarine S wash, mouse', cell: [0, 0], brush: 'round', size: 200, load: 0.85, pigment: 'ultra', path: line(110, 150, 400, 150, 55, 1), ms: 700, pointer: 'mouse' },
  { ...wc, name: 'viridian detail', cell: [0, 0], brush: 'round', size: 34, load: 0.8, pigment: 'viridian', path: line(50, 370, 470, 360, 22, 1.5), ms: 900 },
  { ...wc, name: 'hansa flat wash', cell: [1, 0], brush: 'flat', size: 130, load: 0.9, pigment: 'hansa', path: line(60, 200, 450, 190, 30, 0.75), ms: 900 },
  { ...wc, name: 'burnt sienna dry brush', cell: [2, 0], brush: 'dry', size: 170, load: 0.6, pigment: 'bsienna', path: line(50, 210, 460, 200, 25, 0.75), ms: 800 },
  { ...wc, name: 'yellow wash', cell: [3, 0], brush: 'round', size: 110, load: 0.9, pigment: 'hansa', path: line(40, 130, 470, 130, 10, 1), ms: 800 },
  { ...wc, name: 'blue wash', cell: [3, 0], brush: 'round', size: 110, load: 0.9, pigment: 'ultra', path: line(40, 290, 470, 290, 10, 1), ms: 800 },
  smudge([3, 0], 110, 0, 'wet'),
  smudge([3, 0], 290, 1, 'wet'),
  // gouache
  { ...gw, name: 'yellow ochre running dry', cell: [0, 1], brush: 'round', size: 64, load: 0.4, pigment: 'yochre', path: line(40, 210, 470, 200, 70, 1.5), ms: 1200 },
  { ...gw, name: 'cadmium red', cell: [1, 1], brush: 'flat', size: 120, load: 0.9, pigment: 'cadred', path: line(40, 150, 470, 140, 15, 0.5), ms: 900 },
  { ...gw, name: 'white through the red', cell: [1, 1], brush: 'flat', size: 90, load: 0.85, pigment: 'tiwhite', path: line(120, 60, 400, 400, 10, 0.5), ms: 900 },
  { ...gw, name: 'lamp black dry brush', cell: [2, 1], brush: 'dry', size: 150, load: 0.55, pigment: 'lampblack', path: line(40, 220, 470, 200, 20, 0.75), ms: 800 },
  { ...gw, name: 'cadmium yellow', cell: [3, 1], brush: 'flat', size: 80, load: 0.9, pigment: 'cadyellow', path: line(30, 120, 480, 120), ms: 800 },
  { ...gw, name: 'phthalo blue', cell: [3, 1], brush: 'flat', size: 80, load: 0.9, pigment: 'phthaloB', path: line(30, 210, 480, 210), ms: 800 },
  smudge([3, 1], 90, 2, 'dry'),
  smudge([3, 1], 240, 3, 'dry'),
  smudge([3, 1], 390, 4, 'dry'),
  // behaviour
  { ...wc, name: 'hansa wash under the glaze', cell: [0, 2], brush: 'round', size: 150, load: 0.9, pigment: 'hansa', path: line(40, 200, 470, 190, 20, 1), ms: 900 },
  { ...wc, name: 'ultramarine glaze across', cell: [0, 2], brush: 'round', size: 110, load: 0.8, pigment: 'ultra', path: line(150, 40, 330, 390, 10, 0.5), ms: 800 },
  { ...wc, name: 'alizarin squiggle', cell: [1, 2], brush: 'round', size: 14, load: 0.9, pigment: 'alizarin', path: line(40, 210, 470, 215, 70, 3), ms: 1400 },
  { ...gw, name: 'pen taper', cell: [2, 2], brush: 'round', size: 60, load: 0.9, pigment: 'rumber', path: line(50, 80, 460, 80), ms: 900, pressure: swell(0.05) },
  { ...gw, name: 'mouse stroke', cell: [2, 2], brush: 'round', size: 60, load: 0.9, pigment: 'rumber', path: line(50, 200, 460, 200), ms: 900, pointer: 'mouse' },
  { ...gw, name: 'pen tilted 45 degrees', cell: [2, 2], brush: 'round', size: 60, load: 0.9, pigment: 'rumber', path: line(50, 330, 460, 330), ms: 900, pressure: () => 0.8, tilt: { altitude: Math.PI / 4, azimuth: Math.PI / 2 } },
  // the loads where a 450 px stroke still runs dry (the checks' full-width ladder is in sheet.ts)
  ...[0.3, 0.4, 0.5, 0.7].map((load, k): SheetStroke => ({ ...gw, name: `load ${Math.round(load * 100)}`, cell: [3, 2], brush: 'round', size: 44, load, pigment: 'dioxazine', path: line(30, 60 + 95 * k, 480, 60 + 95 * k), ms: 1000 })),
];

/** painting px of a point on a stroke's path */
export const at = (s: SheetStroke, u: number): [number, number] => {
  const [x, y] = s.path(u);
  return [s.cell[0] * CELL.w + x, s.cell[1] * CELL.h + y];
};

/** the pointer samples of stroke `k`: eased along its path, at 240 Hz (pen) or 125 Hz (mouse), with a little hand jitter */
export function samplesOf(s: SheetStroke, k: number): PointerSample[] {
  const r = rng(k + 3);
  const hz = s.pointer === 'pen' ? 240 : 125;
  const n = Math.max(2, Math.round((s.ms / 1000) * hz));
  const out: PointerSample[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const [x, y] = at(s, u);
    const pressure = s.pointer === 'pen' ? Math.max(0.03, (s.pressure ?? ((v) => Math.sin(Math.PI * v) ** 0.55))(u)) : null;
    out.push({ x: x + (r() - 0.5) * 0.35, y: y + (r() - 0.5) * 0.35, t: 1000 + (i * 1000) / hz, pressure, tilt: s.pointer === 'pen' ? (s.tilt ?? null) : null });
  }
  return out;
}

export const optionsOf = (s: SheetStroke, k: number): StrokeOptions => ({
  tool: s.tool,
  medium: s.medium,
  brush: s.brush,
  size: s.size,
  load: s.load,
  loaded: s.pigment ? loadedOf(s.pigment) : null,
  seed: k + 1,
});

/** the samples in 60 fps batches: the first begins, each batch is one frame, the last is the lift */
export function framesOf(list: PointerSample[]): { first: PointerSample; frames: PointerSample[][]; last: PointerSample } {
  const frames: PointerSample[][] = [];
  const t0 = list[0].t;
  const rest = list.slice(1, -1);
  for (let f = 0, i = 0; i < rest.length; f++) {
    const until = t0 + ((f + 1) * 1000) / 60;
    const batch: PointerSample[] = [];
    while (i < rest.length && rest[i].t < until) batch.push(rest[i++]);
    frames.push(batch);
  }
  return { first: list[0], frames, last: list.at(-1)! };
}
