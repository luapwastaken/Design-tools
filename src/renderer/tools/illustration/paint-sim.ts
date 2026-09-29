// The paint canvas's simulation (plan unit C). Per pixel it keeps the colour a screen shows (sRGB,
// 0..1) and water. A stroke lays dabs along the pointer's path; while the paper is wet, a flow
// step each frame lets colour bleed through the water and darkens a wash's rim as it dries.
// Paint mixes as paint through km.ts once per dab, never per pixel per frame: the brush carries K
// and S curves (pickup mixes curves), and each pixel blends straight, then takes the dab's
// Kubelka-Munk correction, so a blue glaze over yellow reads green while the texture under it stays.
// Pure TypeScript, no DOM, so the tests drive it directly.
import { rgb255, toOklch } from '../../../shared/color/index.ts';
import { colourOf, mixCurves, paintOf, type Paint } from '../../../shared/paint/km.ts';

export type Rgb = [number, number, number];
/** what a brush is loaded with: the paint (km.ts curves) and the traits the canvas uses */
export type Loaded = { paint: Paint; opacity: number; granulation: number };
export type Medium = 'wet' | 'dry';
export type StrokeOptions = {
  tool: 'paint' | 'smudge';
  medium: Medium;
  /** brush diameter in canvas pixels */
  size: number;
  /** 0..1: paint held (paint) or strength (smudge) */
  load: number;
  loaded: Loaded;
};
/** inclusive pixel bounds */
export type Rect = { x0: number; y0: number; x1: number; y1: number };

export const CANVAS_W = 1024;
export const CANVAS_H = 640;
export const UNDO_STEPS = 20;

const TILE = 64;
const DRY = 0.015;
const WATER = 0.9;
/** per flow step: water evening out, colour bleeding through it, drying (a full wash stays wet
 *  about 8s at 60 steps a second: long enough to drop paint into it) */
const DIFFUSE = 0.9;
const BLEED = 0.2;
const EVAPORATE = 0.0019;
/** a dried wash's rim: how much denser its edge gets, the interior a little paler, and the rim's width */
const RIM = 0.75;
const HOLLOW = 0.12;
const RIM_PX = 4;
const LUT_N = 1024;
const UNDO_BYTES = 160 * 2 ** 20;

export const rgbOf = (p: Paint): Rgb => rgb255(colourOf(p)).map((v) => v / 255) as Rgb;
/** canvas colour as paint (average traits), for pickup and the KM correction */
const paintAt = (rgb: Rgb): Paint => paintOf({ oklch: toOklch({ mode: 'rgb', r: rgb[0], g: rgb[1], b: rgb[2] }) });
const blend = (a: Paint, b: Paint, t: number): Paint =>
  mixCurves([
    { paint: a, amount: 1 - t },
    { paint: b, amount: t },
  ]);

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

type Step = { kind: 'stroke' | 'clear'; tiles: Map<number, Float32Array> };
/** KM minus a straight blend at t = 0, .25, .5, .75, 1 per channel (the ends stay 0), and what it was worked out for */
type Correction = { key: number[]; d: Float32Array };
const correction = (): Correction => ({ key: [], d: new Float32Array(15) });
const WHITE: Rgb = [1, 1, 1];

type Live = {
  o: StrokeOptions;
  r: number;
  spacing: number;
  /** falloff by squared distance over squared radius */
  lut: Float32Array;
  /** how far one pass covers what's under it */
  opacity: number;
  /** what the brush carries now: its load, dirtied by what it picked up */
  paint: Paint;
  rgb: Rgb;
  /** paint picked up along the way and its share of the brush; fresh paint from the belly of the
   *  brush pushes it out again */
  picked: Paint | null;
  dirt: number;
  reservoir: number;
  /** reservoir used per pixel of travel */
  use: number;
  last: { x: number; y: number; p: number };
  /** travel left before the next dab */
  gap: number;
  /** direction of travel, for a dry brush's streaks */
  dir: [number, number];
  bristle: Float32Array;
  R: number;
  /** everything the stroke touched */
  box: Rect | null;
  /** smudge: the colour, paint amount and water the finger carries, (2R+1)² */
  carry: Float32Array | null;
  carryA: Float32Array | null;
  carryW: Float32Array | null;
  /** a wet dab's KM corrections, over bare paper and over the paint under it */
  onPaper: Correction;
  onPaint: Correction;
};

export class PaintSim {
  readonly w: number;
  readonly h: number;
  /** 3 per pixel, sRGB 0..1; bare paper is white */
  readonly col: Float32Array;
  readonly water: Float32Array;
  /** the paper's tooth, 0..1, fixed */
  readonly paper: Float32Array;
  /** where a wash pools and where it runs thin, 0..1, fixed */
  private readonly pool: Float32Array;
  /** how much a wet pixel belongs to its wash's rim, 0..1: it darkens by that as it dries */
  private readonly edge: Float32Array;
  /** a paint stroke's coverage so far, and the colour under it before it started: a stroke
   *  crossing itself doesn't build up, and every pixel gets an even pass */
  private readonly cov: Float32Array;
  private readonly base: Float32Array;

