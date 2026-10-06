// The OKLCH planes (src/shared/color/plane.ts): their edges against maxChroma, the value lock's
// C by H plane against the value it holds, the strips, and how fast they draw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inSrgb, type Oklch } from '../src/shared/color/index.ts';
import { maxChroma } from '../src/shared/color/picker.ts';
import { chArt, CMAX, FLOOR, heldChArt, hlArt, hStrip, lcArt, lStrip, planeColour, planeFixed, planePoint } from '../src/shared/color/plane.ts';
import { holdValue, valueOf } from '../src/shared/color/value.ts';

/** the points of an SVG path of M and L moves */
const points = (d: string) => [...d.matchAll(/[ML]([\d.-]+) ([\d.-]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
const alpha = (px: Uint8ClampedArray, w: number, x: number, y: number) => px[(y * w + x) * 4 + 3];

test('C by H: each column of the sRGB and P3 edges sits on maxChroma at that hue and lightness', () => {
  const [w, rows] = [180, 200];
  for (const l of [0.3, 0.6, 0.85]) {
    const a = chArt(l, w, rows);
    const [s, p] = [points(a.srgb), points(a.p3)];
    assert.equal(s.length, w);
    for (const x of [0, 17, 45, 90, 133, 179]) {
      const h = ((x + 0.5) / w) * 360;
      assert.ok(Math.abs((1 - s[x][1] / rows) * CMAX - Math.min(CMAX, maxChroma(l, h, 'srgb'))) < 2e-3 + CMAX / rows, `sRGB at L ${l} H ${h}`);
      assert.ok(Math.abs((1 - p[x][1] / rows) * CMAX - Math.min(CMAX, maxChroma(l, h, 'p3'))) < 2e-3 + CMAX / rows, `P3 at L ${l} H ${h}`);
    }
  }
});

test('L by C: the edges are the existing per-row edges, in pixels', () => {
  const [w, rows, axis] = [100, 80, 0.35];
  const a = lcArt(145, w, rows, axis);
  const s = points(a.srgb);
  assert.equal(s.length, rows + 2);
  const y = 40;
  const l = 1 - (y + 0.5) / rows;
  assert.ok(Math.abs((s[y + 1][0] / w) * axis - maxChroma(l, 145, 'srgb')) < 1e-3);
});

test('H by L: every vertex of an edge is a boundary of the pixels (one side in sRGB, the other not)', () => {
  const [w, rows] = [120, 100];
  const a = hlArt(0.12, w, rows);
  assert.equal(a.empty, false);
  const vertices = a.srgb.split('M').filter(Boolean).flatMap((d) => points('M' + d));
  assert.ok(vertices.length > w);
  for (const [px, py] of vertices) {
    const x = Math.floor(px);
    const [above, below] = [py > 0 && alpha(a.px, w, x, py - 1) === 255, py < rows && alpha(a.px, w, x, py) === 255];
    assert.notEqual(above, below, `column ${x} row ${py}`);
  }
  // and the pixels are the colours: opaque exactly where the colour is in sRGB
  let off = 0;
  for (let i = 0; i < 400; i++) {
    const [x, y] = [(i * 37) % w, (i * 53) % rows];
    const o: Oklch = [1 - (y + 0.5) / rows, 0.12, ((x + 0.5) / w) * 360];
    if ((alpha(a.px, w, x, y) === 255) !== inSrgb(o)) off++;
  }
  assert.ok(off <= 4, `${off} of 400 pixels disagree with inSrgb`);
});

test('the planes with nothing to draw say so', () => {
  assert.equal(chArt(0, 60, 40).empty, true);
  assert.equal(chArt(1, 60, 40).empty, true);
  assert.equal(chArt(0.6, 60, 40).empty, false);
  assert.equal(hlArt(0.37, 60, 40).empty, true, 'sRGB never reaches chroma 0.37');
  assert.equal(heldChArt(0, 60, 40).empty, true);
});

test('the value lock plane: every pixel keeps the value, at every hue and chroma', () => {
  const [w, rows] = [180, 120];
  for (const t of [0.05, 0.2, 0.5, 0.8, 0.95]) {
    const a = heldChArt(t, w, rows);
    assert.equal(a.empty, false);
    let n = 0;
    let worst = 0;
    for (let i = 0; i < w * rows; i++) {
      if (!a.px[i * 4 + 3]) continue;
      n++;
      const v = (0.2126 * a.px[i * 4] + 0.7152 * a.px[i * 4 + 1] + 0.0722 * a.px[i * 4 + 2]) / 255;
      worst = Math.max(worst, Math.abs(v - t));
    }
    assert.ok(n > w * rows * 0.1, `value ${t}: ${n} pixels`);
    assert.ok(worst < 0.006, `value ${t}: worst ${worst.toFixed(4)} off the target (one 8-bit step is 0.0039)`);
  }
});

test('the held plane reaches as far as the colours at that value do: its edge is the most chroma holdValue finds', () => {
  const [w, rows] = [120, 200];
  const a = heldChArt(0.5, w, rows);
  const edge = points(a.srgb);
  for (const x of [5, 30, 60, 90, 115]) {
    const h = ((x + 0.5) / w) * 360;
    const c = (1 - edge[x][1] / rows) * CMAX;
    assert.ok(Math.abs(c - holdValue(0.5, 0.5, h)[1]) < 0.006, `hue ${h}: edge ${c.toFixed(3)}`);
  }
  // and the colour the lock makes for a point on the plane has the value, as the app measures it
  const h = ((60 + 0.5) / w) * 360;
  const c = ((rows - 150 - 0.5) / rows) * CMAX;
  assert.ok(Math.abs(valueOf(holdValue(0.5, c, h)) - 0.5) < 2e-3);
});

test('the held plane redraws in well under a frame at the inspector size', () => {
  heldChArt(0.5, 340, 200);
  const runs = Array.from({ length: 5 }, () => {
    const t = performance.now();
    heldChArt(0.5, 340, 200);
    return performance.now() - t;
  }).sort((p, q) => p - q);
  // 30 ms is the budget on a quiet machine; the bound here is looser so a busy test run doesn't flake
  assert.ok(runs[2] < 100, `median ${runs[2].toFixed(1)} ms`);
  console.log(`held C by H 340x200: median ${runs[2].toFixed(1)} ms`);
});

test('a point on a plane and its colour are inverses, and the fixed value is quantised for the cache', () => {
  const o: Oklch = [0.62, 0.18, 145];
  for (const id of ['lc', 'ch', 'hl'] as const) {
    const [u, v] = planePoint(id, o, 0.35);
    assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, id);
    const back = planeColour(id, u, v, o, 0.35);
    back.forEach((x, i) => assert.ok(Math.abs(x - o[i]) < 1e-9, `${id} channel ${i}`));
  }
  assert.equal(planeFixed('lc', [0.5, 0.1, 145.04]), 145);
  assert.equal(planeFixed('ch', [0.6212, 0.1, 10]), 0.62);
  assert.equal(planeFixed('hl', [0.5, 0.1203, 10]), 0.12);
});

test('the L strip: sRGB colours between two ticks, clear outside; none at grey', () => {
  const w = 340;
  const a = lStrip(0.15, 145, w);
  assert.equal(a.ends.length, 2);
  for (const e of a.ends) {
    const x = Math.round(e * w);
    assert.notEqual(alpha(a.px, w, x - 1, 0) === 255, alpha(a.px, w, x, 0) === 255);
  }
  assert.equal(alpha(a.px, w, 0, 0), 0, 'black has no colour at this chroma');
  assert.equal(lStrip(0, 145, w).ends.length, 0);
  assert.equal(alpha(lStrip(0, 145, w).px, w, 5, 0), 255);
});

test('the H strip: clear where sRGB has no colour at this chroma; at a grey it is painted at the floor chroma', () => {
  const w = 360;
  const wide = hStrip(0.7, 0.2, w);
  assert.equal(wide.floor, false);
  assert.ok(wide.ends.length >= 2, 'L 0.7 C 0.2 leaves some hues out');
  const grey = hStrip(0.6, 0.005, w);
  assert.equal(grey.floor, true);
  assert.equal(grey.ends.length, 0);
  let opaque = 0;
  const reds = new Set<number>();
  for (let x = 0; x < w; x++) {
    opaque += grey.px[x * 4 + 3] === 255 ? 1 : 0;
    reds.add(grey.px[x * 4]);
  }
  assert.equal(opaque, w);
  assert.ok(reds.size > 20, 'the strip is coloured, not a grey bar');
  assert.equal(FLOOR, 0.1);
});
