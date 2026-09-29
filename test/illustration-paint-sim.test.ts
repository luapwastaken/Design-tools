import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOklch } from '../src/shared/color/index.ts';
import { paintOf } from '../src/shared/paint/km.ts';
import { PIGMENTS, type Pigment } from '../src/shared/paint/pigments.ts';
import { PaintSim, UNDO_STEPS, type Loaded, type Rgb, type StrokeOptions } from '../src/renderer/tools/illustration/paint-sim.ts';
import { addToWell, DEFAULT_PAINT, paintSettings, sourcesOf, WELL_MAX, wellMix } from '../src/renderer/tools/illustration/paint-sources.ts';
import type { Swatch } from '../src/shared/types.ts';

const P = Object.fromEntries(PIGMENTS.map((p) => [p.id, p])) as Record<string, Pigment>;
const loaded = (id: string): Loaded => ({ paint: paintOf(P[id]), opacity: P[id].opacity, granulation: 0 });
const opts = (id: string, o: Partial<StrokeOptions> = {}): StrokeOptions => ({ tool: 'paint', medium: 'dry', size: 20, load: 1, loaded: loaded(id), ...o });

function stroke(sim: PaintSim, o: StrokeOptions, from: [number, number], to: [number, number]) {
  sim.begin(o, ...from);
  for (let i = 1; i <= 20; i++) sim.to(from[0] + ((to[0] - from[0]) * i) / 20, from[1] + ((to[1] - from[1]) * i) / 20);
  sim.end();
}
const at = (sim: PaintSim, x: number, y: number): Rgb => {
  const j = (y * sim.w + x) * 3;
  return [sim.col[j], sim.col[j + 1], sim.col[j + 2]];
};
const dry = (sim: PaintSim) => assert.ok(sim.settle() && !sim.wet);
const same = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return a.length === b.length;
};
const hueOf = (c: Rgb) => toOklch({ mode: 'rgb', r: c[0], g: c[1], b: c[2] })[2];

test('a stroke paints along its path and leaves the rest of the paper untouched', () => {
  const sim = new PaintSim(160, 100);
  stroke(sim, opts('cadred'), [20, 50], [140, 50]);
  const mid = at(sim, 80, 50);
  assert.ok(mid[0] > 0.7 && mid[1] < 0.4, `red in the middle: ${mid}`);
  assert.deepEqual(at(sim, 80, 5), [1, 1, 1]);
  assert.deepEqual(at(sim, 80, 95), [1, 1, 1]);
});

test('a pass covers evenly across the brush: no build-up in the middle from overlapping dabs', () => {
  const sim = new PaintSim(200, 100);
  stroke(sim, opts('ultra', { medium: 'wet', size: 40, load: 0.6 }), [20, 50], [180, 50]);
  const middle = at(sim, 100, 50);
  const aside = at(sim, 100, 38);
  assert.ok(Math.abs(middle[2] - aside[2]) < 0.05 && Math.abs(middle[0] - aside[0]) < 0.08, `${middle} vs ${aside}`);
});

test('a blue glaze over dry yellow mixes as paint: green, not the grey a straight blend makes', () => {
  const sim = new PaintSim(160, 120);
  stroke(sim, opts('hansa', { medium: 'wet', size: 60 }), [10, 60], [150, 60]);
  dry(sim);
  const yellow = at(sim, 80, 60);
  stroke(sim, opts('ultra', { medium: 'wet', size: 40 }), [80, 5], [80, 115]);
  dry(sim);
  const glazed = at(sim, 80, 60);
  const hue = hueOf(glazed);
  assert.ok(hue > 110 && hue < 200, `green: hue ${hue.toFixed(0)} (${glazed.map((v) => v.toFixed(2))} over ${yellow.map((v) => v.toFixed(2))})`);
});

test('a lifted wash settles: dry, and its rim denser than its middle', () => {
  const sim = new PaintSim(200, 120);
  stroke(sim, opts('ultra', { medium: 'wet', size: 60 }), [30, 60], [170, 60]);
  assert.ok(sim.wet);
  dry(sim);
  // the edge of the wash, a pixel or two in, against its middle
  let rim = 1;
  for (let y = 30; y < 45; y++) rim = Math.min(rim, at(sim, 100, y)[0]);
  assert.ok(rim < at(sim, 100, 60)[0] - 0.03, `rim ${rim.toFixed(2)} vs middle ${at(sim, 100, 60)[0].toFixed(2)}`);
});

test('dry gouache covers: white over red ends up near white once the brush has cleaned itself', () => {
  const sim = new PaintSim(300, 100);
  stroke(sim, opts('cadred', { size: 30 }), [150, 5], [150, 95]);
  stroke(sim, opts('tiwhite', { size: 20 }), [10, 50], [290, 50]);
  const over = at(sim, 150, 50);
  const after = at(sim, 280, 50);
  assert.ok(over[1] > 0.6, `white over red is light: ${over}`);
  assert.ok(after[1] > 0.9 && after[2] > 0.88, `and clean again further on: ${after}`);
});

