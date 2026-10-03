// Pointer input to brush steps (plan §3), pure so the tests drive it:
//   coalesced samples → One Euro smoothing (pressure on its own) → a centripetal Catmull-Rom curve,
//   one sample behind → even steps along it, at most INPUT.maxSteps a frame → at the lift, on to
//   where the pointer left the paper. Mouse and touch get pressure from speed and a start taper.
import { INPUT as I } from './tuning.ts';
import { HEIGHT, WIDTH, type PointerSample } from './types.ts';

/** A pointer event in painting px: pen pressure and tilt when there is a pen, speed stands in otherwise. */
export function toSample(e: PointerEvent, box: DOMRect): PointerSample {
  const pen = e.pointerType === 'pen';
  return {
    x: ((e.clientX - box.left) * WIDTH) / box.width,
    y: ((e.clientY - box.top) * HEIGHT) / box.height,
    t: e.timeStamp,
    pressure: pen ? e.pressure : null,
    tilt: pen && Number.isFinite(e.altitudeAngle) ? { altitude: e.altitudeAngle, azimuth: e.azimuthAngle } : null,
  };
}

/**
 * One Euro filter (Casiez, Roussel and Vogel, 2012) over a point of any dimension: smooth when slow,
 * quick when fast. The cutoff follows the speed of the whole point, not each axis on its own, which
 * would slow an axis to a crawl wherever the path turns across it. t in seconds.
 */
class OneEuro {
  readonly minCutoff: number;
  readonly beta: number;
  readonly dCutoff: number;
  #x: number[] | null = null;
  #dx: number[] = [];
  #t = 0;

  constructor(minCutoff: number, beta: number, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  static alpha(cutoff: number, dt: number): number {
    return 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  }

  /** the smoothed speed, units per second */
  get speed(): number {
    return Math.hypot(...this.#dx);
  }

  filter(v: readonly number[], t: number): number[] {
    if (this.#x === null) {
      this.#x = [...v];
      this.#dx = v.map(() => 0);
      this.#t = t;
      return [...v];
    }
    const x = this.#x;
    const dt = Math.max(1e-3, t - this.#t);
    this.#t = t;
    const ad = OneEuro.alpha(this.dCutoff, dt);
    this.#dx = this.#dx.map((d, i) => d + ad * ((v[i] - x[i]) / dt - d));
    const a = OneEuro.alpha(this.minCutoff + this.beta * this.speed, dt);
    this.#x = x.map((xi, i) => xi + a * (v[i] - xi));
    return [...this.#x];
  }
}

/** how a pen's tilt changes a Round's footprint: wider across the stroke, and shifted toward the barrel (share of the size) */
export type TiltShape = { widen: number; ox: number; oy: number };
export const NO_TILT: TiltShape = { widen: 1, ox: 0, oy: 0 };

export function tiltShape(tilt: PointerSample['tilt']): TiltShape {
  if (!tilt) return NO_TILT;
  const lying = Math.min(1, Math.max(0, 1 - tilt.altitude / (Math.PI / 2)));
  const shift = I.tiltShift * lying;
  return { widen: 1 + (I.tiltWiden - 1) * lying, ox: Math.cos(tilt.azimuth) * shift, oy: Math.sin(tilt.azimuth) * shift };
}

/** one brush step: where, how hard (taper included), which way the brush faces, and how far it came */
export type Step = {
  x: number;
  y: number;
  p: number;
  /** direction of travel, smoothed, unit length */
  dx: number;
  dy: number;
  /** the spacing it came at, px (0 for the first dab) */
  ds: number;
  /** travel along the stroke so far, px */
  s: number;
  tilt: TiltShape;
  /** ms, the time of the path at this point */
  t: number;
  /** a click, a tap or a short drag ends in a dab (the brush gives it a footprint): 1 is a whole dab, less is a smaller one */
  tap?: number;
};

type Pt = { x: number; y: number; p: number; t: number; tilt: PointerSample['tilt'] };

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: Pt, b: Pt, w: number): Pt => ({ x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, p: a.p + (b.p - a.p) * w, t: a.t + (b.t - a.t) * w, tilt: w < 0.5 ? a.tilt : b.tilt });

/** centripetal Catmull-Rom (alpha 0.5) from p1 to p2, as a polyline of pieces at most `piece` px long */
function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, piece: number): Pt[] {
  const knot = (a: Pt, b: Pt) => Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)) || 1e-4;
  const t1 = knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const at = (t: number) => {
    const L = (a: Pt, b: Pt, ta: number, tb: number) => lerp(a, b, (t - ta) / (tb - ta));
    const a1 = L(p0, p1, 0, t1);
    const a2 = L(p1, p2, t1, t2);
    const a3 = L(p2, p3, t2, t3);
    return L(L(a1, a2, 0, t2), L(a2, a3, t1, t3), t1, t2);
  };
  const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / piece));
  const out: Pt[] = [];
  for (let k = 1; k < n; k++) out.push(at(t1 + ((t2 - t1) * k) / n));
  out.push({ ...p2 });
  return out;
}

