// The Copy as formats: each text reads back as the same colour, and the numbers are the shortest that do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COPY_FORMATS, formatColour } from '../src/shared/color/format.ts';
import { hexToOklch, inSrgb, linearRgb, rgb255, toHex, type Oklch } from '../src/shared/color/index.ts';
import { parseColours } from '../src/shared/palette/paste.ts';

const HEXES = ['#ff0000', '#e8643c', '#1a2b3c', '#fafafa', '#000000', '#ffffff', '#0a5f38', '#7b61ff', '#ffe600', '#808080', '#00ffff'];
const OKLCHS: Oklch[] = [[0.7008, 0.1646, 36.1237], [0.5, 0.2, 264.05], [0.93, 0.0421, 101.7], [0.62796, 0.25768, 29.23388]];
const READS = ['hex', 'rgb', 'hsl', 'oklch', 'oklab', 'p3'] as const;

test('every format a colour paste reads comes back as the same hex', () => {
  for (const o of [...HEXES.map(hexToOklch), ...OKLCHS]) {
    for (const f of READS) {
      const text = formatColour(o, f);
      const back = parseColours(text).colours[0];
      assert.ok(back, `${f}: "${text}" is read`);
      assert.equal(toHex(back), toHex(o), `${f}: "${text}"`);
    }
  }
});

test('an sRGB colour stays sRGB through its OKLCH copy, and the numbers are short', () => {
  for (const hex of HEXES) {
    const text = formatColour(hexToOklch(hex), 'oklch');
    assert.ok(inSrgb(parseColours(text).colours[0], 1e-4), text);
    assert.match(text, /^oklch\(\d(\.\d+)? \d(\.\d+)? \d+(\.\d+)?\)$/, text);
  }
  // oklch.com's own red: 4 places for C, 2 for H, no more
  assert.equal(formatColour(hexToOklch('#ff0000'), 'oklch'), 'oklch(0.628 0.2577 29.23)');
  assert.equal(toHex(parseColours('oklch(0.628 0.2577 29.23)').colours[0]), '#ff0000');
});

test('hex is upper case, RGB the integers, After Effects 0 to 1 with alpha, Linear RGB the light-linear floats', () => {
  const o = hexToOklch('#e8643c');
  assert.equal(formatColour(o, 'hex'), '#E8643C');
  assert.equal(formatColour(o, 'rgb'), 'rgb(232 100 60)');
  assert.equal(formatColour(o, 'ae'), '[0.9098, 0.3922, 0.2353, 1]');
  const lin = formatColour(o, 'linear').split(', ').map(Number);
  assert.equal(lin.length, 3);
  linearRgb(o).forEach((v, i) => assert.ok(Math.abs(lin[i] - v) < 1e-5));
  const encode = (x: number) => Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255);
  assert.deepEqual(lin.map(encode), rgb255(o));
  assert.equal(formatColour(hexToOklch('#ffffff'), 'ae'), '[1, 1, 1, 1]');
});

test('every format has a label and prints', () => {
  for (const f of COPY_FORMATS) assert.ok(f.label && formatColour([0.6, 0.1, 200], f.id).length > 3, f.id);
});

test('an OKLCH colour outside sRGB is copied as it is, not mapped', () => {
  const wide: Oklch = [0.7, 0.3, 150];
  assert.ok(!inSrgb(wide));
  assert.equal(formatColour(wide, 'oklch'), 'oklch(0.7 0.3 150)');
  assert.match(formatColour(wide, 'p3'), /^color\(display-p3 [\d.]+ [\d.]+ [\d.]+\)$/);
  assert.ok(formatColour(wide, 'p3').length < 45, 'a colour past P3 is clipped to it and printed short');
});
