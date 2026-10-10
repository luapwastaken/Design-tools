import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inSrgb, rgb255, type Oklch } from '../src/shared/color/index.ts';
import { canHold, capture, hsbMove, hslMove, oklchMove, projectMove, resolve, type Hold } from '../src/shared/color/hold.ts';
import { fromCmyk, fromHsb, fromHsl, fromRgb255, hsbOf, hslOf, type Hsb } from '../src/shared/color/picker.ts';
import { heldEdge } from '../src/shared/color/fast.ts';
import { holdValue, hslHold, valueOf } from '../src/shared/color/value.ts';

const HUES = Array.from({ length: 73 }, (_, i) => i * 5);
/** one half value point (the lock's promise; the solvers do far better) */
const TOL = 0.5 / 100;
const near = (o: Oklch, v: number, what: string) => assert.ok(Math.abs(valueOf(o) - v) < TOL, `${what}: value ${valueOf(o)} vs ${v}`);

// a red, a mid green, a light blue, a dark violet: the starts the lock is asked to carry round the hue circle
const STARTS: Oklch[] = [[0.62, 0.2, 29], [0.7, 0.12, 145], [0.8, 0.08, 250], [0.45, 0.15, 300]];

test('Square: a hue drag from red to blue keeps the value', () => {
  for (const start of STARTS) {
    let hold: Hold | null = capture(start);
    const target = hold.target;
    let cur = hsbOf(start);
    for (const h of HUES) {
      const m = hsbMove(hold!, cur, [h, cur[1], cur[2]]);
      assert.ok(m.hold, 'a hue move keeps the hold');
      near(fromHsb(m.v), target, `${start} hue ${h}`);
      assert.ok(m.v[2] <= 100 + 1e-9 && m.v[1] <= 100 + 1e-9);
      hold = m.hold;
      cur = m.v;
    }
  }
});

test('Square: the saturation set is remembered through a sweep, so the hue can come back to it', () => {
  const start = fromHsb([0, 50, 80]);
  let hold: Hold = capture(start);
  let cur = hsbOf(start);
  const at = (h: number) => {
    const m = hsbMove(hold, cur, [h, cur[1], cur[2]]);
    hold = m.hold!;
    cur = m.v;
    return m.v;
  };
  const blue = at(240);
  assert.ok(blue[1] < 50, `blue cannot carry S 50 at this value: ${blue[1]}`);
  const back = at(0);
  assert.ok(Math.abs(back[1] - 50) < 1e-6, `red again: ${back[1]}`);
  assert.ok(Math.abs(back[2] - 80) < 1e-6, `red again: ${back[2]}`);
});

test('Square: x picks saturation and brightness follows; the carrier (B) is a new value', () => {
  const start = fromHsb([30, 40, 70]);
  const hold = capture(start);
  const cur = hsbOf(start);
  const m = hsbMove(hold, cur, [cur[0], 20, cur[2]]);
  near(fromHsb(m.v), hold.target, 'S drag');
  assert.ok(m.v[2] < cur[2], 'less saturation lifts the value, so brightness comes down to keep it');
  // a typed or arrowed B: the colour as given, no hold, the next edit captures its value
  const typed = hsbMove(hold, cur, [cur[0], cur[1], 90]);
  assert.deepEqual(typed.v, [cur[0], cur[1], 90]);
  assert.equal(typed.hold, null);
});

test('HSL: hue and saturation solve lightness, over every hue and saturation', () => {
  const start = fromHsl([20, 60, 45]);
  const hold = capture(start);
  let cur = hslOf(start);
  for (const h of HUES) {
    for (const s of [0, 25, 100]) {
      const m = hslMove(hold, cur, [h, s, cur[2]]);
      near(fromHsl(m.v), hold.target, `h ${h} s ${s}`);
    }
    cur = hslMove(hold, cur, [h, cur[1], cur[2]]).v;
  }
  assert.equal(hslMove(hold, cur, [cur[0], cur[1], 10]).hold, null, 'HSL L is the carrier');
});

test('hslHold reaches every value at every hue and saturation', () => {
  for (const v of [0.01, 0.2, 0.5, 0.9, 0.99]) {
    for (const h of [0, 60, 120, 240, 300]) {
      for (const s of [0, 50, 100]) {
        const l = hslHold(v, h, s);
        assert.ok(l >= 0 && l <= 100);
        near(fromHsl([h, s, l]), v, `v ${v} h ${h} s ${s}`);
      }
    }
  }
});

test('OKLCH: hue and chroma moves keep the value, chroma yields at the gamut and comes back; L is the carrier', () => {
  for (const start of STARTS) {
    let hold: Hold = capture(start);
    let cur = start;
    for (const h of [...HUES, ...HUES.slice().reverse(), start[2]]) {
      const m = oklchMove(hold, cur, [cur[0], cur[1], h]);
      assert.ok(inSrgb(m.v), `${start} h ${h}`);
      near(m.v, hold.target, `${start} h ${h}`);
      hold = m.hold!;
      cur = m.v;
    }
    assert.ok(Math.abs(cur[1] - start[1]) < 1e-6, `chroma came back: ${cur[1]} vs ${start[1]}`);
    if (inSrgb(start)) assert.ok(Math.abs(cur[0] - start[0]) < 1e-3, `and so did L: ${cur[0]} vs ${start[0]}`);
    const c = oklchMove(hold, cur, [cur[0], 0.3, cur[2]]);
    near(c.v, hold.target, 'C drag past the gamut');
    assert.ok(c.v[1] <= 0.3 && inSrgb(c.v));
  }
  const hold = capture(STARTS[0]);
  assert.equal(oklchMove(hold, STARTS[0], [0.9, STARTS[0][1], STARTS[0][2]]).hold, null);
});

