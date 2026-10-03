// The Post FX document (plan: Document), the limits every edit keeps, the stack's own edits, and the
// timeline a document plays on: a clip's or a GIF's own frames, or for a still with moving effects
// a loop of `loop.seconds` at `loop.fps` whose last frame runs into the first (spec §3 Loop). Where
// the playhead rests is the view's (view-state.ts), not the document's: moving it is no edit, so
// Undo never has to step back over it.
import { BLENDS, defaultsOf, effectOf, type Blend, type EffectId, type Memory, type ParamValue } from './effects/index.ts';
import type { Source } from './media.ts';
import { timingOf, type Timing } from './media-time.ts';

export type { Blend, EffectId, ParamValue };

export type Layer = { id: string; effect: EffectId; on: boolean; opacity: number; blend: Blend; params: Record<string, ParamValue> };

export type { Source };

export type PostFxDoc = {
  source: Source | null;
  /** applied top to bottom */
  stack: Layer[];
  /** for stills with moving effects */
  loop: { seconds: number; fps: number };
};

export const LIMIT = {
  layers: 24,
  seconds: [0.5, 12] as [number, number],
  /** a GIF shows a frame for at least 20 ms */
  fps: [1, 50] as [number, number],
};

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v));

export const emptyDoc = (): PostFxDoc => ({ source: null, stack: [], loop: { seconds: 2, fps: 25 } });

/** the rules no edit may break, applied after each one */
export function fix(d: PostFxDoc): PostFxDoc {
  return { ...d, loop: { seconds: Math.round(clamp(d.loop.seconds, LIMIT.seconds) * 100) / 100, fps: Math.round(clamp(d.loop.fps, LIMIT.fps)) } };
}

// ── the timeline ─────────────────────────────────────────────────────────────────────────────

/** an effect that changes with time (grain, VHS, glitch, wave, light leak…) is on */
export const isMoving = (d: Pick<PostFxDoc, 'stack'>): boolean => d.stack.some((l) => l.on && effectOf(l.effect)?.moving);

/** media.ts's timing of one loop, and where its frames come from: the source's own, a loop made for a still, or one still frame */
export type Timeline = Timing & { kind: 'still' | 'loop' | 'gif' | 'video' };

export function timeline(d: Pick<PostFxDoc, 'source' | 'stack' | 'loop'>): Timeline {
  const s = d.source;
  if (s && (s.kind === 'gif' || s.kind === 'video')) return { ...timingOf(s.kind, { frames: s.frames ?? 1, fps: s.fps, delays: s.delays ?? null }, d.loop), kind: s.kind };
  const moving = isMoving(d);
  const t = timingOf('image', { frames: 1, fps: null, delays: null }, moving ? d.loop : { seconds: 0, fps: d.loop.fps });
  return { ...t, kind: moving ? 'loop' : 'still' };
}

/** when frame `i` starts, seconds */
export const startOf = (t: Timeline, i: number): number => t.at(i) / 1000;

/** how long frame `i` shows, ms */
export const frameMs = (t: Timeline, i: number): number => t.delays?.[i] ?? 1000 / t.fps;

/** the frame showing at `seconds` */
export const frameAt = (t: Timeline, seconds: number): number => (t.count < 2 ? 0 : t.frameAt(Math.max(0, seconds) * 1000 + 1e-3));

// ── the stack ────────────────────────────────────────────────────────────────────────────────

export const newId = (): string => crypto.randomUUID();

/** an effect at its defaults, on, normal, full opacity */
export function layerOf(effect: EffectId, params: Record<string, ParamValue> = {}): Layer {
  return { id: newId(), effect, on: true, opacity: 1, blend: 'normal', params: { ...defaultsOf(effect), ...params } };
}

export const mapLayer = (d: PostFxDoc, id: string, fn: (l: Layer) => Layer): PostFxDoc => ({ ...d, stack: d.stack.map((l) => (l.id === id ? fn(l) : l)) });

/** layer `from` moved to before slot `to` (0..n), for a drag or Alt+arrow */
export function moveLayer(d: PostFxDoc, from: number, to: number): PostFxDoc {
  const list = [...d.stack];
  const [l] = list.splice(from, 1);
  list.splice(to > from ? to - 1 : to, 0, l);
  return { ...d, stack: list };
}

export function duplicateLayer(d: PostFxDoc, id: string): { doc: PostFxDoc; copy: Layer | null } {
  const at = d.stack.findIndex((l) => l.id === id);
  if (at < 0 || d.stack.length >= LIMIT.layers) return { doc: d, copy: null };
  const copy = { ...d.stack[at], id: newId(), params: { ...d.stack[at].params } };
  return { doc: { ...d, stack: [...d.stack.slice(0, at + 1), copy, ...d.stack.slice(at + 1)] }, copy };
}

export const removeLayer = (d: PostFxDoc, id: string): PostFxDoc => ({ ...d, stack: d.stack.filter((l) => l.id !== id) });

export const isBlend = (v: unknown): v is Blend => BLENDS.some((b) => b.id === v);

/** a video-only effect (datamosh) has nothing to work on in a still or a GIF's loop of one image */
export const offered = (d: Pick<PostFxDoc, 'source'>, effect: EffectId): boolean => !effectOf(effect)?.videoOnly || d.source?.kind === 'video';

// ── effects with a memory ─────────────────────────────────────────────────────────────────────

/**
 * Datamosh smears one frame into the next, so a frame on its own is drawn after the ones before it. This
 * many: a second of 30 fps, whose smear a Refresh of a few per cent has mostly let go of. A sequence
 * from the first frame has all of them; stepping or playing carries on from wherever it was.
 */
export const RUN_IN = 30;

/** a layer whose effect remembers the frames before (datamosh) and is drawing */
export const remembers = (l: Layer): boolean => l.on && l.opacity > 0 && !!effectOf(l.effect)?.videoOnly;

/** a clip with a layer that remembers the frames before */
export const isStateful = (d: Pick<PostFxDoc, 'source' | 'stack'>): boolean => d.source?.kind === 'video' && d.stack.some(remembers);

/** the frames before `frame` that are its run-in: up to RUN_IN of them, in order */
export const runIn = (frame: number): number[] => {
  const n = Math.min(frame, RUN_IN);
  return Array.from({ length: n }, (_, k) => frame - n + k);
};

/**
 * The frames to run through the stack, in order, before `frame` so every stateful layer has its run-in,
 * or none when each one has it already (it last drew this frame or the one before, after enough
 * frames in a row).
 */
export function leadIn(frame: number, memory: readonly Memory[]): number[] {
  const need = Math.min(frame, RUN_IN);
  const ready = memory.every((m) => m && ((m.f === frame && m.run >= need) || (m.f === frame - 1 && m.run >= need - 1)));
  return ready ? [] : runIn(frame);
}