  private dirty: Rect | null;
  /** where water may be: the rows and, per row, the first and last pixel (empty when left > right) */
  private wetBox: Rect | null = null;
  private readonly spanL: Int32Array;
  private readonly spanR: Int32Array;
  private history: Step[] = [];
  private bytes = 0;
  private live: Live | null = null;
  private readonly tmpW: Float32Array;
  private readonly tmpC: Float32Array;
  private readonly tilesX: number;

  constructor(w = CANVAS_W, h = CANVAS_H) {
    this.w = w;
    this.h = h;
    this.col = new Float32Array(w * h * 3).fill(1);
    this.water = new Float32Array(w * h);
    this.paper = paperTooth(w, h);
    this.pool = noise(w, h, [[70, 52, 0.6], [23, 17, 0.4]], 5);
    this.edge = new Float32Array(w * h);
    this.cov = new Float32Array(w * h);
    this.base = new Float32Array(w * h * 3);
    this.spanL = new Int32Array(h).fill(w);
    this.spanR = new Int32Array(h).fill(-1);
    this.tmpW = new Float32Array(w * h);
    this.tmpC = new Float32Array(w * h * 3);
    this.tilesX = Math.ceil(w / TILE);
    this.dirty = this.all();
  }

  /** anything still wet (the flow keeps running) */
  get wet(): boolean {
    return this.wetBox !== null;
  }
  get stroking(): boolean {
    return this.live !== null;
  }
  /** undo steps held */
  get depth(): number {
    return this.history.length;
  }
  /** the newest undo step is a Clear */
  get lastIsClear(): boolean {
    return this.history.at(-1)?.kind === 'clear';
  }
  /** nothing painted: bare paper everywhere */
  get blank(): boolean {
    const c = this.col;
    for (let i = 0; i < c.length; i++) if (c[i] !== 1) return false;
    return true;
  }

  /** the region that changed since the last call, for the canvas to redraw */
  takeDirty(): Rect | null {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }

  // ── strokes ──────────────────────────────────────────────────────────────────────────────────

  begin(o: StrokeOptions, x: number, y: number, pressure = 1): void {
    this.end();
    this.push('stroke');
    const r = Math.max(0.75, o.size / 2);
    const wet = o.medium === 'wet';
    const smudge = o.tool === 'smudge';
    const spacing = Math.max(0.6, r * 0.2);
    const R = Math.ceil(r) + 1;
    this.live = {
      o,
      r,
      spacing,
      lut: falloff(smudge ? 0.1 : wet ? 0.88 : 0.92),
      opacity: wet ? (0.16 + 0.34 * o.loaded.opacity) * o.load ** 0.8 : 0.95,
      paint: o.loaded.paint,
      rgb: rgbOf(o.loaded.paint),
      picked: null,
      dirt: 0,
      reservoir: smudge || wet ? 1 : 0.35 + 0.65 * o.load,
      // bigger brushes spend their paint sooner
      use: smudge ? 0 : (wet ? 1 / (1500 + 5000 * o.load) : 1 / (250 + 2600 * o.load)) * Math.sqrt(14 / Math.max(r, 3)),
      last: { x, y, p: pressure },
      gap: spacing,
      dir: [1, 0],
      bristle: bristles(R, Math.round(x * 7 + y * 13)),
      R,
      box: null,
      carry: smudge ? new Float32Array((2 * R + 1) ** 2 * 3) : null,
      carryA: smudge ? new Float32Array((2 * R + 1) ** 2) : null,
      carryW: smudge ? new Float32Array((2 * R + 1) ** 2) : null,
      onPaper: correction(),
      onPaint: correction(),
    };
    if (smudge) this.fillCarry(Math.round(x), Math.round(y));
    this.dab(x, y, pressure);
  }

  /** dabs along the segment from the last point, `spacing` apart */
  to(x: number, y: number, pressure = 1): void {
    const L = this.live;
    if (!L) return;
    const { x: lx, y: ly, p: lp } = L.last;
    const dx = x - lx;
    const dy = y - ly;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return;
    L.dir = [dx / dist, dy / dist];
    let at = L.gap;
    for (; at <= dist; at += L.spacing) this.dab(lx + (dx * at) / dist, ly + (dy * at) / dist, lp + ((pressure - lp) * at) / dist);
    L.gap = at - dist;
    L.last = { x, y, p: pressure };
  }

  end(): void {
    const L = this.live;
    this.live = null;
    if (!L?.box) return;
    const { w, cov } = this;
    if (L.o.tool === 'paint') for (let y = L.box.y0; y <= L.box.y1; y++) cov.fill(0, y * w + L.box.x0, y * w + L.box.x1 + 1);
    if (L.o.medium === 'wet') this.rim(L.box);
  }

  /** Esc mid-stroke: as if it never happened */
  cancel(): void {
    if (!this.live) return;
    this.end();
    this.undo();
  }

