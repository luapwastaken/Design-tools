// Synthetic images and palettes for the dither tests (never personal images: the repo is public).
import { hexToOklch, linearRgb } from '../src/shared/color/index.ts';
import { toOklab, type OklabPalette } from '../src/shared/dither/palette.ts';
import { random } from '../src/shared/palette/random.ts';

export const palette = (hexes: string): OklabPalette => toOklab(hexes.split(' ').map((h) => hexToOklch(h)));
export const BW = palette('#000000 #ffffff');
export const PICO8 = palette(
  '#000000 #1d2b53 #7e2553 #008751 #ab5236 #5f574f #c2c3c7 #fff1e8 #ff004d #ffa300 #ffec27 #00e436 #29adff #83769c #ff77a8 #ffccaa',
);

/** linear light of a hex, as the tool decodes a pixel */
export const lin = (hex: string): [number, number, number] => linearRgb(hexToOklch(hex));

export function flat(w: number, h: number, rgb: readonly number[]): Float32Array {
  const img = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) img.set(rgb, i * 3);
  return img;
}

/** photo-like: smooth value noise per channel, plus fine grain, in linear light */
export function field(w: number, h: number, seed = 7): Float32Array {
  const rnd = random(seed);
  const G = 9;
  const grid = Array.from({ length: G * G * 3 }, rnd);
  const img = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [gx, gy] = [(x / Math.max(1, w - 1)) * (G - 1), (y / Math.max(1, h - 1)) * (G - 1)];
      const [ix, iy] = [Math.min(G - 2, Math.floor(gx)), Math.min(G - 2, Math.floor(gy))];
      const [fx, fy] = [gx - ix, gy - iy];
      for (let c = 0; c < 3; c++) {
        const at = (i: number, j: number) => grid[((iy + j) * G + ix + i) * 3 + c];
        const v = (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy;
        img[(y * w + x) * 3 + c] = Math.min(1, Math.max(0, v * v + (rnd() - 0.5) * 0.02));
      }
    }
  }
  return img;
}

/** left to right from one hex to another, mixed in linear light */
export function ramp(w: number, h: number, from: string, to: string): Float32Array {
  const [a, b] = [lin(from), lin(to)];
  const img = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 3; c++) img[(y * w + x) * 3 + c] = a[c] + (b[c] - a[c]) * (x / (w - 1));
    }
  }
  return img;
}

/** the share of pixels showing palette index `k` */
export const share = (idx: Uint8Array, k: number): number => idx.reduce((n, v) => n + (v === k ? 1 : 0), 0) / idx.length;
