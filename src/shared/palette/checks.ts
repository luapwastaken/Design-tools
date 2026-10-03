// The palette checks (spec §2): contrast, value, colour vision, print. Pure, so the checks panel,
// the status readout and In context all agree.
import type { Swatch } from '../types.ts';
import {
  cmykEstimate,
  contrast,
  deltaE,
  inP3,
  inSrgb,
  simulateCvd,
  wcagGrade,
  type Cvd,
  type Oklch,
  type WcagGrade,
} from '../color/index.ts';
import { INK_LIBRARIES, nearestInks, type InkMatch } from './inks.ts';
import { isGround, isInk } from './roles.ts';
import { fitChroma } from './space.ts';

// ── contrast ─────────────────────────────────────────────────────────────────────────────────────

export type ContrastFix = { swatchId: string; oklch: Oklch; ratio: number };
export type ContrastPair = { text: Swatch; ground: Swatch; ratio: number; grade: WcagGrade; target: number; fix: ContrastFix | null };

/** Primary (buttons) and Highlight (chart marks, pills) are fills: WCAG's 3:1 for large text and non-text. */
export const contrastTarget = (role: string | null): number => (role === 'Primary' || role === 'Highlight' ? 3 : 4.5);

/** text is what has an ink job role or no role; a free role (Border, Disabled) says nothing about carrying text */
const carriesText = (role: string | null): boolean => role === null || isInk(role);

/**
 * Text on grounds. With ground roles, every swatch that carries text on each of them; without, the
 * darkest and lightest swatches that aren't inks stand in as grounds, and each other swatch is
 * checked on the one it reads best on. A failing text carries one fix for all its grounds: the
 * nearest lightness that passes on every one, `minGap` clear of the other swatches' lightnesses
 * where a little more of a move gets there, so the fix doesn't make a value collision. Its fix is
 * null when no lightness of its hue passes on all its grounds.
 */
export function contrastPairs(swatches: Swatch[], { minGap = 0 }: { minGap?: number } = {}): ContrastPair[] {
  const roled = swatches.filter((s) => isGround(s.role));
  const plain = swatches.filter((s) => !isInk(s.role));
  const grounds = roled.length ? roled : extremes(plain.length ? plain : swatches);
  const texts = swatches.filter((s) => !grounds.includes(s) && carriesText(s.role));
  if (!texts.length && grounds.length === 2 && !roled.length) return [pair(grounds[1], grounds[0], null)]; // just a dark and a light
  return texts.flatMap((text) => {
    const on = roled.length ? grounds : [grounds.reduce((a, b) => (contrast(text.oklch, b.oklch) > contrast(text.oklch, a.oklch) ? b : a))];
    const target = contrastTarget(text.role);
    const failing = on.some((g) => contrast(text.oklch, g.oklch) < target);
    const others = swatches.filter((s) => s !== text).map((s) => s.oklch[0]);
    const fix = failing ? fixLightness(text, on.map((g) => g.oklch), target, others, minGap) : null;
    return on.map((ground) => pair(text, ground, fix));
  });
}

function extremes(pool: Swatch[]): Swatch[] {
  if (pool.length < 2) return pool;
  const byL = [...pool].sort((a, b) => a.oklch[0] - b.oklch[0]);
  return [byL[0], byL.at(-1)!];
}

function pair(text: Swatch, ground: Swatch, fix: ContrastFix | null): ContrastPair {
  const ratio = contrast(text.oklch, ground.oklch);
  const target = contrastTarget(text.role);
  return { text, ground, ratio, grade: wcagGrade(ratio), target, fix: ratio >= target || !fix ? null : { ...fix, ratio: contrast(fix.oklch, ground.oklch) } };
}

/** how far past the smallest passing move a fix may go to keep clear of the other lightnesses */
const CLEAR_REACH = 0.13;

/**
 * The nearest lightness, towards white or black, where the text passes on every ground. Hue kept;
 * chroma only cut to fit sRGB, and never for a swatch already wider than sRGB (it stays wide).
 */
