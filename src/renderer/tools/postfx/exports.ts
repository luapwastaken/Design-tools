// What each export writes: the stack (effects/stack.ts, the preview's own passes) at full resolution
// on the frame it names, read back as 8-bit RGBA with its alpha. One frame is a PNG; a loop goes
// through media.ts's exportAnimation, the shared animated path (lib/frames), in order. Every PNG is
// written from the straight RGBA (lib/png), so colour under faint alpha stays exact.
import { gpuScope, type Texture } from '../../lib/gpu/index.ts';
import { rgbaPng } from '../../lib/png.ts';
import { fmtPx } from '../common/names.ts';
import { isStateful, runIn, timeline, type PostFxDoc, type Source, type Timeline } from './doc.ts';
import { Stack } from './effects/stack.ts';
import { exportAnimation, openMedia } from './media.ts';

type Progress = (done: number, detail?: string) => void;

/** what a canvas here can make into a PNG, as the other image tools */
const MAX_PX = 64e6;

let limits: ReturnType<typeof gpuScope> | null = null;

/** why this source can't be exported at full resolution, or null */
export function sizeLimit(s: Pick<Source, 'w' | 'h'>): string | null {
  const max = (limits ??= gpuScope('postfx limits')).maxSize;
  if (max && Math.max(s.w, s.h) > max) return `${fmtPx(s.w, s.h)} is wider than this graphics card can process at once (${max.toLocaleString('en')} px a side). Resize it in another app first.`;
  if (s.w * s.h > MAX_PX) return `${fmtPx(s.w, s.h)} is more than a PNG here can hold (64 megapixels). Resize it in another app first.`;
  return null;
}

/** the stack on one source frame, at full resolution: RGBA bytes, straight alpha, rows from the top */
function runOn(stack: Stack, src: Texture, d: PostFxDoc, tl: Timeline, frame: number): Uint8Array {
  return stack.bytes(drawOn(stack, src, d, tl, frame));
}

/** the same, left on the GPU: for a frame that only feeds the next (datamosh remembers it) */
function drawOn(stack: Stack, src: Texture, d: PostFxDoc, tl: Timeline, frame: number): Texture {
  return stack.render(src, d.stack, { t: tl.count > 1 ? tl.phase(frame) : 0, frame: d.source!.kind === 'video' ? frame : null, scale: 1, seconds: tl.seconds });
}

/**
 * Frame `frame` of the timeline (the one on screen) as a PNG, full resolution, alpha kept. A clip with
 * datamosh on it draws the frame after the ones before it (doc.ts RUN_IN), as the preview does, so the
 * file is the picture on screen; `progress` says which of them it is on.
 */
export async function pngBlob(d: PostFxDoc, frame: number, progress?: Progress): Promise<Blob> {
  const s = d.source;
  if (!s) throw new Error('There is no image to export yet.');
  const why = sizeLimit(s);
  if (why) throw new Error(why);
  const tl = timeline(d);
  const media = await openMedia(s);
  const stack = new Stack('postfx export');
  try {
    let src: Texture | null = null;
    const load = async (i: number) => {
      const img = await media.frame(s.kind === 'image' ? 0 : i);
      try {
        if (src) src.upload(img);
        else src = stack.g.texture(img, 'rgba16f');
      } finally {
        img.close();
      }
      return src;
    };
    const lead = isStateful(d) ? runIn(frame) : [];
    for (const [k, i] of lead.entries()) {
      progress?.(k / (lead.length + 1), `Frame ${i + 1} of ${frame + 1}`);
      drawOn(stack, await load(i), d, tl, i);
    }
    return await rgbaPng(runOn(stack, await load(frame), d, tl, frame), s.w, s.h);
  } finally {
    stack.release();
    media.close();
  }
}

/** every frame of one loop, in order, as a GIF or numbered PNGs (spec §3: exact frame counts, a loop that repeats) */
export async function framesTo(d: PostFxDoc, to: 'gif' | 'folder', name: string, progress?: Progress, signal?: AbortSignal) {
  const s = d.source;
  if (!s) throw new Error('There is no image to export yet.');
  const why = sizeLimit(s);
  if (why) throw new Error(why);
  const stack = new Stack('postfx export');
  const tl = timeline(d);
  let src: Texture | null = null;
  const load = (image: ImageBitmap) => {
    // a still goes up once; a GIF's or a clip's frames each in turn
    if (!src) src = stack.g.texture(image, 'rgba16f');
    else if (s.kind !== 'image') src.upload(image);
    return src;
  };
  try {
    return await exportAnimation({
      source: s,
      timing: tl,
      to,
      name,
      progress,
      signal,
      // a GIF keeps every second frame of a fast clip, but datamosh has to see them all
      advance: isStateful(d) ? async (image, i) => void drawOn(stack, load(image), d, tl, i) : undefined,
      render: async (image, i) => {
        const bytes = runOn(stack, load(image), d, tl, i);
        return { data: new Uint8ClampedArray(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.length), width: s.w, height: s.h };
      },
      straightAlpha: true,
    });
  } finally {
    stack.release();
  }
}
