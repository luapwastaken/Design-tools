// Synthetic wordmarks for the type-metrics tests: a small geometric alphabet (no one's lettering),
// set as polygons in em units, y up from the baseline. Drawn two ways from the same outlines: an
// antialiased RGBA raster, as the renderer would draw it, and SVG paths for the in-app checks.

export type Pt = [number, number];
/** one filled shape: its outlines, even-odd, so a ring has its hole */
export type Prim = Pt[][];

export const CAP = 0.7;
export const XH = 0.5;
export const ASC = 0.74;
export const DESC = -0.22;
/** how far round letters overshoot the lines */
export const OVER = 0.012;
const T = 0.09;

const rect = (x0: number, y0: number, x1: number, y1: number): Prim => [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];
const quad = (...p: Pt[]): Prim => [p];

/** an elliptical ring t thick, the whole way round or from a0 to a1 (radians, anticlockwise from +x) */
function ring(cx: number, cy: number, rx: number, ry: number, t: number, a0 = 0, a1 = 2 * Math.PI): Prim {
  const n = 96;
  const arc = (r: number, s: number, from: number, to: number): Pt[] =>
    Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n).map((a) => [cx + (rx - r) * Math.cos(a), cy + (ry - s) * Math.sin(a)]);
  const whole = a1 - a0 >= 2 * Math.PI - 1e-9;
  if (whole) return [arc(0, 0, 0, 2 * Math.PI), arc(t, t, 0, 2 * Math.PI)];
  return [[...arc(0, 0, a0, a1), ...arc(t, t, a1, a0)]];
}

/** a stroke t thick from p to q, square ends */
function stroke(p: Pt, q: Pt, t: number): Prim {
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
  const nx = (-(q[1] - p[1]) / len) * (t / 2);
  const ny = ((q[0] - p[0]) / len) * (t / 2);
  return [[[p[0] + nx, p[1] + ny], [q[0] + nx, q[1] + ny], [q[0] - nx, q[1] - ny], [p[0] - nx, p[1] - ny]]];
}

const half = XH / 2;

type Glyph = { adv: number; prims: Prim[] };

