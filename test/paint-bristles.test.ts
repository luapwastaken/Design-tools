import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BRISTLE_STRIDE, brushStep, brushWidth, makeBrush, type Brush, type BrushSpec, type StepOut } from '../src/renderer/tools/illustration/paint/bristles.ts';
import { NO_TILT, type Step } from '../src/renderer/tools/illustration/paint/input.ts';
import { framesOf, line, optionsOf, samplesOf, SHEET, type SheetStroke } from '../src/renderer/tools/illustration/paint/sheet-strokes.ts';
import { LiveStroke } from '../src/renderer/tools/illustration/paint/stroke.ts';
import { budget } from './perf.ts';

const out = (): StepOut => ({ bristles: new Float32Array(128 * BRISTLE_STRIDE), nBristles: 0, bodies: new Float32Array(64), nBodies: 0, pos: new Float32Array(128 * 64 * 4), prm: new Float32Array(128 * 64 * 4), box: null });
const spec = (o: Partial<BrushSpec> = {}): BrushSpec => ({ kind: 'round', tool: 'paint', medium: 'wet', size: 80, load: 0.8, seed: 7, ...o });
const step = (x: number, p: number, s = 500, ds = 4): Step => ({ x, y: 400, p, dx: 1, dy: 0, ds, s, tilt: NO_TILT, t: 0 });

/** one step well into a stroke (past the round's touch-down); each hair's amount and place across */
function hairs(b: Brush, p: number): { amt: number; y: number; hw: number }[] {
  const o = out();
  brushStep(b, step(1000, p), 0, o);
  const list: { amt: number; y: number; hw: number }[] = [];
  for (let i = 0; i < o.nBristles; i++) list.push({ amt: o.bristles[i * BRISTLE_STRIDE + 6], y: o.bristles[i * BRISTLE_STRIDE + 3], hw: o.bristles[i * BRISTLE_STRIDE + 4] });
  return list;
}
const footprint = (list: { amt: number; y: number; hw: number }[]) => {
  const on = list.filter((h) => h.amt > 0.05);
  return on.length ? Math.max(...on.map((h) => h.y + h.hw)) - Math.min(...on.map((h) => h.y - h.hw)) : 0;
};

test("a Round's middle hairs are longest, and at a light touch only a few of them reach the paper", () => {
  const b = makeBrush(spec());
  const middle = b.hairs.filter((h) => Math.abs(h.u) < 0.3);
  const sides = b.hairs.filter((h) => Math.abs(h.u) > 0.7);
  const mean = (l: typeof b.hairs) => l.reduce((t, h) => t + h.len, 0) / l.length;
  assert.ok(mean(middle) > mean(sides) + 0.1);
  const light = hairs(makeBrush(spec()), 0.1);
  const touching = light.filter((h) => h.amt > 0.5).length / b.hairs.length;
  assert.ok(touching <= 0.3, `${(touching * 100).toFixed(0)} % touch at pressure 0.1`);
});

test('a Round widens with pressure; a Flat keeps 0.88 of its size or more', () => {
  const widths = [0.1, 0.4, 0.7, 1].map((p) => footprint(hairs(makeBrush(spec()), p)));
  widths.forEach((w, i) => assert.ok(!i || w > widths[i - 1], `round ${widths}`));
  for (const p of [0.1, 0.5, 1]) {
    const w = footprint(hairs(makeBrush(spec({ kind: 'flat', medium: 'dry' })), p));
    assert.ok(w >= 0.88 * 80, `flat at ${p}: ${w}`);
  }
  assert.equal(brushWidth('flat', 100, 0), 88);
  assert.equal(brushWidth('round', 100, 1), 100);
});

test("the Dry brush's hairs cover under 0.7 of its width", () => {
  // its width is the footprint brushWidth() gives, not the span its random clumps happen to reach
  const width = brushWidth('dry', 80, 0.8);
  for (let seed = 1; seed <= 20; seed++) {
    const list = hairs(makeBrush(spec({ kind: 'dry', medium: 'dry', seed })), 0.8).filter((h) => h.amt > 0.05);
    const cells = new Uint8Array(Math.ceil(width));
    // the step sits at y 400, the footprint's middle
    for (const h of list) for (let y = Math.max(0, Math.floor(h.y - h.hw - (400 - width / 2))); y < Math.min(cells.length, Math.ceil(h.y + h.hw - (400 - width / 2))); y++) cells[y] = 1;
    const cover = cells.reduce((a, b) => a + b, 0) / cells.length;
    assert.ok(cover < 0.7, `seed ${seed}: ${cover}`);
  }
});