/**
 * A stand-in for the point past p1, turning as the path turned from p3 through p2 to p1 (at most
 * 60 degrees): the end of a stroke keeps its curve instead of flattening into a chord.
 */
function beyond(p1: Pt, p2: Pt, p3: Pt): Pt {
  const [ux, uy] = [p1.x - p2.x, p1.y - p2.y];
  const [vx, vy] = [p2.x - p3.x, p2.y - p3.y];
  const turn = ux * ux + uy * uy > 0 && vx * vx + vy * vy > 0 ? Math.atan2(vx * uy - vy * ux, vx * ux + vy * uy) : 0;
  const a = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, turn));
  return { ...p1, x: p1.x + ux * Math.cos(a) - uy * Math.sin(a), y: p1.y + ux * Math.sin(a) + uy * Math.cos(a) };
}

/** One stroke's input: the first dab at once, then each frame's samples as even steps. */
export class StrokeInput {
  readonly size: number;
  readonly pen: boolean;
  readonly #fxy = new OneEuro(I.minCutoff, I.beta, I.dCutoff);
  readonly #fp: OneEuro;
  /** the last four points of the curve; the segment between the middle two is drawn when the fourth arrives */
  #pts: Pt[];
  /** no segment drawn yet: the curve's first point is a stand-in */
  #fresh = true;
  /** where the walk along the curve is, and how far it has come since the last step */
  #at: Pt;
  #since = 0;
  #travel = 0;
  #dir: [number, number] | null = null;
  #prev: Step | null = null;
  #raw: PointerSample;
  #first: Step | null;
  /** a brush that turns with the stroke holds its first dab until the stroke has a heading */
  readonly #hold: boolean;

  constructor(o: { size: number; pen: boolean; hold?: boolean }, first: PointerSample) {
    this.#hold = !!o.hold;
    this.size = o.size;
    this.pen = o.pen;
    this.#fp = new OneEuro(I.pressureCutoff, o.pen ? 4 : 0, I.dCutoff);
    this.#raw = first;
    const q = this.#filter(first);
    this.#pts = [q, q];
    this.#at = q;
    this.#first = this.#step(q, 0);
  }

  /** the spacing between steps before the frame cap */
  get spacing(): number {
    return Math.min(I.spacingMax, Math.max(I.spacingMin, this.size * I.spacing));
  }