  private dab(x: number, y: number, pressure: number): void {
    const L = this.live!;
    const pen = Math.min(1, Math.max(0.05, pressure));
    const r = Math.max(0.6, L.r * (0.35 + 0.65 * pen));
    const b = this.bounds(x, y, r);
    if (!b) return;
    this.touch(b);
    L.box = union(L.box, b);
    if (L.o.tool === 'smudge') this.smudgeDab(Math.round(x), Math.round(y), r, pen, b);
    else this.paintDab(x, y, r, pen, b);
    this.markDirty(b);
    // a finger can carry water even through dry paint
    if (L.o.medium === 'wet' || L.o.tool === 'smudge') this.markWet(b);
  }

  private paintDab(cx: number, cy: number, r: number, pen: number, b: Rect): void {
    const L = this.live!;
    const { w, col, water, paper, pool, cov, base, edge } = this;
    const wet = L.o.medium === 'wet';
    const invR2 = 1 / (r * r);
    const lut = L.lut;

    // what was under the dab before this stroke: the paint there (its colour and how much of it)
    // and how wet it is
    const step = r <= 10 ? 1 : Math.ceil(r / 10);
    let sw = 0, pw = 0, p0 = 0, p1 = 0, p2 = 0, ww = 0;
    for (let y = b.y0; y <= b.y1; y += step) {
      const dy2 = (y - cy) * (y - cy);
      for (let x = b.x0; x <= b.x1; x += step) {
        const t = ((x - cx) * (x - cx) + dy2) * invR2;
        if (t >= 1) continue;
        const f = lut[(t * LUT_N) | 0];
        const i = y * w + x;
        const src = cov[i] > 0 ? base : col;
        const c0 = src[i * 3], c1 = src[i * 3 + 1], c2 = src[i * 3 + 2];
        sw += f;
        ww += water[i] * f;
        const fp = f * (1 - Math.min(c0, c1, c2));
        pw += fp;
        p0 += c0 * fp;
        p1 += c1 * fp;
        p2 += c2 * fp;
      }
    }
    if (sw <= 0) return;

    // pickup: the brush takes some of the paint it passes through, more of it when that is wet
    const take = pw / sw > 0.02 ? (wet ? 0.08 * (0.2 + (0.8 * ww) / sw) : 0.006) * (pw / sw) * pen : 0;
    this.pickUp(take > 0.003 ? paintAt([p0 / pw, p1 / pw, p2 / pw]) : null, take, wet ? 0.03 : 0.1);
    // Wet paint mixes with what's under it as paint does (dry gouache covers, pixel by pixel). KM
    // bends a mix far more over white paper than over dark paint, so each pixel takes the paper's
    // or the paint's correction by how much paint it had
    const brush = { paint: L.paint, rgb: L.rgb };
    const onPaper = wet ? km(L.onPaper, WHITE, brush) : null;
    const onPaint = wet && pw / sw > 0.02 ? km(L.onPaint, [p0 / pw, p1 / pw, p2 / pw], brush) : null;
    const thick = onPaint ? 1 / Math.max(0.02, 1 - Math.min(p0, p1, p2) / pw) : 0;

    L.reservoir = Math.max(0, L.reservoir - L.use * L.spacing);
    const res = L.reservoir;
    const pass = L.opacity * Math.sqrt(pen) * (wet ? 0.35 + 0.65 * res : smooth(0, 0.3, res));
    // a dry brush running out catches only the paper's high points, in streaks along the stroke
    const gate = wet ? 0 : Math.min(1, Math.max(0, 1.1 - res * 2));
    // a wash pools unevenly and settles into the paper's grain; granulating pigments sink into
    // its hollows
    const gran = wet ? 0.2 + L.o.loaded.granulation * 1.4 : 0;
    const [ux, uy] = L.dir;
    const { bristle, R } = L;
    const [br0, br1, br2] = L.rgb;

    for (let y = b.y0; y <= b.y1; y++) {
      const dy = y - cy;
      const dy2 = dy * dy;
      for (let x = b.x0; x <= b.x1; x++) {
        const dx = x - cx;
        const t = (dx * dx + dy2) * invR2;
        if (t >= 1) continue;
        const i = y * w + x;
        let f = lut[(t * LUT_N) | 0];
        // a wash's edge follows the paper's grain
        if (wet && f < 0.6) f *= 0.5 + paper[i];
        let a = pass * f;
        if (gran > 0) a *= Math.max(0, (1 + gran * (0.5 - paper[i])) * (0.7 + 0.6 * pool[i]));
        else {
          // gouache: the brush's sides drag in streaks, and a brush running dry skips the hollows
          const off = dy * ux - dx * uy;
          const hair = bristle[Math.min(2 * R, Math.max(0, Math.round(off) + R))];
          a *= 1 - smooth(0.7, 0.95, Math.abs(off) / r) * smooth(0.35, 0.65, 1 - hair);
          if (gate > 0) a *= smooth(gate - 0.08, gate + 0.08, paper[i] * 0.6 + hair * 0.4);
        }
        if (a > 1) a = 1;
        if (a <= cov[i] + 1e-4) continue;
        const j = i * 3;
        if (cov[i] === 0) {
          base[j] = col[j];
          base[j + 1] = col[j + 1];
          base[j + 2] = col[j + 2];
        }
        cov[i] = a;
        let v0 = base[j] + (br0 - base[j]) * a;
        let v1 = base[j + 1] + (br1 - base[j + 1]) * a;
        let v2 = base[j + 2] + (br2 - base[j + 2]) * a;
        if (onPaper) {
          const s = a * 4;
          const k = s < 4 ? s | 0 : 3;
          const fr = s - k;
          const o = k * 3;
          let d0 = onPaper[o] + (onPaper[o + 3] - onPaper[o]) * fr;
          let d1 = onPaper[o + 1] + (onPaper[o + 4] - onPaper[o + 1]) * fr;
          let d2 = onPaper[o + 2] + (onPaper[o + 5] - onPaper[o + 2]) * fr;
          if (onPaint) {
            const m = Math.min(1, (1 - Math.min(base[j], base[j + 1], base[j + 2])) * thick);
            d0 += (onPaint[o] + (onPaint[o + 3] - onPaint[o]) * fr - d0) * m;
            d1 += (onPaint[o + 1] + (onPaint[o + 4] - onPaint[o + 1]) * fr - d1) * m;
            d2 += (onPaint[o + 2] + (onPaint[o + 5] - onPaint[o + 2]) * fr - d2) * m;
          }
          v0 += d0;
          v1 += d1;
          v2 += d2;
        }
        col[j] = clamp01(v0);
        col[j + 1] = clamp01(v1);
        col[j + 2] = clamp01(v2);
        if (wet) {
          // the water ends where the paint does, so a wash keeps its edge
          const wv = WATER * smooth(0.02, 0.2, f);
          if (wv > water[i]) water[i] = wv;
          edge[i] = 0;
        }
      }
    }
  }

