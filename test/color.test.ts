import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatHex } from 'culori';
import {
  cmykEstimate,
  contrast,
  cssColor,
  deltaE,
  hexToOklch,
  inP3,
  inSrgb,
  parseHex,
  simulateCvd,
  toHex,
  toSrgbGamut,
  wcagGrade,
  type Cvd,
  type Oklch,
} from '../src/shared/color/index.ts';

const HEX6 = /^#[0-9a-f]{6}$/;
/** out of sRGB but inside Display P3 */
const P3_GREEN: Oklch = [0.85, 0.3, 142];
/** out of both */
const WILD: Oklch = [0.7, 0.4, 150];

test('parseHex takes 3 or 6 digits, # optional, and nothing else', () => {
  assert.equal(parseHex('abc'), '#aabbcc');
  assert.equal(parseHex('#ABC'), '#aabbcc');
  assert.equal(parseHex('A1b2C3'), '#a1b2c3');
  assert.equal(parseHex(' #0f0 '), '#00ff00');
  for (const junk of ['', '#', 'ab', 'abcd', '#12345', '#1234567', '#abcdef80', 'ggg', 'red', '##abc'])
    assert.equal(parseHex(junk), null, junk);
});

test('the 3-digit trap: #abc goes in and six digits come out', () => {
  const o = hexToOklch('#abc');
  assert.ok(o.every(Number.isFinite));
  assert.equal(toHex(o), '#aabbcc');
  assert.equal(toHex(hexToOklch('f80')), '#ff8800');
});

test('hex round-trips exactly through OKLCH and counts as in gamut', () => {
  for (let r = 0; r < 256; r += 15)
    for (let g = 0; g < 256; g += 17)
      for (let b = 0; b < 256; b += 5) {
        const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
        const o = hexToOklch(hex);
        assert.equal(toHex(o), hex);
        assert.ok(inSrgb(o), hex);
      }
});

test('hexToOklch throws on junk instead of returning NaN', () => {
  assert.throws(() => hexToOklch('#12'), TypeError);
});

test('gamut checks run on OKLCH', () => {
  assert.equal(inSrgb(P3_GREEN), false);
  assert.equal(inP3(P3_GREEN), true);
  assert.equal(inSrgb(WILD), false);
  assert.equal(inP3(WILD), false);
  assert.ok(inSrgb([0.6, 0.1, 30]));
});

test('gamut mapping reduces chroma and keeps six digits', () => {
  for (const o of [P3_GREEN, WILD, [0.5, 0.4, 300], [0.95, 0.3, 90]] as Oklch[]) {
    assert.match(toHex(o), HEX6);
    const m = toSrgbGamut(o);
    assert.ok(inSrgb(m));
    assert.ok(m[1] < o[1], 'chroma went down');
    assert.ok(Math.abs(m[0] - o[0]) < 0.02, 'lightness held');
    assert.equal(toHex(m), toHex(o));
  }
  const inside: Oklch = [0.6, 0.1, 30];
  assert.deepEqual(toSrgbGamut(inside), inside);
  assert.notEqual(toSrgbGamut(inside), inside, 'a copy, not the same array');
});

test('gamut mapping is CSS Color 4 §13.2 as written, where culori lands elsewhere', () => {
  // expected values from a separate §13.2 implementation; culori's toGamut gives b7, db, 19
  assert.equal(toHex([0.398, 0.287, 295]), '#5900b6');
  assert.equal(toHex([0.617, 0.356, 49]), '#da5600');
  assert.equal(toHex([0.138, 0.052, 228]), '#000b18');
  assert.equal(toHex(WILD), '#00c248');
});

test('lightness past the ends maps to white and black, and stored L stays in 0..1', () => {
  assert.equal(toHex([1.2, 0.1, 30]), '#ffffff');
  assert.equal(toHex([-0.1, 0, 0]), '#000000');
  assert.deepEqual(hexToOklch('#ffffff'), [1, 0, 0], 'no 1.0000000000000002');
  assert.equal(toSrgbGamut([1.2, 0.1, 30])[0], 1);
});

test('ΔE is CIEDE2000 on its 0–100 scale', () => {
  assert.ok(Math.abs(deltaE('#000', '#fff') - 100) < 0.01);
  assert.ok(deltaE('#336699', hexToOklch('#336699')) < 1e-9);
  const near = deltaE('#ff0000', '#fe0000');
  assert.ok(near > 0 && near < 1, `just noticeable, got ${near}`);
});

test('contrast is WCAG 2, symmetric, and takes hex or OKLCH', () => {
  assert.ok(Math.abs(contrast('#000', '#fff') - 21) < 1e-9);
  assert.equal(contrast('#fff', '#fff'), 1);
  assert.equal(contrast('#777777', '#ffffff'), contrast(hexToOklch('#ffffff'), '#777'));
  assert.ok(Math.abs(contrast('#777', '#fff') - 4.48) < 0.01);
  assert.throws(() => contrast('nope', '#fff'), TypeError);
});