  /** This frame's samples as steps (the first dab leads the first frame). `end` also runs the path on to the lift. */
  frame(samples: readonly PointerSample[], end?: { last?: PointerSample }): Step[] {
    const path: Pt[] = [];
    for (const e of samples) {
      this.#raw = e;
      this.#push(this.#filter(e), path);
    }
    if (end) {
      // where the pen or mouse left the paper, unfiltered
      const r = end.last ?? this.#raw;
      const last: Pt = { x: r.x, y: r.y, p: this.#pts.at(-1)!.p, t: r.t, tilt: r.tilt };
      this.#pts.push(last);
      if (this.#pts.length > 4) this.#pts.shift();
      const [a, b, c, d] = this.#pts;
      if (d) {
        path.push(...catmullRom(this.#fresh ? beyond(b, c, d) : a, b, c, d, this.#piece()));
        path.push(...catmullRom(b, c, d, beyond(d, c, b), this.#piece()));
      } else path.push(...catmullRom(beyond(b, c, c), b, c, beyond(c, b, b), this.#piece()));
    }
    const first = this.#first;
    const out = first ? [first] : [];
    this.#first = null;
    // the frame cap: a long frame spaces its steps wider rather than drawing more of them
    let length = this.#since;
    for (let i = 0, from = this.#at; i < path.length; from = path[i++]) length += Math.hypot(path[i].x - from.x, path[i].y - from.y);
    const ds = Math.max(this.spacing, length / (I.maxSteps - out.length - (end ? 1 : 0)));
    for (const q of path) this.#walk(q, ds, out);
    // the stroke ends exactly where the pointer left
    if (end && this.#since > 1e-6) {
      out.push(this.#step(this.#at, this.#since));
      this.#since = 0;
    }
    if (this.#hold && first) {
      // the curve is a sample behind, so the first dab alone would face right whatever the stroke does:
      // it waits for the second step and turns to face it (a click still dabs, at the lift)
      if (out.length === 1 && !end) {
        this.#first = first;
        return [];
      }
      if (out.length > 1) [first.dx, first.dy] = [out[1].dx, out[1].dy];
    }
    if (end) {
      const w = this.#tapWeight();
      if (w > 0) out.push(this.#tap(w));
    }
    return out;
  }

  /** how much of a whole dab the stroke ends in: all of it for a click or a wobble, none once it has travelled on */
  #tapWeight(): number {
    return 1 - smooth(this.size * I.tapTravel, this.size * I.tapEnd, this.#travel);
  }

  /** the last step again, `w` of a dab: at a dab's pressure (a mouse's own, a pen's as it pressed but not feather-light) */
  #tap(w: number): Step {
    const q = this.#prev!;
    const dab = this.pen ? Math.max(I.tapFloor, q.p) : I.tapPressure;
    return { ...q, p: Math.max(q.p, dab * w + q.p * (1 - w)), ds: 0, tap: w };
  }

  #piece(): number {
    return Math.max(0.5, this.spacing / 4);
  }

  #filter(e: PointerSample): Pt {
    const t = e.t / 1000;
    const [x, y] = this.#fxy.filter([e.x, e.y], t);
    const raw = e.pressure ?? Math.min(1, Math.max(I.speedFloor, I.speedFast - this.#fxy.speed / I.speedPer));
    const [p] = this.#fp.filter([raw], t);
    return { x, y, p: Math.min(1, Math.max(0, p)), t: e.t, tilt: e.tilt };
  }

  #push(q: Pt, path: Pt[]): void {
    this.#pts.push(q);
    if (this.#pts.length > 4) this.#pts.shift();
    if (this.#pts.length < 4) return;
    const [a, b, c, d] = this.#pts;
    path.push(...catmullRom(this.#fresh ? beyond(b, c, d) : a, b, c, d, this.#piece()));
    this.#fresh = false;
  }

  /** moves the walk to `q`, laying a step every `ds` px of travel */
  #walk(q: Pt, ds: number, out: Step[]): void {
    let a = this.#at;
    let d = Math.hypot(q.x - a.x, q.y - a.y);
    while (d > 1e-9 && this.#since + d >= ds) {
      const at = lerp(a, q, (ds - this.#since) / d);
      out.push(this.#step(at, ds));
      this.#since = 0;
      a = at;
      d = Math.hypot(q.x - a.x, q.y - a.y);
    }
    this.#since += d;
    this.#at = q;
  }

  #step(q: Pt, ds: number): Step {
    this.#travel += ds;
    const prev = this.#prev;
    if (prev) {
      const len = Math.hypot(q.x - prev.x, q.y - prev.y);
      if (len > 1e-9) {
        const nd: [number, number] = [(q.x - prev.x) / len, (q.y - prev.y) / len];
        const d = this.#dir ? [this.#dir[0] * (1 - I.turn) + nd[0] * I.turn, this.#dir[1] * (1 - I.turn) + nd[1] * I.turn] : nd;
        const l = Math.hypot(d[0], d[1]) || 1;
        this.#dir = [d[0] / l, d[1] / l];
      }
    }
    const [dx, dy] = this.#dir ?? [1, 0];
    const taper = this.pen ? 1 : I.taperFrom + (1 - I.taperFrom) * smooth(0, this.size * I.taper, this.#travel);
    const s: Step = { x: q.x, y: q.y, p: Math.max(I.minPressure, q.p * taper), dx, dy, ds, s: this.#travel, tilt: tiltShape(q.tilt), t: q.t };
    this.#prev = s;
    return s;
  }
}