function fixLightness(text: Swatch, grounds: Oklch[], target: number, others: number[], minGap: number): ContrastFix | null {
  const [l, c, h] = text.oklch;
  const wide = !inSrgb(text.oklch);
  const at = (L: number): Oklch => (wide ? [L, c, h] : fitChroma([L, c, h]));
  const passes = (L: number) => grounds.every((g) => contrast(at(L), g) >= target);
  const clear = (L: number) => others.every((o) => Math.abs(o - L) >= minGap - 1e-9);
  const moves = [1, 0].flatMap((end) => {
    if (!passes(end)) return [];
    // bisect for the smallest move that passes (moving towards an end only ever raises the ratio past each ground)
    let [near, far] = [l, end];
    for (let i = 0; i < 40; i++) {
      const mid = (near + far) / 2;
      if (passes(mid)) far = mid;
      else near = mid;
    }
    // a readable number, still on the passing side
    const round = end ? Math.ceil(far * 1000) / 1000 : Math.floor(far * 1000) / 1000;
    const least = passes(round) ? round : far;
    const dir = end ? 1 : -1;
    for (let d = 0; minGap > 0 && d <= CLEAR_REACH; d += 0.005) {
      const L = Math.round((least + dir * d) * 1000) / 1000;
      if (L < 0 || L > 1) break;
      if (clear(L)) return [{ L, clear: true }];
    }
    return [{ L: least, clear: minGap <= 0 }];
  });
  if (!moves.length) return null;
  const by = (m: { L: number; clear: boolean }) => (m.clear ? 0 : 10) + Math.abs(m.L - l);
  const { L } = moves.reduce((a, b) => (by(b) < by(a) ? b : a));
  const oklch = at(L);
  return { swatchId: text.id, oklch, ratio: Math.min(...grounds.map((g) => contrast(oklch, g))) };
}

// ── value ────────────────────────────────────────────────────────────────────────────────────────

export type ValueCollision = { a: Swatch; b: Swatch; deltaL: number };

/** pairs whose OKLCH lightness is closer than `minDeltaL`: they read as the same grey. Closest first. */
export function valueCollisions(swatches: Swatch[], minDeltaL = 0.06): ValueCollision[] {
  return checkedPairs(swatches)
    .map(([a, b]) => ({ a, b, deltaL: Math.abs(a.oklch[0] - b.oklch[0]) }))
    // a hair of slack, so 0.58 − 0.52 counts as the 6.0 it reads as
    .filter((p) => p.deltaL < minDeltaL - 1e-9)
    .sort((x, y) => x.deltaL - y.deltaL);
}

// ── colour vision ────────────────────────────────────────────────────────────────────────────────

export type CvdClosest = { a: Swatch; b: Swatch; deltaE: number; flag: boolean };

/**
 * The two swatches that look most alike to a viewer with `kind` ('typical' = no deficiency), by
 * CIEDE2000 of the simulated colours; `flag` when they are closer than `flagBelow`. Two grounds
 * aren't a pair here either.
 */
export function cvdClosest(
  swatches: Swatch[],
  kind: Cvd | 'typical',
  { severity = 1, flagBelow = 10 }: { severity?: number; flagBelow?: number } = {},
): CvdClosest | null {
  const seen = new Map(swatches.map((s) => [s, kind === 'typical' ? s.oklch : simulateCvd(s.oklch, kind, severity)]));
  let best: CvdClosest | null = null;
  for (const [a, b] of checkedPairs(swatches)) {
    const e = deltaE(seen.get(a)!, seen.get(b)!);
    if (!best || e < best.deltaE) best = { a, b, deltaE: e, flag: e < flagBelow };
  }
  return best;
}

// ── print ────────────────────────────────────────────────────────────────────────────────────────

export type PrintInfo = { cmyk: [number, number, number, number]; inSrgb: boolean; inP3: boolean; nearest: InkMatch[] };

/** ≈CMYK (an estimate: always label it so), gamut flags, and the nearest ink of each library */
export function printInfo(swatch: Swatch): PrintInfo {
  const o = swatch.oklch;
  return { cmyk: cmykEstimate(o), inSrgb: inSrgb(o), inP3: inP3(o), nearest: INK_LIBRARIES.flatMap((lib) => nearestInks(o, lib)) };
}

const allPairs = <T>(list: T[]): [T, T][] => list.flatMap((a, i) => list.slice(i + 1).map((b): [T, T] => [a, b]));

/** a card on its page is meant to sit close to it: two grounds never count as one value or merged colours */
const checkedPairs = (list: Swatch[]): [Swatch, Swatch][] => allPairs(list).filter(([a, b]) => !(isGround(a.role) && isGround(b.role)));
