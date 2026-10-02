// The painting engine (plan 2026-09-30 §4): one 2048 × 1280 painting on the GPU, its live stroke,
// undo and redo, the CPU copy, and the frames on screen.
//   The painting (base) is linear sRGB with the paint's height in alpha. A live stroke is drawn over
//   it every frame into shown; the lift copies that rect into base. Nothing runs after the lift, so
//   what was on screen at the lift is the painting, bit for bit, and it never changes on its own.
//   Frames are requested only while there are samples to draw: idle, there is no rAF, no timer and
//   no GPU work. Every change is read back in the background into the CPU copy (sRGB bytes and a
//   height byte), which serves Pick, saving, the blank test and recovery after a graphics reset.
import { gpuScope, GpuError, type Gpu, type Rect, type Texture } from '../../../lib/gpu/index.ts';
import { decodeImage } from '../../../lib/load.ts';
import { encodePng, isBlank, isV1, word } from './codec.ts';
import { History, type HistoryStep } from './history.ts';
import { beginStroke, compile, decode, drawStroke, encode, grown, lit, PAPER_BARE, screen, surfaces, warmUp, WHOLE, type Programs, type Surfaces } from './passes.ts';
import { LiveStroke } from './stroke.ts';
import { HEIGHT, UNDO_STEPS, WIDTH, type ChangeKind, type FrameLog, type PaintingState, type PointerSample, type Rgb, type StrokeOptions } from './types.ts';

const UNDO_BYTES = 160 * 2 ** 20;
/** rows per background read: one band per task */
const BAND = 256;
const FRAMES_KEPT = 600;

type Listeners = { change: Set<(kind: ChangeKind, state: PaintingState) => void>; error: Set<(err: Error) => void> };

/** what the smoke checks and the sheet reach past the public API for */
export type Internals = {
  g: Gpu;
  programs: Programs;
  surfaces: Surfaces;
  split: boolean;
  cpu: Uint8Array;
  settled(): Promise<void>;
  /** probes: set to time each frame on the GPU, whose ms land in gpuMs */
  timing: boolean;
  gpuMs: number[];
  /** how long create() took to compile, then to build every shader for its textures */
  startMs: { compile: number; ready: number };
};
export const internals = new WeakMap<PaintEngine, Internals>();

