import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex } from '../src/shared/color/index.ts';
import { ALGORITHMS } from '../src/shared/dither/algorithms.ts';
import { fix, frameMs, gifLimit, loopMs, moveColour, NEUTRAL_TONE, outSize, scaleOf, used, workProblem, workSize, type DitherDoc, type Source } from '../src/renderer/tools/dither/doc.ts';
import { linearOf, run } from '../src/renderer/tools/dither/engine.ts';
import { emptyDoc, isLook, LOOKS, presetOf, PRESETS, withLook } from '../src/renderer/tools/dither/looks.ts';
import { runsSvg } from '../src/renderer/tools/dither/svg.ts';
import { budget } from './perf.ts';

const still = (w: number, h: number): Source => ({ assets: ['dt://asset/dither/x.png'], name: 'x', w, h, fps: null, delays: null, frames: 1 });
const withSource = (d: DitherDoc, w: number, h: number): DitherDoc => ({ ...d, source: still(w, h) });

test('a new document is a 1-bit Mac look, Atkinson at pixel size 2, with no image (spec §5 q5)', () => {
  const d = emptyDoc();
  assert.equal(d.source, null);
  assert.equal(d.pixel, 2);
  assert.equal(d.algorithm, 'atkinson');
  assert.deepEqual(used(d).map(toHex), ['#000000', '#ffffff']);
  assert.ok(isLook(d, LOOKS[0]));
});

test('the working size is the image over the pixel size, so a block is exactly the pixel size in the file', () => {
  const d = withSource({ ...emptyDoc(), pixel: 8 }, 1920, 1080);
  assert.deepEqual(workSize(d), { w: 240, h: 135 });
  assert.deepEqual(workSize({ ...d, pixel: 1 }), { w: 1920, h: 1080 });
  assert.deepEqual(workSize({ ...d, pixel: 32, source: still(10, 10) }), { w: 1, h: 1 }, 'never below one block');
});

test('an image too big to dither at once is refused with the pixel size that fits, never frozen on', () => {
  const d = withSource({ ...emptyDoc(), pixel: 1 }, 12000, 8000);
  assert.match(workProblem(d)!, /pixel size of 3 or more/);
  assert.notEqual(workProblem({ ...d, pixel: 2 }), null);
  assert.equal(workProblem({ ...d, pixel: 3 }), null);
});

test('a look sets the palette, algorithm and tone, and leaves the image, the pixel size and resampling alone', () => {
  const d = { ...withSource(emptyDoc(), 100, 100), pixel: 5, resample: 'nearest' as const, tone: { ...NEUTRAL_TONE, gamma: 2 } };
  const gb = withLook(d, LOOKS.find((l) => l.id === 'gameboy')!);
  assert.equal(gb.pixel, 5);
  assert.equal(gb.resample, 'nearest');
  assert.equal(gb.source, d.source);
  assert.equal(gb.tone.gamma, 1, 'a look starts from neutral tone');
  assert.equal(used(gb).length, 4);
  assert.ok(isLook(gb, LOOKS.find((l) => l.id === 'gameboy')!));
  assert.ok(!isLook({ ...gb, strength: 0.5 }, LOOKS.find((l) => l.id === 'gameboy')!), 'an edit makes it your own');
});

test('every look is a real algorithm and a real preset, and the ten are distinct', () => {
  assert.equal(LOOKS.length, 10);
  assert.equal(new Set(LOOKS.map((l) => `${l.preset} ${l.algorithm}`)).size, LOOKS.length);
  for (const l of LOOKS) {
    assert.ok(ALGORITHMS.some((a) => a.id === l.algorithm), l.algorithm);
    assert.ok(presetOf(l.preset), l.preset);
  }
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
  for (const p of PRESETS) assert.ok(p.colours.length >= 2 && p.colours.length <= 256, p.name);
});

test('the export block follows the pixel size: a scale is a multiple of it, never a block of its own', () => {
  const d = withSource({ ...emptyDoc(), pixel: 8 }, 200, 120);
  assert.equal(scaleOf(d, { times: 1 }), 8);
  assert.equal(scaleOf({ ...d, pixel: 2 }, { times: 1 }), 2, 'a new pixel size is what the files get');
  assert.equal(scaleOf(d, { times: 3 }), 24);
  assert.equal(scaleOf(d, { times: 0 }), 1, 'or one pixel a block');
  assert.deepEqual(outSize(d, scaleOf(d, { times: 2 })), { w: 400, h: 240 });
});

test('the Game Boy look lays lightness along its four greens, as the Camera did', () => {
  const gb = withLook(emptyDoc(), LOOKS.find((l) => l.id === 'gameboy')!);
  assert.equal(gb.tone.map, true);
  // a sky lighter than the lightest green still steps through the greens instead of flattening on one
  const sky = new Float32Array(64 * 3);
  for (let x = 0; x < 64; x++) sky.fill(0.3 + (0.7 * x) / 63, x * 3, x * 3 + 3);
  assert.ok(new Set(run(sky, 64, 1, { ...gb, colours: used(gb) })).size >= 3);
});