/** px a gouache brush travels before half its hairs run out */
function dryOut(load: number): number {
  const b = makeBrush(spec({ medium: 'dry', load }));
  const o = out();
  for (let s = 4; s < 20000; s += 4) {
    o.nBristles = 0;
    o.nBodies = 0;
    brushStep(b, step(s, 0.8, s), 0, o);
    if (b.hairs.filter((h) => h.load > 0.05).length < b.hairs.length / 2) return s;
  }
  return Infinity;
}

test('load runs down with travel, and a fuller brush goes further', () => {
  const b = makeBrush(spec({ medium: 'dry' }));
  const o = out();
  const means: number[] = [];
  for (let s = 4; s <= 1200; s += 4) {
    o.nBristles = 0;
    o.nBodies = 0;
    brushStep(b, step(s, 0.8, s), 0, o);
    if (s % 400 === 0) means.push(b.loadMean);
  }
  means.forEach((m, i) => assert.ok(!i || m < means[i - 1], `${means}`));
  const d = [0.2, 0.5, 0.8, 1].map(dryOut);
  d.forEach((v, i) => assert.ok(!i || v > d[i - 1], `${d}`));
});

test('the same seed gives the same brush; instances pack stride × count', () => {
  const a = makeBrush(spec({ seed: 11 }));
  const b = makeBrush(spec({ seed: 11 }));
  assert.deepEqual(a.hairs, b.hairs);
  assert.notDeepEqual(a.hairs, makeBrush(spec({ seed: 12 })).hairs);
  const o = out();
  brushStep(a, step(10, 1), 0, o);
  assert.equal(o.nBristles, a.hairs.length);
  assert.ok(o.bristles.subarray(o.nBristles * BRISTLE_STRIDE).every((v) => v === 0));
});

function fnv(h: number, f: Float32Array): number {
  const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength);
  for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i], 16777619) >>> 0;
  return h;
}

/** a stroke's CPU half, frame by frame as the engine runs it; its instance data hashed */
function replay(s: SheetStroke, k: number): { hash: number; ms: number[] } {
  const { first, frames, last } = framesOf(samplesOf(s, k));
  const live = new LiveStroke(optionsOf(s, k), first, k + 1);
  let hash = 2166136261;
  const ms: number[] = [];
  const run = (f: () => ReturnType<LiveStroke['frame']>) => {
    const t0 = performance.now();
    const r = f();
    ms.push(performance.now() - t0);
    const o = live.out;
    hash = fnv(hash, o.bristles.subarray(0, r.bristles * BRISTLE_STRIDE));
    hash = fnv(hash, o.bodies.subarray(0, r.bodies * 8));
    if (live.brush.pickup > 0) hash = fnv(hash, o.pos.subarray(0, r.steps * 128 * 4));
  };
  for (const batch of frames) run(() => live.frame(batch));
  run(() => live.frame([], { last }));
  return { hash, ms };
}

test('every sheet stroke runs its CPU half the same each time', () => {
  for (const [k, s] of SHEET.entries()) assert.equal(replay(s, k).hash, replay(s, k).hash, s.name);
});

test('a 200 px fling at 6000 px/s stays inside a frame budget on the CPU', () => {
  const fling: SheetStroke = { name: 'fling', cell: [0, 0], tool: 'paint', medium: 'dry', brush: 'flat', size: 200, load: 0.9, pigment: 'tiwhite', path: line(100, 1100, 1950, 150, 100, 1), ms: 350, pointer: 'mouse' };
  replay(fling, 99); // warm up
  // the best of three: a busy machine (npm test runs every file at once) spikes one run, not all of them
  const { ms } = [replay(fling, 99), replay(fling, 99), replay(fling, 99)].sort((x, y) => Math.max(...x.ms) - Math.max(...y.ms))[0];
  const mean = ms.reduce((a, b) => a + b, 0) / ms.length;
  assert.ok(mean <= budget(2), `mean ${mean.toFixed(2)} ms`);
  assert.ok(Math.max(...ms) <= budget(6), `max ${Math.max(...ms).toFixed(2)} ms`);
});
