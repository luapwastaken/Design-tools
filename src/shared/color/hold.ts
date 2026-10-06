// The value lock's moves (the pickers' side of value.ts). A hold is the value being kept while one
// colour is edited, plus what the colour was asked to be (the saturation or chroma you set) so a hue
// that can't reach it for a while gives it back when it can. Each move takes the colour and the
// change asked of it and returns the colour that keeps the value, so the pickers only draw it.
import type { Oklch } from './index.ts';
import { fromHsb, fromHsl, hsbOf, sameColour, type Hsb, type Hsl } from './picker.ts';
import { holdValue, hslHold, hsbHold, valueOf } from './value.ts';

export type Hold = {
  /** the value held, 0..1: captured from the colour when the lock first sees it */
  target: number;
  /** the HSB saturation and the OKLCH chroma last set, kept through a hue sweep */
  s: number;
  c: number;
  /** the colour the lock last made: the next edit holds the same target only while the colour is still this */
  last: Oklch;
};

/** a move's result; `hold` null means the colour was set outright (the next edit captures a new target) */
export type Move<T> = { v: T; hold: Hold | null; /** the colour itself, where the tuple only approximates it (≈CMYK) */ o?: Oklch };

/** a value within one 8-bit step of black or white has a single colour, so there is nothing to hold */
const INERT = 0.004;
export const canHold = (target: number) => target >= INERT && target <= 1 - INERT;

export const capture = (o: Oklch): Hold => ({ target: valueOf(o), s: hsbOf(o)[1], c: o[1], last: o });

/** the hold for this colour: the one the lock left it with, or a new one when the colour came from elsewhere (a new swatch, an undo, a typed value) */
export const resolve = (prev: Hold | null, value: Oklch): Hold => (prev && sameColour(prev.last, value) ? prev : capture(value));

/** HSB: the hue and saturation hold the value by solving brightness; brightness itself is the carrier, so changing it is a new value */
export function hsbMove(hold: Hold, cur: Hsb, next: Hsb): Move<Hsb> {
  if (!canHold(hold.target) || next[2] !== cur[2]) return { v: next, hold: null };
  const set = next[1] !== cur[1];
  const [s, b] = hsbHold(hold.target, next[0], set ? next[1] : hold.s);
  const v: Hsb = [next[0], s, b];
  return { v, hold: { ...hold, s: set ? s : hold.s, last: fromHsb(v) } };
}

/** HSL: lightness is the carrier */
export function hslMove(hold: Hold, cur: Hsl, next: Hsl): Move<Hsl> {
  if (!canHold(hold.target) || next[2] !== cur[2]) return { v: next, hold: null };
  const v: Hsl = [next[0], next[1], hslHold(hold.target, next[0], next[1])];
  return { v, hold: { ...hold, last: fromHsl(v) } };
}

/** OKLCH: chroma and hue hold the value by solving L; L is the carrier */
export function oklchMove(hold: Hold, cur: Oklch, next: Oklch): Move<Oklch> {
  if (!canHold(hold.target) || next[0] !== cur[0]) return { v: next, hold: null };
  const set = next[1] !== cur[1];
  const v = holdValue(hold.target, set ? next[1] : hold.c, next[2]);
  return { v, hold: { ...hold, c: set ? v[1] : hold.c, last: v } };
}

/** RGB and ≈CMYK have no one carrier: the colour the drag made keeps its hue and chroma and gets the held value */
export function projectMove(hold: Hold, made: Oklch): Move<Oklch> {
  if (!canHold(hold.target)) return { v: made, hold: null };
  const v = holdValue(hold.target, made[1], made[2]);
  return { v, hold: { ...hold, c: v[1], last: v } };
}
