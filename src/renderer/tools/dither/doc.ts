// The Dither document (plan: Document), the limits every edit keeps, and the working size that
// follows from the pixel size (spec §3: a block is exactly `pixel` px in the exported file).
import type { Oklch } from '../../../shared/color/index.ts';
import type { AlgorithmId } from '../../../shared/dither/algorithms.ts';
import { gifDelays } from '../../lib/gif.ts';

export type { AlgorithmId };

/** a palette colour; one left out stays in its place, unused, so picking is never destructive */
export type Colour = { oklch: Oklch; on: boolean };

export type Source = {
  /** dt:// urls in the workspace: one file (a still, or an animated GIF), or a sequence's frames in order */
  assets: string[];
  name: string;
  w: number;
  h: number;
  /** null for a still */
  fps: number | null;
  /** a GIF's own timing, each frame in ms, until the frame rate is changed; null: every frame lasts 1 / fps */
  delays: number[] | null;
  frames: number;
};

export type Tone = { black: number; white: number; gamma: number; contrast: number; map: boolean };

export type DitherDoc = {
  source: Source | null;
  /** 1..32, the block size in the exported file */
  pixel: number;
  /** how the source is reduced to the working size */
  resample: 'area' | 'nearest';
  algorithm: AlgorithmId;
  /** 0..1 */
  strength: number;
  serpentine: boolean;
  seed: number;
  palette: { name: string; colours: Colour[] };
  paletteSource: { kind: 'preset' | 'library' | 'extract'; id?: string };
  tone: Tone;
  /** the look it started from, for the readout only */
  look: string | null;
};

export const LIMIT = {
  pixel: [1, 32] as [number, number],
  colours: [2, 256] as [number, number],
  fps: [1, 60] as [number, number],
  gamma: [0.2, 5] as [number, number],
  contrast: [-1, 1] as [number, number],
  extract: [2, 32] as [number, number],
  seed: [0, 9999] as [number, number],
  /** working pixels dithered at once: a 4K frame at pixel size 1 fits, an 8K one needs size 2 */
  work: 4096 * 4096,
};

export const NEUTRAL_TONE: Tone = { black: 0, white: 1, gamma: 1, contrast: 0, map: false };

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

/** the rules no edit may break, applied after each one */
export function fix(d: DitherDoc): DitherDoc {
  const t = d.tone;
  return {
    ...d,
    pixel: Math.round(clamp(d.pixel, LIMIT.pixel)),
    strength: clamp(d.strength, [0, 1]),
    seed: Math.round(clamp(d.seed, LIMIT.seed)),
    tone: { ...t, black: clamp(t.black, [0, 0.99]), white: clamp(t.white, [0.01, 1]), gamma: clamp(t.gamma, LIMIT.gamma), contrast: clamp(t.contrast, LIMIT.contrast) },
    source: d.source && d.source.fps !== null ? { ...d.source, fps: Math.round(clamp(d.source.fps, LIMIT.fps)) } : d.source,
  };
}

export const isAnimated = (d: Pick<DitherDoc, 'source'>): boolean => !!d.source && d.source.frames > 1;

/** how long frame `i` shows, ms */
export const frameMs = (s: Source, i: number): number => s.delays?.[i] ?? 1000 / (s.fps ?? 1);

/** one loop of the animation, ms */
export const loopMs = (s: Source): number => (s.delays ? s.delays.reduce((a, b) => a + b, 0) : (s.frames * 1000) / (s.fps ?? 1));

/** why this animation can't be a GIF (a frame under the 20 ms a GIF can show), or null */
export function gifLimit(d: DitherDoc): string | null {
  const s = d.source;
  if (!s || s.frames < 2) return null;
  try {
    gifDelays(s.frames, s.delays ?? s.fps ?? 1);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** the colours the dither uses, in order: the index buffer counts in these */
export const used = (d: Pick<DitherDoc, 'palette'>): Oklch[] => d.palette.colours.filter((c) => c.on).map((c) => c.oklch);

/** the working image: the source divided by the pixel size, one dithered pixel per block */
export function workSize(d: Pick<DitherDoc, 'source' | 'pixel'>): { w: number; h: number } {
  if (!d.source) return { w: 0, h: 0 };
  return { w: Math.max(1, Math.round(d.source.w / d.pixel)), h: Math.max(1, Math.round(d.source.h / d.pixel)) };
}

/** px per block in the files: the pixel size times the export's scale (view state), or 1 px a block at 0 */
export const scaleOf = (d: Pick<DitherDoc, 'pixel'>, v: { times: number }): number => (v.times === 0 ? 1 : d.pixel * v.times);

export function outSize(d: Pick<DitherDoc, 'source' | 'pixel'>, scale: number): { w: number; h: number } {
  const { w, h } = workSize(d);
  return { w: w * scale, h: h * scale };
}

/** why this document can't be dithered at once, or null */
export function workProblem(d: Pick<DitherDoc, 'source' | 'pixel'>): string | null {
  const { w, h } = workSize(d);
  if (w * h <= LIMIT.work) return null;
  const need = Math.ceil(Math.sqrt((d.source!.w * d.source!.h) / LIMIT.work));
  return `${w.toLocaleString('en')} × ${h.toLocaleString('en')} working pixels is more than one dither holds (${(LIMIT.work / 1e6).toFixed(1)} million). Use a pixel size of ${need} or more.`;
}

/** colours moved from `from` to before `to` (0..n), for a drag or Alt+arrow */
export function moveColour(d: DitherDoc, from: number, to: number): DitherDoc {
  const list = [...d.palette.colours];
  const [c] = list.splice(from, 1);
  list.splice(to > from ? to - 1 : to, 0, c);
  return { ...d, palette: { ...d.palette, colours: list } };
}

export const paletteOf = (name: string, colours: Oklch[]): DitherDoc['palette'] => ({ name, colours: colours.map((oklch) => ({ oklch, on: true })) });
