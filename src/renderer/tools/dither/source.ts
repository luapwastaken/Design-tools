// The source's frames: decoded while the tool shows (a hidden tool keeps only the asset urls,
// foundation spec §4), and each frame reduced to the working size, which is what the worker
// dithers. A GIF decodes a frame at a time through lib/frames; a sequence a file at a time.
import { cssColor } from '../../../shared/color/index.ts';
import { decodeFrames } from '../../lib/frames.ts';
import { sequenceFrame } from '../common/sequence.ts';
import { fetchBlob } from '../common/take.ts';
import { workSize, type DitherDoc, type Source } from './doc.ts';

export type WorkFrame = { key: string; w: number; h: number; rgba: Uint8ClampedArray; hist: Uint32Array };

const J = JSON.stringify;
const WHITE = cssColor([1, 0, 0]);

type Reader = { key: string; frame(i: number): Promise<ImageBitmap>; close(): void };

let reader: Reader | null = null;

/**
 * The source's frames, the last few kept for scrubbing back and forth. One that falls out closes a
 * moment later (whoever just got it has drawn it by then), so a view that keeps one takes a copy.
 */
function readerOf(s: Source): Reader {
  const key = sourceId(s);
  if (reader?.key === key) return reader;
  reader?.close();
  const decode = s.assets.length > 1 ? sequence(s) : oneFile(s);
  const kept = new Map<number, Promise<ImageBitmap>>();
  const shut = (b: Promise<ImageBitmap>) => void b.then((x) => setTimeout(() => x.close(), 1000), () => {});
  reader = {
    key,
    frame(i) {
      let got = kept.get(i);
      if (got) kept.delete(i);
      else {
        got = decode.frame(i);
        got.catch(() => kept.get(i) === got && kept.delete(i));
      }
      kept.set(i, got);
      for (const [k, old] of kept) {
        if (kept.size <= KEEP) break;
        kept.delete(k);
        shut(old);
      }
      return got;
    },
    close() {
      kept.forEach(shut);
      kept.clear();
      decode.close();
    },
  };
  return reader;
}

const KEEP = 4;

/** a still or an animated GIF, through lib/frames */
function oneFile(s: Source) {
  const frames = fetchBlob(s.assets[0], s.name).then((b) => decodeFrames(b));
  return {
    frame: async (i: number) => (await frames).frame(i),
    close: () => void frames.then((f) => f.close(), () => {}),
  };
}

/** a sequence's files, each read as it is asked for, all the size of the first */
function sequence(s: Source) {
  return {
    frame: (i: number) => sequenceFrame(s.assets, s.name, s.w, s.h, i),
    close() {},
  };
}

/** the source frame at full resolution, for the Original view */
export const sourceFrame = (s: Source, i: number): Promise<ImageBitmap> => readerOf(s).frame(i);

// ── frames at the working size, kept up to a budget ──

const BUDGET = 256e6;
const frames = new Map<string, Promise<WorkFrame>>();
const sizes = new Map<string, number>();
let bytes = 0;

// a sequence's asset list is long, and keys are made many times a second during playback: each list
// gets a short id once
const ids = new WeakMap<Source, string>();
const interned = new Map<string, string>();

/** a short id for the source's files: the same files, the same id */
export function sourceId(s: Source | null): string {
  if (!s) return '';
  let id = ids.get(s);
  if (id === undefined) {
    const k = J(s.assets);
    id = interned.get(k) ?? `s${interned.size}`;
    interned.set(k, id);
    ids.set(s, id);
  }
  return id;
}

export const workKey = (d: DitherDoc, i: number): string => J([sourceId(d.source), i, workSize(d), d.pixel === 1 ? 'same' : d.resample]);

async function reduce(d: DitherDoc, i: number, key: string): Promise<WorkFrame> {
  const img = await sourceFrame(d.source!, i);
  const { w, h } = workSize(d);
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = d.resample === 'area';
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const hist = new Uint32Array(256);
  for (let q = 0; q < rgba.length; q += 4) hist[Math.round(0.2126 * rgba[q] + 0.7152 * rgba[q + 1] + 0.0722 * rgba[q + 2])]++;
  return { key, w, h, rgba, hist };
}

/** frame `i` of the source at the working size */
export function workFrame(d: DitherDoc, i: number): Promise<WorkFrame> {
  const key = workKey(d, i);
  const hit = frames.get(key);
  if (hit) {
    frames.delete(key);
    frames.set(key, hit);
    return hit;
  }
  const made = reduce(d, i, key);
  frames.set(key, made);
  made.then(
    (f) => {
      if (frames.get(key) !== made) return;
      sizes.set(key, f.rgba.length);
      bytes += f.rgba.length;
      for (const k of frames.keys()) {
        if (bytes <= BUDGET || k === key) break;
        drop(k);
      }
    },
    () => frames.get(key) === made && frames.delete(key),
  );
  return made;
}

function drop(key: string) {
  frames.delete(key);
  bytes -= sizes.get(key) ?? 0;
  sizes.delete(key);
}

/** a hidden tool frees every decoded pixel (foundation spec §4) */
export function releaseSource(): void {
  reader?.close();
  reader = null;
  frames.clear();
  sizes.clear();
  bytes = 0;
}
