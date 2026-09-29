// Animated input and output (spec §10.4, Dither plan unit B). decodeFrames reads an animated GIF or
// an image sequence a frame at a time. exportFrames is the one animated export every tool uses:
// exactly `count` frames rendered offline and in order, streamed one at a time to the GIF encoder in
// a worker, or written as numbered PNGs into one folder, with progress and cancel.
import type { ToolId } from '../../shared/types.ts';
import { intoFolder, saveFile } from './export.ts';
import { gifDelays, readGif, scaleUp, type FrameImage, type Rgba } from './gif.ts';
import type { GifJob, GifReply } from './gif.worker.ts';
import { decodeImage, unsupportedImage } from './load.ts';
import { encodeIndexedPng } from './png-indexed.ts';
import { withDpi } from './png.ts';

export type { FrameImage, Indexed, Rgba } from './gif.ts';
export type { Rgba8 } from './png-indexed.ts';

export const MAX_FRAMES = 600;

export type Frames = {
  /** the file's name without its extension, or a sequence's without its frame number; '' for a Blob */
  name: string;
  count: number;
  w: number;
  h: number;
  /** each frame's length in ms: a GIF's own timing, or null for a still or a sequence (the tool sets the rate) */
  delays: number[] | null;
  /** frame `i` at full resolution, alpha as stored: a new bitmap each call, yours to close or transfer */
  frame(i: number): Promise<ImageBitmap>;
  close(): void;
};

const fileName = (b: Blob) => (b instanceof File ? b.name : '');
const stem = (name: string) => name.replace(/\.[^.]+$/, '');
const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** files in natural order by name: "frame 2" before "frame 10" */
export const naturalOrder = <T extends File>(files: readonly T[]): T[] => [...files].sort((a, b) => byName.compare(a.name, b.name));

/**
 * An animated GIF (every frame, composed as it plays, with its delays) or an image sequence. Files
 * are put in natural name order; Blobs (restored assets) keep the order given. A still is a
 * one-frame sequence. Rejects with a plain sentence, including above MAX_FRAMES frames.
 */
export async function decodeFrames(input: Blob | readonly Blob[]): Promise<Frames> {
  const list = input instanceof Blob ? [input] : input;
  if (!list.length) throw new Error('There are no images to open.');
  if (list.length > MAX_FRAMES) throw new Error(`That's ${list.length.toLocaleString('en')} images. A sequence can have at most ${MAX_FRAMES} frames.`);
  if (list.length === 1) {
    const one = list[0];
    const head = new Uint8Array(await one.slice(0, 6).arrayBuffer());
    if (String.fromCharCode(...head).startsWith('GIF8')) {
      const gif = await openGif(one, stem(fileName(one)));
      if (gif) return gif;
    }
    return sequence(list, stem(fileName(one)));
  }
  const files = list.every((b) => b instanceof File) ? naturalOrder(list as readonly File[]) : [...list];
  for (const f of files) {
    const why = unsupportedImage(f.type, fileName(f));
    if (why) throw new Error(fileName(f) ? `${fileName(f)}: ${why}` : why);
  }
  const first = stem(fileName(files[0]));
  return sequence(files, first.replace(/[\s._-]*\d+$/, '') || first);
}

const damaged = (name: string) => `${name || 'The GIF'} couldn't be read as an animation. The file may be damaged.`;

/** null for a GIF with one frame, which opens as a still */
async function openGif(blob: Blob, name: string): Promise<Frames | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const blocks = readGif(bytes).frames;
  if (blocks.length < 2) return null;
  if (blocks.length > MAX_FRAMES) throw new Error(`${name || 'This GIF'} has ${blocks.length.toLocaleString('en')} frames. The most this tool can take is ${MAX_FRAMES}; trim it first.`);
  const decoder = new ImageDecoder({ data: bytes, type: 'image/gif', colorSpaceConversion: 'none' });
  try {
    await Promise.all([decoder.tracks.ready, decoder.completed]);
    const count = Math.min(blocks.length, decoder.tracks.selectedTrack?.frameCount ?? 0);
    const { image } = await decoder.decode({ frameIndex: 0 });
    const [w, h] = [image.displayWidth, image.displayHeight];
    image.close();
    if (count < 2) throw new Error();
    return {
      name,
      count,
      w,
      h,
      // what every browser plays: a delay of 0 or 10 ms shows for 100 ms
      delays: blocks.slice(0, count).map((b) => (b.delay <= 1 ? 100 : b.delay * 10)),
      async frame(i) {
        if (!(i >= 0 && i < count)) throw new RangeError(`There is no frame ${i + 1}; the GIF has ${count}.`);
        const { image } = await decoder.decode({ frameIndex: i });
        try {
          return await createImageBitmap(image, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        } finally {
          image.close();
        }
      },
      close: () => decoder.close(),
    };
  } catch {
    decoder.close();
    throw new Error(damaged(name));
  }
}

