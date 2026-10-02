// Post FX's media (plan unit M): a still, an animated GIF or a video, read at full resolution with
// alpha as stored. A <video> has no frame step of its own, so a video frame is found by seeking to
// the middle of its time on screen and proved by requestVideoFrameCallback's mediaTime. Previews
// play through a callback; exports go through lib/frames' one animated path.
import { decodeFrames, exportFrames, MAX_FRAMES, type FrameImage } from '../../lib/frames.ts';
import { fetchBlob } from '../common/take.ts';
import { DEFAULT_FPS, frameOf, gifPlan, isCleanRate, isVideoFile, seekTime, snapFps, timingOf, typicalStep, videoProblem, type MediaKind, type Timing } from './media-time.ts';

export { isVideoFile, type Loop, type MediaKind, type Timing } from './media-time.ts';

/** the document's source (plan: PostFxDoc.source); `fps` and `frames` are null for a still, `delays` is a GIF's own timing in ms */
export type Source = { asset: string; name: string; kind: MediaKind; w: number; h: number; fps: number | null; frames: number | null; delays?: number[] | null };

/** what the preview is given on each frame: valid only during the call, so draw or upload it there */
export type Shown = ImageBitmap | HTMLVideoElement;

export type Media = {
  /** frame `i` at full resolution, alpha as stored (a still's every frame is the still); yours to close */
  frame(i: number): Promise<ImageBitmap>;
  /** plays one loop of `timing` (the timeline's) from frame `from`, over and over, calling `show` with each frame presented, until the returned stop; `t` is timing.phase(i) */
  play(o: { from: number; timing: Timing; show(i: number, image: Shown, t: number): void; failed?(e: Error): void }): () => void;
  close(): void;
};

const ID = 'postfx';
const OPEN_MS = 20_000;
const SEEK_MS = 10_000;
/** rVFC fires within a frame or two of `seeked`; a hidden page may never fire it, and then the frame's own timestamp stands */
const PRESENT_MS = 250;
const BITMAP = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' } as const;

const TYPE_EXT: Record<string, string> = { quicktime: 'mov', 'x-matroska': 'mkv', 'x-msvideo': 'avi', 'x-ms-wmv': 'wmv', jpeg: 'jpg', 'svg+xml': 'svg' };
/** the file's own extension (a File's name has it), else one from its type, kept to what putAsset takes */
const extOf = (blob: Blob, name: string) => {
  const sub = /^(?:image|video)\/([\w.+-]+)/.exec(blob.type)?.[1];
  return (/\.([a-z0-9]{1,8})$/i.exec(blob instanceof File ? blob.name : name)?.[1] ?? (sub && (TYPE_EXT[sub] ?? sub)) ?? 'png').toLowerCase();
};
const put = async (blob: Blob, ext: string) => (await window.api.invoke('workspace.putAsset', ID, await blob.arrayBuffer(), ext)).url;
const sleep = (ms: number) => new Promise<null>((ok) => setTimeout(() => ok(null), ms));

/**
 * A dropped or picked file as the source: read to be sure it opens (a video's size, frame rate and
 * frame count measured, a GIF's own timing kept), then kept in the workspace at full resolution.
 * Rejects with a plain sentence.
 */
export async function sourceOf(blob: Blob, name: string, ext = extOf(blob, name)): Promise<Source> {
  if (isVideoFile(blob.type, blob instanceof File ? blob.name : `${name}.${ext}`)) {
    // the page's CSP lets a <video> read dt:// but not blob:, so the file goes in first; one that
    // doesn't open is left to the workspace's sweep of unused assets
    const asset = await put(blob, ext);
    const clip = openClip(asset, name);
    try {
      return { asset, name, kind: 'video', delays: null, ...(await clip.measure()) };
    } finally {
      clip.close();
    }
  }
  const f = await decodeFrames(blob);
  const { w, h, count, delays } = f;
  f.close();
  const asset = await put(blob, ext);
  if (count < 2 || !delays) return { asset, name, kind: 'image', w, h, fps: null, frames: null, delays: null };
  const { fps } = timingOf('gif', { frames: count, fps: null, delays }, { seconds: 1, fps: 1 });
  return { asset, name, kind: 'gif', w, h, fps, frames: count, delays };
}

