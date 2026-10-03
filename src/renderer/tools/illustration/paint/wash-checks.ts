// The brush chip's wash against the engine (smoke): watercolour strokes across the painting, a palette
// colour and tubes at two Loads, on the Round and the Flat, at five Sizes, painted through the public API
// as a mouse would. The wash is read back from the painting at four places along each stroke and as a
// whole, and held to what wash.ts says, because the paint thins with travel and one chip has to serve
// the whole run.
import { deltaE, toOklch, type Oklch } from '../../../../shared/color/index.ts';
import { PIGMENTS } from '../../../../shared/paint/pigments.ts';
import { loadedOf as loadedFrom } from '../paint-sources.ts';
import { PaintEngine } from './engine.ts';
import { framesOf } from './sheet-strokes.ts';
import { washColour, washRange } from './wash.ts';
import { HEIGHT, WIDTH, type BrushKind, type Loaded, type PointerSample } from './types.ts';

type Check = (name: string, ok: unknown, detail?: unknown) => boolean;

/** a palette colour as the tray offers it: middling traits, laid harder by the engine (`swatch`) */
export const rampPaint = (oklch: Oklch): Loaded => loadedFrom({ id: 'ramp', name: 'Ramp', oklch, tint: 1, opacity: 0.6, granulation: 0, staining: 0.4 }, true);
export const tubePaint = (id: string): Loaded => loadedFrom(PIGMENTS.find((p) => p.id === id)!);

type Case = [name: string, loaded: Loaded, brush: BrushKind, load: number, size?: number];
export type WashCase = { name: string; loaded: Loaded; load: number; brush?: BrushKind; /** painting px; default SIZE */ size?: number; /** px/s; default RUN.speed */ speed?: number };
/** `span`: how far apart the engine's washes at the first and last window are (wash.ts, from the paint's own thinning), ΔE00; `measured` and `de`: each window, then the whole stroke */
export type WashRead = { name: string; brush: BrushKind; size: number; load: number; chip: Oklch; span: number; measured: Oklch[]; de: number[] };

/** the default Size: how fast the hairs run dry depends on it */
const SIZE = 80;
/** where the strokes start and end, painting px, and the speed of a mouse along them, px/s */
const RUN = { x0: 100, x1: 1900, speed: 700 };
/** the stretches of each stroke whose middle is read, in px from its start (its first dab to the end of a run), then the stroke as a whole */
export const WINDOWS: readonly (readonly [number, number])[] = [[60, 260], [500, 700], [1000, 1200], [1500, 1700], [100, 1650]];
/** a stroke's middle is read this share of its Size either side of its centre line (so a narrow brush's edges and the paper beside it stay out) */
const BAND = 0.2;
/** rows are this many times a stroke's size apart (centre to centre, for two of one size) */
const ROW = 1.25;

/** a mouse's stroke along a row: constant speed, 125 Hz */
function mouseStroke(y: number, speed: number): PointerSample[] {
  const n = Math.round(((RUN.x1 - RUN.x0) / speed) * 125);
  return Array.from({ length: n + 1 }, (_, i) => ({ x: RUN.x0 + ((RUN.x1 - RUN.x0) * i) / n, y, t: 1000 + i * 8, pressure: null, tilt: null }));
}

/** the mean colour of a strip of the painting, linear, as OKLCH: long enough that the wash's pooling averages out */
function middle(e: PaintEngine, x0: number, x1: number, y: number, r: number): Oklch {
  const px = e.probe.read('base', { x: x0, y: y - r, w: x1 - x0, h: 2 * r + 1 });
  const sum = [0, 0, 0];
  const n = px.length / 4;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) sum[c] += px[i * 4 + c] / n;
  return toOklch({ mode: 'lrgb', r: sum[0], g: sum[1], b: sum[2] });
}

