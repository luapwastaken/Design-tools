// The mixes and glazes the GPU's KM is checked against (plan §6), shared by the node tests and the
// smoke checks: every paint alone, every pair at five ratios, whites, and a spread of threes.
import { PIGMENTS } from '../../../../shared/paint/pigments.ts';

/** [pigment index, parts] */
export type MixCase = [number, number][];

export function mixCases(): MixCase[] {
  const P = PIGMENTS.length;
  const out: MixCase[] = [];
  for (let i = 0; i < P; i++) out.push([[i, 1]]);
  for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) for (const [x, y] of [[1, 4], [1, 2], [1, 1], [2, 1], [4, 1]]) out.push([[a, x], [b, y]]);
  for (let a = 1; a < P; a++) for (const w of [8, 16, 32]) out.push([[a, 1], [0, w]]);
  for (let a = 1; a < P; a += 3) for (let b = a + 1; b < P; b += 4) for (let c = b + 1; c < P; c += 5) out.push([[a, 1], [b, 1], [c, 1]]);
  return out;
}

/** two glazes, each [pigment index, thickness], over bare paper: every ordered pair of coloured paints */
export function glazeCases(x = 0.5): [[number, number], [number, number]][] {
  const out: [[number, number], [number, number]][] = [];
  for (let a = 1; a < PIGMENTS.length; a++) for (let b = 1; b < PIGMENTS.length; b++) if (a !== b) out.push([[a, x], [b, x]]);
  return out;
}
