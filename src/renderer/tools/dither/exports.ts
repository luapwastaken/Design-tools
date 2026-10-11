// What each export writes, every one from the index buffer the view shows (pipeline.ts): the PNG
// and the indexed PNG with each block exactly `scale` px, the SVG as runs of blocks, and an
// animation's GIF or PNG frames through the one shared animated path (lib/frames).
import { rgb255 } from '../../../shared/color/index.ts';
import { exportFrames, gifBytes, type ExportFramesOptions } from '../../lib/frames.ts';
import { scaleUp } from '../../lib/gif.ts';
import { encodeIndexedPng } from '../../lib/png-indexed.ts';
import { withDpi } from '../../lib/png.ts';
import { fmtPx } from '../common/names.ts';
import { gifLimit, isAnimated, workSize, type DitherDoc } from './doc.ts';
import { dithered, type Result } from './pipeline.ts';
import { runsSvg } from './svg.ts';

type Progress = (done: number, detail?: string) => void;


/** what a canvas here can make into a PNG without running out of memory, as Halftone's */
const MAX_PX = 64e6;
/** the indexed files never touch a canvas: lib/png-indexed's own limit */
const INDEXED_MAX = 2 ** 28;
/** the SVG draws each run of blocks as a path segment: past this many working pixels it outweighs the PNG */
export const SVG_MAX = 256 * 256;

export const sizeLimit = (w: number, h: number): string | null =>
  w * h > MAX_PX ? `${fmtPx(w, h)} is more than a full-colour PNG here can hold. Lower the export scale, or take 1 px a block.` : null;

export const indexedLimit = (w: number, h: number): string | null => (w * h > INDEXED_MAX ? `${fmtPx(w, h)} is more than an indexed file here can hold. Lower the export scale.` : null);

export const svgLimit = (d: DitherDoc): string | null => {
  const { w, h } = workSize(d);
  return w * h > SVG_MAX ? `The SVG is for small pieces: ${w.toLocaleString('en')} × ${h.toLocaleString('en')} blocks is past 256 × 256. Raise the pixel size, or export a PNG.` : null;
};

/** the result's colours, packed as a canvas reads them */
function rgbaOf(r: Result): Uint32Array<ArrayBuffer> {
  const lut = new Uint32Array(r.colours.map((c) => {
    const [R, G, B] = rgb255(c);
    return (255 << 24) | (B << 16) | (G << 8) | R;
  }));
  const out = new Uint32Array(r.indices.length);
  for (let p = 0; p < out.length; p++) out[p] = lut[r.indices[p]];
  return out;
}

/** the result as a full-colour image, one pixel a block (the view draws this) */
export function imageOf(r: Result): ImageData {
  return new ImageData(new Uint8ClampedArray(rgbaOf(r).buffer), r.w, r.h);
}

/**
 * Send to's picture, as big as the Export group's scale makes the files. An animation goes whole, as
 * a GIF of every frame with its own timing (Post FX opens it as a clip to work on), unless a GIF
 * can't time it (`gifLimit`), when the frame on screen goes alone and `why` says so. `scale`: the
 * px a block came out, smaller than asked where the picture would be more than a PNG here holds.
 */
export async function sendFor(d: DitherDoc, frame: number, scale: number): Promise<{ blob: Blob; ext: 'gif' | 'png'; scale: number; why: string | null }> {
  const { w, h } = workSize(d);
  let fit = scale;
  while (fit > 1 && w * h * fit * fit > MAX_PX) fit--;
  const why = isAnimated(d) ? gifLimit(d) : null;
  if (isAnimated(d) && !why) {
    const bytes = await gifBytes(framesOptions(d, fit, 'gif', d.source!.name));
    if (bytes) return { blob: new Blob([bytes], { type: 'image/gif' }), ext: 'gif', scale: fit, why: null };
  }
  return { blob: await pngBlob(d, frame, fit), ext: 'png', scale: fit, why };
}

export async function pngBlob(d: DitherDoc, frame: number, scale: number): Promise<Blob> {
  const r = await dithered(d, frame, 'export');
  const [W, H] = [r.w * scale, r.h * scale];
  const why = sizeLimit(W, H);
  if (why) throw new Error(why);
  const canvas = new OffscreenCanvas(W, H);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(scaleUp(rgbaOf(r), r.w, r.h, scale).buffer), W, H), 0, 0);
  return withDpi(await canvas.convertToBlob({ type: 'image/png' }));
}

const paletteBytes = (r: Result) => r.colours.map((c) => rgb255(c));

export async function indexedBlob(d: DitherDoc, frame: number, scale: number): Promise<Blob> {
  const r = await dithered(d, frame, 'export');
  return encodeIndexedPng(r.indices, r.w, r.h, paletteBytes(r), { scale });
}

export async function svgFor(d: DitherDoc, frame: number, scale: number): Promise<string> {
  const why = svgLimit(d);
  if (why) throw new Error(why);
  const r = await dithered(d, frame, 'export');
  return runsSvg(r.indices, r.w, r.h, r.colours, scale);
}

/** the options of the one animated path: every frame, in order, from the index buffers the view shows */
function framesOptions(d: DitherDoc, scale: number, to: 'gif' | 'folder', name: string, progress?: Progress, signal?: AbortSignal): ExportFramesOptions {
  const s = d.source;
  if (!s || s.frames < 2) throw new Error('Only an animation has frames to export.');
  return {
    tool: 'dither',
    name,
    count: s.frames,
    fps: s.fps ?? 1,
    delays: s.delays ?? undefined,
    scale,
    progress,
    signal,
    render: async (i) => {
      const r = await dithered(d, i, 'export');
      return { indices: r.indices, w: r.w, h: r.h, palette: paletteBytes(r) };
    },
    to,
  };
}

/** every frame, in order, as a GIF or numbered PNGs (spec §3: exact frame counts, no drift) */
export const framesTo = (d: DitherDoc, scale: number, to: 'gif' | 'folder', name: string, progress?: Progress, signal?: AbortSignal) => exportFrames(framesOptions(d, scale, to, name, progress, signal));
