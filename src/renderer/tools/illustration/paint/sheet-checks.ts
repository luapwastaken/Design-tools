// What the stroke sheet must show (plan §6), measured on the painting it made: linear sRGB with
// the height in alpha, rows from the top. Density is how much a pixel absorbs of the light the
// bare paper reflects, in its most absorbed channel: 0 on paper, 1 for black.
import { toOklch } from '../../../../shared/color/index.ts';
import { PAPER_RGB } from './paper.ts';
import { at, CELL, SHEET, type SheetStroke } from './sheet-strokes.ts';
import { HEIGHT, WIDTH } from './types.ts';

export type Check = { name: string; ok: boolean; value: unknown };

type Painting = Float32Array;
const px = (p: Painting, x: number, y: number): [number, number, number, number] => {
  const i = (Math.min(HEIGHT - 1, Math.max(0, Math.round(y))) * WIDTH + Math.min(WIDTH - 1, Math.max(0, Math.round(x)))) * 4;
  return [p[i], p[i + 1], p[i + 2], p[i + 3]];
};
export const density = (c: readonly number[]): number => Math.max(0, 1 - Math.min(c[0] / PAPER_RGB[0], c[1] / PAPER_RGB[1], c[2] / PAPER_RGB[2]));
const lch = (c: readonly number[]) => toOklch({ mode: 'lrgb', r: c[0], g: c[1], b: c[2] });
/** the mean colour of a (2r+1)² patch */
function patch(p: Painting, x: number, y: number, r = 3): number[] {
  const sum = [0, 0, 0];
  for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) px(p, x + i, y + j).slice(0, 3).forEach((v, c) => (sum[c] += v));
  return sum.map((v) => v / (2 * r + 1) ** 2);
}
const stroke = (name: string): SheetStroke => SHEET.find((s) => s.name === name)!;
const round = (v: number, d = 3) => +v.toFixed(d);

/** density along a line through (x, y) in direction (dx, dy), from -half to +half px */
function profile(p: Painting, x: number, y: number, dx: number, dy: number, half: number): number[] {
  const out: number[] = [];
  for (let t = -half; t <= half; t++) out.push(density(px(p, x + dx * t, y + dy * t)));
  return out;
}
/** px at or above half of the profile's peak */
const fwhm = (d: number[]) => d.filter((v) => v >= Math.max(...d) / 2).length;

/** the painted width across a stroke at path position u: px denser than `min` along the normal */
function widthAt(p: Painting, s: SheetStroke, u: number, min = 0.3): number {
  const [x, y] = at(s, u);
  const [x1, y1] = at(s, Math.min(1, u + 0.01));
  const [x0, y0] = at(s, Math.max(0, u - 0.01));
  const l = Math.hypot(x1 - x0, y1 - y0) || 1;
  return profile(p, x, y, -(y1 - y0) / l, (x1 - x0) / l, s.size).filter((v) => v > min).length;
}

/** autocorrelation of density at lag `lag` along (dx, dy), over points `pts` */
function autocorr(p: Painting, pts: [number, number][], dx: number, dy: number, lag: number): number {
  const a = pts.map(([x, y]) => density(px(p, x, y)));
  const b = pts.map(([x, y]) => density(px(p, x + dx * lag, y + dy * lag)));
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(a);
  const mb = mean(b);
  let num = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(va * vb || 1);
}

export type Aux = { smudge: { name: string; band: number; at50: number; at300: number }[] };