/** the source ready to read and play; each call opens its own, so an export never moves the preview */
export const openMedia = (s: Source): Promise<Media> => (s.kind === 'video' ? videoMedia(s) : pictureMedia(s));

/**
 * One loop of `timing` (the timeline's) as a GIF or a folder of numbered PNGs at full resolution: a
 * clip's every frame at its own rate, a GIF's frames with its own timing, or a still's loop, whose
 * phases stop one frame short of 1 so it repeats with no jump. A GIF plays at most 50 fps, so a
 * faster clip keeps every second frame. What was written, or null when cancelled.
 */
export async function exportAnimation(o: {
  source: Source;
  timing: Timing;
  to: 'gif' | 'folder';
  /** the GIF's name, or the name before each frame's number */
  name: string;
  /** loop frame `i` through the stack, from its source frame `image` (closed after); `t` is timing.phase(i) */
  render(image: ImageBitmap, i: number, t: number): Promise<FrameImage>;
  progress?: (done: number, detail?: string) => void;
  signal?: AbortSignal;
}): Promise<{ path: string; label: string } | null> {
  const t = o.timing;
  const plan = o.to === 'gif' ? gifPlan(t, MAX_FRAMES) : null;
  const media = await openMedia(o.source);
  try {
    return await exportFrames({
      tool: ID,
      name: o.name,
      count: plan ? plan.frames.length : t.count,
      fps: t.fps,
      delays: plan?.delays,
      to: o.to,
      progress: o.progress,
      signal: o.signal,
      render: async (k) => {
        const i = plan ? plan.frames[k] : k;
        const image = await media.frame(i);
        try {
          return await o.render(image, i, t.phase(i));
        } finally {
          image.close();
        }
      },
    });
  } finally {
    media.close();
  }
}

// ── stills and GIFs, through lib/frames ──

async function pictureMedia(s: Source): Promise<Media> {
  const f = await decodeFrames(await fetchBlob(s.asset, s.name));
  let still: ImageBitmap | null = null;
  if (f.count === 1) {
    try {
      still = await f.frame(0);
    } finally {
      f.close();
    }
  }
  let stop: (() => void) | null = null;
  return {
    frame: (i) => (still ? createImageBitmap(still, BITMAP) : f.frame(i)),
    play(o) {
      stop?.();
      // a still is shown as it is, never copied; a GIF frame is decoded, shown and closed
      const next = still ? () => Promise.resolve({ image: still!, done() {} }) : (i: number) => f.frame(i).then((b) => ({ image: b, done: () => b.close() }));
      const halt = clock(o.timing, o.from, next, o.show, (e) => {
        halt();
        o.failed?.(e);
      });
      const end = () => {
        halt();
        if (stop === end) stop = null;
      };
      return (stop = end);
    },
    close() {
      stop?.();
      if (still) still.close();
      else f.close();
    },
  };
}

/** plays by the clock, a frame per display frame at most; a frame still decoding holds the one on screen */
function clock(t: Timing, from: number, next: (i: number) => Promise<{ image: ImageBitmap; done(): void }>, show: (i: number, image: Shown, t: number) => void, failed: (e: Error) => void) {
  const begin = performance.now() - t.at(from);
  let alive = true;
  let raf = 0;
  let busy = false;
  let shown = -1;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const i = t.frameAt(performance.now() - begin);
    if (i === shown || busy) return;
    busy = true;
    next(i).then(
      (f) => {
        busy = false;
        try {
          if (alive) show(i, f.image, t.phase(i));
          shown = i;
        } finally {
          f.done();
        }
      },
      (e) => alive && failed(e instanceof Error ? e : new Error(String(e))),
    );
  };
  tick();
  return () => {
    alive = false;
    cancelAnimationFrame(raf);
  };
}

// ── video, through one <video> element per reader ──

