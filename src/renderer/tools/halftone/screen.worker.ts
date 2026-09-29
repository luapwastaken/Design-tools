// The screening, off the window's thread: the image's plates (shared/halftone separate), each ink's
// cells and dots (screen), or its FM plate (stochastic), and the meters' numbers. This is the one
// place the screen is computed: the view draws what comes back and every export writes it.
import { hexToOklch, linearRgb } from '../../../shared/color/index.ts';
import { stats } from '../../../shared/halftone/coverage.ts';
import { cells, dots, inkedCoverage, splitOf } from '../../../shared/halftone/screen.ts';
import { toPlates } from '../../../shared/halftone/separate.ts';
import { stochastic } from '../../../shared/halftone/stochastic.ts';
import type { Cells, Mode, Overlap, Screen, SeparateInk, Size, Tone } from '../../../shared/halftone/types.ts';
import type { Oklch } from '../../../shared/color/index.ts';

export type SourceIn = { key: string; w: number; h: number; rgba: Uint8ClampedArray<ArrayBuffer> };
export type Job = {
  id: number;
  /** only when it changed: the image drawn onto the page at the plate's size, sRGB bytes */
  source?: SourceIn;
  sourceKey: string;
  sepKey: string;
  inks: (SeparateInk & { angle: number; key: string })[];
  mode: Mode;
  tone: Tone;
  paper: Oklch;
  overlap: Overlap;
  size: Size;
  screen: Screen;
};
/** one ink: its plate, and its cells with each one's dot (a, b and inked coverage, interleaved), or its FM plate */
export type InkOut = { plate: Float32Array; cells: Cells | null; dots: Float32Array | null; count: number; fm: Uint8Array | null };
export type Done = { id: number; inks: InkOut[]; stats: { mean: number; peak: number }[]; hist: Uint32Array; plateW: number; plateH: number; ms: number };
export type Failed = { id: number; error: string };

// sRGB byte to linear light, through shared/color (the grey of each byte, decoded)
const hex2 = (v: number) => v.toString(16).padStart(2, '0');
const DECODE = Float32Array.from({ length: 256 }, (_, v) => linearRgb(hexToOklch(`#${hex2(v).repeat(3)}`))[0]);

let src: { key: string; w: number; h: number; linear: Float32Array; hist: Uint32Array } | null = null;
let sep: { key: string; plates: Float32Array[] } | null = null;
const screened = new Map<string, Omit<InkOut, 'plate'>>();

function takeSource(s: SourceIn) {
  const n = s.w * s.h;
  const linear = new Float32Array(n * 4);
  const hist = new Uint32Array(256);
  const px = s.rgba;
  for (let p = 0, q = 0; p < n; p++, q += 4) {
    linear[q] = DECODE[px[q]];
    linear[q + 1] = DECODE[px[q + 1]];
    linear[q + 2] = DECODE[px[q + 2]];
    linear[q + 3] = px[q + 3] / 255;
    // the histogram counts what the image holds, not the paper round it
    if (px[q + 3] > 127) hist[Math.round(0.2126 * px[q] + 0.7152 * px[q + 1] + 0.0722 * px[q + 2])]++;
  }
  src = { key: s.key, w: s.w, h: s.h, linear, hist };
  sep = null;
}

function screenInk(j: Job, i: number, plate: Float32Array): Omit<InkOut, 'plate'> {
  const ink = j.inks[i];
  const hit = screened.get(ink.key);
  if (hit) return hit;
  let out: Omit<InkOut, 'plate'>;
  if (j.screen.shape === 'stochastic') {
    const W = Math.round((j.size.w * j.size.dpi) / 25.4);
    const H = Math.round((j.size.h * j.size.dpi) / 25.4);
    const fm = stochastic(plate, src!.w, src!.h, i, { outW: W, outH: H, gain: j.screen.gain });
    let count = 0;
    for (let p = 0; p < fm.length; p++) if (fm[p] === 0) count++;
    out = { cells: null, dots: null, count, fm };
  } else {
    const c = cells(plate, j.size, j.screen.lpi, ink.angle, src!.w, src!.h, splitOf(j.screen.shape));
    const { geom, count } = dots(c, j.screen);
    const inst = new Float32Array(c.n * 3);
    for (let k = 0, o = 0; k < c.n; k++, o += 3) {
      inst[o] = geom[2 * k];
      inst[o + 1] = geom[2 * k + 1];
      inst[o + 2] = inkedCoverage(j.screen, c.coverage[k]);
    }
    out = { cells: c, dots: inst, count, fm: null };
  }
  screened.set(ink.key, out);
  return out;
}

self.onmessage = (e: MessageEvent<Job>) => {
  const j = e.data;
  const t0 = performance.now();
  try {
    if (j.source) takeSource(j.source);
    if (!src || src.key !== j.sourceKey) throw new Error('The image went missing on its way to the screen. Open it again.');
    if (sep?.key !== j.sepKey) {
      sep = { key: j.sepKey, plates: toPlates(src.linear, src.w, src.h, j.inks, j.mode, j.tone, { paper: j.paper, overlap: j.overlap }) };
      screened.clear();
    }
    // what this job doesn't ask for any more goes: a turned ink's old cells, the other shape's
    const keys = new Set(j.inks.map((k) => k.key));
    for (const k of screened.keys()) if (!keys.has(k)) screened.delete(k);
    const plates = sep.plates;
    const inks = j.inks.map((_, i) => ({ plate: plates[i], ...screenInk(j, i, plates[i]) }));
    const done: Done = {
      id: j.id,
      // copies: the worker keeps its own for the next job
      inks: inks.map((k) => ({ ...k, plate: k.plate.slice() })),
      stats: stats(plates),
      hist: src.hist.slice(),
      plateW: src.w,
      plateH: src.h,
      ms: performance.now() - t0,
    };
    self.postMessage(done, { transfer: done.inks.map((k) => k.plate.buffer) });
  } catch (err) {
    self.postMessage({ id: j.id, error: err instanceof Error ? err.message : String(err) } satisfies Failed);
  }
};
