import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rgbAt, rgbLine, rgbOnLine, rgbPos, hslLine } from '../src/shared/color/area.ts';
import { fromHsl, fromRgb255, hslOf, rgb255, type Rgb255 } from '../src/shared/color/picker.ts';
import { LUMA, valueOf } from '../src/shared/color/value.ts';

const lumaOf = ([r, g, b]: Rgb255) => (LUMA[0] * r + LUMA[1] * g + LUMA[2] * b) / 255;

test('RGB area: a position and its colour round-trip, blue across and green up at the red on the bar', () => {
  for (const r of [0, 90, 255]) {
    for (let g = 0; g <= 255; g += 15) {
      for (let b = 0; b <= 255; b += 15) {
        const [x, y] = rgbPos([r, g, b]);
        assert.deepEqual(rgbAt(r, x, y), [r, g, b]);
        // and through the colour the picker stores
        assert.deepEqual(rgb255(fromRgb255(rgbAt(r, x, y), 0)), [r, g, b]);
      }
    }
  }
  assert.deepEqual(rgbAt(40, 1, 0), [40, 0, 255], 'blue is the right edge');
  assert.deepEqual(rgbAt(40, 0, 1), [40, 255, 0], 'green is the top edge');
});

test('RGB area: the value line is straight, and a colour on it has the held value', () => {
  for (const r of [0, 60, 128, 200, 255]) {
    for (const t of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) {
      const line = rgbLine(t, r);
      if (!line) continue;
      const [[x0, y0], [x1, y1]] = line;
      for (const [x, y] of [[x0, y0], [x1, y1]]) {
        assert.ok(x >= -1e-9 && x <= 1 + 1e-9 && y >= -1e-9 && y <= 1 + 1e-9, 'the ends stay in the square');
        const v = LUMA[0] * (r / 255) + LUMA[1] * y + LUMA[2] * x;
        assert.ok(Math.abs(v - t) < 1e-9, `end of the line at R ${r}, value ${t}: ${v}`);
      }
      for (let i = 0; i <= 8; i++) {
        const c = rgbOnLine(t, r, x0 + ((x1 - x0) * i) / 8)!;
        assert.equal(c[0], r);
        assert.ok(Math.abs(lumaOf(c) - t) < 0.0028, `R ${r} value ${t}: ${lumaOf(c)}`); // within one 8-bit green step
        // the colour the picker stores shows the same value
        assert.ok(Math.abs(valueOf(fromRgb255(c, 0)) - lumaOf(c)) < 2e-3);
      }
    }
  }
});

test('RGB area: the pointer past the line is held to its ends, and a value no colour at this red has has no line', () => {
  const t = 0.5;
  const r = 100;
  const [[x0], [x1]] = rgbLine(t, r)!;
  assert.deepEqual(rgbOnLine(t, r, -5), rgbOnLine(t, r, x0));
  assert.deepEqual(rgbOnLine(t, r, 9), rgbOnLine(t, r, x1));
  assert.equal(rgbLine(1, 0), null, 'white needs red');
  assert.equal(rgbOnLine(1, 0, 0.5), null);
  assert.equal(rgbLine(0, 255), null, 'black needs no red');
});

test('HSL area: the value line gives the lightness that holds the value at every saturation', () => {
  for (const h of [0, 40, 120, 200, 265, 320]) {
    for (const t of [0.1, 0.35, 0.6, 0.9]) {
      const line = hslLine(t, h);
      assert.equal(line[0][0], 0);
      assert.equal(line.at(-1)![0], 100);
      for (const [s, l] of line) {
        assert.ok(l >= 0 && l <= 100);
        assert.ok(Math.abs(valueOf(fromHsl([h, s, l])) - t) < 1e-3, `H ${h} S ${s}: value ${valueOf(fromHsl([h, s, l]))} for ${t}`);
      }
    }
  }
});

test('HSL area: a position and its colour round-trip', () => {
  for (const h of [0, 90, 210, 330]) {
    for (let s = 0; s <= 100; s += 20) {
      for (let l = 10; l <= 90; l += 20) {
        const [h2, s2, l2] = hslOf(fromHsl([h, s, l]));
        assert.ok((s === 0 || Math.abs(((h2 - h + 540) % 360) - 180) < 0.3) && Math.abs(s2 - s) < 0.3 && Math.abs(l2 - l) < 0.3, `${[h, s, l]} -> ${[h2, s2, l2]}`);
      }
    }
  }
});

test('HSL area: its two gradients (a grey-to-hue ramp under white fading out and black fading in at the middle) are HSL exactly', () => {
  const chan = (h: number, n: number) => {
    const k = (n + h / 30) % 12;
    return 0.5 - 0.5 * Math.max(-1, Math.min(k - 3, 9 - k, 1)); // the hue's channel at S 100, L 50
  };
  for (const h of [10, 75, 150, 230, 290, 350]) {
    for (const s of [0, 0.3, 1]) {
      for (const l of [0, 0.2, 0.5, 0.8, 1]) {
        const want = rgb255(fromHsl([h, s * 100, l * 100]));
        const base = [0, 8, 4].map((n) => 0.5 + (chan(h, n) - 0.5) * s);
        // white over the top half with alpha 2L-1, black over the bottom with alpha 1-2L
        const got = base.map((b) => (l >= 0.5 ? (2 * l - 1) + (2 - 2 * l) * b : 2 * l * b) * 255);
        got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1.01, `H ${h} S ${s} L ${l}: ${got.map(Math.round)} vs ${want}`));
      }
    }
  }
});