test('RGB and CMYK drags keep the value: the colour the drag made keeps its hue and chroma and gets the held value', () => {
  const start = fromRgb255([200, 90, 60], 40);
  const hold = capture(start);
  for (const rgb of [[255, 90, 60], [200, 0, 60], [200, 90, 255], [10, 10, 10]] as [number, number, number][]) {
    near(projectMove(hold, fromRgb255(rgb, 40)).v, hold.target, `rgb ${rgb}`);
  }
  for (const k of [[0, 40, 60, 10], [60, 40, 0, 10], [10, 10, 10, 0]] as [number, number, number, number][]) {
    near(projectMove(hold, fromCmyk(k, 40)).v, hold.target, `cmyk ${k}`);
  }
  assert.equal(rgb255(start).length, 3);
});

test('near black and white the lock holds nothing: a drag moves freely and the next edit captures the new colour', () => {
  const black: Oklch = [0, 0, 0];
  const hold = capture(black);
  assert.equal(canHold(hold.target), false);
  assert.equal(hsbMove(hold, [0, 0, 0], [120, 50, 0]).hold, null);
  assert.equal(oklchMove(hold, black, [0, 0.1, 140]).hold, null);
  assert.equal(canHold(capture([1, 0, 0]).target), false);
  assert.equal(canHold(capture([0.5, 0.1, 30]).target), true);
});

test('the target is kept only while the colour is the one the lock made', () => {
  const hold = capture(STARTS[0]);
  const made = oklchMove(hold, STARTS[0], [STARTS[0][0], STARTS[0][1], 200]);
  assert.equal(resolve(made.hold, made.v), made.hold, 'the colour the lock made keeps its hold');
  const other = resolve(made.hold, [0.3, 0.05, 10]);
  assert.notEqual(other, made.hold, 'any other colour (a new swatch, an undo, a typed value) is captured anew');
  assert.ok(Math.abs(other.target - valueOf([0.3, 0.05, 10])) < 1e-12);
  assert.equal(resolve(null, STARTS[1]).target, valueOf(STARTS[1]));
});

test('no drift: thousands of hue, saturation and chroma moves leave the held value where it was', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const start: Oklch = [0.62, 0.14, 40];
  const target = valueOf(start);
  // the HSB path: each step goes through the colour the doc keeps
  let hold: Hold | null = capture(start);
  let value = start;
  for (let i = 0; i < 2000; i++) {
    hold = resolve(hold, value);
    const cur = hsbOf(value);
    const next: Hsb = rand() < 0.5 ? [Math.round(rand() * 3600) / 10, cur[1], cur[2]] : [cur[0], Math.round(rand() * 1000) / 10, cur[2]];
    const m = hsbMove(hold, cur, next);
    hold = m.hold;
    value = fromHsb(m.v);
  }
  assert.ok(Math.abs(valueOf(value) - target) < 1e-6, `${valueOf(value)} vs ${target}`);
  // and the OKLCH path
  hold = capture(start);
  value = start;
  for (let i = 0; i < 2000; i++) {
    hold = resolve(hold, value);
    const next: Oklch = rand() < 0.5 ? [value[0], value[1], rand() * 360] : [value[0], rand() * 0.3, value[2]];
    const m = oklchMove(hold, value, next);
    hold = m.hold;
    value = m.v;
  }
  assert.ok(Math.abs(valueOf(value) - target) < 1e-6, `${valueOf(value)} vs ${target}`);
});

test('holdValue is the OKLCH hold: a value the hue cannot reach at that chroma gives up chroma, not value', () => {
  const o = holdValue(0.9, 0.2, 264);
  near(o, 0.9, 'light blue');
  assert.ok(o[1] < 0.2);
});

test('holdValue holds at the blue corner, where the in-gamut chroma at one L is not one run out from grey', () => {
  // these landed at 0.184, 0.149, 0.189 and 0.043 when the edge was trimmed with maxChroma
  for (const [v, c, h] of [[0.1, 0.2702, 264.18], [0.0666, 0.2981, 264.18], [0.0818, 0.3262, 264.15], [0.0241, 0.3012, 264.15]] as const) {
    const o = holdValue(v, c, h);
    near(o, v, `${v} ${c} ${h}`);
    assert.ok(inSrgb(o), `${v} ${c} ${h} inside`);
  }
});

test('the held edge is the real end of sRGB for dark saturated blues and violets (a missed secant solve cut it short)', () => {
  // at value 12.4 and hue 279 sRGB has chroma to 0.271; the old solve stopped at 0.250
  assert.ok(heldEdge(0.124, 279).c > 0.27);
  assert.ok(holdValue(0.124, 0.3, 279)[1] > 0.27);
  near(holdValue(0.124, 0.3, 279), 0.124, 'dark violet');
  // and the edge is inside sRGB at the value asked, whatever the hue
  for (const [v, h] of [[0.09, 267], [0.15, 306], [0.2, 333], [0.12, 342], [0.24, 354], [0.5, 120]] as const) {
    const e = heldEdge(v, h);
    const o: Oklch = [e.l, e.c, h];
    assert.ok(inSrgb(o, 1e-3), `${v} ${h} inside`);
    near(o, v, `${v} ${h} edge`);
  }
});
