// The screen for a document: its image drawn onto the page at the plate's size, screened by the
// worker (screen.worker.ts), and kept by the settings it came from. The view and every export ask
// here, so they all hold the same cells (the plan's one rule).
import { knockedOut, totalInk } from '../../../shared/halftone/coverage.ts';
import { pagePx, splitOf } from '../../../shared/halftone/screen.ts';
import { decodeImage } from '../../lib/load.ts';
import { fetchBlob } from '../common/take.ts';
import { overlapOf, type HalftoneDoc } from './doc.ts';
import type { Done, Failed, InkOut, Job, SourceIn } from './screen.worker.ts';

export type Screened = {
  /** every setting that shaped it */
  key: string;
  doc: HalftoneDoc;
  /** the page in print pixels, unrounded */
  page: { w: number; h: number };
  plate: { w: number; h: number };
  /** in the document's ink order */
  inks: (InkOut & { id: string })[];
  stats: { mean: number; peak: number }[];
  hist: Uint32Array;
  ms: number;
};

/** plate pixels across one cell: enough for each cell's mean to follow the image */
const PLATE_PER_CELL = 2.5;
/** and along a line screen's segment, which are shorter */
const PLATE_PER_SEGMENT = 1.25;
const MAX_PLATE = 8e6;
/** every ink's cells together, about 24 bytes each on each side of the worker */
const MAX_CELLS = 12e6;
/** a stochastic screen's plates are at print resolution, so it stops at this size */
export const MAX_FM = 120e6;

/** The plate's size for a document, or why it can't be screened. */
export function plateOf(d: HalftoneDoc): { w: number; h: number } | string {
  const page = pagePx(d.size);
  if (d.screen.shape === 'stochastic') {
    const n = Math.round(page.w) * Math.round(page.h);
    if (n > MAX_FM) return `A stochastic screen works print pixel by print pixel: ${Math.round(page.w).toLocaleString('en')} × ${Math.round(page.h).toLocaleString('en')} px at ${d.size.dpi} dpi is too many. Lower the DPI or the size.`;
    // the blue noise reads the plate between its pixels, so a third of print resolution loses nothing it can show
    const k = Math.min(1, Math.max(1 / 3, Math.sqrt(MAX_PLATE / n)));
    return { w: Math.max(1, Math.round(page.w * k)), h: Math.max(1, Math.round(page.h * k)) };
  }
  const pitch = d.size.dpi / d.screen.lpi;
  const split = splitOf(d.screen.shape);
  const k = Math.min(1, Math.max(PLATE_PER_CELL, PLATE_PER_SEGMENT * split) / pitch, Math.sqrt(MAX_PLATE / (page.w * page.h)));
  const cells = (page.w / pitch + 2) * (page.h / pitch + 2) * split * d.inks.length;
  if (cells > MAX_CELLS) return `${(cells / 1e6).toFixed(1)} million dots over ${d.inks.length === 1 ? 'the ink' : `${d.inks.length} inks`} is more than the view and the files can hold (${MAX_CELLS / 1e6} million). Lower the frequency or the size.`;
  return { w: Math.max(1, Math.round(page.w * k)), h: Math.max(1, Math.round(page.h * k)) };
}

const J = JSON.stringify;

function keysOf(d: HalftoneDoc, plate: { w: number; h: number }) {
  const sourceKey = J([d.source?.asset, d.size.w, d.size.h, d.fit, plate.w, plate.h]);
  const sepKey = J([sourceKey, d.mode, d.inks.map((i) => [i.colour, i.curve, i.process]), d.tone, d.paper.colour, overlapOf(d)]);
  const fm = d.screen.shape === 'stochastic';
  const inkKeys = d.inks.map((ink, n) => J([sepKey, n, fm ? [d.size.dpi, d.screen.gain] : [ink.angle, d.screen, d.size.dpi]]));
  return { sourceKey, sepKey, inkKeys, key: J(inkKeys) };
}

// ── the image, drawn onto the page at the plate's size ──

let bitmap: { asset: string; img: Promise<ImageBitmap> } | null = null;

/** the source at full resolution, decoded once while the tool shows (the Original view draws it too) */
export function sourceBitmap(d: HalftoneDoc): Promise<ImageBitmap> | null {
  const s = d.source;
  if (!s) return null;
  if (bitmap?.asset !== s.asset) {
    void bitmap?.img.then((b) => b.close(), () => {});
    bitmap = { asset: s.asset, img: fetchBlob(s.asset, s.name).then((blob) => decodeImage(blob, s.name)) };
    const mine = bitmap;
    mine.img.catch(() => bitmap === mine && (bitmap = null));
  }
  return bitmap.img;
}

/** where the image sits on the page, in page px: whole (contain) or filling it (cover) */
export function placement(d: HalftoneDoc): { x: number; y: number; w: number; h: number } | null {
  if (!d.source) return null;
  const page = pagePx(d.size);
  const k = (d.fit === 'cover' ? Math.max : Math.min)(page.w / d.source.w, page.h / d.source.h);
  const [w, h] = [d.source.w * k, d.source.h * k];
  return { x: (page.w - w) / 2, y: (page.h - h) / 2, w, h };
}

async function drawSource(d: HalftoneDoc, plate: { w: number; h: number }, key: string): Promise<SourceIn> {
  const img = await sourceBitmap(d)!;
  const page = pagePx(d.size);
  const at = placement(d)!;
  const k = plate.w / page.w;
  const ctx = new OffscreenCanvas(plate.w, plate.h).getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, at.x * k, at.y * (plate.h / page.h), at.w * k, at.h * (plate.h / page.h));
  return { key, w: plate.w, h: plate.h, rgba: ctx.getImageData(0, 0, plate.w, plate.h).data };
}