test('a dry brush low on paint breaks up on the paper', () => {
  const sim = new PaintSim(400, 60);
  stroke(sim, opts('lampblack', { size: 24, load: 0.05 }), [10, 30], [390, 30]);
  const row = (x0: number, x1: number) => {
    let bare = 0;
    for (let x = x0; x < x1; x++) for (let y = 24; y < 36; y++) bare += at(sim, x, y)[0] > 0.9 ? 1 : 0;
    return bare;
  };
  assert.ok(row(300, 380) > row(20, 100) + 50, `more bare paper late in the stroke: ${row(20, 100)} then ${row(300, 380)}`);
});

test('smudge drags paint along, and a clean finger on bare paper lays nothing', () => {
  const sim = new PaintSim(200, 100);
  stroke(sim, opts('ultra', { size: 30 }), [40, 10], [40, 90]);
  const blank = new PaintSim(200, 100);
  stroke(blank, opts('ultra', { tool: 'smudge' }), [150, 10], [150, 90]);
  assert.ok(blank.col.every((v) => v === 1), 'nothing on bare paper');
  stroke(sim, opts('ultra', { tool: 'smudge', size: 20, load: 0.8 }), [40, 50], [110, 50]);
  assert.ok(at(sim, 75, 50)[0] < 0.9, `paint pushed out to x 75: ${at(sim, 75, 50)}`);
  assert.deepEqual(at(sim, 75, 10), [1, 1, 1]);
});

test('undo puts strokes back exactly, mid-settle too; Esc mid-stroke leaves nothing; only the last strokes are kept', () => {
  const sim = new PaintSim(160, 100);
  stroke(sim, opts('cadred'), [10, 30], [150, 30]);
  const before = sim.col.slice();
  stroke(sim, opts('ultra', { medium: 'wet' }), [80, 5], [80, 95]);
  sim.settle(0);
  assert.ok(sim.wet, 'still settling');
  assert.ok(sim.undo());
  assert.deepEqual(sim.col, before);
  assert.ok(!sim.wet && sim.settle(), 'an undone wash is gone, water and all');
  stroke(sim, opts('ultra', { medium: 'wet' }), [80, 5], [80, 95]);
  sim.begin(opts('hansa'), 10, 70);
  sim.to(150, 70);
  sim.cancel();
  assert.equal(sim.depth, 2);
  assert.ok(sim.undo());
  assert.deepEqual(sim.col, before);
  for (let i = 0; i < UNDO_STEPS + 5; i++) stroke(sim, opts('ultra'), [10 + i, 50], [20 + i, 50]);
  assert.equal(sim.depth, UNDO_STEPS);
});

test('Clear is one undo step that brings the painting back, settled', () => {
  const sim = new PaintSim(120, 80);
  const twin = new PaintSim(120, 80);
  for (const s of [sim, twin]) stroke(s, opts('viridian', { medium: 'wet' }), [10, 40], [110, 40]);
  twin.settle();
  sim.settle(0);
  sim.clear(true);
  assert.ok(sim.blank && sim.lastIsClear && !sim.wet);
  sim.undo();
  assert.deepEqual(sim.col, twin.col);
  sim.clear(false);
  assert.ok(sim.blank && sim.depth === 0);
});

test('pick averages a 3×3 patch; a saved painting loads back as rendered', () => {
  const sim = new PaintSim(120, 80);
  stroke(sim, opts('bsienna', { size: 30 }), [10, 40], [110, 40]);
  const p = sim.pick(60, 40);
  const c = at(sim, 60, 40);
  assert.ok(p.every((v, i) => Math.abs(v - c[i]) < 0.02));
  const rgba = new Uint8ClampedArray(120 * 80 * 4).fill(255);
  sim.render(rgba, { x0: 0, y0: 0, x1: 119, y1: 79 });
  const copy = new PaintSim(120, 80);
  copy.load(rgba);
  assert.ok(copy.col.every((v, i) => Math.abs(v - sim.col[i]) <= 0.5 / 255 + 1e-6));
  assert.equal(copy.depth, 0);
});

test('painting a wet stroke stays well inside a frame budget', () => {
  const sim = new PaintSim();
  const out = new Uint8ClampedArray(sim.w * sim.h * 4);
  sim.begin(opts('ultra', { medium: 'wet', size: 60, load: 0.8 }), 60, 320);
  const t0 = performance.now();
  for (let i = 1; i <= 60; i++) {
    sim.to(60 + i * 14, 320 + Math.sin(i / 6) * 150);
    const d = sim.frame(8);
    if (d) sim.render(out, d);
  }
  sim.end();
  const perFrame = (performance.now() - t0) / 60;
  assert.ok(perFrame < 12, `${perFrame.toFixed(1)}ms per frame`);
});

// ── settling: nothing on the canvas changes slowly over time ─────────────────────────────────────

