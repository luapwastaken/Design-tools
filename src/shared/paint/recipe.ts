// "How do I mix this?" (spec 2026-09-29 §3.3): km.ts run backwards. Every owned paint alone, in
// pairs and in threes, at whole parts up to 6 (what you can measure out with a brush); a pale tint
// is a little colour in a lot of white, so the white goes up a ladder to 128 parts. The closest
// mixes come back, closest first.
import { deltaE, type Oklch } from '../color/index.ts';
import { toOklab } from '../palette/space.ts';
import { BANDS, colourOf, mixCurves, paintOf, type Paint } from './km.ts';
import type { Pigment } from './pigments.ts';

export type Recipe = { parts: { pigment: Pigment; parts: number }[]; result: Oklch; deltaE: number };

const MAX_PARTS = 6;
const PARTS = [1, 2, 3, 4, 5, 6];
/** the white's parts: a mid grey is about 10 of Titanium White to 1 of Lamp Black, a pale blue 30 to 1 of Ultramarine */
const LADDER = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 50, 64, 80, 100, 128];
/** a paint this light and grey is the white tints go into */
const WHITE_L = 0.9;
const WHITE_C = 0.04;
/** a recipe with more paints is only listed when it beats its simpler versions by more than this ΔE */
const SIMPLER = 1;
/** near a tie, fewer parts in all wins: 1 + 1 beats 5 + 6 (OKLab × 100 per part; the white's count up to 6) */
const PER_PART = 0.03;
/** threes are first tried at a few parts each; this many of the closest are then refined */
const REFINE = 12;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** every list with one value from each of `lists` */
const product = (lists: number[][]): number[][] => lists.reduce<number[][]>((out, l) => out.flatMap((r) => l.map((v) => [...r, v])), [[]]);
/** each ratio once (2:2 is 1:1) */
const ratios = (lists: number[][]) => product(lists).filter((r) => r.reduce(gcd) === 1);

type Found = { set: number[]; parts: number[]; score: number };

export function recipes(target: Oklch, owned: Pigment[], opts: { maxPigments: 1 | 2 | 3; count: number }): Recipe[] {
  const paints = owned.map(paintOf);
  const goal = toOklab(target);
  const lightest = owned.reduce((best, p, i) => (best < 0 || p.oklch[0] > owned[best].oklch[0] ? i : best), -1);
  const white = lightest >= 0 && owned[lightest].oklch[0] >= WHITE_L && owned[lightest].oklch[1] < WHITE_C ? lightest : -1;
  const levels = (set: number[]) => set.map((p) => (p === white ? LADDER : PARTS));
  const coarse = (set: number[]) => set.map((p) => (p === white ? [1, 3, 6, 12, 24, 50, 100] : [1, 3, 6]));

  const mixed: Paint = { K: new Float64Array(BANDS), S: new Float64Array(BANDS) };
  // the hot loop: K/S is a ratio, so the parts go in unnormalised and nothing is allocated
  const score = (set: number[], parts: number[]) => {
    let total = 0;
    for (let j = 0; j < set.length; j++) {
      const { K, S } = paints[set[j]];
      const a = parts[j];
      total += Math.min(a, MAX_PARTS);
      for (let i = 0; i < BANDS; i++) {
        mixed.K[i] = (j ? mixed.K[i] : 0) + a * K[i];
        mixed.S[i] = (j ? mixed.S[i] : 0) + a * S[i];
      }
    }
    const [l, a, b] = toOklab(colourOf(mixed));
    return Math.hypot(l - goal[0], a - goal[1], b - goal[2]) * 100 + PER_PART * total;
  };
  const bestOf = (set: number[], tries: number[][]) =>
    tries.reduce<Found>(
      (f, parts) => {
        const s = score(set, parts);
        return s < f.score ? { set, parts, score: s } : f;
      },
      { set, parts: [], score: Infinity },
    );

  const n = paints.length;
  const found: Found[] = [];
  const threes: Found[] = [];
  for (let i = 0; i < n; i++) {
    found.push(bestOf([i], [[1]]));
    for (let j = i + 1; j < n && opts.maxPigments >= 2; j++) {
      found.push(bestOf([i, j], ratios(levels([i, j]))));
      for (let k = j + 1; k < n && opts.maxPigments >= 3; k++) threes.push(bestOf([i, j, k], ratios(coarse([i, j, k]))));
    }
  }
  threes.sort((a, b) => a.score - b.score);
  found.push(...threes.slice(0, REFINE).map((f) => climb(f, levels(f.set), (parts) => score(f.set, parts))), ...threes.slice(REFINE));

  const all = found.map(({ set, parts }) => {
    const result = colourOf(mixCurves(set.map((p, j) => ({ paint: paints[p], amount: parts[j] }))));
    const list = set.map((p, j) => ({ pigment: owned[p], parts: parts[j] })).sort((a, b) => b.parts - a.parts);
    return { set, recipe: { parts: list, result, deltaE: deltaE(target, result) } };
  });
  const simplerWins = (x: (typeof all)[number]) =>
    all.some((y) => y.set.length < x.set.length && y.set.every((p) => x.set.includes(p)) && y.recipe.deltaE <= x.recipe.deltaE + SIMPLER);
  return all
    .filter((x) => !simplerWins(x))
    .map((x) => x.recipe)
    .sort((a, b) => a.deltaE - b.deltaE)
    .slice(0, Math.max(0, opts.count));
}

/** Greedy descent, one rung up or down each paint's own list of parts at a time. */
function climb(start: Found, levels: number[][], score: (parts: number[]) => number): Found {
  const moves = product(start.parts.map(() => [-1, 0, 1])).filter((m) => m.some((v) => v));
  let at = start;
  let rungs = start.parts.map((p, i) => levels[i].indexOf(p));
  for (let moved = true; moved; ) {
    moved = false;
    const from = rungs;
    for (const move of moves) {
      const next = from.map((r, i) => r + move[i]);
      if (next.some((r, i) => r < 0 || r >= levels[i].length)) continue;
      const parts = next.map((r, i) => levels[i][r]);
      if (parts.reduce(gcd) !== 1) continue;
      const s = score(parts);
      if (s < at.score) [at, rungs, moved] = [{ set: at.set, parts, score: s }, next, true];
    }
  }
  return at;
}