test('moving a colour puts it before the slot it is dropped on, either way', () => {
  const d = withLook(emptyDoc(), LOOKS.find((l) => l.id === 'gray4')!);
  const hexes = (x: DitherDoc) => x.palette.colours.map((c) => toHex(c.oklch));
  const [a, b, c, e] = hexes(d);
  assert.deepEqual(hexes(moveColour(d, 0, 2)), [b, a, c, e]);
  assert.deepEqual(hexes(moveColour(d, 3, 0)), [e, a, b, c]);
  assert.deepEqual(hexes(moveColour(d, 1, 4)), [a, c, e, b]);
});

test('edits keep the document in range', () => {
  const d = fix({ ...emptyDoc(), pixel: 99.4, strength: 3, seed: -5, tone: { black: -1, white: 2, gamma: 0, contrast: 9, map: false }, source: { ...still(10, 10), fps: 240, frames: 5 } });
  assert.deepEqual([d.pixel, d.strength, d.seed, d.source!.fps], [32, 1, 0, 60]);
  assert.deepEqual([d.tone.black, d.tone.white, d.tone.gamma, d.tone.contrast], [0, 1, 0.2, 1]);
});

test("a GIF keeps its own timing until the rate is changed; the loop is the frames' sum", () => {
  const gif: Source = { ...still(10, 10), fps: 10, delays: [100, 100, 250], frames: 3 };
  assert.equal(frameMs(gif, 2), 250);
  assert.equal(loopMs(gif), 450);
  const rated = { ...gif, fps: 12, delays: null };
  assert.equal(frameMs(rated, 2), 1000 / 12);
  assert.equal(loopMs(rated), 250);
});

test('the SVG draws runs of blocks, one path per colour, over a rect of the commonest', () => {
  const colours = emptyDoc().palette.colours.map((c) => c.oklch);
  // 0 0 1 / 1 1 1: white is the commonest
  const svg = runsSvg(Uint8Array.of(0, 0, 1, 1, 1, 1), 3, 2, colours, 8);
  assert.match(svg, /width="24" height="16" viewBox="0 0 3 2"/);
  assert.match(svg, /<rect width="3" height="2" fill="#ffffff"\/>/);
  assert.match(svg, /<path fill="#000000" d="M0 0h2v1h-2z"\/>/);
  assert.equal((svg.match(/<path/g) ?? []).length, 1);
});

test('transparency flattens on white, and the engine never writes to the image it is given', () => {
  const lin = linearOf(Uint8ClampedArray.of(0, 0, 0, 0, 0, 0, 0, 255), 2);
  assert.deepEqual([...lin.slice(0, 3)], [1, 1, 1]);
  assert.deepEqual([...lin.slice(3)], [0, 0, 0]);
  const img = Float32Array.from({ length: 64 * 3 }, (_, i) => (i % 192) / 191);
  const copy = img.slice();
  const d = { ...emptyDoc(), tone: { ...NEUTRAL_TONE, gamma: 2, map: true } };
  run(img, 8, 8, { ...d, colours: used(d) });
  assert.deepEqual(img, copy);
});

test('the gradient map follows the palette order: reversed, black comes out white', () => {
  const d = { ...emptyDoc(), tone: { ...NEUTRAL_TONE, map: true } };
  const black = new Float32Array(4 * 3);
  const s = { algorithm: d.algorithm, strength: 1, serpentine: true, seed: 1, tone: d.tone };
  const shown = (colours: ReturnType<typeof used>, tone = d.tone) => [...new Set(run(black, 2, 2, { ...s, tone, colours }))].map((i) => toHex(colours[i]));
  assert.deepEqual(shown(used(d)), ['#000000']);
  assert.deepEqual(shown(used(d).reverse()), ['#ffffff']);
  assert.deepEqual(shown(used(d).reverse(), NEUTRAL_TONE), ['#000000'], 'off, colours match as they are');
});

test('a 1080p frame at pixel size 2 dithers, toned and gradient mapped, in a fifth of a second', () => {
  const [w, h] = [960, 540];
  const img = new Float32Array(w * h * 3);
  for (let p = 0; p < w * h; p++) img.fill(((p % w) / w) ** 2.2, p * 3, p * 3 + 3);
  const d = withLook(emptyDoc(), LOOKS.find((l) => l.id === 'pico8')!);
  const s = { algorithm: 'floyd-steinberg' as const, strength: 1, serpentine: true, seed: 1, tone: { ...NEUTRAL_TONE, contrast: 0.2, map: true }, colours: used(d) };
  run(img, w, h, s);
  // the best of three, so a pause elsewhere in the run doesn't count against it
  const ms = Math.min(
    ...[0, 1, 2].map(() => {
      const t0 = performance.now();
      run(img, w, h, s);
      return performance.now() - t0;
    }),
  );
  assert.ok(ms < budget(200), `${ms.toFixed(0)} ms`);
});

test('an animation faster than a GIF plays says so before any frame is made', () => {
  const at = (fps: number, delays: number[] | null = null): DitherDoc => ({ ...emptyDoc(), source: { ...still(64, 48), fps, delays, frames: 12 } });
  assert.equal(gifLimit(at(24)), null);
  assert.equal(gifLimit(at(50)), null);
  assert.match(String(gifLimit(at(60))), /at most 50 frames a second/);
  // a GIF's own timing counts, not its rounded rate
  assert.equal(gifLimit(at(60, Array(12).fill(20))), null);
  assert.equal(gifLimit(emptyDoc()), null);
});