/** each case a watercolour stroke of its own on one painting (seeded, so the same every run), read at each window */
export function measureWashes(e: PaintEngine, cases: WashCase[], windows = WINDOWS): WashRead[] {
  let y = 0;
  let above = 0;
  return cases.map((c, k) => {
    const size = c.size ?? SIZE;
    y = k ? Math.round(y + (ROW * (above + size)) / 2) : size;
    above = size;
    if (y + size > HEIGHT || RUN.x1 > WIDTH) throw new Error('wash checks: too many cases for one painting');
    const { first, frames, last } = framesOf(mouseStroke(y, c.speed ?? RUN.speed));
    const brush = c.brush ?? 'round';
    e.begin({ tool: 'paint', medium: 'wet', brush, size, load: c.load / 100, loaded: c.loaded, seed: 11 + k }, first);
    for (const batch of frames) {
      e.move(batch);
      e.flush();
    }
    e.end(last);
    const measured = windows.map(([from, to]) => middle(e, RUN.x0 + from, RUN.x0 + to, y, Math.max(3, Math.round(BAND * size))));
    const chip = washColour(c.loaded, c.load / 100, size);
    const centre = ([from, to]: readonly [number, number]) => (from + to) / 2;
    const ends = washRange(c.loaded, c.load / 100, size, { from: centre(windows[0]), to: centre(windows[windows.length - 2]) });
    return { name: c.name, brush, size, load: c.load, chip, span: deltaE(ends.first, ends.last), measured, de: measured.map((m) => deltaE(chip, m)) };
  });
}

/**
 * The chip is the stroke's wash along a run across the painting. The stroke as a whole reads as the chip
 * within ΔE00 3 (the engine's 2128 strokes at Sizes 10 to 250: all but 3 of them, worst 3.2). A window
 * along it can't always: a paint that thins by more than 6 between the first window and the last (a
 * strong or dark one, or any at a high Load) can't be within 3 of both ends, so a window is held to 3, or
 * to half that thinning plus 3.5 where it is more. The 3.5 is the wash's own pooling, which moves a
 * 200 px window by 2 or more (the excess over half the thinning was 1.3 at the 90th percentile of the
 * 2128 strokes, 2.7 at the 99th and 4.6 at most), so this catches a chip that has come apart from the
 * engine, such as a wash 25 % too thick, and not the engine's own noise.
 */
export async function washChecks(check: Check): Promise<void> {
  const read = async (cases: Case[]) => {
    const e = await PaintEngine.create();
    try {
      return measureWashes(e, cases.map(([name, loaded, brush, load, size]) => ({ name, loaded, load, brush, size })));
    } finally {
      e.release();
    }
  };
  try {
    // the default Size: a palette colour and tubes at two Loads, on both brushes
    const middling: Case[] = [
      ['ramp colour', rampPaint([0.62, 0.12, 40]), 'round', 30],
      ['ramp colour', rampPaint([0.62, 0.12, 40]), 'round', 100],
      ['Ultramarine Blue', tubePaint('ultra'), 'round', 30],
      ['Ultramarine Blue', tubePaint('ultra'), 'round', 100],
      ['Phthalo Blue', tubePaint('phthaloB'), 'round', 30],
      ['Phthalo Blue', tubePaint('phthaloB'), 'round', 100],
      ['Ultramarine Blue', tubePaint('ultra'), 'flat', 30],
      ['Ultramarine Blue', tubePaint('ultra'), 'flat', 100],
      ['ramp colour', rampPaint([0.55, 0.1, 250]), 'flat', 30],
      ['Alizarin Crimson', tubePaint('alizarin'), 'round', 100],
      ['Dioxazine Purple', tubePaint('dioxazine'), 'round', 80],
    ];
    // a small brush holds out longer and a large one runs dry sooner, and a narrow one is mostly rim
    const sizes: Case[] = [
      ['Ultramarine Blue', tubePaint('ultra'), 'round', 95, 40],
      ['Lamp Black', tubePaint('lampblack'), 'round', 60, 40],
      ['Alizarin Crimson', tubePaint('alizarin'), 'round', 60, 140],
      ['Phthalo Blue', tubePaint('phthaloB'), 'flat', 95, 140],
      ['ramp colour', rampPaint([0.55, 0.1, 250]), 'round', 80, 20],
      ['Dioxazine Purple', tubePaint('dioxazine'), 'round', 80, 250],
    ];
    for (const r of [...(await read(middling)), ...(await read(sizes))]) {
      const limit = Math.max(3, r.span / 2 + 3.5);
      const windows = r.de.slice(0, -1);
      const body = r.de[r.de.length - 1];
      const at = `${r.name} on the ${r.brush} at Size ${r.size}, Load ${r.load}`;
      check(`paint wash: the stroke of ${at} reads as the chip says as a whole (ΔE00 ${body.toFixed(1)} of 3)`, body <= 3, r);
      check(`paint wash: and along it (ΔE00 ${windows.map((d) => d.toFixed(1)).join(' ')} of ${limit.toFixed(1)})`, Math.max(...windows) <= limit, r);
    }
  } catch (err) {
    check('paint wash: the checks ran', false, err instanceof Error ? err.message : String(err));
  }
}