test('grades switch exactly at 7, 4.5 and 3', () => {
  assert.equal(wcagGrade(21), 'AAA');
  assert.equal(wcagGrade(7), 'AAA');
  assert.equal(wcagGrade(6.999), 'AA');
  assert.equal(wcagGrade(4.5), 'AA');
  assert.equal(wcagGrade(4.499), 'AA large · non-text');
  assert.equal(wcagGrade(3), 'AA large · non-text');
  assert.equal(wcagGrade(2.999), 'Fail');
  assert.equal(wcagGrade(1), 'Fail');
  assert.equal(wcagGrade(contrast('#777', '#fff')), 'AA large · non-text');
});

test('CVD simulation returns valid sRGB colours', () => {
  const types: Cvd[] = ['protan', 'deutan', 'tritan', 'achromat'];
  const colours: Oklch[] = [hexToOklch('#ff0000'), hexToOklch('#00ff00'), hexToOklch('#0000ff'), hexToOklch('#ffffff'), hexToOklch('#000000'), WILD];
  for (const type of types)
    for (const o of colours)
      for (const severity of [0, 0.3, 1]) {
        const s = simulateCvd(o, type, severity);
        assert.equal(s.length, 3);
        assert.ok(s.every(Number.isFinite), `${type} ${o} ${severity}`);
        assert.ok(s[0] >= 0 && s[0] <= 1 && s[1] >= 0 && s[2] >= 0 && s[2] < 360);
        assert.ok(inSrgb(s));
        assert.match(toHex(s), HEX6);
      }
});

test('CVD severity 0 changes nothing; full severity changes red', () => {
  const red = hexToOklch('#ff0000');
  for (const type of ['protan', 'deutan', 'tritan', 'achromat'] as Cvd[])
    assert.equal(toHex(simulateCvd(red, type, 0)), '#ff0000', type);
  assert.notEqual(toHex(simulateCvd(red, 'protan')), '#ff0000');
  assert.notEqual(toHex(simulateCvd(red, 'deutan')), '#ff0000');
  const grey = simulateCvd(red, 'achromat');
  assert.ok(grey[1] < 1e-6, 'achromat has no chroma');
  assert.ok(Math.abs(contrast(grey, '#000') - contrast(red, '#000')) < 1e-6, 'achromat keeps luminance');
});

test('CVD severity moves smoothly between culori’s 0.1 table steps', () => {
  const red = hexToOklch('#ff0000');
  const at = (s: number) => toHex(simulateCvd(red, 'protan', s));
  assert.equal(at(0.3), '#a11200', 'on a step: culori’s own value');
  assert.equal(at(0.4), '#891500');
  const between = [0.3, 0.32, 0.34, 0.36, 0.38, 0.4].map(at);
  assert.equal(new Set(between).size, between.length, `every severity moves the colour: ${between}`);
});

test('cmykEstimate gives whole percentages', () => {
  assert.deepEqual(cmykEstimate(hexToOklch('#ffffff')), [0, 0, 0, 0]);
  assert.deepEqual(cmykEstimate(hexToOklch('#000000')), [0, 0, 0, 100]);
  assert.deepEqual(cmykEstimate(hexToOklch('#ff0000')), [0, 100, 100, 0]);
  assert.deepEqual(cmykEstimate(hexToOklch('#808080')), [0, 0, 0, 50]);
  for (const v of cmykEstimate(WILD)) assert.ok(Number.isInteger(v) && v >= 0 && v <= 100);
});

test('cssColor writes a plain oklch() for inline styles', () => {
  assert.equal(cssColor([0.5, 0.1, 120]), 'oklch(0.5 0.1 120)');
  assert.equal(cssColor([0.1234567, 1e-9, 359.9999]), 'oklch(0.12346 0 360)');
  assert.match(cssColor(hexToOklch('#e72a50')), /^oklch\(0\.\d{1,5} 0\.\d{1,5} \d{1,3}(\.\d{1,3})?\)$/);
});

/** what Chromium paints for an oklch() on an sRGB screen: per-channel clip, as formatHex does */
const painted = (css: string) => formatHex(css);

test('cssColor paints as the hex readout, out of gamut too', () => {
  for (const o of [WILD, P3_GREEN, [0.6, 0.3, 30], [0.5, 0.4, 300], [1.2, 0.1, 30]] as Oklch[])
    assert.equal(painted(cssColor(o)), toHex(o), `${o}`);
  for (let v = 0; v < 1 << 24; v += 4099) {
    const hex = '#' + v.toString(16).padStart(6, '0');
    assert.equal(painted(cssColor(hexToOklch(hex))), hex);
  }
});