// ── the worker, one job at a time ──

type Want = { d: HalftoneDoc; key: string; keep: boolean; ok(s: Screened): void; fail(e: unknown): void };

/** a newer view request took this one's place */
export class Superseded extends Error {}

let worker: Worker | null = null;
let workerSource = '';
let seq = 0;
let latest: Screened | null = null;
/** the request the worker has now */
let running: Want | null = null;
const queue: Want[] = [];
/** false once the tool hides: the worker and the image go as soon as no export needs them */
let shown = true;

function start(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./screen.worker.ts', import.meta.url), { type: 'module' });
  workerSource = '';
  return worker;
}

/** the job in the worker's hands: releasing the worker ends it */
let inFlight: ((e: unknown) => void) | null = null;

function run(job: Job): Promise<Done> {
  const w = start();
  return new Promise<Done>((ok, fail) => {
    inFlight = fail;
    w.onmessage = ({ data }: MessageEvent<Done | Failed>) => data.id === job.id && ('error' in data ? fail(new Error(data.error)) : ok(data));
    w.onerror = (e) => fail(new Error(e.message || 'The screen stopped working.'));
    w.postMessage(job, job.source ? [job.source.rgba.buffer] : []);
  }).finally(() => (inFlight = null));
}

async function pump(): Promise<void> {
  if (running) return;
  for (let want = queue.shift(); want; want = queue.shift()) {
    running = want;
    try {
      want.ok(await compute(want.d, want.key));
    } catch (e) {
      want.fail(e);
    }
  }
  running = null;
  if (!shown) free();
}

async function compute(d: HalftoneDoc, key: string): Promise<Screened> {
  if (latest?.key === key) return latest;
  const plate = plateOf(d);
  if (typeof plate === 'string') throw new Error(plate);
  if (!d.source) throw new Error('There is no image to screen yet.');
  const k = keysOf(d, plate);
  const source = workerSource === k.sourceKey ? undefined : await drawSource(d, plate, k.sourceKey);
  const job: Job = {
    id: ++seq,
    source,
    sourceKey: k.sourceKey,
    sepKey: k.sepKey,
    inks: d.inks.map((i, n) => ({ colour: i.colour, curve: i.curve, process: i.process, angle: i.angle, key: k.inkKeys[n] })),
    mode: d.mode,
    tone: d.tone,
    paper: d.paper.colour,
    overlap: overlapOf(d),
    size: d.size,
    screen: d.screen,
  };
  let done: Done;
  try {
    done = await run(job);
    workerSource = k.sourceKey;
  } catch (e) {
    workerSource = '';
    throw e;
  }
  const inks = done.inks.map((ink, n) => ({ ...ink, id: d.inks[n].id }));
  latest = {
    key,
    doc: d,
    page: pagePx(d.size),
    plate: { w: done.plateW, h: done.plateH },
    inks,
    stats: done.stats,
    hist: done.hist,
    ms: done.ms,
  };
  return latest;
}

/**
 * The screen for `d`. A view request (`keep` false) gives way to the next one, rejecting with
 * Superseded; an export's is kept, so it gets exactly the document it asked for.
 */
export function screen(d: HalftoneDoc, keep = false): Promise<Screened> {
  if (!keep) shown = true;
  const plate = plateOf(d);
  const key = typeof plate === 'string' || !d.source ? `x${J(d)}` : keysOf(d, plate).key;
  if (latest?.key === key) return Promise.resolve(latest);
  return new Promise((ok, fail) => {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].keep) continue;
      queue[i].fail(new Superseded());
      queue.splice(i, 1);
    }
    queue.push({ d, key, keep, ok, fail });
    void pump();
  });
}

/** the screen for `d` if it's made already */
export function ready(d: HalftoneDoc): Screened | null {
  const plate = plateOf(d);
  return latest && d.source && typeof plate !== 'string' && latest.key === keysOf(d, plate).key ? latest : null;
}

/**
 * A hidden tool frees the worker's plates and the decoded image (foundation spec §4): the view's
 * requests stop now, an export's run on (it reports by toast) and the rest goes when it's done.
 */
export function releaseScreening(): void {
  shown = false;
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].keep) continue;
    queue[i].fail(new Superseded());
    queue.splice(i, 1);
  }
  if (running && !running.keep) {
    inFlight?.(new Superseded());
    worker?.terminate();
    worker = null;
  }
  if (!running && !queue.length) free();
}

function free(): void {
  worker?.terminate();
  worker = null;
  workerSource = '';
  latest = null;
  void bitmap?.img.then((b) => b.close(), () => {});
  bitmap = null;
}

/** the most ink is read over squares this big, whatever the plate's resolution (it differs by screen) */
const INK_SPOT_MM = 0.5;

/**
 * What the inks that show print: their dots, each ink's coverage in the screen's order (knocked
 * out, what its cut plate prints), and the most ink on any one spot (the meters' header).
 */
export function totals(s: Screened, d: HalftoneDoc): { dots: number; maxInk: number; stats: { mean: number; peak: number }[] } {
  const prints = s.inks.map((ink) => !!d.inks.find((i) => i.id === ink.id)?.visible);
  const block = Math.max(1, Math.round((s.plate.w * INK_SPOT_MM) / s.doc.size.w));
  const dots = s.inks.reduce((n, ink, i) => n + (prints[i] ? ink.count : 0), 0);
  const plates = s.inks.map((ink) => ink.plate);
  if (overlapOf(s.doc) === 'knockout') return { dots, ...knockedOut(plates, prints, s.plate.w, block) };
  return { dots, stats: s.stats, maxInk: totalInk(plates.filter((_, i) => prints[i]), s.plate.w, block) };
}