const O = OVER;
const PI = Math.PI;
const A_PRIMS: Prim[] = [quad([0.27, CAP], [0.37, CAP], [0.12, 0], [0.02, 0]), quad([0.27, CAP], [0.37, CAP], [0.62, 0], [0.52, 0]), rect(0.14, 0.2, 0.5, 0.28)];
const GLYPHS: Record<string, Glyph> = {
  A: { adv: 0.64, prims: A_PRIMS },
  // A with its ring resting on the apex and joined to it, as many faces draw it
  Å: { adv: 0.64, prims: [...A_PRIMS, ring(0.32, CAP + 0.095, 0.1, 0.1, 0.035)] },
  H: { adv: 0.64, prims: [rect(0.06, 0, 0.15, CAP), rect(0.49, 0, 0.58, CAP), rect(0.06, 0.305, 0.58, 0.395)] },
  E: { adv: 0.58, prims: [rect(0.06, 0, 0.15, CAP), rect(0.06, CAP - T, 0.5, CAP), rect(0.06, 0.305, 0.45, 0.395), rect(0.06, 0, 0.52, T)] },
  L: { adv: 0.55, prims: [rect(0.06, 0, 0.15, CAP), rect(0.06, 0, 0.5, T)] },
  T: { adv: 0.6, prims: [rect(0.02, CAP - T, 0.58, CAP), rect(0.255, 0, 0.345, CAP)] },
  I: { adv: 0.21, prims: [rect(0.06, 0, 0.15, CAP)] },
  O: { adv: 0.76, prims: [ring(0.38, CAP / 2, 0.33, CAP / 2 + O, T)] },
  Q: { adv: 0.78, prims: [ring(0.38, CAP / 2, 0.33, CAP / 2 + O, T), quad([0.52, 0.2], [0.62, 0.2], [0.74, -0.13], [0.64, -0.13])] },
  M: {
    adv: 0.78,
    prims: [rect(0.06, 0, 0.15, CAP), rect(0.63, 0, 0.72, CAP), quad([0.06, CAP], [0.16, CAP], [0.44, 0.2], [0.34, 0.2]), quad([0.72, CAP], [0.62, CAP], [0.34, 0.2], [0.44, 0.2])],
  },
  // E with an acute accent standing clear above it
  É: {
    adv: 0.58,
    prims: [rect(0.06, 0, 0.15, CAP), rect(0.06, CAP - T, 0.5, CAP), rect(0.06, 0.305, 0.45, 0.395), rect(0.06, 0, 0.52, T), quad([0.22, 0.77], [0.32, 0.77], [0.44, 0.87], [0.34, 0.87])],
  },
  o: { adv: 0.6, prims: [ring(0.3, half, 0.25, half + O, T)] },
  e: { adv: 0.6, prims: [ring(0.3, half, 0.25, half + O, T, -0.05, 2 * PI - 0.75), rect(0.05, 0.22, 0.55, 0.29)] },
  c: { adv: 0.58, prims: [ring(0.3, half, 0.25, half + O, T, 0.6, 2 * PI - 0.6)] },
  a: { adv: 0.56, prims: [ring(0.27, half, 0.22, half + O, T), rect(0.4, 0, 0.49, XH)] },
  d: { adv: 0.56, prims: [ring(0.27, half, 0.22, half + O, T), rect(0.4, 0, 0.49, ASC)] },
  n: { adv: 0.58, prims: [rect(0.06, 0, 0.15, XH), rect(0.41, 0, 0.5, 0.3), ring(0.28, 0.3, 0.22, 0.2 + O, T, 0, PI)] },
  h: { adv: 0.58, prims: [rect(0.06, 0, 0.15, ASC), rect(0.41, 0, 0.5, 0.3), ring(0.28, 0.3, 0.22, 0.2 + O, T, 0, PI)] },
  m: {
    adv: 0.88,
    prims: [rect(0.06, 0, 0.15, XH), rect(0.39, 0, 0.48, 0.3), rect(0.72, 0, 0.81, 0.3), ring(0.27, 0.3, 0.21, 0.2 + O, T, 0, PI), ring(0.6, 0.3, 0.21, 0.2 + O, T, 0, PI)],
  },
  r: { adv: 0.42, prims: [rect(0.06, 0, 0.15, XH), ring(0.3, 0.3, 0.2, 0.2 + O, T, 1.0, PI)] },
  l: { adv: 0.21, prims: [rect(0.06, 0, 0.15, ASC)] },
  i: { adv: 0.21, prims: [rect(0.06, 0, 0.15, XH), rect(0.06, 0.6, 0.15, 0.69)] },
  t: { adv: 0.38, prims: [rect(0.12, 0, 0.21, 0.64), rect(0.02, 0.41, 0.34, XH)] },
  p: { adv: 0.62, prims: [rect(0.06, DESC, 0.15, XH), ring(0.33, half, 0.24, half + O, T)] },
  y: { adv: 0.58, prims: [quad([0.02, XH], [0.12, XH], [0.33, 0], [0.23, 0]), quad([0.46, XH], [0.56, XH], [0.16, DESC], [0.06, DESC])] },
  g: { adv: 0.62, prims: [ring(0.29, half, 0.24, half + O, T), rect(0.44, -0.1, 0.53, XH), ring(0.29, -0.1, 0.24, 0.12 + O, T, PI, 2 * PI)] },
  '.': { adv: 0.21, prims: [rect(0.06, 0, 0.15, T)] },
  ' ': { adv: 0.3, prims: [] },
};

/** where to set a run of letters */
export type Setting = { size?: number; dx?: number; dy?: number; tracking?: number; slant?: number; bounce?: number[] };

/** the letters' outlines set in a row; `size` in em, `bounce` moves each letter up (em) */
export function set(text: string, { size = 1, dx = 0, dy = 0, tracking = 0, slant = 0, bounce = [] }: Setting = {}): { prims: Prim[]; width: number } {
  const prims: Prim[] = [];
  let x = dx;
  [...text].forEach((ch, i) => {
    const g = GLYPHS[ch];
    if (!g) throw new Error(`no glyph for ${ch}`);
    const up = dy + (bounce[i] ?? 0);
    for (const p of g.prims) prims.push(p.map((path) => path.map(([px, py]): Pt => [x + px * size + slant * (py * size + up), py * size + up])));
    x += (g.adv + tracking) * size;
  });
  return { prims, width: x - dx };
}

/** a trademark sign: a small T and M at cap height after the letters */
export const trademark = (at: number): Prim[] => set('TM', { size: 0.28, dx: at + 0.04, dy: CAP - 0.28 * CAP }).prims;

/** a trademark sign as most faces set it: T and M over half the cap height, hung from the cap line */
export const bigTrademark = (at: number, size = 0.56): Prim[] => set('TM', { size, dx: at + 0.04, dy: CAP - size * CAP }).prims;