async function videoMedia(s: Source): Promise<Media> {
  const clip = openClip(s.asset, s.name);
  let t0: number;
  try {
    t0 = await clip.start();
  } catch (e) {
    clip.close();
    throw e;
  }
  const fps = s.fps ?? DEFAULT_FPS;
  const frames = s.frames ?? 1;
  const { el } = clip;
  // one seek at a time: a second would cancel the first mid-way
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  };
  let stop: (() => void) | null = null;
  return {
    frame(i) {
      stop?.();
      return serial(() => clip.frame(i, t0, fps, frames));
    },
    play(o) {
      stop?.();
      let alive = true;
      let handle = 0;
      const each = (_: number, m: VideoFrameCallbackMetadata) => {
        if (!alive) return;
        const i = Math.min(frames - 1, Math.max(0, frameOf(m.mediaTime, t0, fps)));
        o.show(i, el, o.timing.phase(i));
        handle = el.requestVideoFrameCallback(each);
      };
      const end = () => {
        alive = false;
        el.cancelVideoFrameCallback(handle);
        el.pause();
        el.loop = false;
        if (stop === end) stop = null;
      };
      serial(async () => {
        if (!alive) return;
        handle = el.requestVideoFrameCallback(each); // before the seek, so its frame is the first shown
        await clip.seek(Math.min(seekTime(o.from, t0, fps), el.duration));
        if (!alive) return;
        el.loop = true;
        await el.play();
      }).catch((e) => {
        if (!alive) return;
        end();
        o.failed?.(e instanceof Error ? e : new Error(String(e)));
      });
      return (stop = end);
    },
    close() {
      stop?.();
      clip.close();
    },
  };
}

