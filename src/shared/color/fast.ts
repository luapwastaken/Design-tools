// Colour, fast: Oklab to sRGB with plain matrices, for what runs per pixel or per solve (the planes,
// the strips, the value lock's edge). About 0.15 µs a colour where culori takes several. The answers
// agree with index.ts to far below one 8-bit step; those functions stay the truth for the app's colours.

/** the Rec. 709 luma weights, in one place so the measure can change (value.ts re-exports them) */
export const LUMA = [0.2126, 0.7152, 0.0722] as const;

const EPS = 1e-6;
const scratch = new Float64Array(3);

/** linear-light sRGB of the Oklab colour (L, a, b) into a shared array, unclamped: use it before the next call */
export function lrgb(l: number, a: number, b: number): Float64Array {
  const p = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const q = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const r = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  scratch[0] = 4.0767416621 * p - 3.3077115913 * q + 0.2309699292 * r;
  scratch[1] = -1.2684380046 * p + 2.6097574011 * q - 0.3413193965 * r;
  scratch[2] = -0.0041960863 * p - 0.7034186147 * q + 1.707614701 * r;
  return scratch;
}

export const inSrgb = (v: Float64Array) => v[0] >= -EPS && v[0] <= 1 + EPS && v[1] >= -EPS && v[1] <= 1 + EPS && v[2] >= -EPS && v[2] <= 1 + EPS;

/** the same colour in Display P3 (linear sRGB through the matrix), and whether P3 holds it */
export function inP3(v: Float64Array) {
  const r = 0.8224621 * v[0] + 0.177538 * v[1];
  const g = 0.0331941 * v[0] + 0.9668058 * v[1];
  const b = 0.0170827 * v[0] + 0.0723974 * v[1] + 0.9105199 * v[2];
  return r >= -EPS && r <= 1 + EPS && g >= -EPS && g <= 1 + EPS && b >= -EPS && b <= 1 + EPS;
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const encode = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
/** 8-bit sRGB for a linear value, by table: the pixels' gamma */
const LUT = new Uint8Array(8193).map((_, i) => Math.round(encode(i / 8192) * 255));
export const to8 = (x: number) => LUT[Math.round(clamp01(x) * 8192)];

/** Rec. 709 luma of the gamma-encoded, clipped colour: the value (value.ts) of what is in gamut */
export const lumaOf = (v: Float64Array) => LUMA[0] * encode(clamp01(v[0])) + LUMA[1] * encode(clamp01(v[1])) + LUMA[2] * encode(clamp01(v[2]));

/** the chroma where the sRGB or P3 edge crosses this L and hue (its cos and sin), by bisection */
export function edgeChroma(l: number, ca: number, sa: number, p3: boolean): number {
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 14; i++) {
    const m = (lo + hi) / 2;
    const v = lrgb(l, m * ca, m * sa);
    if (p3 ? inP3(v) : inSrgb(v)) lo = m;
    else hi = m;
  }
  return lo;
}

/** how close to the target a solve must land to count as having reached it */
export const REACHED = 1e-4;

/** The L at chroma `c` (hue cos and sin) whose value is `target`, by secant steps from `guess`: value rises with L. */
export function solveL(target: number, c: number, ca: number, sa: number, guess: number): number {
  const at = (l: number) => lumaOf(lrgb(l, c * ca, c * sa)) - target;
  let [x0, f0] = [guess, at(guess)];
  let x1 = clamp01(guess + (f0 > 0 ? -0.02 : 0.02));
  for (let i = 0; i < 12 && Math.abs(f0) > 1e-5; i++) {
    const f1 = at(x1);
    if (Math.abs(f1) <= 1e-5) return x1;
    const slope = (f1 - f0) / (x1 - x0);
    [x0, f0] = [x1, f1];
    x1 = clamp01(x1 - (slope > 0.05 ? f1 / slope : f1 * 2)); // a flat step is a bad guess
  }
  return Math.abs(f0) <= 1e-5 ? x0 : x1;
}

/** a solved colour is usable if it is inside sRGB and the solve reached the value (near the edge a clipped channel flattens it) */
export function holds(target: number, l: number, c: number, ca: number, sa: number): boolean {
  const v = lrgb(l, c * ca, c * sa);
  return inSrgb(v) && Math.abs(lumaOf(v) - target) < REACHED;
}

/**
 * The most chroma any colour at this value and hue has inside sRGB, and the L it has there. The
 * colours at one value form one run of chroma out from the grey, so bisection finds its end.
 */
export function heldEdge(target: number, h: number): { c: number; l: number } {
  const [ca, sa] = [Math.cos((h * Math.PI) / 180), Math.sin((h * Math.PI) / 180)];
  let lo = 0;
  let hi = 0.5;
  let lLo = solveL(target, 0, ca, sa, target ** 0.73);
  for (let i = 0; i < 16; i++) {
    const m = (lo + hi) / 2;
    const l = solveL(target, m, ca, sa, lLo);
    if (holds(target, l, m, ca, sa)) [lo, lLo] = [m, l];
    else hi = m;
  }
  return { c: lo, l: lLo };
}
