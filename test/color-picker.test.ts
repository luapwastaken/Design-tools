import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cmykEstimate, inP3, inSrgb, toHex, toSrgbGamut, type Oklch } from '../src/shared/color/index.ts';
import {
  fromCmyk,
  fromHex,
  fromHsb,
  fromHsl,
  fromRgb255,
  gamutEdges,
  hsbHue,
  hsbOf,
  hslOf,
  maxChroma,
  planeAxis,
  planePixels,
  rgb255,
  rowL,
  sameColour,
  type Hsb,
} from '../src/shared/color/picker.ts';

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

/** a small seeded generator, so a failure repeats */
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b) % 360, 360 - (Math.abs(a - b) % 360));

test('HSB and HSL round trip through OKLCH', () => {
  const r = rng(7);
  for (let i = 0; i < 500; i++) {
    const x: Hsb = [r() * 360, 2 + r() * 98, 2 + r() * 98];
    for (const [to, from] of [[fromHsb, hsbOf], [fromHsl, hslOf]] as const) {
      const y = from(to(x));
      assert.ok(Math.abs(y[1] - x[1]) < 0.01 && Math.abs(y[2] - x[2]) < 0.01, `${to.name} ${x} came back ${y}`);
      assert.ok(hueGap(y[0], x[0]) < 0.01, `${to.name} hue ${x[0]} came back ${y[0]}`);
    }
  }
});

test('HSB matches the hex the swatch shows', () => {
  const ember: Oklch = [0.6616, 0.1731, 37.3];
  const [h, s, b] = hsbOf(ember);
  assert.deepEqual([Math.round(h), Math.round(s), Math.round(b)], [14, 74, 91]); // #e8643c in Photoshop
  assert.equal(toHex(fromHsb([h, s, b])), toHex(ember));
  assert.equal(toHex(fromHsb([0, 100, 100])), '#ff0000');
  assert.equal(toHex(fromHsl([120, 100, 50])), '#00ff00');
  assert.equal(toHex(fromHsb([240, 100, 60])), '#000099');
});

test('greys keep their hue: a grey made on the square reads back at the hue it was made at', () => {
  for (let h = 0; h < 360; h += 7.5) {
    for (const [make, read] of [[fromHsb, hsbOf], [fromHsl, hslOf]] as const) {
      for (const grey of [[h, 0, 50], [h, 0, 0], [h, 100, 0]] as Hsb[]) {
        if (make === fromHsl && grey[2] === 0 && grey[1] === 100) continue; // HSL has no such black
        const o = make(grey);
        assert.ok(o[1] < 1e-3, `${make.name} ${grey} is grey`);
        assert.ok(hueGap(read(o)[0], h) < 1e-4, `${make.name} ${grey}: hue ${read(o)[0]}`);
      }
    }
    assert.ok(hueGap(hsbHue(fromHsb([h, 0, 100])[2]), h) < 1e-4, `white at ${h}`);
  }
  // a stored grey from elsewhere (a hex, the OKLCH plane) opens at the hue its OKLCH hue stands for
  const [gh, gs] = hsbOf(fromHex('#808080', 264));
  assert.equal(gs, 0);
  assert.ok(gh > 200 && gh < 260, `a grey with a blue OKLCH hue sits among the blues, at ${gh}`);
  // a grey with no hue of its own (a hex, black) opens at 0°, as in other tools
  assert.equal(hsbOf(fromHex('#2e2e2e', 0))[0], 0);
  assert.equal(hsbOf([0, 0, 0])[0], 0);
});

test('sameColour: a grey is another colour once its hue moves, though its hex stays', () => {
  const grey = fromHsb([20, 0, 60]);
  assert.ok(sameColour(grey, [...grey]));
  assert.ok(!sameColour(grey, fromHsb([238, 0, 60])), 'an undone hue drag on a grey is a change');
  assert.ok(sameColour([0.5, 0.1, 30], [0.5, 0.1, 30.0001]));
  assert.ok(!sameColour([0.5, 0.1, 30], [0.5, 0.1, 60]));
  assert.ok(sameColour([0.5, 0, 359.9], [0.5, 0, 0.1]), 'the hue wraps');
});

test('outside sRGB reads as the clipped colour the hex shows, and writes back only that', () => {
  for (const o of [[0.7, 0.3, 145], [0.6, 0.29, 30], [0.95, 0.2, 200], [1, 0.1, 30], [0.45, 0.32, 264]] as Oklch[]) {
    assert.ok(!inSrgb(o), `${o} is outside sRGB`);
    const clipped = toSrgbGamut(o);
    for (const [make, read] of [[fromHsb, hsbOf], [fromHsl, hslOf]] as const) {
      const v = read(o);
      assert.ok(v.every((x, i) => x >= 0 && x <= (i ? 100 : 360)), `${read.name} ${o}: ${v} in range`);
      assert.deepEqual(v.map((x) => x.toFixed(6)), read(clipped).map((x) => x.toFixed(6)), `${read.name} ${o} reads as its clipped colour`);
      assert.equal(toHex(make(v)), toHex(o), `${make.name} of ${o}'s reading is the colour the hex shows`);
      assert.ok(inSrgb(make(v)), 'and lands inside sRGB');
    }
  }
});