/** the sheet's painting, measured; `lifted` per stroke, `paper` the bare value, `aux` the smudge trails painted apart */
export function measureSheet(p: Painting, shown: Painting, lifted: boolean[], paper: number[], aux: Aux): Check[] {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, value: unknown) => checks.push({ name, ok, value });

  add('lift: after every stroke, shown equals base over its rect', lifted.every(Boolean), lifted.flatMap((v, i) => (v ? [] : [SHEET[i].name])));
  let diff = 0;
  let bad = 0;
  for (let i = 0; i < p.length; i++) {
    if (!Object.is(p[i], shown[i])) diff++;
    if (!Number.isFinite(p[i])) bad++;
  }
  add('lift: at the end, shown equals base everywhere', diff === 0, diff);
  add('no NaN or Inf anywhere', bad === 0, bad);

  // untouched: outside every stroke's reach, exactly the paper
  const reach = SHEET.map((s) => {
    const pts = Array.from({ length: 101 }, (_, k) => at(s, k / 100));
    const pad = s.size + 12;
    return [Math.min(...pts.map((q) => q[0])) - pad, Math.min(...pts.map((q) => q[1])) - pad, Math.max(...pts.map((q) => q[0])) + pad, Math.max(...pts.map((q) => q[1])) + pad];
  });
  let off = 0;
  let checked = 0;
  for (let y = 0; y < HEIGHT; y += 3) {
    for (let x = 0; x < WIDTH; x += 3) {
      if (reach.some(([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) continue;
      checked++;
      const i = (y * WIDTH + x) * 4;
      if (p[i] !== paper[0] || p[i + 1] !== paper[1] || p[i + 2] !== paper[2] || p[i + 3] !== paper[3]) off++;
    }
  }
  add('untouched pixels are exactly paper', off === 0 && checked > 10000, { off, checked });

  // glaze: Ultramarine over Hansa reads green
  {
    const [l, c, h] = lch(patch(p, 230, 2 * CELL.h + 195, 4));
    add('glaze: Ultramarine over Hansa is green (hue 120-165, chroma 0.05+)', h >= 120 && h <= 165 && c >= 0.05, { l: round(l), c: round(c), h: round(h, 1) });
  }

  // gouache: White through Red covers past 150 px, and is pinker near the red
  {
    const s = stroke('white through the red');
    const far = [0.8, 0.84, 0.88, 0.92].map((u) => lch(patch(p, ...at(s, u), 3)));
    const near = lch(patch(p, ...at(s, 0.48), 3));
    const minL = Math.min(...far.map((c) => c[0]));
    const pinker = near[1] > far[3][1] + 0.01;
    add('gouache: White over Red is L 0.85+ past 150 px, and pinker near the red', minL >= 0.85 && pinker, { farL: round(minL), nearC: round(near[1]), farC: round(far[3][1]) });
  }

  // dry brush: broken coverage, streaks along the stroke
  for (const name of ['lamp black dry brush', 'burnt sienna dry brush']) {
    const s = stroke(name);
    const pts: [number, number][] = [];
    const [x0, y0] = at(s, 0.3);
    const [x1, y1] = at(s, 0.7);
    const l = Math.hypot(x1 - x0, y1 - y0);
    const [dx, dy] = [(x1 - x0) / l, (y1 - y0) / l];
    for (let a = 0; a < l; a += 2) for (let c = -s.size * 0.3; c <= s.size * 0.3; c += 2) pts.push([x0 + dx * a - dy * c, y0 + dy * a + dx * c]);
    const cover = pts.filter(([x, y]) => density(px(p, x, y)) > 0.15).length / pts.length;
    const along = autocorr(p, pts, dx, dy, 4);
    const across = autocorr(p, pts, -dy, dx, 4);
    add(`dry brush (${name}): coverage 0.25-0.75, streaks along 2x across`, cover >= 0.25 && cover <= 0.75 && along >= 2 * across, { cover: round(cover), along: round(along), across: round(across) });
  }

  // taper: a pen's ends, a mouse's start
  {
    const pen = stroke('pen taper');
    const mouse = stroke('mouse stroke');
    const mid = widthAt(p, pen, 0.5);
    const ends = [widthAt(p, pen, 0.04), widthAt(p, pen, 0.96)];
    const mMid = widthAt(p, mouse, 0.5);
    const mStart = widthAt(p, mouse, 0.02);
    add('taper: the pen ends 35 % of the middle or less, the mouse start 40 % or less', Math.max(...ends) <= 0.35 * mid && mStart <= 0.4 * mMid, { pen: [ends[0], mid, ends[1]], mouse: [mStart, mMid] });
  }

  // load ladder: a fuller brush runs dry later
  {
    const outs = [20, 50, 70, 100].map((n) => {
      const s = stroke(`load ${n}`);
      for (let u = 0.1; u <= 1; u += 0.01) {
        const covered = [-6, -3, 0, 3, 6].filter((c) => density(px(p, at(s, u)[0], at(s, u)[1] + c)) > 0.3).length;
        if (covered < 3) return round(u, 2);
      }
      return 1;
    });
    add('load ladder: dry-out comes later as load rises', outs.every((v, i) => !i || v >= outs[i - 1]) && outs[0] < outs[3], outs);
  }

  // smudge: across the full width, never stronger than its sources, fading, staining resists
  {
    const s = stroke('smudge 3');
    const y = CELL.h + 300;
    const u = (300 - 40) / 350;
    const [x] = at(s, u);
    const w = fwhm(profile(p, x, y, 1, 0, 70));
    const sources = [0.15, 0.5, 0.85].flatMap((v) => [at(stroke('cadmium yellow'), v), at(stroke('phthalo blue'), v)]).map(([sx, sy]) => lch(patch(p, sx, sy, 2))[1]);
    const trail = [260, 290, 320, 350, 380].map((yy) => lch(patch(p, at(s, (yy - 40) / 350)[0], CELL.h + yy, 2))[1]);
    const most = Math.max(...sources);
    add('smudge: width at half maximum 0.8 × size or more', w >= 0.8 * s.size, { fwhm: w, size: s.size });
    add("smudge: the trail's chroma never exceeds its sources' by more than 0.01", Math.max(...trail) <= most + 0.01, { trail: trail.map((v) => round(v)), sources: round(most) });
    const [red, blue] = aux.smudge;
    add('smudge: at 300 px the trail holds 50 % or less of its density at 50 px', aux.smudge.every((t) => t.at300 <= 0.5 * t.at50), aux.smudge);
    add('smudge: Phthalo (staining) smudges weaker than Cadmium Red', blue.at50 / blue.band < red.at50 / red.band, aux.smudge.map((t) => ({ name: t.name, share: round(t.at50 / t.band) })));
  }

  // watercolour rim: denser at the edge, narrow, anti-aliased. In optical density, which follows the
  // thickness of a thin layer where plain density saturates
  {
    const s = stroke('ultramarine S wash, mouse');
    const od = (c: readonly number[]) => Math.max(0, -Math.log(Math.max(1e-4, Math.min(c[0] / PAPER_RGB[0], c[1] / PAPER_RGB[1], c[2] / PAPER_RGB[2]))));
    const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    const rows = [0.3, 0.36, 0.42, 0.48, 0.54, 0.6, 0.66, 0.72].flatMap((u) =>
      [1, -1].map((side) => {
        const [x, y] = at(s, u);
        const [x1, y1] = at(s, u + 0.01);
        const [x0, y0] = at(s, u - 0.01);
        const l = Math.hypot(x1 - x0, y1 - y0);
        const [nx, ny] = [(-(y1 - y0) / l) * side, ((x1 - x0) / l) * side];
        // outward from the path's centre: [inside ... edge ... paper]
        const d = Array.from({ length: s.size }, (_, t) => od(px(p, x + nx * t, y + ny * t)));
        const edge = d.findIndex((v, i) => i > 30 && v < 0.02);
        const rim = mean(d.slice(edge - 3, edge));
        const inside = mean(d.slice(edge - 40, edge - 20));
        const at0 = d.slice(edge - 8, edge).indexOf(Math.max(...d.slice(edge - 8, edge))) + edge - 8;
        const half = inside + 0.5 * (d[at0] - inside);
        let width = 1;
        for (let i = at0 - 1; i > edge - 20 && d[i] >= half; i--) width++;
        const soft = d.slice(edge - 2, edge).some((v) => v > 0.1 * d[at0] && v < 0.9 * d[at0]);
        return { ratio: rim / inside, width, soft };
      }),
    );
    const ratios = rows.map((r) => r.ratio).sort((a, b) => a - b);
    const median = ratios[ratios.length >> 1];
    const widest = Math.max(...rows.map((r) => r.width));
    const soft = rows.filter((r) => r.soft).length / rows.length;
    add('watercolour rim: outer 3 px 1.3× denser than inside, 6 px wide or less, anti-aliased', median >= 1.3 && widest <= 6 && soft >= 0.6, { median: round(median, 2), widest, soft: round(soft, 2) });
  }
  return checks;
}
