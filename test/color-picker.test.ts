import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmykEstimate, inP3, inSrgb, toHex, type Oklch } from '../src/shared/color/index.ts';
import { fromCmyk, fromHex, fromRgb255, gamutEdges, maxChroma, planeAxis, planePixels, rgb255, rowL } from '../src/shared/color/picker.ts';

const HUES = [0, 37.3, 110, 145, 200, 264, 330];

test('maxChroma sits on the gamut edge: just inside, then just outside', () => {
  for (const h of HUES) {
    for (const l of [0.2, 0.5, 0.66, 0.9]) {
      const s = maxChroma(l, h, 'srgb');
      const p = maxChroma(l, h, 'p3');
      assert.ok(inSrgb([l, s, h]) && !inSrgb([l, s + 1e-4, h]), `sRGB edge at L ${l} H ${h}`);
      assert.ok(inP3([l, p, h]) && !inP3([l, p + 1e-4, h]), `P3 edge at L ${l} H ${h}`);
      assert.ok(p >= s, 'P3 holds sRGB');
    }
  }
});

test('plane pixels: opaque inside sRGB, dimmed out to P3, clear beyond', () => {
  const w = 60;
  const rows = 40;
  const h = 145;
  const edges = gamutEdges(h, rows);
  const cmax = planeAxis(h);
  const widest = Math.max(...edges.p3);
  assert.ok(cmax >= widest && cmax - widest < 0.051, `axis ${cmax} holds P3's widest ${widest}`);
  const px = planePixels(h, w, rows, cmax, edges);
  for (const y of [5, 20, 30]) {
    for (let x = 0; x < w; x++) {
      const c = ((x + 0.5) / w) * cmax;
      const a = px[(y * w + x) * 4 + 3];
      const want = c <= edges.srgb[y] ? 255 : c <= edges.p3[y] ? 90 : 0;
      assert.equal(a, want, `alpha at row ${y}, C ${c.toFixed(3)}`);
      if (a === 255) {
        const hex = '#' + [0, 1, 2].map((k) => px[(y * w + x) * 4 + k].toString(16).padStart(2, '0')).join('');
        assert.equal(hex, toHex([rowL(y, rows), c, h]), 'the pixel is the colour the hex readout shows');
      }
    }
  }
});

test('RGB and hex round trip exactly; greys keep the hue you were on', () => {
  const o: Oklch = [0.6616, 0.1731, 37.3];
  const rgb = rgb255(o);
  assert.deepEqual(rgb, [0xe8, 0x64, 0x3c]);
  assert.equal(toHex(fromRgb255(rgb, 0)), toHex(o));
  assert.equal(fromHex('#808080', 212)[2], 212);
  assert.equal(fromRgb255([128, 128, 128], 99)[2], 99);
  assert.ok(Math.abs(fromHex('#e8643c', 0)[2] - 37.3) < 0.2, 'a real hue is kept as it is');
});

test('fromCmyk inverts the ≈CMYK estimate, to within its whole-percent steps', () => {
  for (const hex of ['#e8643c', '#14161a', '#8fb8de', '#3f6b4f', '#ffffff', '#000000']) {
    const o = fromHex(hex, 0);
    const back = rgb255(fromCmyk(cmykEstimate(o), 0));
    rgb255(o).forEach((v, i) => assert.ok(Math.abs(back[i] - v) <= 3, `${hex} channel ${i}: ${back[i]} vs ${v}`));
  }
});
