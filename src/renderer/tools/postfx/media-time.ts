// The arithmetic of Post FX's media (plan unit M), pure so node --test reaches it (media.ts itself
// needs the page): frame rates, which frame a video time is, one loop's timing, the GIF a loop
// becomes, and the plain words for a video that won't open.
import { unreadable } from '../../lib/load.ts';

export type MediaKind = 'image' | 'gif' | 'video' | 'sequence';
/** a still's loop, for effects that move (a clip or a GIF is its own loop) */
export type Loop = { seconds: number; fps: number };

export type Timing = {
  /** frames in one loop */
  count: number;
  /** their rate; a GIF's mean */
  fps: number;
  /** one loop's length: count / fps, or a GIF's delays added up */
  seconds: number;
  /** a GIF's own ms per frame, else null (every frame 1 / fps) */
  delays: readonly number[] | null;
  /** when frame `i` starts, ms into the loop */
  at(i: number): number;
  /** frame `i`'s place in the loop, [0, 1): the `t` moving effects take, so frame `count` is frame 0 again */
  phase(i: number): number;
  /** the frame showing `ms` into the loop, wrapping */
  frameAt(ms: number): number;
};

/** a clip too short to measure plays at this rate */
export const DEFAULT_FPS = 30;
/** a GIF shows a frame for at least 20 ms (lib/gif's gifDelays) */
const GIF_MAX_FPS = 50;

/** the rates that have an NTSC twin, n × 1000 / 1001 */
const NTSC = [24, 30, 48, 60, 120];

/**
 * A measured rate, snapped to what an encoder meant: the nearer of the whole rate and its NTSC twin
 * (24 or 24000/1001, only 0.1% apart), when within 0.5% (a recording's jitter); else as measured.
 */
export function snapFps(raw: number): number {
  if (!(raw > 0 && Number.isFinite(raw))) return DEFAULT_FPS;
  const whole = Math.round(raw);
  const twin = Math.round(raw * 1.001);
  const best = NTSC.includes(twin) && Math.abs(raw - (twin * 1000) / 1001) < Math.abs(raw - whole) ? (twin * 1000) / 1001 : whole;
  return best > 0 && Math.abs(raw - best) / best < 0.005 ? best : Math.round(raw * 1000) / 1000;
}

/**
 * Whether a frame's own duration is exactly a whole rate's or an NTSC twin's, as a container writes
 * it (40 ms, 1001/24000 s). A step read off a recording's clock is only near one, so it never is.
 */
export function isCleanRate(period: number): boolean {
  const fps = 1 / period;
  const snapped = snapFps(fps);
  const clean = Number.isInteger(snapped) || NTSC.some((n) => Math.abs(snapped - (n * 1000) / 1001) < 1e-9);
  return Number.isFinite(fps) && clean && Math.abs(fps - snapped) / snapped < 0.001;
}

/**
 * The step between presented frames (media times in seconds, in order): the mean of the steps near
 * the median, so a dropped or late frame doesn't count and a clock's rounding (WebM's 1 ms: 17, 16,
 * 17 ms for 1/60 s) averages out. Null for none.
 */
export function typicalStep(times: readonly number[]): number | null {
  const steps = times
    .slice(1)
    .map((t, k) => t - times[k])
    .filter((d) => d > 1e-4)
    .sort((a, b) => a - b);
  if (!steps.length) return null;
  const mid = steps[steps.length >> 1];
  const near = steps.filter((d) => Math.abs(d - mid) < mid / 4);
  return near.reduce((a, b) => a + b, 0) / near.length;
}

/** which frame a presented frame is, from its media time; `t0` is the first frame's */
export const frameOf = (mediaTime: number, t0: number, fps: number): number => Math.round((mediaTime - t0) * fps) + 0; // + 0: never -0