export class PaintEngine {
  /** compiles the programs (in parallel where the driver can) and makes the paper; rejects with GpuError when this GPU can't paint */
  static async create(o: { split?: boolean } = {}): Promise<PaintEngine> {
    const g = gpuScope('paint');
    try {
      const split = !!o.split || g.caps.drawBuffers < 5 || !g.caps.indexedBlend;
      const t0 = performance.now();
      const programs = await compile(g, split);
      const t1 = performance.now();
      const e = new PaintEngine(g, programs, split);
      await e.#ready();
      internals.get(e)!.startMs = { compile: Math.round(t1 - t0), ready: Math.round(performance.now() - t1) };
      return e;
    } catch (err) {
      g.release();
      throw err instanceof GpuError ? err : new GpuError(`This graphics card can't paint here: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  readonly #g: Gpu;
  readonly #p: Programs;
  #s: Surfaces;
  #history = new History<Texture<'rgba16f'>>({ steps: UNDO_STEPS, bytes: UNDO_BYTES });
  #blank = true;
  /** the CPU copy: sRGB bytes, height in alpha */
  #cpu = new Uint8Array(WIDTH * HEIGHT * 4);
  #paperWord = 0;
  /** background reads, snapshots and loads, in call order */
  #queue: Promise<unknown> = Promise.resolve();
  #listeners: Listeners = { change: new Set(), error: new Set() };
  #offRestore: () => void;

  #canvas: HTMLCanvasElement | null = null;
  #ctx: CanvasRenderingContext2D | null = null;
  #screen: Texture<'rgba8'> | null = null;
  #presents = 0;
  #frames: FrameLog[] = [];

  #live: LiveStroke | null = null;
  #samples: PointerSample[] = [];
  /** the first dab (or queued samples) wait for a frame */
  #due = false;
  #raf = 0;

  private constructor(g: Gpu, p: Programs, split: boolean) {
    this.#g = g;
    this.#p = p;
    this.#s = surfaces(g);
    this.#offRestore = g.onRestore(() => this.#restored());
    const e = this;
    internals.set(this, {
      g,
      programs: p,
      split,
      get surfaces() {
        return e.#s;
      },
      get cpu() {
        return e.#cpu;
      },
      settled: () => e.#queue.then(() => {}),
      timing: false,
      gpuMs: [],
      startMs: { compile: 0, ready: 0 },
    });
  }

  // ── the screen ──

  /** the on-screen canvas (a 2D context, alpha false), presented at its width × height attributes; null detaches */
  attach(canvas: HTMLCanvasElement | null): void {
    this.#canvas = canvas;
    this.#ctx = canvas?.getContext('2d', { alpha: false }) ?? null;
    this.resize();
  }

  /** after changing the attached canvas's width or height: presents once at the new size */
  resize(): void {
    const c = this.#canvas;
    if (!c || !c.width || !c.height) return;
    if (this.#screen?.width !== c.width || this.#screen.height !== c.height) {
      this.#screen?.release();
      this.#screen = this.#g.texture({ width: c.width, height: c.height }, 'rgba8', { filter: 'nearest' });
    }
    this.#present();
  }

  #present(): void {
    const c = this.#canvas;
    if (!c || !this.#ctx || !this.#screen || this.#g.lost) return;
    screen(this.#g, this.#p, this.#s, this.#screen);
    const bmp = this.#g.bitmap(this.#screen);
    if (!bmp) return;
    this.#ctx.drawImage(bmp, 0, 0);
    bmp.close();
    this.#presents++;
  }

  // ── the live stroke ──

  get stroking(): boolean {
    return !!this.#live;
  }

  /** painting px the brush laid at its last step: the ring's size during a stroke */
  get liveWidth(): number {
    return this.#live?.width ?? 0;
  }

  /** the first dab lands on the next frame (or at flush / end) */
  begin(o: StrokeOptions, first: PointerSample): void {
    if (this.#g.lost) return;
    if (this.#live) this.end();
    const seed = o.seed ?? 1 + Math.floor(Math.random() * 0xfffffe);
    this.#try(() => {
      const live = new LiveStroke(o, first, seed);
      beginStroke(this.#g, this.#p, this.#s, live);
      this.#live = live;
      this.#samples = [];
      this.#due = true;
      this.#schedule();
    });
  }

  /** coalesced samples in order; drawn on the next animation frame */
  move(samples: readonly PointerSample[]): void {
    if (!this.#live || !samples.length) return;
    this.#samples.push(...samples);
    this.#due = true;
    this.#schedule();
  }

  /** draws queued samples now (the sheet, tests, a hidden smoke window whose frames are throttled) */
  flush(): void {
    if (this.#live && this.#due) this.#frame();
  }

  /** the lift: draws what's queued, runs on to `last`, presents, and keeps the stroke as one undo step */
  end(last?: PointerSample): void {
    const live = this.#live;
    if (!live) return;
    this.#try(() => {
      this.#frame({ last });
      this.#live = null;
      this.#unschedule();
      const rect = live.total;
      if (!rect) return;
      const g = this.#g;
      const before = g.texture({ width: rect.w, height: rect.h }, 'rgba16f', { filter: 'nearest' });
      g.copy(this.#s.base, before, rect, { x: 0, y: 0 });
      g.copy(this.#s.shown, this.#s.base, rect);
      const was = this.#blank;
      if (live.o.tool === 'paint') this.#blank = false;
      this.#history.push({ kind: 'stroke', rect, bytes: rect.w * rect.h * 8, copy: before, blank: [was, this.#blank] });
      this.#changed('stroke', rect);
    });
    this.#live = null;
  }

  /** Esc: the painting as before the stroke, no undo step */
  cancel(): void {
    const live = this.#live;
    if (!live) return;
    this.#live = null;
    this.#samples = [];
    this.#unschedule();
    if (!live.total) return;
    this.#try(() => {
      this.#g.copy(this.#s.base, this.#s.shown, live.total!);
      lit(this.#g, this.#p, this.#s, grown(live.total!, 1));
      this.#present();
    });
  }

  #schedule(): void {
    if (!this.#raf) this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      if (this.#live && this.#due) this.#try(() => this.#frame());
    });
  }

  #unschedule(): void {
    cancelAnimationFrame(this.#raf);
    this.#raf = 0;
  }

  /** one frame of the live stroke: the queued samples as steps, their passes, and the screen */
  #frame(end?: { last?: PointerSample }): void {
    const live = this.#live!;
    const t0 = performance.now();
    const samples = this.#samples;
    this.#samples = [];
    this.#due = false;
    const f = live.frame(samples, end);
    const draw = () => {
      drawStroke(this.#g, this.#p, this.#s, live, f.steps, f.rect);
      if (f.rect) this.#present();
    };
    const probe = internals.get(this);
    if (probe?.timing) void this.#g.timeGpu(draw).then((ms) => ms !== null && probe.gpuMs.push(ms));
    else draw();
    const at = performance.now();
    this.#frames.push({ at, cpuMs: at - t0, steps: f.steps, bristles: f.bristles, oldestSample: f.oldest });
    if (this.#frames.length > FRAMES_KEPT) this.#frames.splice(0, this.#frames.length - FRAMES_KEPT);
  }

  // ── undo, redo, clear ──

  undo(): boolean {
    if (this.#live || this.#g.lost) return false;
    const step = this.#history.undo();
    if (!step) return false;
    this.#try(() => {
      this.#swap(step);
      this.#blank = step.blank[0];
      this.#changed('undo', step.rect);
    });
    return true;
  }

  redo(): boolean {
    if (this.#live || this.#g.lost) return false;
    const step = this.#history.redo();
    if (!step) return false;
    this.#try(() => {
      this.#swap(step);
      this.#blank = step.blank[1];
      this.#changed('redo', step.rect);
    });
    return true;
  }

  /** one undo step */
  clear(): void {
    if (this.#g.lost) return;
    if (this.#live) this.end();
    this.#try(() => {
      const g = this.#g;
      const copy = g.texture({ width: WIDTH, height: HEIGHT }, 'rgba16f', { filter: 'nearest' });
      g.copy(this.#s.base, copy, WHOLE);
      this.#history.push({ kind: 'clear', rect: WHOLE, bytes: WIDTH * HEIGHT * 8, copy, blank: [this.#blank, true] });
      g.clear([this.#s.base, this.#s.shown], PAPER_BARE);
      this.#blank = true;
      this.#changed('clear', WHOLE);
    });
  }

  get state(): PaintingState {
    const h = this.#history;
    return { depth: h.depth, redoDepth: h.redoDepth, lastIsClear: h.lastIsClear, blank: this.#blank };
  }

  /** the step's copy and the painting trade places over its rect, through the scratch texture (nothing is made) */
  #swap(step: HistoryStep<Texture<'rgba16f'>>): void {
    const g = this.#g;
    const { base, shown, scratch } = this.#s;
    const r = step.rect;
    const all = { x: 0, y: 0, w: r.w, h: r.h };
    g.copy(base, scratch, r);
    g.copy(step.copy, base, all, r);
    g.copy(step.copy, shown, all, r);
    g.copy(scratch, step.copy, r, { x: 0, y: 0 });
  }

  /** after any change to base: the look, the screen, the listeners, then the CPU copy in the background */
  #changed(kind: ChangeKind, rect: Rect): void {
    if (kind !== 'stroke') {
      lit(this.#g, this.#p, this.#s, grown(rect, 1));
      this.#present();
    }
    this.#emit(kind);
    this.#read(rect);
  }

  #emit(kind: ChangeKind): void {
    const state = this.state;
    for (const fn of [...this.#listeners.change]) fn(kind, state);
  }

  // ── the CPU copy ──

  /** `rect` of the painting into the CPU copy, band by band, behind whatever is queued */
  #read(rect: Rect): void {
    const write = this.#readBands(rect);
    this.#after(write);
  }

  /** reads `rect` as it is now, without waiting on the GPU; the function writes the bands into the CPU copy as they land */
  #readBands(rect: Rect): () => Promise<void> {
    const g = this.#g;
    encode(g, this.#p, this.#s, rect);
    const bands: { y: number; h: number; px: Promise<Uint8Array> }[] = [];
    for (let y = rect.y; y < rect.y + rect.h; y += BAND) {
      const h = Math.min(BAND, rect.y + rect.h - y);
      const px = g.readAsync(this.#s.encoded, { x: rect.x, y, w: rect.w, h });
      px.catch(() => {}); // a lost context: the bands stay as they were
      bands.push({ y, h, px });
    }
    return async () => {
      for (const b of bands) {
        const px = await b.px.catch(() => null);
        if (!px) continue;
        for (let row = 0; row < b.h; row++) this.#cpu.set(px.subarray(row * rect.w * 4, (row + 1) * rect.w * 4), ((b.y + row) * WIDTH + rect.x) * 4);
      }
    };
  }

  #after<T>(fn: () => T | Promise<T>): Promise<T> {
    const run = this.#queue.then(fn);
    this.#queue = run.catch(() => {});
    return run;
  }

  /** every shader built, then the blank painting's bytes (one pixel read, the rest filled), without blocking the page */
  async #ready(): Promise<void> {
    warmUp(this.#g, this.#p, this.#s);
    encode(this.#g, this.#p, this.#s, { x: 0, y: 0, w: 1, h: 1 });
    this.#paperWord = word(await this.#g.readAsync(this.#s.encoded, { x: 0, y: 0, w: 1, h: 1 }));
    new Uint32Array(this.#cpu.buffer).fill(this.#paperWord);
  }

  /** the painting's colour at a point (no relief), a 3×3 average; waits for a readback still under way */
  pick(x: number, y: number): Promise<Rgb> {
    return this.#after(() => {
      const cx = Math.min(WIDTH - 1, Math.max(0, Math.floor(x)));
      const cy = Math.min(HEIGHT - 1, Math.max(0, Math.floor(y)));
      const sum = [0, 0, 0];
      let n = 0;
      for (let j = Math.max(0, cy - 1); j <= Math.min(HEIGHT - 1, cy + 1); j++) {
        for (let i = Math.max(0, cx - 1); i <= Math.min(WIDTH - 1, cx + 1); i++) {
          const o = (j * WIDTH + i) * 4;
          for (let c = 0; c < 3; c++) sum[c] += toLinear(this.#cpu[o + c] / 255);
          n++;
        }
      }
      return sum.map((v) => toSrgb(v / n)) as Rgb;
    });
  }

  /** the painting as it is at the call, as a v2 PNG; null when blank. Encoded in a worker */
  snapshot(): Promise<Blob | null> {
    return this.#after(() => (this.#blank ? null : encodePng(this.#cpu.slice(), WIDTH, HEIGHT)));
  }

  /** a saved painting (v2, or v1 upscaled), or blank paper for null; clears history; never saves */
  load(png: Blob | null): Promise<void> {
    return this.#after(async () => {
      const bmp = png ? await decodeImage(png, 'The painting') : null;
      if (this.#g.lost) {
        bmp?.close();
        return;
      }
      if (this.#live) this.cancel();
      const g = this.#g;
      this.#history.reset();
      if (bmp) {
        try {
          const src = g.texture(bmp, 'rgba8', { filter: 'nearest' });
          decode(g, this.#p, this.#s, src, isV1(bmp.width, bmp.height));
          src.release();
        } finally {
          bmp.close();
        }
      } else g.clear([this.#s.base, this.#s.shown], PAPER_BARE);
      lit(g, this.#p, this.#s, WHOLE);
      this.#present();
      if (bmp) await this.#readBands(WHOLE)();
      else new Uint32Array(this.#cpu.buffer).fill(this.#paperWord);
      this.#blank = !bmp || isBlank(this.#cpu, this.#paperWord);
      this.#emit('load');
    });
  }

  /** a graphics reset: everything made again, the painting back from the CPU copy, its history gone */
  #restored(): void {
    this.#live = null;
    this.#samples = [];
    this.#unschedule();
    this.#history.reset();
    this.#try(() => {
      const g = this.#g;
      releaseSurfaces(this.#s);
      this.#s = surfaces(g);
      warmUp(g, this.#p, this.#s);
      const old = this.#screen;
      old?.release();
      this.#screen = old && g.texture({ width: old.width, height: old.height }, 'rgba8', { filter: 'nearest' });
      const src = g.texture({ width: WIDTH, height: HEIGHT, data: this.#cpu }, 'rgba8', { filter: 'nearest' });
      decode(g, this.#p, this.#s, src, false);
      src.release();
      lit(g, this.#p, this.#s, WHOLE);
      this.#present();
      this.#blank = isBlank(this.#cpu, this.#paperWord);
      this.#emit('restored');
    });
  }

  // ── events, probes, release ──

  on(type: 'change', fn: (kind: ChangeKind, state: PaintingState) => void): () => void;
  on(type: 'error', fn: (err: Error) => void): () => void;
  on(type: 'change' | 'error', fn: ((kind: ChangeKind, state: PaintingState) => void) | ((err: Error) => void)): () => void {
    const set = this.#listeners[type] as Set<typeof fn>;
    set.add(fn);
    return () => void set.delete(fn);
  }

  /** a frame or pass failed: the stroke is ended and the UI shows the message */
  #try(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.#live = null;
      this.#samples = [];
      this.#unschedule();
      const err = e instanceof Error ? e : new Error(String(e));
      if (!this.#listeners.error.size) reportError(err);
      for (const f of [...this.#listeners.error]) f(err);
    }
  }

  /** tests and probes only: synchronous GPU reads, never while painting */
  get probe(): { read(which: 'base' | 'shown', rect?: Rect): Float32Array; readonly presents: number; readonly frames: readonly FrameLog[] } {
    const self = this;
    return {
      read: (which, rect) => self.#g.read(which === 'base' ? self.#s.base : self.#s.shown, rect),
      get presents() {
        return self.#presents;
      },
      get frames() {
        return self.#frames;
      },
    };
  }

  release(): void {
    this.#live = null;
    this.#unschedule();
    this.#offRestore();
    this.#history.reset();
    this.#listeners.change.clear();
    this.#listeners.error.clear();
    this.#g.release();
    internals.delete(this);
  }
}

function releaseSurfaces(s: Surfaces): void {
  for (const v of Object.values(s)) for (const r of [v].flat(2)) r.release();
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
