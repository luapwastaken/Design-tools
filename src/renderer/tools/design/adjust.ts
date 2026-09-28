// Colour moves the checks' one-click fixes and the inspector make. All maths through shared/color.
import { deltaE, inSrgb, simulateCvd, type Cvd, type Oklch } from '../../../shared/color/index.ts';
import { fitChroma } from '../../../shared/palette/space.ts';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** L and hue exact; chroma cut only when the swatch was an sRGB colour to begin with (a P3 one stays wide) */
const withL = (o: Oklch, l: number): Oklch => (inSrgb(o) ? fitChroma([l, o[1], o[2]]) : [l, o[1], o[2]]);

/**
 * `list` spaced `gap` apart in lightness, keeping the order their lightness has now (returned in
 * `list`'s order). Of three placements (around where they sit, the lightest staying put, the darkest
 * staying put), the one furthest from the palette's other lightnesses (`others`), so a fix doesn't
 * make the next problem. `ok` rules placements out, such as one that breaks a passing contrast pair.
 */
export function spreadLs(list: Oklch[], gap: number, others: number[] = [], ok: (next: Oklch[]) => boolean = () => true): Oklch[] {
  const order = list.map((_, i) => i).sort((i, j) => list[i][0] - list[j][0] || list[i][2] - list[j][2]);
  const span = (list.length - 1) * gap;
  const fit = (start: number) => Math.min(Math.max(start, 0), Math.max(0, 1 - span));
  const place = (start: number): Oklch[] => {
    const out = [...list];
    order.forEach((i, k) => (out[i] = withL(list[i], start + k * gap)));
    return out;
  };
  const clearance = (start: number) => Math.min(...others.flatMap((o) => order.map((_, k) => Math.abs(o - start - k * gap))));
  const around = order.reduce((sum, i, k) => sum + list[i][0] - k * gap, 0) / list.length;
  const starts = [fit(around), fit(list[order.at(-1)!][0] - span), fit(list[order[0]][0])];
  const allowed = starts.filter((s) => ok(place(s)));
  return place((allowed.length ? allowed : starts).reduce((x, y) => (clearance(y) > clearance(x) + 1e-6 ? y : x)));
}

/** Two swatches `gap` apart in lightness, the lighter one staying lighter. */
export const spreadL = (a: Oklch, b: Oklch, gap: number, others: number[] = []): [Oklch, Oklch] => spreadLs([a, b], gap, others) as [Oklch, Oklch];

/** Value collision: swatches that read as one grey, spaced just past the flag threshold (L 0..1). */
export const valueFix = (list: Oklch[], minGap: number, others: number[], ok?: (next: Oklch[]) => boolean): Oklch[] =>
  spreadLs(list, Math.min(1 / Math.max(1, list.length - 1), minGap + 0.005), others, ok);

/** Colour vision: the smallest lightness spread that parts the pair under this simulation, or null. */
export function cvdFix(a: Oklch, b: Oklch, kind: Cvd, minE: number, others: number[]): [Oklch, Oklch] | null {
  for (let gap = Math.abs(a[0] - b[0]) + 0.01; gap <= 1; gap += 0.01) {
    const [x, y] = spreadL(a, b, gap, others);
    if (deltaE(simulateCvd(x, kind), simulateCvd(y, kind)) >= minE) return [x, y];
  }
  return null;
}

/** where a new swatch goes in lightness: the middle of the widest gap the palette leaves */
export function nextL(ls: number[]): number {
  const stops = [0.12, ...ls.map(clamp01).sort((x, y) => x - y), 0.96];
  let best = 0.6;
  let width = -1;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i] - stops[i - 1] > width) {
      width = stops[i] - stops[i - 1];
      best = (stops[i] + stops[i - 1]) / 2;
    }
  }
  return best;
}

export const TINT_LS = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95];

/** the same hue down the lightness scale at exactly these lightnesses, chroma held where sRGB allows */
export const tints = ([, c, h]: Oklch): Oklch[] => TINT_LS.map((l) => fitChroma([l, c, h]));