/** where to seek for frame `i`: the middle of its time on screen, so timestamps a little early or late still land on it */
export const seekTime = (i: number, t0: number, fps: number): number => t0 + (i + 0.5) / fps;

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** one loop: a clip's or a GIF's own frames, or a still's `loop.seconds × loop.fps` (at least one) */
export function timingOf(kind: MediaKind, own: { frames: number; fps: number | null; delays: readonly number[] | null }, loop: Loop): Timing {
  if (kind === 'gif' && own.delays?.length) return byDelays(own.delays);
  const fps = kind === 'image' ? loop.fps : (own.fps ?? DEFAULT_FPS);
  if (!(fps > 0 && Number.isFinite(fps))) throw new Error(`The frame rate has to be above 0, not ${fps}.`);
  const count = kind === 'image' ? Math.max(1, Math.round(loop.seconds * fps)) : Math.max(1, own.frames);
  const ms = 1000 / fps;
  return {
    count,
    fps,
    seconds: count / fps,
    delays: null,
    at: (i) => i * ms,
    phase: (i) => mod(i, count) / count,
    frameAt: (t) => Math.min(count - 1, Math.floor(mod(t, count * ms) / ms + 1e-9)),
  };
}

function byDelays(delays: readonly number[]): Timing {
  const starts = [0];
  for (const d of delays) starts.push(starts[starts.length - 1] + d);
  const count = delays.length;
  const total = starts[count];
  return {
    count,
    fps: (count * 1000) / total,
    seconds: total / 1000,
    delays,
    at: (i) => starts[mod(i, count)],
    phase: (i) => starts[mod(i, count)] / total,
    frameAt(t) {
      const x = mod(t, total) + 1e-9;
      let [lo, hi] = [0, count - 1];
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= x) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
  };
}

export type GifPlan = {
  /** the loop's frame each GIF frame shows */
  frames: number[];
  /** each GIF frame's ms; they add up to the loop's length */
  delays: number[];
};

/**
 * The GIF of one loop. A GIF plays at most 50 frames a second, so a faster clip keeps every second
 * (or third) frame, and the last frame holds for what is left, so the loop keeps its length exactly.
 * Refused, with the reason, past `max` frames.
 */
export function gifPlan(t: Pick<Timing, 'count' | 'fps' | 'delays'>, max: number): GifPlan {
  // a GIF's own frames are within `max` already (lib/frames refuses longer ones)
  if (t.delays) return { frames: [...Array(t.count).keys()], delays: [...t.delays] };
  const step = Math.max(1, Math.ceil(t.fps / GIF_MAX_FPS - 1e-9));
  const n = Math.max(1, Math.floor(t.count / step));
  if (n > max) {
    const slower = step > 1 ? ` (${n.toLocaleString('en')} at the ${fmtFps(t.fps / step)} fps a GIF can play)` : '';
    throw new Error(`A GIF here holds at most ${max} frames; this loop is ${t.count.toLocaleString('en')}${slower}. Export a PNG sequence, or make it shorter.`);
  }
  const ms = 1000 / t.fps;
  return {
    frames: Array.from({ length: n }, (_, k) => k * step),
    delays: Array.from({ length: n }, (_, k) => (k < n - 1 ? step : t.count - k * step) * ms),
  };
}

export const fmtFps = (fps: number): string => String(Math.round(fps * 100) / 100);

const VIDEO_EXTS = /\.(mp4|m4v|webm|mov|mkv|ogv|avi|wmv|mpe?g|3gp|flv|mxf)$/i;

/** a file to open as a video: by its type, or by its extension when the type is vague */
export const isVideoFile = (type: string, name: string): boolean => type.startsWith('video/') || (!type.startsWith('image/') && VIDEO_EXTS.test(name));

/**
 * Why a video didn't open, in plain words (short enough to fit a toast's one line), from what Chromium reported: its MediaError code (3
 * decode, 4 not supported) and message, or neither when it opened with no picture Chromium can
 * decode (a ProRes .mov can open as its sound alone).
 */
export function videoProblem(name: string, error: { code: number; message: string } | null): string {
  const msg = error?.message ?? '';
  if (/COULD_NOT_OPEN|COULD_NOT_PARSE|open context failed/i.test(msg) || (error?.code === 3 && !/codec|decoder/i.test(msg)))
    return unreadable(name, 'a video', 'The file may be damaged or incomplete.');
  return `${name} can't be decoded here (ProRes, DNxHR, some HEVC). Re-export as H.264 MP4 or VP9 WebM.`;
}