/** a registered sign hung from the cap line: an E in a ring */
export function registered(at: number, size = 0.62): Prim[] {
  const r = (size * CAP) / 2;
  const [cx, cy] = [at + 0.05 + r, CAP - r];
  const e = 0.6 * size;
  return [ring(cx, cy, r, r, 0.035), ...set('E', { size: e, dx: cx - 0.29 * e, dy: cy - 0.35 * e }).prims];
}

/** a joined script: one looping stroke (a prolate cycloid) with a dot over it, slanted */
export function script(dx = 0): Prim[] {
  const prims: Prim[] = [];
  const pts: Pt[] = [];
  for (let i = 0; i <= 480; i++) {
    const a = (i / 480) * 7 * 2 * PI;
    // loops of varying height, one dipping below the line like a descender
    const tall = 0.32 + 0.12 * Math.sin(a / 3);
    const dip = Math.abs(a - 4.5 * 2 * PI) < PI ? -0.28 * Math.cos((a - 4.5 * 2 * PI) / 2) ** 2 : 0;
    const y = tall - tall * Math.cos(a) + dip;
    pts.push([dx + 0.06 * a - 0.16 * Math.sin(a) + 0.25 * y, y]);
  }
  for (let i = 1; i < pts.length; i++) prims.push(stroke(pts[i - 1], pts[i], 0.06));
  prims.push(ring(dx + 2.4, 0.95, 0.04, 0.04, 0.04));
  return prims;
}

/** a separate swash capital that dips below the line, as scripts often have */
export const swashCapital = (dx = 0): Prim[] => [ring(dx + 0.35, 0.42, 0.34, 0.52, 0.08, 0.4, 2 * PI - 0.2)];

/** a rectangle outline round everything, as a boxed wordmark has */
export function frame(x0: number, y0: number, x1: number, y1: number, t = 0.05): Prim[] {
  return [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1]], [[x0 + t, y0 + t], [x1 - t, y0 + t], [x1 - t, y1 - t], [x0 + t, y1 - t]]]];
}

function bounds(prims: Prim[]) {
  const all = prims.flat(2);
  return { x0: Math.min(...all.map((p) => p[0])), x1: Math.max(...all.map((p) => p[0])), y0: Math.min(...all.map((p) => p[1])), y1: Math.max(...all.map((p) => p[1])) };
}

/**
 * The outlines drawn antialiased (4 × 4 samples a pixel) at `perEm` px per em, cropped to the ink
 * as the renderer crops to the artwork box. `row(y)` is the px edge of an em height.
 */
export function raster(prims: Prim[], perEm: number): { rgba: Uint8ClampedArray; w: number; h: number; row: (y: number) => number } {
  const b = bounds(prims);
  const w = Math.ceil((b.x1 - b.x0) * perEm);
  const h = Math.ceil((b.y1 - b.y0) * perEm);
  const SS = 4;
  const count = new Uint8Array(w * h);
  const line = new Uint8Array(w * SS);
  for (let sy = 0; sy < h * SS; sy++) {
    const y = b.y1 - (sy + 0.5) / SS / perEm;
    line.fill(0);
    for (const prim of prims) {
      const xs: number[] = [];
      for (const path of prim) {
        for (let i = 0; i < path.length; i++) {
          const [ax, ay] = path[i];
          const [bx, by] = path[(i + 1) % path.length];
          if (ay <= y !== by <= y) xs.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const from = Math.max(0, Math.ceil((xs[i] - b.x0) * perEm * SS - 0.5));
        const to = Math.min(w * SS - 1, Math.floor((xs[i + 1] - b.x0) * perEm * SS - 0.5));
        for (let sx = from; sx <= to; sx++) line[sx] = 1;
      }
    }
    const py = Math.floor(sy / SS);
    for (let sx = 0; sx < w * SS; sx++) if (line[sx]) count[py * w + Math.floor(sx / SS)]++;
  }
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba[i * 4 + 3] = Math.round((count[i] / (SS * SS)) * 255);
  return { rgba, w, h, row: (y: number) => (b.y1 - y) * perEm };
}

/** the outlines as an SVG of paths (y flipped), `pad` em of empty artboard round them */
export function svgOf(prims: Prim[], pad = 0): string {
  const b = bounds(prims);
  const f = (n: number) => +n.toFixed(4);
  const d = prims.map((prim) => prim.map((path) => `M${path.map(([x, y]) => `${f(x)} ${f(-y)}`).join('L')}Z`).join(''));
  const box = [b.x0 - pad, -b.y1 - pad, b.x1 - b.x0 + 2 * pad, b.y1 - b.y0 + 2 * pad].map(f).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${d.map((p) => `<path fill-rule="evenodd" d="${p}"/>`).join('')}</svg>`;
}
