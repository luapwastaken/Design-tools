// Dithered frames for a document: asked for by the view, the playback and the exports, made one at
// a time by the worker, and kept by the settings that made them. A view request gives way to the
// next one; the playback fills the rest of an animation in order behind it; an export's request is
// always kept, so it gets exactly the document it asked for (the plan's one rule).
import type { Oklch } from '../../../shared/color/index.ts';
import { createStore } from '../common/store.ts';
import type { Done, Failed, Job } from './dither.worker.ts';
import { used, workProblem, workSize, type DitherDoc } from './doc.ts';
import { settingsOf } from './engine.ts';
import { releaseSource, sourceId, workFrame, workKey } from './source.ts';

export type Result = {
  key: string;
  /** the key's part every frame of the document shares */
  doc: string;
  /** the source it came from (sourceId), so a result of another image is never shown for this one */
  src: string;
  frame: number;
  w: number;
  h: number;
  /** palette index per working pixel, into `colours` */
  indices: Uint8Array;
  colours: Oklch[];
  /** the frame's histogram before tone, sRGB luma */
  hist: Uint32Array;
  ms: number;
};

type Kind = 'view' | 'fill' | 'export';
type Want = { d: DitherDoc; frame: number; key: string; kind: Kind; ok(r: Result): void; fail(e: unknown): void };

/** a newer request of the view took this one's place */
export class Superseded extends Error {}

const J = JSON.stringify;
const BUDGET = 384e6;

// a document's palette can be 256 colours, and keys are asked for every frame of a fill and every
// tick of the playback: each document's shared part is made once
const docKeys = new WeakMap<DitherDoc, string>();
function docKey(d: DitherDoc): string {
  let k = docKeys.get(d);
  if (k === undefined) docKeys.set(d, (k = J([workKey(d, 0), settingsOf(d, used(d))])));
  return k;
}

export const resultKey = (d: DitherDoc, frame: number): string => `${frame}|${docKey(d)}`;

const cache = new Map<string, Result>();
/** the frames kept for each document, counted as they come and go */
const kept = new Map<string, Set<number>>();
let bytes = 0;

function forget(r: Result) {
  cache.delete(r.key);
  bytes -= r.indices.length;
  const frames = kept.get(r.doc);
  frames?.delete(r.frame);
  if (frames?.size === 0) kept.delete(r.doc);
}

/** bumped whenever a result is kept or all are freed, for the transport's count of made frames */
export const made = createStore(0);

function keep(r: Result) {
  if (cache.has(r.key)) return;
  cache.set(r.key, r);
  bytes += r.indices.length;
  if (!kept.has(r.doc)) kept.set(r.doc, new Set());
  kept.get(r.doc)!.add(r.frame);
  for (const [k, old] of cache) {
    if (bytes <= BUDGET || k === r.key) break;
    forget(old);
  }
  made.set(made.get() + 1);
}

/** the frame's result if it's made already */
export function ready(d: DitherDoc, frame: number): Result | null {
  if (!d.source) return null;
  const hit = cache.get(resultKey(d, frame));
  if (!hit) return null;
  cache.delete(hit.key);
  cache.set(hit.key, hit);
  return hit;
}

// ── the worker, one job at a time ──

let worker: Worker | null = null;
/** the frame the worker holds, so it isn't sent again */
let holds = '';
let seq = 0;
let running: Want | null = null;
let inFlight: ((e: unknown) => void) | null = null;
const queue: Want[] = [];
/** the animation the playback is filling in: from which frame, how far it got, how many may still be kept */
let fill: { d: DitherDoc; from: number; i: number; left: number } | null = null;
/** the document the last fill was for: it isn't started again for the same one */
let filled: DitherDoc | null = null;
let shown = true;

function start(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./dither.worker.ts', import.meta.url), { type: 'module' });
  holds = '';
  return worker;
}

function post(job: Job): Promise<Done> {
  const w = start();
  return new Promise<Done>((ok, fail) => {
    inFlight = fail;
    w.onmessage = ({ data }: MessageEvent<Done | Failed>) => data.id === job.id && ('error' in data ? fail(new Error(data.error)) : ok(data));
    w.onerror = (e) => fail(new Error(e.message || 'The dither stopped working.'));
    w.postMessage(job);
  }).finally(() => (inFlight = null));
}