  private pickUp(paint: Paint | null, take: number, refresh: number): void {
    const L = this.live!;
    if (paint) {
      L.picked = L.picked ? blend(L.picked, paint, take / (L.dirt + take)) : paint;
      L.dirt += take * (1 - L.dirt);
    } else if (L.dirt === 0) return;
    L.dirt *= 1 - refresh;
    if (L.dirt < 0.004) L.dirt = 0;
    L.paint = L.dirt > 0 ? blend(L.o.loaded.paint, L.picked!, L.dirt) : L.o.loaded.paint;
    L.rgb = rgbOf(L.paint);
  }

  private fillCarry(cx: number, cy: number): void {
    const L = this.live!;
    const { w, h, col, water } = this;
    const side = 2 * L.R + 1;
    for (let dy = -L.R; dy <= L.R; dy++) {
      const y = Math.min(h - 1, Math.max(0, cy + dy));
      for (let dx = -L.R; dx <= L.R; dx++) {
        const i = y * w + Math.min(w - 1, Math.max(0, cx + dx));
        const k = (dy + L.R) * side + dx + L.R;
        L.carry!.set(col.subarray(i * 3, i * 3 + 3), k * 3);
        L.carryA![k] = 1 - Math.min(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
        L.carryW![k] = water[i];
      }
    }
  }

  /**
   * A finger through the paint: lays down the paint it carries (a clean finger lays nothing, so
   * bare paper never smears in) and picks up what it passes through.
   */
  private smudgeDab(cx: number, cy: number, r: number, pen: number, b: Rect): void {
    const L = this.live!;
    const { w, col, water } = this;
    const wet = L.o.medium === 'wet';
    const invR2 = 1 / (r * r);
    const { R, lut } = L;
    const side = 2 * R + 1;
    const carry = L.carry!;
    const carryA = L.carryA!;
    const carryW = L.carryW!;
    const strength = (0.3 + 0.65 * L.o.load) * Math.sqrt(pen);
    const pick = wet ? 0.12 : 0.22;

    const corr = this.smudgeMix(cx, cy, invR2, b);

    for (let y = b.y0; y <= b.y1; y++) {
      const dy = y - cy;
      for (let x = b.x0; x <= b.x1; x++) {
        const dx = x - cx;
        const t = (dx * dx + dy * dy) * invR2;
        if (t >= 1) continue;
        const i = y * w + x;
        let a = strength * lut[(t * LUT_N) | 0];
        if (wet) a *= 0.35 + 0.65 * Math.min(1, water[i] / WATER);
        if (a < 1e-4) continue;
        const j = i * 3;
        const k = (dy + R) * side + dx + R;
        const lay = a * carryA[k];
        const s = lay * 4;
        const n = s < 4 ? s | 0 : 3;
        for (let c = 0; c < 3; c++) {
          let v = col[j + c] + (carry[k * 3 + c] - col[j + c]) * lay;
          if (corr) v += corr[n * 3 + c] + (corr[n * 3 + 3 + c] - corr[n * 3 + c]) * (s - n);
          col[j + c] = clamp01(v);
        }
        // the finger picks up paint: its colour mixes by how much paint each side holds
        const here = (1 - Math.min(col[j], col[j + 1], col[j + 2])) * pick * a;
        const share = here / Math.max(1e-4, here + carryA[k] * (1 - pick * a));
        for (let c = 0; c < 3; c++) carry[k * 3 + c] += (col[j + c] - carry[k * 3 + c]) * share;
        carryA[k] += here - carryA[k] * pick * a;
        water[i] += (carryW[k] - water[i]) * lay;
        carryW[k] += (water[i] - carryW[k]) * pick * a;
      }
    }
  }

  /** paint pushed into other paint mixes as paint: one KM correction for the dab, from what the
   *  finger carries and what's under it */
  private smudgeMix(cx: number, cy: number, invR2: number, b: Rect): Float32Array | null {
    const L = this.live!;
    const { w, col } = this;
    const { R, carry, carryA } = L;
    const side = 2 * R + 1;
    let n = 0, a0 = 0, a1 = 0, a2 = 0, c0 = 0, c1 = 0, c2 = 0, ca = 0;
    for (let y = b.y0; y <= b.y1; y += 2) {
      for (let x = b.x0; x <= b.x1; x += 2) {
        if (((x - cx) ** 2 + (y - cy) ** 2) * invR2 >= 1) continue;
        const j = (y * w + x) * 3;
        const k = (y - cy + R) * side + x - cx + R;
        const amount = carryA![k];
        n++;
        a0 += col[j];
        a1 += col[j + 1];
        a2 += col[j + 2];
        c0 += carry![k * 3] * amount;
        c1 += carry![k * 3 + 1] * amount;
        c2 += carry![k * 3 + 2] * amount;
        ca += amount;
      }
    }
    if (ca <= 0.05 * n || Math.abs(a0 / n - c0 / ca) + Math.abs(a1 / n - c1 / ca) + Math.abs(a2 / n - c2 / ca) < 0.06) return null;
    const rgb: Rgb = [c0 / ca, c1 / ca, c2 / ca];
    return km(L.onPaint, [a0 / n, a1 / n, a2 / n], { paint: paintAt(rgb), rgb });
  }

  // ── watercolour flow ─────────────────────────────────────────────────────────────────────────

  /**
   * A stroke ended: the rim of every wash it joined, from the wet region's own outline (so washes
   * that ran together share one edge). Each wet pixel's share of the rim, 0..1.
   */
  private rim(r: Rect): void {
    const { w, h, water, edge, tmpW } = this;
    const grow = (n: number): Rect => ({ x0: Math.max(0, r.x0 - n), y0: Math.max(0, r.y0 - n), x1: Math.min(w - 1, r.x1 + n), y1: Math.min(h - 1, r.y1 + n) });
    // the margin too: a wash this stroke ran into has a new outline there
    const e = grow(RIM_PX);
    const o = grow(2 * RIM_PX);
    const wetAt = (i: number) => (water[i] >= DRY ? 1 : 0);
    // how much of the row around each pixel is wet, then of the column around that
    for (let y = o.y0; y <= o.y1; y++) {
      let run = 0;
      for (let x = e.x0 - RIM_PX; x <= e.x0 + RIM_PX; x++) if (x >= 0 && x < w) run += wetAt(y * w + x);
      for (let x = e.x0; x <= e.x1; x++) {
        tmpW[y * w + x] = run;
        if (x + RIM_PX + 1 < w) run += wetAt(y * w + x + RIM_PX + 1);
        if (x - RIM_PX >= 0) run -= wetAt(y * w + x - RIM_PX);
      }
    }
    const area = (2 * RIM_PX + 1) ** 2;
    for (let x = e.x0; x <= e.x1; x++) {
      let run = 0;
      for (let y = e.y0 - RIM_PX; y <= e.y0 + RIM_PX; y++) if (y >= o.y0 && y <= o.y1) run += tmpW[y * w + x];
      for (let y = e.y0; y <= e.y1; y++) {
        const i = y * w + x;
        edge[i] = water[i] >= DRY ? clamp01((1 - run / area) * 2.2) : 0;
        if (y + RIM_PX + 1 <= o.y1) run += tmpW[(y + RIM_PX + 1) * w + x];
        if (y - RIM_PX >= o.y0) run -= tmpW[(y - RIM_PX) * w + x];
      }
    }
  }

  /**
   * One tick while anything is wet (`dt` ticks' worth, when the canvas runs it less often). Water
   * evens out between wet pixels but never soaks into dry paper, so a wash keeps its edge; colour
   * bleeds through the water (wet-in-wet); as it dries, pigment gathers at the rim and leaves the
   * middle a little paler. Only each row's wet span is visited.
   */
  step(dt = 1): boolean {
    const box = this.wetBox;
    if (!box) return false;
    const { w, h, col, water, edge, tmpW, tmpC, spanL, spanR } = this;
    // the old values the neighbours read: each row over its own and its neighbours' spans
    const reach = (y: number): [number, number] => {
      let a = w, z = -1;
      for (let r = Math.max(box.y0, y - 1); r <= Math.min(box.y1, y + 1); r++) {
        if (spanL[r] < a) a = spanL[r];
        if (spanR[r] > z) z = spanR[r];
      }
      return [Math.max(0, a - 1), Math.min(w - 1, z + 1)];
    };
    for (let y = Math.max(0, box.y0 - 1); y <= Math.min(h - 1, box.y1 + 1); y++) {
      const [a, z] = reach(y);
      if (z < a) continue;
      tmpW.set(water.subarray(y * w + a, y * w + z + 1), y * w + a);
      tmpC.set(col.subarray((y * w + a) * 3, (y * w + z + 1) * 3), (y * w + a) * 3);
    }
    this.touchWet(box);

    const evaporate = EVAPORATE * dt;
    const drying = evaporate / WATER;
    const share = Math.min(1, DIFFUSE * dt) / 4;
    const bleed = Math.min(0.9, BLEED * dt);
    let nx0 = w, ny0 = h, nx1 = -1, ny1 = -1;
    for (let y = box.y0; y <= box.y1; y++) {
      const from = spanL[y];
      const to = spanR[y];
      spanL[y] = w;
      spanR[y] = -1;
      for (let x = from; x <= to; x++) {
        const i = y * w + x;
        const w0 = tmpW[i];
        if (w0 < DRY) continue;
        const j = i * 3;
        // wet neighbours, on the canvas
        const nl = x > 0 && tmpW[i - 1] >= DRY ? tmpW[i - 1] : 0;
        const nr = x < w - 1 && tmpW[i + 1] >= DRY ? tmpW[i + 1] : 0;
        const nu = y > 0 && tmpW[i - w] >= DRY ? tmpW[i - w] : 0;
        const nd = y < h - 1 && tmpW[i + w] >= DRY ? tmpW[i + w] : 0;
        const sum = nl + nr + nu + nd;
        let v0 = tmpC[j], v1 = tmpC[j + 1], v2 = tmpC[j + 2];
        if (sum > 0) {
          // colour moves toward its wet neighbours' (water-weighted), faster the wetter it is;
          // a neighbour off the canvas weighs 0 and is never read
          let s0 = -v0 * sum, s1 = -v1 * sum, s2 = -v2 * sum;
          if (nl) {
            s0 += tmpC[j - 3] * nl;
            s1 += tmpC[j - 2] * nl;
            s2 += tmpC[j - 1] * nl;
          }
          if (nr) {
            s0 += tmpC[j + 3] * nr;
            s1 += tmpC[j + 4] * nr;
            s2 += tmpC[j + 5] * nr;
          }
          if (nu) {
            const o = j - w * 3;
            s0 += tmpC[o] * nu;
            s1 += tmpC[o + 1] * nu;
            s2 += tmpC[o + 2] * nu;
          }
          if (nd) {
            const o = j + w * 3;
            s0 += tmpC[o] * nd;
            s1 += tmpC[o + 1] * nd;
            s2 += tmpC[o + 2] * nd;
          }
          const k = (bleed * w0 * w0) / sum;
          v0 += s0 * k;
          v1 += s1 * k;
          v2 += s2 * k;
        }
        const e = edge[i];
        const dense = 1 + (e > 0 ? RIM * e : -HOLLOW) * drying;
        col[j] = clamp01(1 - (1 - v0) * dense);
        col[j + 1] = clamp01(1 - (1 - v1) * dense);
        col[j + 2] = clamp01(1 - (1 - v2) * dense);
        // wet neighbours share their water; dry paper takes none
        const flow = (nl && nl - w0) + (nr && nr - w0) + (nu && nu - w0) + (nd && nd - w0);
        const nw = w0 + flow * share - evaporate;
        if (nw < DRY) {
          water[i] = 0;
          edge[i] = 0;
          continue;
        }
        water[i] = nw;
        if (x < spanL[y]) spanL[y] = x;
        spanR[y] = x;
      }
      if (spanR[y] < 0) continue;
      if (ny1 < 0) ny0 = y;
      ny1 = y;
      if (spanL[y] < nx0) nx0 = spanL[y];
      if (spanR[y] > nx1) nx1 = spanR[y];
    }
    this.markDirty(box);
    this.wetBox = ny1 >= 0 ? { x0: nx0, y0: ny0, x1: nx1, y1: ny1 } : null;
    return this.wetBox !== null;
  }

  /** the undo step keeps the tiles the flow is about to change: per band of tiles, its rows' spans */
  private touchWet(box: Rect): void {
    const { w, h, spanL, spanR } = this;
    for (let top = Math.floor(box.y0 / TILE) * TILE; top <= box.y1; top += TILE) {
      let a = w, z = -1;
      for (let y = Math.max(top, box.y0); y <= Math.min(top + TILE - 1, box.y1); y++) {
        if (spanL[y] < a) a = spanL[y];
        if (spanR[y] > z) z = spanR[y];
      }
      if (z >= a) this.touch({ x0: a, y0: top, x1: z, y1: Math.min(h - 1, top + TILE - 1) });
    }
  }

  // ── reading and writing whole paintings ──────────────────────────────────────────────────────

  /** the colour at a point, averaged over 3×3 so granulation doesn't decide it */
  pick(x: number, y: number): Rgb {
    const cx = Math.min(this.w - 2, Math.max(1, Math.round(x)));
    const cy = Math.min(this.h - 2, Math.max(1, Math.round(y)));
    const out: Rgb = [0, 0, 0];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const j = ((cy + dy) * this.w + cx + dx) * 3;
        for (let c = 0; c < 3; c++) out[c] += this.col[j + c] / 9;
      }
    }
    return out;
  }

  /** RGBA bytes for `r` into `out` (the whole canvas, w × h × 4; alpha left as it is) */
  render(out: Uint8ClampedArray, r: Rect): void {
    const { w, col } = this;
    for (let y = r.y0; y <= r.y1; y++) {
      let j = (y * w + r.x0) * 3;
      let o = (y * w + r.x0) * 4;
      for (let x = r.x0; x <= r.x1; x++, j += 3, o += 4) {
        out[o] = col[j] * 255;
        out[o + 1] = col[j + 1] * 255;
        out[o + 2] = col[j + 2] * 255;
      }
    }
  }

  /** a saved painting (RGBA, same size): dry, with nothing to undo */
  load(rgba: Uint8ClampedArray): void {
    const { col } = this;
    for (let i = 0, j = 0; j < col.length; i += 4, j += 3) {
      col[j] = rgba[i] / 255;
      col[j + 1] = rgba[i + 1] / 255;
      col[j + 2] = rgba[i + 2] / 255;
    }
    this.reset();
  }

  /** blank paper; `undoable` makes it one step that brings the painting back */
  clear(undoable: boolean): void {
    this.end();
    if (undoable) {
      this.push('clear');
      this.touch(this.all());
    }
    this.col.fill(1);
    if (!undoable) this.reset();
    this.water.fill(0);
    this.findWet();
    this.markDirty(this.all());
  }

  // ── undo ─────────────────────────────────────────────────────────────────────────────────────

  /** puts back the tiles the newest step changed; they come back dry */
  undo(): boolean {
    this.end();
    const step = this.history.pop();
    if (!step) return false;
    const { w, h, col, water } = this;
    for (const [ti, saved] of step.tiles) {
      const t = this.tileRect(ti);
      const tw = t.x1 - t.x0 + 1;
      for (let y = t.y0; y <= t.y1; y++) {
        col.set(saved.subarray((y - t.y0) * tw * 3, (y - t.y0 + 1) * tw * 3), (y * w + t.x0) * 3);
        water.fill(0, y * w + t.x0, y * w + t.x1 + 1);
      }
      this.bytes -= saved.byteLength;
      this.markDirty(t);
    }
    this.findWet();
    return true;
  }

  private reset(): void {
    this.history = [];
    this.bytes = 0;
    this.live = null;
    this.water.fill(0);
    this.findWet();
    this.markDirty(this.all());
  }

  /** where the water is, from scratch (after undo, load or clear) */
  private findWet(): void {
    const { w, h, water, spanL, spanR } = this;
    let box: Rect | null = null;
    for (let y = 0; y < h; y++) {
      spanL[y] = w;
      spanR[y] = -1;
      for (let x = 0; x < w; x++) {
        if (water[y * w + x] < DRY) continue;
        if (spanR[y] < 0) spanL[y] = x;
        spanR[y] = x;
      }
      if (spanR[y] >= 0) box = union(box, { x0: spanL[y], y0: y, x1: spanR[y], y1: y });
    }
    this.wetBox = box;
  }

  private push(kind: Step['kind']): void {
    this.history.push({ kind, tiles: new Map() });
    while (this.history.length > UNDO_STEPS) this.dropOldest();
  }

  private dropOldest(): void {
    for (const t of this.history.shift()?.tiles.values() ?? []) this.bytes -= t.byteLength;
  }

  /** before changing `r`: the newest step keeps a copy of each tile it hasn't seen yet */
  private touch(r: Rect): void {
    const step = this.history.at(-1);
    if (!step) return;
    const { w, col } = this;
    for (let ty = Math.floor(r.y0 / TILE); ty <= Math.floor(r.y1 / TILE); ty++) {
      for (let tx = Math.floor(r.x0 / TILE); tx <= Math.floor(r.x1 / TILE); tx++) {
        const ti = ty * this.tilesX + tx;
        if (step.tiles.has(ti)) continue;
        const t = this.tileRect(ti);
        const tw = t.x1 - t.x0 + 1;
        const copy = new Float32Array(tw * (t.y1 - t.y0 + 1) * 3);
        for (let y = t.y0; y <= t.y1; y++) copy.set(col.subarray((y * w + t.x0) * 3, (y * w + t.x1 + 1) * 3), (y - t.y0) * tw * 3);
        step.tiles.set(ti, copy);
        this.bytes += copy.byteLength;
      }
    }
    // a memory cap before the step count: a Clear alone is the whole canvas
    while (this.bytes > UNDO_BYTES && this.history.length > 1) this.dropOldest();
  }

  private tileRect(ti: number): Rect {
    const x0 = (ti % this.tilesX) * TILE;
    const y0 = Math.floor(ti / this.tilesX) * TILE;
    return { x0, y0, x1: Math.min(this.w, x0 + TILE) - 1, y1: Math.min(this.h, y0 + TILE) - 1 };
  }

  private all(): Rect {
    return { x0: 0, y0: 0, x1: this.w - 1, y1: this.h - 1 };
  }

  private bounds(x: number, y: number, r: number): Rect | null {
    const b = {
      x0: Math.max(0, Math.floor(x - r)),
      y0: Math.max(0, Math.floor(y - r)),
      x1: Math.min(this.w - 1, Math.ceil(x + r)),
      y1: Math.min(this.h - 1, Math.ceil(y + r)),
    };
    return b.x0 <= b.x1 && b.y0 <= b.y1 ? b : null;
  }

  private markDirty(r: Rect): void {
    this.dirty = union(this.dirty, r);
  }

  private markWet(r: Rect): void {
    this.wetBox = union(this.wetBox, r);
    for (let y = r.y0; y <= r.y1; y++) {
      if (r.x0 < this.spanL[y]) this.spanL[y] = r.x0;
      if (r.x1 > this.spanR[y]) this.spanR[y] = r.x1;
    }
  }
}

