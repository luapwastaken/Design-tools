import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gifDelays, gifWriter, readGif, scaleUp, type Indexed } from '../src/renderer/lib/gif.ts';
import { budget } from './perf.ts';

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const BW: Indexed['palette'] = [[0, 0, 0], [255, 255, 255]];
const flat = (w: number, h: number, v = 0, palette = BW): Indexed => ({ indices: new Uint8Array(w * h).fill(v), w, h, palette });

test('delays carry their rounding: 30 fps is 3, 4, 3 hundredths and 30 frames last exactly 1 s', () => {
  const d = gifDelays(30, 30);
  assert.deepEqual(d.slice(0, 6), [3, 4, 3, 3, 4, 3]);
  assert.equal(sum(d), 100);
  assert.deepEqual(gifDelays(4, 12.5), [8, 8, 8, 8]);
  assert.deepEqual(gifDelays(3, 50), [2, 2, 2]);
});

test('every rate from 1 to 50 fps and every length up to 240 frames loops in exactly count / fps, to the hundredth', () => {
  for (let fps = 1; fps <= 50; fps += 0.25) {
    for (const count of [1, 2, 3, 7, 24, 25, 59, 60, 61, 119, 240]) {
      const d = gifDelays(count, fps);
      assert.equal(d.length, count);
      assert.equal(sum(d), Math.round((count * 100) / fps), `${count} frames at ${fps} fps`);
      // no frame ends more than half a hundredth from where it should
      let end = 0;
      d.forEach((x, i) => {
        end += x;
        assert.ok(Math.abs(end - ((i + 1) * 100) / fps) <= 0.5 + 1e-9);
        assert.ok(x >= 2);
      });
    }
  }
});

test("a GIF's own timing in ms comes back as it was, uneven holds included", () => {
  assert.deepEqual(gifDelays(5, [70, 70, 150, 30, 20]), [7, 7, 15, 3, 2]);
  assert.deepEqual(gifDelays(3, [33, 33, 34]), [3, 4, 3]);
  // fps worked out from a decoded GIF (10 frames of 70 ms) gives 7 each, not 7, 7, 7, 8
  assert.deepEqual(gifDelays(10, (10 * 1000) / 700), Array(10).fill(7));
});

test('a rate a GIF cannot play is refused, never written as 100 ms frames', () => {
  assert.throws(() => gifDelays(10, 60), /at most 50 frames a second/);
  assert.throws(() => gifDelays(4, [15, 15, 15, 15]), /at least 20 ms/);
  for (const bad of [0, -1, Number.NaN, Infinity]) assert.throws(() => gifDelays(1, bad), /above 0/);
  assert.throws(() => gifDelays(1, [700_000]), /655 seconds/);
});

test('the writer loops forever, clears every frame and keeps each delay; the reader counts whole frames only', () => {
  const g = gifWriter();
  const cs = [3, 4, 3, 15, 2];
  cs.forEach((c, i) => g.add(flat(5, 4, i % 2), c, 3));
  const bytes = g.finish();
  const info = readGif(bytes);
  assert.deepEqual([info.w, info.h], [15, 12]);
  assert.equal(info.loop, 0);
  assert.deepEqual(info.frames.map((f) => f.delay), cs);
  assert.ok(info.frames.every((f) => f.dispose === 2 && f.clear === null));
  // cut inside the last frame: four whole frames remain
  const lastFrame = bytes.lastIndexOf(0x2c);
  assert.equal(readGif(bytes.subarray(0, lastFrame + 12)).frames.length, 4);
  assert.throws(() => readGif(new TextEncoder().encode('\x89PNG\r\n\x1a\n.....')), /not a GIF/);
});

test('clear palette entries become the one clear index GIF has', () => {
  const g = gifWriter();
  const palette: Indexed['palette'] = [[255, 0, 0], [0, 0, 0, 0], [0, 0, 255], [9, 9, 9, 10]];
  g.add({ indices: Uint8Array.of(0, 1, 2, 3), w: 2, h: 2, palette }, 5);
  g.add({ indices: Uint8Array.of(0, 0, 2, 2), w: 2, h: 2, palette: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] }, 5);
  const [a, b] = readGif(g.finish()).frames;
  assert.equal(a.clear, 1);
  assert.equal(b.clear, null);
});

test('RGBA frames find their own colours; alpha makes a clear index', () => {
  const rgba = (a: number) => {
    const data = new Uint8ClampedArray(8 * 8 * 4);
    for (let p = 0; p < 64; p++) data.set([p * 4, 255 - p * 4, 90, p < 8 ? a : 255], p * 4);
    return { data, width: 8, height: 8 };
  };
  const g = gifWriter();
  g.add(rgba(255), 4);
  g.add(rgba(0), 4);
  const [solid, clear] = readGif(g.finish()).frames;
  assert.equal(solid.clear, null);
  assert.equal(typeof clear.clear, 'number');
});

test('the writer refuses frames that would make a broken GIF', () => {
  const g = gifWriter();
  g.add(flat(4, 4), 5);
  assert.throws(() => g.add(flat(5, 4), 5), /Frame 2 is 5 × 4 px, but the first frame is 4 × 4 px/);
  assert.throws(() => g.add({ indices: Uint8Array.of(0, 2, 0, 0), w: 2, h: 2, palette: BW }, 5, 2), /uses colour 3, but its palette has 2/);
  const many = Array.from({ length: 257 }, () => [0, 0, 0] as const);
  assert.throws(() => gifWriter().add(flat(1, 1, 0, many), 5), /1 to 256 colours/);
  assert.throws(() => gifWriter().add(flat(700, 1), 5, 100), /65,535 px a side/);
});

test('scaleUp turns each pixel into an s × s block, for indices and for RGBA words', () => {
  const src = Uint8Array.of(1, 2, 3, 4, 5, 6);
  assert.equal(scaleUp(src, 3, 2, 1), src);
  const big = scaleUp(src, 3, 2, 2);
  assert.deepEqual([...big], [1, 1, 2, 2, 3, 3, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 4, 4, 5, 5, 6, 6]);
  const words = scaleUp(Uint32Array.of(0xff0000ff, 0x00ff00ff), 2, 1, 3);
  assert.ok(words instanceof Uint32Array);
  assert.deepEqual([...words.subarray(0, 6)], [0xff0000ff, 0xff0000ff, 0xff0000ff, 0x00ff00ff, 0x00ff00ff, 0x00ff00ff]);
  assert.deepEqual([...words.subarray(12)], [...words.subarray(0, 6)]);
});

test('a 1920 × 1080 dithered frame (16 colours) goes into the GIF in under 80 ms', () => {
  const [w, h] = [1920, 1080];
  const indices = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) indices[y * w + x] = ((x * 15) / w + ((x ^ y) & 3) / 4) | 0;
  const palette = Array.from({ length: 16 }, (_, i) => [i * 16, i * 8, 255 - i * 16] as const);
  const g = gifWriter();
  g.add({ indices, w, h, palette }, 4); // warm up the encoder's tables
  const t = performance.now();
  g.add({ indices, w, h, palette }, 4);
  const ms = performance.now() - t;
  assert.ok(ms < budget(80), `${ms.toFixed(0)} ms`);
});
