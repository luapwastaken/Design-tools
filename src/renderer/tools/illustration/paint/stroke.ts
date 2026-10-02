// The live stroke's CPU half: pointer samples to steps (input.ts), steps to bristle and body
// instances and pickup rows (bristles.ts), one frame at a time. Pure, so the tests run every sheet
// stroke through it; the engine uploads what it makes and runs the frame's passes.
import { paint15 } from '../../../../shared/paint/km15.ts';
import { BODY_STRIDE, BRISTLE_STRIDE, brushStep, makeBrush, type Box, type Brush, type StepOut } from './bristles.ts';
import { StrokeInput } from './input.ts';
import { BRISTLES, INPUT } from './tuning.ts';
import { HEIGHT, WIDTH, type PointerSample, type Rect, type StrokeOptions } from './types.ts';

/** what one frame drew: counts, the rect it touched (whole px, inside the painting), and its oldest sample */
export type FrameOut = { steps: number; bristles: number; bodies: number; rect: Rect | null; oldest: number };

/** the brush's paint as the shaders take it: 15 K then S */
function paintUniform(o: StrokeOptions): Float32Array {
  const u = new Float32Array(16);
  if (!o.loaded) return u;
  const p = paint15(o.loaded.paint);
  u.set(p.K);
  u[15] = p.S;
  return u;
}

/** a float box, grown by `margin`, as whole px inside the painting; null when it misses it */
export function rectOf(b: Box | null, margin: number): Rect | null {
  if (!b) return null;
  const x0 = Math.max(0, Math.floor(b.x0 - margin));
  const y0 = Math.max(0, Math.floor(b.y0 - margin));
  const x1 = Math.min(WIDTH, Math.ceil(b.x1 + margin));
  const y1 = Math.min(HEIGHT, Math.ceil(b.y1 + margin));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

export const union = (a: Rect | null, b: Rect | null): Rect | null => {
  if (!a || !b) return a ?? b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

export class LiveStroke {
  readonly o: StrokeOptions;
  readonly seed: number;
  readonly brush: Brush;
  readonly paint: Float32Array;
  readonly out: StepOut;
  /** every px the stroke has touched */
  total: Rect | null = null;
  /** frames drawn so far */
  frames = 0;
  /** which of the two pickup sets holds the latest rows, and the last row written (-1: none yet) */
  carrySet = 0;
  lastRow = -1;
  readonly #input: StrokeInput;

  constructor(o: StrokeOptions, first: PointerSample, seed: number) {
    this.o = o;
    this.seed = seed;
    this.brush = makeBrush({ kind: o.brush, tool: o.tool, medium: o.medium, size: o.size, load: o.load, seed });
    this.paint = paintUniform(o);
    this.#input = new StrokeInput({ size: o.size, pen: first.pressure !== null }, first);
    const steps = INPUT.maxSteps;
    this.out = {
      bristles: new Float32Array(steps * BRISTLES.max * BRISTLE_STRIDE),
      nBristles: 0,
      bodies: new Float32Array(steps * BODY_STRIDE),
      nBodies: 0,
      pos: new Float32Array(steps * BRISTLES.max * 4),
      prm: new Float32Array(steps * BRISTLES.max * 4),
      box: null,
    };
  }

  /** the width the brush laid at its last step, painting px */
  get width(): number {
    return this.brush.width;
  }

  /** one frame's samples (and, at the lift, the run-on) into this.out */
  frame(samples: readonly PointerSample[], end?: { last?: PointerSample }): FrameOut {
    const o = this.out;
    o.nBristles = 0;
    o.nBodies = 0;
    o.box = null;
    const steps = this.#input.frame(samples, end);
    steps.forEach((st, row) => brushStep(this.brush, st, row, o));
    const rect = rectOf(o.box, 2);
    this.total = union(this.total, rect);
    this.frames++;
    const oldest = samples.length ? samples[0].t : (steps[0]?.t ?? NaN);
    return { steps: steps.length, bristles: o.nBristles, bodies: o.nBodies, rect, oldest };
  }
}