/** a <video> off the page, muted, and every wait on it bounded, so a file that won't play says why instead of hanging */
function openClip(url: string, name: string) {
  const el = document.createElement('video');
  el.muted = true;
  el.preload = 'auto';
  el.crossOrigin = 'anonymous'; // dt:// is another origin: without CORS its frames can't be read
  const problem = () => new Error(videoProblem(name, el.error && { code: el.error.code, message: el.error.message }));
  const stuck = `${name} stopped responding. Try opening it again, or export it as an H.264 MP4.`;

  /** resolves on `type`; rejects on the element's error, or after `ms` */
  const when = (type: string, ms: number, late: string) =>
    new Promise<void>((ok, fail) => {
      if (el.error) return fail(problem());
      const done = (then: () => void) => {
        clearTimeout(timer);
        el.removeEventListener(type, on);
        el.removeEventListener('error', bad);
        then();
      };
      const on = () => done(ok);
      const bad = () => done(() => fail(problem()));
      const timer = setTimeout(() => done(() => fail(new Error(late))), ms);
      el.addEventListener(type, on);
      el.addEventListener('error', bad);
    });

  const ready = when('loadedmetadata', OPEN_MS, `${name} didn't open within ${OPEN_MS / 1000} seconds. The file may be damaged, or too large to read here.`).then(() => {
    if (!el.videoWidth) throw new Error(videoProblem(name, null)); // the sound opened, the picture didn't
  });
  ready.catch(() => {}); // awaited by every read; this only keeps an early failure from going unhandled
  el.src = url;

  const seek = async (t: number) => {
    await ready;
    const seeked = when('seeked', SEEK_MS, stuck);
    el.currentTime = t;
    await seeked;
    // a file served without byte ranges can't seek: Chromium lands at 0 and shows its first frame
    if (Number.isFinite(el.duration) && Math.abs(el.currentTime - Math.min(t, el.duration)) > 1e-3)
      throw new Error(`${name} couldn't be read at ${t.toFixed(2)} s: the video only plays from the start here, so its frames can't be read one by one.`);
  };

  /**
   * Seeks to `t` and gives the frame now on screen (yours to close) and its time. It must be the one
   * rVFC says was presented: a copy taken before the new frame arrived would carry another mediaTime.
   */
  const present = async (t: number): Promise<{ vf: VideoFrame; ts: number }> => {
    await ready;
    for (let tries = 1; ; tries++) {
      let handle = 0;
      const presented = new Promise<number>((ok) => (handle = el.requestVideoFrameCallback((_, meta) => ok(meta.mediaTime))));
      await seek(t);
      const m = await Promise.race([presented, sleep(PRESENT_MS)]);
      el.cancelVideoFrameCallback(handle);
      let vf: VideoFrame;
      try {
        vf = new VideoFrame(el);
      } catch {
        throw new Error(`${name} gave no picture at ${t.toFixed(3)} s. ${videoProblem(name, null)}`);
      }
      const ts = vf.timestamp / 1e6;
      if (m === null || Math.abs(ts - m) < 1e-4) return { vf, ts };
      vf.close();
      if (tries === 3) throw new Error(`${name} couldn't be read exactly at ${t.toFixed(3)} s: the video kept showing another frame.`);
    }
  };

  /** the median step, in seconds, between frames presented at half speed (so a 60 fps clip presents every frame on a 60 Hz screen); null if none were */
  const playedStep = async (): Promise<number | null> => {
    const times: number[] = [];
    let handle = 0;
    const enough = new Promise<void>((ok) => {
      const each = (_: number, m: VideoFrameCallbackMetadata) => {
        times.push(m.mediaTime);
        if (times.length < 12) handle = el.requestVideoFrameCallback(each);
        else ok();
      };
      handle = el.requestVideoFrameCallback(each);
      el.addEventListener('ended', () => ok(), { once: true });
    });
    el.playbackRate = 0.5;
    try {
      await el.play();
      await Promise.race([enough, sleep(3000)]);
    } finally {
      el.cancelVideoFrameCallback(handle);
      el.pause();
      el.playbackRate = 1;
    }
    return typicalStep(times);
  };

  return {
    el,
    seek,

    /** the first frame's time, which frames count from */
    async start(): Promise<number> {
      const { vf, ts } = await present(0);
      vf.close();
      return ts;
    },

    /**
     * Size, frame rate and frame count. The period starts as the first frame's own duration when it is
     * exactly a rate (a container's is), else the step between frames presented while it plays, or the
     * own duration when the two agree (a recording's can be anything). A step read off WebM's 1 ms clock is still a little off, so
     * the period is measured again over spans that double, each counting its frames with the last
     * span's period, up to the last frame; the rate over that whole span is the clip's.
     */
    async measure(): Promise<{ w: number; h: number; fps: number; frames: number }> {
      const time = async (t: number) => {
        const p = await present(Math.max(0, t));
        p.vf.close();
        return p.ts;
      };
      const first = await present(0);
      const t0 = first.ts;
      const own = (first.vf.duration ?? 0) / 1e6;
      first.vf.close();
      // a container's own frame time, when it is exactly a rate, is the clip's (and needs no playing, which
      // a window that presents rarely, hidden or covered, would measure far off); a recording's can be anything
      const step = isCleanRate(own) ? null : await playedStep();
      let period = own && (!step || Math.abs(own - step) < 1.5e-3) ? own : (step ?? 1 / DEFAULT_FPS);
      // seeking to the very end shows no frame in some files, so also a quarter frame before it; a
      // live recording may not know its duration, and a seek past the end finds its last frame too
      const end = Number.isFinite(el.duration) ? el.duration : 1e9;
      const last = Math.max(await time(end), await time(end - period / 4));
      for (let k = 1; t0 + (2 * k + 0.5) * period < last; ) {
        const at = await time(t0 + (2 * k + 0.5) * period);
        const n = frameOf(at, t0, 1 / period);
        if (n <= k) break; // uneven frame times: the whole span decides
        [period, k] = [(at - t0) / n, n];
      }
      const n = frameOf(last, t0, 1 / period);
      const span = last - t0;
      // the file's own duration is exact (to the µs) where the span's times are only to the ms, so it
      // wins whenever the two agree to within that clock: an NTSC WebM stays 24000/1001
      const fps = own && (n === 0 || Math.abs(1 / own - n / span) * span < 1.5e-3 * (n / span)) ? snapFps(1 / own) : snapFps(n > 0 ? n / span : 1 / period);
      return { w: el.videoWidth, h: el.videoHeight, fps, frames: frameOf(last, t0, fps) + 1 };
    },

    /**
     * Frame `i`: the frame on screen at the middle of its time, as rVFC presented it, and never one
     * from after that time. A clip with uneven frame times (a phone or screen recording) gives what
     * a player shows at that moment.
     */
    async frame(i: number, t0: number, fps: number, frames: number): Promise<ImageBitmap> {
      if (!(Number.isInteger(i) && i >= 0 && i < frames)) throw new RangeError(`There is no frame ${i + 1}; ${name} has ${frames}.`);
      const t = Math.min(seekTime(i, t0, fps), el.duration);
      const { vf, ts } = await present(t);
      try {
        if (ts > t + 1e-4) throw new Error(`Frame ${i + 1} of ${name} couldn't be read exactly: the video showed a later one.`);
        return await createImageBitmap(vf, BITMAP);
      } finally {
        vf.close();
      }
    },

    close() {
      el.pause();
      el.removeAttribute('src');
      el.load(); // lets the decoder go now, not at garbage collection
    },
  };
}
