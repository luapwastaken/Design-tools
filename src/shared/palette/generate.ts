// Seeded palettes from a style preset: a lightness range and a chroma shape (spec §6.2). Lightness
// is spread before anything else, so a generated palette passes the value check (v1's never did).
import type { Oklch } from '../color/index.ts';
import { random } from './random.ts';
import { fitChroma, wrapHue } from './space.ts';

export type Preset = { id: string; label: string; describe: string };

type Shape = Preset & {
  l: [number, number];
  /** chroma at the ends of the lightness range and in its middle */
  c: [ends: number, mid: number];
  /** where the base hue is drawn from; null = anywhere, or the most colourful locked swatch */
  hues: [number, number] | null;
  /** hue step per colour, darkest first, and random wander either side */
  step: number;
  wander: number;
  /** one strong colour, at the free lightness nearest `at` */
  accent?: { at: number; c: number; hues: [number, number] };
};

const SHAPES: Shape[] = [
  { id: 'quiet', label: 'Quiet', describe: 'Soft, low chroma neutrals with a hint of colour.', l: [0.3, 0.96], c: [0.012, 0.05], hues: null, step: 0, wander: 60 },
  { id: 'bold', label: 'Bold', describe: 'Saturated mid tones, hues spread round the wheel.', l: [0.22, 0.95], c: [0.05, 0.19], hues: null, step: 137.5, wander: 20 },
  { id: 'warm', label: 'Warm', describe: 'Reds, oranges and ochres over warm darks and creams.', l: [0.22, 0.95], c: [0.03, 0.14], hues: [20, 80], step: 0, wander: 40 },
  { id: 'cool', label: 'Cool', describe: 'Blues, teals and violets over cool greys.', l: [0.2, 0.95], c: [0.03, 0.12], hues: [190, 270], step: 0, wander: 50 },
  { id: 'editorial', label: 'Editorial', describe: 'Paper and ink neutrals with one red accent.', l: [0.16, 0.97], c: [0.008, 0.02], hues: [60, 90], step: 0, wander: 10, accent: { at: 0.52, c: 0.17, hues: [20, 40] } },
  { id: 'tech', label: 'Tech', describe: 'Dark cool greys with one electric accent.', l: [0.14, 0.93], c: [0.012, 0.035], hues: [235, 265], step: 0, wander: 10, accent: { at: 0.78, c: 0.2, hues: [140, 200] } },
];

export const PRESETS: Preset[] = SHAPES.map(({ id, label, describe }) => ({ id, label, describe }));

/** two lightnesses closer than this read as one grey; the value check flags 0.06, this keeps a margin */
const MIN_GAP = 0.07;

/**
 * `count` colours; a non-null `locked[i]` stays at slot i unchanged and the others spread around
 * it. Free slots run dark to light. The same options always give the same palette.
 */
export function generate(opts: { seed: number; count: number; preset: string; locked: (Oklch | null)[] }): Oklch[] {
  const shape = SHAPES.find((s) => s.id === opts.preset) ?? SHAPES[0];
  const rnd = random(opts.seed);
  const slots = Array.from({ length: Math.max(0, Math.floor(opts.count)) }, (_, i) => opts.locked[i] ?? null);
  const free = slots.flatMap((o, i) => (o ? [] : [i]));
  const taken = slots.filter((o): o is Oklch => !!o);
  const range = rangeFor(shape.l, slots.length);
  const ls = spreadLightness(taken.map((o) => o[0]), free.length, range, rnd);
  const base = baseHue(shape, taken, rnd);
  const [lo, hi] = range;
  const at = shape.accent?.at ?? NaN;
  const accent = shape.accent ? ls.reduce((best, l, j) => (Math.abs(l - at) < Math.abs(ls[best] - at) ? j : best), 0) : -1;
  const made = ls.map((l, j): Oklch => {
    if (j === accent) return fitChroma([l, shape.accent!.c * (0.85 + 0.3 * rnd()), between(shape.accent!.hues, rnd())]);
    const t = Math.min(1, Math.max(0, (l - lo) / (hi - lo)));
    const c = (shape.c[0] + (shape.c[1] - shape.c[0]) * Math.sin(Math.PI * t)) * (0.75 + 0.5 * rnd());
    return fitChroma([l, c, wrapHue(base + j * shape.step + (rnd() - 0.5) * shape.wander)]);
  });
  free.forEach((slot, j) => (slots[slot] = made[j]));
  return slots as Oklch[];
}

const between = ([a, b]: [number, number], t: number) => a + (b - a) * t;

/** a preset's lightness range, widened as far as `n` colours need to stand MIN_GAP apart (Quiet at 12) */
function rangeFor([lo, hi]: [number, number], n: number): [number, number] {
  const short = (n - 1) * MIN_GAP - (hi - lo);
  if (short <= 0) return [lo, hi];
  const down = Math.min(lo - 0.02, Math.max(short / 2, short - (0.99 - hi)));
  return [lo - down, Math.min(0.99, hi + short - down)];
}

function baseHue(shape: Shape, taken: Oklch[], rnd: () => number): number {
  if (shape.hues) return between(shape.hues, rnd());
  const lead = taken.reduce<Oklch | null>((best, o) => (o[1] > 0.03 && o[1] > (best?.[1] ?? 0) ? o : best), null);
  return lead ? lead[2] : rnd() * 360;
}

/**
 * `m` lightnesses in `range`, as far apart from each other and from `taken` as the gaps allow:
 * each point goes to the gap where it leaves the widest spacing, then all are jittered by what
 * spacing there is to spare above MIN_GAP. Sorted, darkest first.
 */
function spreadLightness(taken: number[], m: number, range: [number, number], rnd: () => number): number[] {
  const fixed = [...taken].sort((a, b) => a - b);
  const edges = [Math.min(range[0], fixed[0] ?? 1), ...fixed, Math.max(range[1], fixed.at(-1) ?? 0)];
  // points keep their distance from a locked lightness, but may sit right on a range end
  const gaps = edges.slice(1).map((b, i) => {
    const [wallA, wallB] = [i === 0, i === edges.length - 2];
    return { a: edges[i], b, wallA, ends: (wallA ? 0 : 1) + (wallB ? 0 : 1), n: 0 };
  });
  type Gap = (typeof gaps)[number];
  const spacing = (g: Gap, n: number) => (n + g.ends - 1 > 0 ? (g.b - g.a) / (n + g.ends - 1) : Infinity);
  for (let k = 0; k < m; k++) gaps.reduce((x, g) => (spacing(g, g.n + 1) > spacing(x, x.n + 1) ? g : x)).n++;
  const used = gaps.filter((g) => g.n);
  const min = Math.min(...used.map((g) => spacing(g, g.n)));
  const jitter = Number.isFinite(min) ? Math.max(0, (min - MIN_GAP) / 2) : (edges[1] - edges[0]) / 4;
  return used
    .flatMap((g) => {
      const s = spacing(g, g.n);
      if (!Number.isFinite(s)) return [(g.a + g.b) / 2]; // a lone point with no neighbours
      const start = g.wallA ? g.a : g.a + s;
      return Array.from({ length: g.n }, (_, i) => start + i * s);
    })
    .map((l) => Math.min(0.99, Math.max(0.02, l + (rnd() * 2 - 1) * jitter)))
    .sort((a, b) => a - b);
}