async function compute(d: DitherDoc, frame: number, key: string): Promise<Result> {
  const hit = cache.get(key);
  if (hit) return hit;
  if (!d.source) throw new Error('There is no image to dither yet.');
  const why = workProblem(d);
  if (why) throw new Error(why);
  const colours = used(d);
  if (colours.length < 2) throw new Error('The dither needs at least two colours. Turn one back on in the palette.');
  const f = await workFrame(d, frame);
  const job: Job = { id: ++seq, frame: f.key, rgba: holds === f.key ? undefined : f.rgba, w: f.w, h: f.h, settings: settingsOf(d, colours) };
  let done: Done;
  try {
    done = await post(job);
    holds = f.key;
  } catch (e) {
    holds = '';
    throw e;
  }
  const r: Result = { key, doc: docKey(d), src: sourceId(d.source), frame, w: f.w, h: f.h, indices: done.indices, colours, hist: f.hist, ms: done.ms };
  keep(r);
  return r;
}

/** the next job: exports first, then the view, then the playback's fill */
function next(): Want | null {
  const at = queue.findIndex((w) => w.kind === 'export');
  if (at >= 0) return queue.splice(at, 1)[0];
  if (queue.length) return queue.shift()!;
  while (fill && fill.left > 0 && fill.i < fill.d.source!.frames) {
    const frame = (fill.from + fill.i++) % fill.d.source!.frames;
    const key = resultKey(fill.d, frame);
    if (cache.has(key)) continue;
    fill.left--;
    return { d: fill.d, frame, key, kind: 'fill', ok: () => {}, fail: () => {} };
  }
  fill = null;
  return null;
}

async function pump(): Promise<void> {
  if (running) return;
  for (let want = next(); want; want = next()) {
    running = want;
    try {
      want.ok(await compute(want.d, want.frame, want.key));
    } catch (e) {
      want.fail(e);
      // a frame that can't be made stops the fill: the view says why
      if (want.kind === 'fill') fill = null;
    }
  }
  running = null;
  if (!shown) free();
}

function dropViews() {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].kind === 'export') continue;
    queue[i].fail(new Superseded());
    queue.splice(i, 1);
  }
}

/**
 * Frame `frame` of `d`, dithered. A view request (the default) gives way to the next one,
 * rejecting with Superseded; an export's always runs.
 */
export function dithered(d: DitherDoc, frame: number, kind: 'view' | 'export' = 'view'): Promise<Result> {
  if (kind === 'view') shown = true;
  const hit = ready(d, frame);
  if (hit) return Promise.resolve(hit);
  const key = d.source ? resultKey(d, frame) : `x${J(d)}`;
  return new Promise((ok, fail) => {
    if (kind === 'view') dropViews();
    queue.push({ d, frame, key, kind, ok, fail });
    void pump();
  });
}

/** make every frame of the animation behind the view's requests, from `from` round to it (the playback) */
export function fillFrom(d: DitherDoc, from: number): void {
  if (!d.source || d.source.frames < 2 || workProblem(d)) return;
  const { w, h } = workSize(d);
  const room = Math.floor(BUDGET / Math.max(1, w * h));
  if (filled === d) return;
  filled = d;
  fill = { d, from: Math.max(0, from) % d.source.frames, i: 0, left: Math.min(d.source.frames, room) };
  void pump();
}

/** how many of the animation's frames are made for these settings */
export const madeCount = (d: DitherDoc): number => (d.source ? (kept.get(docKey(d))?.size ?? 0) : 0);

/**
 * A hidden tool frees the worker, the results and the decoded frames (foundation spec §4): the
 * view's requests stop now, an export's run on (it reports by toast) and the rest goes after it.
 */
export function releaseDither(): void {
  shown = false;
  fill = null;
  filled = null;
  dropViews();
  if (running && running.kind !== 'export') {
    inFlight?.(new Superseded());
    worker?.terminate();
    worker = null;
  }
  if (!running && !queue.length) free();
}

function free(): void {
  filled = null;
  worker?.terminate();
  worker = null;
  holds = '';
  cache.clear();
  kept.clear();
  bytes = 0;
  made.set(made.get() + 1);
  releaseSource();
}
