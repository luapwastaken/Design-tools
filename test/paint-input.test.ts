import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StrokeInput, tiltShape, type Step } from '../src/renderer/tools/illustration/paint/input.ts';
import { INPUT } from '../src/renderer/tools/illustration/paint/tuning.ts';
import type { PointerSample } from '../src/renderer/tools/illustration/paint/types.ts';

const sample = (x: number, y: number, t: number, pressure: number | null = null): PointerSample => ({ x, y, t, pressure, tilt: null });

/** samples along path(u), u 0..1, `ms` long at `hz` */
function samples(path: (u: number) => [number, number], ms: number, hz: number, pressure: (u: number) => number | null = () => null): PointerSample[] {
  const n = Math.max(1, Math.round((ms / 1000) * hz));
  return Array.from({ length: n + 1 }, (_, k) => {
    const [x, y] = path(k / n);
    return sample(x, y, 1000 + (k * ms) / n, pressure(k / n));
  });
}

/** a whole stroke fed in batches of `batch` samples a frame; the last sample is the lift */
function run(list: PointerSample[], size: number, batch: number, pen = false, hold = false): Step[][] {
  const input = new StrokeInput({ size, pen, hold }, list[0]);
  const frames: Step[][] = [];
  const rest = list.slice(1, -1);
  for (let i = 0; i < rest.length; i += batch) frames.push(input.frame(rest.slice(i, i + batch)));
  frames.push(input.frame([], { last: list.at(-1) }));
  return frames;
}
const line = (x0: number, y0: number, x1: number, y1: number) => (u: number): [number, number] => [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
const wave = (u: number): [number, number] => [200 + 1400 * u, 600 + 180 * Math.sin(u * Math.PI * 3)];

test('a circle from 12 samples stays round (the old polygon was 3.4 % off)', () => {
  const r = 200;
  const circle = (u: number): [number, number] => [1000 + r * Math.cos(u * 2 * Math.PI), 640 + r * Math.sin(u * 2 * Math.PI)];
  const steps = run(samples(circle, 200, 60), 40, 1, true).flat();
  const worst = Math.max(...steps.map((s) => Math.abs(Math.hypot(s.x - 1000, s.y - 640) - r) / r));
  assert.ok(worst <= 0.005, `worst ${(worst * 100).toFixed(2)} %`);
});

test('steps are evenly spaced, the first dab is at pointer-down and the stroke ends at the lift', () => {
  const list = samples(wave, 900, 240, () => 0.8);
  const steps = run(list, 60, 4, true).flat();
  const ds = Math.min(INPUT.spacingMax, 60 * INPUT.spacing);
  assert.deepEqual([steps[0].x, steps[0].y], [list[0].x, list[0].y]);
  const end = steps.at(-1)!;
  assert.ok(Math.hypot(end.x - list.at(-1)!.x, end.y - list.at(-1)!.y) < 1e-9);
  for (let i = 1; i < steps.length - 1; i++) {
    const d = Math.hypot(steps[i].x - steps[i - 1].x, steps[i].y - steps[i - 1].y);
    assert.ok(Math.abs(d - ds) <= 0.1 * ds, `step ${i}: ${d.toFixed(2)} px apart, not ${ds}`);
  }
});

test('the paint keeps up: at 500 px/s the brush is 25 ms or less behind the pointer', () => {
  for (const hz of [125, 240]) {
    const list = samples(line(100, 300, 600, 300), 1000, hz);
    const input = new StrokeInput({ size: 40, pen: false }, list[0]);
    let last: Step | null = null;
    let worst = 0;
    for (const [i, e] of list.slice(1).entries()) {
      last = input.frame([e]).at(-1) ?? last;
      if (i > hz / 5 && last) worst = Math.max(worst, ((e.x - last.x) / 500) * 1000);
    }
    assert.ok(worst <= 25, `${hz} Hz: ${worst.toFixed(1)} ms behind`);
  }
});

test('a mouse gets full pressure when slow and at least the floor when fast, after a start taper', () => {
  const slow = run(samples(line(100, 300, 400, 300), 3000, 125), 40, 2).flat();
  const fast = run(samples(line(100, 600, 1900, 600), 300, 125), 40, 2).flat();
  const settled = (list: Step[]) => list.filter((s) => s.s > 40 * INPUT.taper && s.s < list.at(-1)!.s - 20);
  assert.ok(settled(slow).every((s) => s.p > 0.97), `slow ${Math.min(...settled(slow).map((s) => s.p))}`);
  const fastMid = settled(fast).slice(settled(fast).length / 2);
  assert.ok(fastMid.every((s) => s.p >= INPUT.speedFloor - 1e-9 && s.p < 0.45), `fast ${fastMid.map((s) => s.p.toFixed(2))}`);
  // the taper: thin at the start, full once the brush has travelled INPUT.taper × its size
  assert.ok(slow[0].p <= INPUT.taperFrom + 1e-9, `first dab ${slow[0].p}`);
  const full = 40 * INPUT.taper;
  const p = (share: number) => slow.find((s) => s.s >= share * full)!.p;
  assert.ok(p(0.2) < p(0.5) && p(0.5) < p(0.8) && p(1.05) > 0.97, [0.2, 0.5, 0.8, 1.05].map(p).join(' '));
});

test('a pen has no start taper: its own pressure', () => {
  const steps = run(samples(line(100, 300, 400, 300), 500, 240, () => 0.6), 40, 3, true).flat();
  assert.ok(steps.slice(0, -1).every((s) => Math.abs(s.p - 0.6) < 1e-6));
});

test('any batching of the samples gives the same steps', () => {
  const list = samples(wave, 700, 240, (u) => 0.3 + 0.6 * Math.sin(Math.PI * u));
  const one = run(list, 50, 1, true).flat();
  for (const batch of [2, 3, 4, 7, 10]) {
    const other = run(list, 50, batch, true).flat();
    assert.equal(other.length, one.length, `batch ${batch}`);
    other.forEach((s, i) => assert.deepEqual(s, one[i], `batch ${batch}, step ${i}`));
  }
});

test('a frame draws at most 64 steps: past that the spacing grows', () => {
  // a 12 px brush flung 1800 px in one frame
  const list = samples(line(100, 100, 1900, 1100), 16, 1000);
  const input = new StrokeInput({ size: 12, pen: false }, list[0]);
  const steps = input.frame(list.slice(1, -1));
  assert.ok(steps.length <= INPUT.maxSteps, `${steps.length} steps`);
  const gaps = steps.slice(2).map((s, i) => Math.hypot(s.x - steps[i + 1].x, s.y - steps[i + 1].y));
  assert.ok(Math.min(...gaps) > input.spacing * 3, `gaps from ${Math.min(...gaps)}`);
  const tail = input.frame([], { last: list.at(-1) });
  assert.ok(tail.length <= INPUT.maxSteps);
});

test('tilt widens a Round and shifts it toward the barrel', () => {
  assert.deepEqual(tiltShape(null), { widen: 1, ox: 0, oy: 0 });
  const up = tiltShape({ altitude: Math.PI / 2, azimuth: 0 });
  const half = tiltShape({ altitude: Math.PI / 4, azimuth: 0 });
  const flat = tiltShape({ altitude: 0, azimuth: Math.PI / 2 });
  assert.equal(up.widen, 1);
  assert.ok(half.widen > 1 && flat.widen > half.widen && flat.widen <= INPUT.tiltWiden + 1e-9);
  assert.ok(half.ox > 0 && Math.abs(half.oy) < 1e-9);
  assert.ok(flat.oy > 0 && Math.abs(flat.ox) < 1e-9);
});

test('a brush that turns with the stroke holds its first dab until it has a heading, then faces it', () => {
  // straight down at 700 px/s: the curve is a sample behind, so the first frames have no step but the first
  const list = samples(line(1000, 300, 1000, 900), 860, 125);
  const held = run(list, 90, 2, false, true);
  assert.equal(held[0].length, 0, 'nothing is drawn until the stroke has a heading');
  const steps = held.flat();
  assert.deepEqual([steps[0].x, steps[0].y], [list[0].x, list[0].y]);
  assert.ok(Math.abs(steps[0].dx) < 1e-9 && Math.abs(steps[0].dy - 1) < 1e-9, `first dab faces (${steps[0].dx}, ${steps[0].dy})`);
  // without the hold, the first dab is at pointer-down, facing right
  const prompt = run(list, 90, 2, false, false);
  assert.equal(prompt[0].length, 1);
  assert.deepEqual([prompt[0][0].dx, prompt[0][0].dy], [1, 0]);
});

test('a click, a tap or a wobble ends in a dab; a real stroke does not', () => {
  const tapped = (list: PointerSample[], size: number, pen = false, hold = false) => run(list, size, 2, pen, hold).flat().filter((s) => s.tap);
  // a click: one sample down, one up; held or not, a mouse dab is at the dab pressure
  for (const hold of [false, true]) {
    const click = tapped([sample(500, 500, 1000), sample(500, 500, 1090)], 80, false, hold);
    assert.equal(click.length, 1, `hold ${hold}`);
    assert.equal(click[0].p, INPUT.tapPressure);
    assert.deepEqual([click[0].x, click[0].y], [500, 500]);
  }
  // a pen's is its own pressure, never feather-light
  assert.equal(tapped([sample(500, 500, 1000, 0.6), sample(500, 500, 1090, 0.6)], 80, true)[0].p, 0.6);
  assert.equal(tapped([sample(500, 500, 1000, 0.05), sample(500, 500, 1090, 0.05)], 80, true)[0].p, INPUT.tapFloor);
  // a wobble of a few px is a whole dab too, a stroke that has travelled past the brush's size is none
  assert.equal(tapped(samples(line(500, 500, 510, 504), 90, 125), 80)[0].tap, 1);
  assert.equal(tapped(samples(line(500, 500, 700, 500), 300, 125), 80).length, 0);
  // and it all goes by the size: a drag that is a whole dab to a big brush is a part of one to a small one
  const drag30 = samples(line(500, 500, 530, 500), 400, 125);
  assert.equal(tapped(drag30, 400)[0].tap, 1);
  const small = tapped(drag30, 40)[0].tap!;
  assert.ok(small > 0 && small < 1, `small brush ${small}`);
});

test('a drag ends in less of a dab as it lengthens, with no jump and no bump (stippling is not dot or sliver)', () => {
  const size = 80;
  for (const pen of [false, true]) {
    let was = { w: 1, p: NaN };
    for (let len = 0; len <= size * INPUT.tapEnd + 10; len += 2) {
      const list = samples(line(500, 500, 500 + len, 500), 40 + len * 6, 125, () => (pen ? 0.6 : null));
      const dab = run(list, size, 2, pen).flat().find((s) => s.tap);
      const w = dab?.tap ?? 0;
      assert.ok(w <= was.w + 1e-9, `${len} px: dab ${w} after ${was.w}`);
      assert.ok(was.w - w <= 0.12, `${len} px: dab drops ${was.w} to ${w}`);
      if (dab) {
        assert.ok(!(Math.abs(dab.p - was.p) > 0.1), `${len} px: pressure jumps ${was.p} to ${dab.p}`);
        was.p = dab.p;
      }
      was.w = w;
    }
    assert.equal(was.w, 0, 'gone once the stroke has travelled its size');
  }
});
