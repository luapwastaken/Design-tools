// Colour moves the checks' one-click fixes make, shared by the colour tools. All maths through shared/color.
// Fixes move VALUE (the grey a colour becomes, shared/color/value.ts), the one measure the value
// lock, the greyscale view and the checks all use: hue stays, chroma gives way where it must.
import { deltaE, inSrgb, simulateCvd, type Cvd, type Oklch } from '../../../shared/color/index.ts';
import { holdValue, valueOf } from '../../../shared/color/value.ts';

/** `o`'s hue and chroma at value `v`; chroma only gives way at the sRGB edge, and never for a swatch already wider than sRGB (it stays wide) */
function withV(o: Oklch, v: number): Oklch {
  if (inSrgb(o)) return holdValue(v, o[1], o[2]);
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (valueOf([mid, o[1], o[2]]) < v) lo = mid;
    else hi = mid;
  }
  return [(lo + hi) / 2, o[1], o[2]];
}

/**
 * `list` spaced `gap` apart in value (0..1), keeping the order their value has now (returned in
 * `list`'s order). Of three placements (around where they sit, the lightest staying put, the darkest
 * staying put), the one furthest from the palette's other values (`others`), so a fix doesn't
 * make the next problem. `ok` rules placements out, such as one that breaks a passing contrast pair.
 */
export function spreadVs(list: Oklch[], gap: number, others: number[] = [], ok: (next: Oklch[]) => boolean = () => true): Oklch[] {
  const vs = list.map(valueOf);
  const order = list.map((_, i) => i).sort((i, j) => vs[i] - vs[j] || list[i][2] - list[j][2]);
  const span = (list.length - 1) * gap;
  const fit = (start: number) => Math.min(Math.max(start, 0), Math.max(0, 1 - span));
  const place = (start: number): Oklch[] => {
    const out = [...list];
    order.forEach((i, k) => (out[i] = withV(list[i], start + k * gap)));
    return out;
  };
  const clearance = (start: number) => Math.min(...others.flatMap((o) => order.map((_, k) => Math.abs(o - start - k * gap))));
  const around = order.reduce((sum, i, k) => sum + vs[i] - k * gap, 0) / list.length;
  const starts = [fit(around), fit(vs[order.at(-1)!] - span), fit(vs[order[0]])];
  const allowed = starts.filter((s) => ok(place(s)));
  return place((allowed.length ? allowed : starts).reduce((x, y) => (clearance(y) > clearance(x) + 1e-6 ? y : x)));
}

/** Two swatches `gap` apart in value, the lighter one staying lighter. */
export const spreadV = (a: Oklch, b: Oklch, gap: number, others: number[] = []): [Oklch, Oklch] => spreadVs([a, b], gap, others) as [Oklch, Oklch];

/** Value collision: swatches that read as one grey, spaced just past the flag threshold (value 0..1). */
export const valueFix = (list: Oklch[], minGap: number, others: number[], ok?: (next: Oklch[]) => boolean): Oklch[] =>
  spreadVs(list, Math.min(1 / Math.max(1, list.length - 1), minGap + 0.005), others, ok);

/** Colour vision: the smallest value spread that parts the pair under this simulation, or null. */
export function cvdFix(a: Oklch, b: Oklch, kind: Cvd, minE: number, others: number[]): [Oklch, Oklch] | null {
  for (let gap = Math.abs(valueOf(a) - valueOf(b)) + 0.01; gap <= 1; gap += 0.01) {
    const [x, y] = spreadV(a, b, gap, others);
    if (deltaE(simulateCvd(x, kind), simulateCvd(y, kind)) >= minE) return [x, y];
  }
  return null;
}