/** KM against a straight blend at t = .25, .5, .75, for paint `B` over `under`; kept while they hold */
function km(c: Correction, under: Rgb, B: { paint: Paint; rgb: Rgb }): Float32Array {
  const key = [...under, ...B.rgb];
  if (c.key.length && key.every((v, i) => Math.abs(v - c.key[i]) < 1 / 160)) return c.d;
  c.key = key;
  const U = paintAt(under);
  for (let k = 1; k <= 3; k++) {
    const t = k / 4;
    const m = rgbOf(blend(U, B.paint, t));
    for (let ch = 0; ch < 3; ch++) c.d[k * 3 + ch] = m[ch] - (under[ch] + (B.rgb[ch] - under[ch]) * t);
  }
  return c.d;
}

const union = (a: Rect | null, b: Rect): Rect =>
  a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : { ...b };

/** 1 inside `hard` × radius, easing to 0 at the edge; indexed by squared distance / squared radius */
function falloff(hard: number): Float32Array {
  const lut = new Float32Array(LUT_N + 1);
  for (let i = 0; i <= LUT_N; i++) lut[i] = 1 - smooth(hard, 1, Math.sqrt(i / LUT_N));
  return lut;
}

const hash = (n: number) => {
  let x = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
};

/** smooth value noise, 0..1: octaves of [cell width, cell height, weight] */
function noise(w: number, h: number, octaves: number[][], seed: number): Float32Array {
  const out = new Float32Array(w * h);
  for (const [sx, sy, weight] of octaves) {
    const gw = Math.ceil(w / sx) + 2;
    const grid = new Float32Array(gw * (Math.ceil(h / sy) + 2));
    for (let i = 0; i < grid.length; i++) grid[i] = hash(i * 31 + sx * 1000 + seed * 7919);
    for (let y = 0; y < h; y++) {
      const iy = Math.floor(y / sy);
      const fy = y / sy - iy;
      const ey = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < w; x++) {
        const ix = Math.floor(x / sx);
        const fx = x / sx - ix;
        const ex = fx * fx * (3 - 2 * fx);
        const g = iy * gw + ix;
        const top = grid[g] + (grid[g + 1] - grid[g]) * ex;
        const bottom = grid[g + gw] + (grid[g + gw + 1] - grid[g + gw]) * ex;
        out[y * w + x] += (top + (bottom - top) * ey) * weight;
      }
    }
  }
  return out;
}

/** cold-press tooth: fibres a little longer across than down, plus grain */
function paperTooth(w: number, h: number): Float32Array {
  const out = noise(w, h, [[9, 5, 0.55], [3.2, 2.4, 0.3]], 0);
  for (let i = 0; i < out.length; i++) out[i] = clamp01(out[i] + (hash(i + 99991) - 0.5) * 0.15 + 0.075);
  return out;
}

/** how much paint each bristle across the brush holds, 0..1 */
function bristles(R: number, seed: number): Float32Array {
  const out = new Float32Array(2 * R + 1);
  for (let i = 0; i < out.length; i++) {
    const a = hash(seed * 131 + (i >> 1));
    const b = hash(seed * 131 + (i >> 1) + 1);
    out[i] = a + ((b - a) * (i & 1)) / 2;
  }
  return out;
}
