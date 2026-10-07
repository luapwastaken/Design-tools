// Seeded palettes from a style preset: a range of greys and a chroma shape (spec §6.2). Value (the
// grey a colour becomes) is spread before anything else, then each colour is solved at its value, so
// a generated palette passes the value check (v1's never did).
import { deltaE, type Oklch } from '../color/index.ts';
import { holdValue, valueOf } from '../color/value.ts';
import { random } from './random.ts';
import { wrapHue } from './space.ts';

export type Preset = { id: string; label: string; describe: string };

type Shape = Preset & {
  /** the greys the palette runs between, as OKLCH lightnesses of a grey (turned to values on use) */
  l: [number, number];
  /** chroma at the ends of the lightness range and in its middle */
  c: [ends: number, mid: number];
  /** where the base hue is drawn from; null = anywhere, or the most colourful locked swatch */
  hues: [number, number] | null;
  /** hue step per colour, darkest first, and random wander either side */
  step: number;
  wander: number;
  /** one strong colour, at the free value nearest the grey of lightness `at` */
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

/** two values closer than this read as one grey; the value check flags 0.06, this keeps a margin */
const MIN_GAP = 0.07;

/** the value of the grey at OKLCH lightness `l` */
const grey = (l: number) => valueOf([l, 0, 0]);

/**
 * `count` colours; a non-null `locked[i]` stays at slot i unchanged and the others spread around
 * it. Free slots run dark to light. The same options always give the same palette. A style with no
 * hues of its own follows the colourful ones among `hues` (the locked colours unless given): each new
 * colour starts from a different one of them, so the set spreads over the palette's hues.
 */
export function generate(opts: { seed: number; count: number; preset: string; locked: (Oklch | null)[]; hues?: Oklch[] }): Oklch[] {
  const shape = SHAPES.find((s) => s.id === opts.preset) ?? SHAPES[0];
  const rnd = random(opts.seed);
  const slots = Array.from({ length: Math.max(0, Math.floor(opts.count)) }, (_, i) => opts.locked[i] ?? null);
  const free = slots.flatMap((o, i) => (o ? [] : [i]));
  const taken = slots.filter((o): o is Oklch => !!o);
  const range = rangeFor([grey(shape.l[0]), grey(shape.l[1])], slots.length);
  const vs = spreadValues(taken.map(valueOf), free.length, range, rnd);
  const base = baseHue(shape, taken, rnd);
  const follow = shape.hues ? [] : colourful(opts.hues ?? taken);
  // a soft style stays soft round a colourful palette, but not so soft that its colours read as grey
  const lift = follow.length ? Math.min(2.5, Math.max(1, Math.min(0.1, follow[0][1] * 0.7) / shape.c[1])) : 1;
  const [lo, hi] = range;
  const at = shape.accent ? grey(shape.accent.at) : NaN;
  const accent = shape.accent ? vs.reduce((best, v, j) => (Math.abs(v - at) < Math.abs(vs[best] - at) ? j : best), 0) : -1;
  const made = vs.map((v, j): Oklch => {
    if (j === accent) return holdValue(v, shape.accent!.c * (0.85 + 0.3 * rnd()), between(shape.accent!.hues, rnd()));
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    const c = (shape.c[0] + (shape.c[1] - shape.c[0]) * Math.sin(Math.PI * t)) * (0.75 + 0.5 * rnd()) * lift;
    const from = follow.length ? follow[(j + Math.floor(rnd() * follow.length)) % follow.length][2] : base;
    return holdValue(v, c, wrapHue(from + j * shape.step + (rnd() - 0.5) * shape.wander));
  });
  apart(made, taken);
  free.forEach((slot, j) => (slots[slot] = made[j]));
  return slots as Oklch[];
}

/** the colours with colour in them, most colourful first, one per 25 degrees of hue */
function colourful(list: Oklch[]): Oklch[] {
  const out: Oklch[] = [];
  for (const o of [...list].filter((x) => x[1] > 0.03).sort((a, b) => b[1] - a[1])) {
    if (out.every((x) => Math.abs(((x[2] - o[2] + 540) % 360) - 180) > 25)) out.push(o);
  }
  return out;
}

/** no two colours (made, or made and kept) that read as the same one: a twin turns its hue and gains chroma at its value */
function apart(made: Oklch[], taken: Oklch[]): void {
  made.forEach((o, i) => {
    for (let tries = 0, now = o; tries < 4 && [...taken, ...made.slice(0, i)].some((x) => deltaE(x, now) < 6); tries++) {
      now = holdValue(valueOf(o), Math.max(now[1], 0.07) * 1.15, wrapHue(now[2] + 55));
      made[i] = now;
    }
  });
}

const between = ([a, b]: [number, number], t: number) => a + (b - a) * t;

/** a preset's value range, widened as far as `n` colours need to stand MIN_GAP apart (Quiet at 12) */
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
 * `m` values in `range`, as far apart from each other and from `taken` as the gaps allow:
 * each point goes to the gap where it leaves the widest spacing, then all are jittered by what
 * spacing there is to spare above MIN_GAP. Sorted, darkest first.
 */
function spreadValues(taken: number[], m: number, range: [number, number], rnd: () => number): number[] {
  const fixed = [...taken].sort((a, b) => a - b);
  const edges = [Math.min(range[0], fixed[0] ?? 1), ...fixed, Math.max(range[1], fixed.at(-1) ?? 0)];
  // points keep their distance from a locked value, but may sit right on a range end
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
    .map((v) => Math.min(0.99, Math.max(0.02, v + (rnd() * 2 - 1) * jitter)))
    .sort((a, b) => a - b);
}