async function sequence(files: readonly Blob[], name: string): Promise<Frames> {
  // the first frame gives the size; it is handed over on the first frame(0), so a still decodes once
  let first: ImageBitmap | null = await decodeImage(files[0], fileName(files[0]) || undefined);
  const { width: w, height: h } = first;
  return {
    name,
    count: files.length,
    w,
    h,
    delays: null,
    async frame(i) {
      if (!(i >= 0 && i < files.length)) throw new RangeError(`There is no frame ${i + 1}; the sequence has ${files.length}.`);
      if (i === 0 && first) {
        const b = first;
        first = null;
        return b;
      }
      const label = fileName(files[i]) || `Frame ${i + 1}`;
      const b = await decodeImage(files[i], label);
      if (b.width === w && b.height === h) return b;
      const size = `${b.width} × ${b.height}`;
      b.close();
      throw new Error(`${label} is ${size} px, but the first frame is ${w} × ${h} px. Every frame of a sequence has to be the same size.`);
    },
    close() {
      first?.close();
      first = null;
    },
  };
}

export type ExportFramesOptions = {
  tool: ToolId;
  /** the GIF's name, or the name before each frame's number, without an extension */
  name: string;
  count: number;
  fps: number;
  /** each frame's length in ms, in place of `fps` (a GIF's own timing) */
  delays?: readonly number[];
  /** frame `i`, rendered offline; called once for each frame, in order, never two at once */
  render(i: number): Promise<FrameImage>;
  to: 'gif' | 'folder';
  /** every pixel becomes a `scale` × `scale` block, nearest neighbour */
  scale?: number;
  /** written into each PNG frame */
  dpi?: number;
  progress?: (done: number, detail?: string) => void;
  signal?: AbortSignal;
};

/** What was written and a label for the toast, or null when cancelled (at the dialog, or by `signal`). */
export async function exportFrames(o: ExportFramesOptions): Promise<{ path: string; label: string } | null> {
  const { count: n, scale = 1 } = o;
  if (!Number.isInteger(n) || n < 1) throw new Error(`An animation needs at least one frame, not ${n}.`);
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`The scale has to be a whole number from 1 up, not ${scale}.`);
  if (o.delays && o.delays.length !== n) throw new Error(`${o.delays.length} delays can't time ${n} frames.`);
  const step = (i: number) => o.progress?.(i / n, i < n ? `Frame ${i + 1} of ${n}` : 'Writing');
  return o.to === 'gif' ? gif(o, n, scale, step) : folder(o, n, scale, step);
}

async function gif(o: ExportFramesOptions, n: number, scale: number, step: (i: number) => void) {
  const delays = gifDelays(n, o.delays ?? o.fps); // a rate a GIF can't play fails before any rendering
  const enc = encoder();
  try {
    for (let i = 0; i < n; i++) {
      if (o.signal?.aborted) return null;
      step(i);
      await enc.add({ frame: await o.render(i), cs: delays[i], scale });
    }
    if (o.signal?.aborted) return null;
    step(n);
    const bytes = await enc.finish();
    const path = await saveFile({ tool: o.tool, suggestedName: o.name, ext: 'gif', filterName: 'Animated GIF', data: bytes.buffer });
    return path ? { path, label: path.split(/[\\/]/).pop()! } : null;
  } finally {
    enc.close();
  }
}

/** the folder is chosen first, then each frame is written as it is made: a long 4K sequence is never in memory whole */
async function folder(o: ExportFramesOptions, n: number, scale: number, step: (i: number) => void) {
  const digits = Math.max(4, String(n).length);
  const at = await intoFolder(o.tool, async (write) => {
    for (let i = 0; i < n; i++) {
      if (o.signal?.aborted) return false;
      step(i);
      const f = await o.render(i);
      const png = 'indices' in f ? await encodeIndexedPng(f.indices, f.w, f.h, f.palette, { scale, dpi: o.dpi }) : await rgbaPng(f, scale, o.dpi);
      await write(`${o.name} ${String(i + 1).padStart(digits, '0')}.png`, await png.arrayBuffer());
    }
    step(n);
    return true;
  });
  return at === null ? null : { path: at, label: `${n === 1 ? '1 frame' : `${n} frames`} into ${at.split(/[\\/]/).pop()}` };
}

async function rgbaPng(f: Rgba, scale: number, dpi?: number): Promise<Blob> {
  const [w, h] = [f.width * scale, f.height * scale];
  const px = scale === 1 ? f.data : new Uint8ClampedArray(scaleUp(new Uint32Array(f.data.buffer, f.data.byteOffset, f.width * f.height), f.width, f.height, scale).buffer);
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0);
  const png = await canvas.convertToBlob({ type: 'image/png' });
  return dpi === undefined ? png : withDpi(png, dpi);
}

/** the encoder worker, one job at a time */
function encoder() {
  const w = new Worker(new URL('./gif.worker.ts', import.meta.url), { type: 'module' });
  const call = (job: GifJob) =>
    new Promise<GifReply>((ok, fail) => {
      w.onmessage = ({ data }: MessageEvent<GifReply>) => ('error' in data ? fail(new Error(data.error)) : ok(data));
      w.onerror = (e) => fail(new Error(e.message || 'The GIF encoder stopped working.'));
      w.postMessage(job);
    });
  return {
    add: (job: Extract<GifJob, { frame: unknown }>) => call(job).then(() => undefined),
    finish: () => call({ finish: true }).then((r) => (r as { bytes: Uint8Array<ArrayBuffer> }).bytes),
    close: () => w.terminate(),
  };
}