test('after the brush lifts, the canvas changes once: the settled wash, all at once', () => {
  const sim = new PaintSim(240, 160);
  const shown = new Uint8ClampedArray(sim.w * sim.h * 4);
  // the smallest slice of work a frame: as many frames as it can take
  const present = () => {
    const d = sim.frame(0);
    if (d) sim.render(shown, d);
  };
  const o = opts('ultra', { medium: 'wet', size: 70, loaded: { ...loaded('ultra'), granulation: 1 } });
  sim.begin(o, 30, 80);
  for (let i = 1; i <= 20; i++) {
    sim.to(30 + i * 9, 80 + (i % 5) * 4);
    present();
  }
  sim.end();
  const lifted = shown.slice();
  let last = shown.slice();
  let frames = 0;
  let changes = 0;
  while (sim.wet && frames < 5000) {
    present();
    frames++;
    if (!same(shown, last)) {
      changes++;
      last = shown.slice();
    }
  }
  for (let i = 0; i < 3; i++) present();
  assert.ok(!sim.wet && frames > 20, `settled over ${frames} frames`);
  assert.equal(changes, 1);
  assert.ok(same(shown, last) && !same(shown, lifted), 'one swap, and it is the settled wash');
  // what it shows is the whole settle, exactly: the same strokes settled in one go
  const whole = new PaintSim(240, 160);
  whole.begin(o, 30, 80);
  for (let i = 1; i <= 20; i++) whole.to(30 + i * 9, 80 + (i % 5) * 4);
  whole.end();
  whole.settle();
  assert.ok(same(whole.col, sim.col));
});

test('a stroke started while the last one settles waits for it: that wash dries as it would alone', () => {
  const [a, b] = [new PaintSim(200, 120), new PaintSim(200, 120)];
  for (const sim of [a, b]) stroke(sim, opts('ultra', { medium: 'wet', size: 50 }), [20, 60], [180, 60]);
  a.settle(0);
  b.settle();
  for (const sim of [a, b]) stroke(sim, opts('cadred', { medium: 'wet', size: 30 }), [100, 10], [100, 110]);
  assert.ok(same(a.col, b.col));
  a.settle();
  b.settle();
  assert.ok(same(a.col, b.col));
});

test('a large wash settles in well under 300ms of work, in slices that leave a frame room', () => {
  const sim = new PaintSim();
  stroke(sim, opts('ultra', { medium: 'wet', size: 200, load: 0.8 }), [100, 320], [924, 320]);
  let total = 0;
  let worst = 0;
  while (sim.wet) {
    const t0 = performance.now();
    sim.settle(4);
    const t = performance.now() - t0;
    total += t;
    worst = Math.max(worst, t);
  }
  assert.ok(total < 300, `${total.toFixed(0)}ms in all`);
  assert.ok(worst < 10, `${worst.toFixed(1)}ms at most in one frame`);
});

// ── the tray, the well and the settings ──────────────────────────────────────────────────────────

const swatch = (id: string, hex: [number, number, number]): Swatch => ({ id, name: '', role: null, oklch: hex, type: 'process' });

test('the tray offers the owned pigments, then the palette colours by id, in their sets', () => {
  const s = sourcesOf([P.ultra, P.hansa], [{ key: 'r', name: 'Skin', swatches: [{ ...swatch('a', [0.6, 0.1, 40]), name: 'Skin shadow' }, swatch('b', [0.5, 0.1, 40])] }]);
  assert.deepEqual(s.map((x) => x.id), ['ultra', 'hansa', 'swatch:a', 'swatch:b']);
  assert.ok(s[2].swatch && s[2].name === 'Skin shadow' && s[2].set?.name === 'Skin');
  assert.ok(/^#[0-9A-F]{6}$/.test(s[3].name));
});

test('the well mixes by parts with km.ts: ultramarine and hansa make a green', () => {
  const sources = sourcesOf(PIGMENTS, []);
  assert.equal(wellMix([], sources), null);
  const mix = wellMix([{ id: 'ultra', parts: 1 }, { id: 'hansa', parts: 2 }], sources)!;
  assert.ok(mix.oklch[2] > 110 && mix.oklch[2] < 190, `hue ${mix.oklch[2].toFixed(0)}`);
  assert.ok(mix.loaded.opacity > P.ultra.opacity && mix.loaded.opacity < P.hansa.opacity);
});

test('adding to the well: a part more of a paint already there, a new paint at 1, never past the limit', () => {
  let well = addToWell([], 'ultra')!;
  well = addToWell(well, 'ultra')!;
  assert.deepEqual(well, [{ id: 'ultra', parts: 2 }]);
  for (const id of ['hansa', 'cadred', 'tiwhite']) well = addToWell(well, id)!;
  assert.equal(well.length, WELL_MAX);
  assert.equal(addToWell(well, 'lampblack'), null);
});

test('saved settings are read field by field; anything odd falls back', () => {
  assert.deepEqual(paintSettings(undefined), DEFAULT_PAINT);
  const s = paintSettings({ tool: 'smudge', medium: 'dry', size: 900, load: -4, paint: 'hansa', well: [{ id: 'ultra', parts: 40 }, { id: 3 }, 'x'] });
  assert.deepEqual(s, { tool: 'smudge', medium: 'dry', size: 200, load: 5, paint: 'hansa', well: [{ id: 'ultra', parts: 9 }] });
  assert.equal(paintSettings({ tool: 'erase' }).tool, 'paint');
});
