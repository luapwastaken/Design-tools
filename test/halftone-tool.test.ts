import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curveAt, emptyDoc, fix, foldAngle, isIdentity, printPx, sharedScreen, withPoint, type HalftoneDoc } from '../src/renderer/tools/halftone/doc.ts';
import { placement, plateOf } from '../src/renderer/tools/halftone/screening.ts';

const withSource = (d: HalftoneDoc, w: number, h: number): HalftoneDoc => ({ ...d, source: { asset: 'dt://asset/halftone/x.png', name: 'x', w, h } });

test('a new document is A4 portrait at 300 DPI and 60 LPI, CMYK on Bone (spec §5 q5)', () => {
  const d = emptyDoc();
  assert.deepEqual(printPx(d), { w: 2480, h: 3508 });
  assert.equal(d.screen.lpi, 60);
  assert.deepEqual(d.inks.map((i) => [i.process, i.angle]), [['c', 15], ['m', 75], ['y', 0], ['k', 45]]);
});

test('the plate follows the screen, not the image: about 2.5 plate pixels a cell', () => {
  const d = withSource(emptyDoc(), 8000, 8000);
  const p = plateOf(d);
  assert.ok(typeof p === 'object');
  assert.equal(p.w, Math.round(((210 * 300) / 25.4) * (2.5 / 5)));
  // a coarser screen needs fewer plate pixels; a finer one more, up to print resolution
  const coarse = plateOf({ ...d, screen: { ...d.screen, lpi: 10 } });
  assert.ok(typeof coarse === 'object' && coarse.w < p.w);
});

test('a screen too fine for its page is refused with a reason, never frozen on', () => {
  const d = withSource({ ...emptyDoc(), size: { w: 2000, h: 2000, unit: 'mm', dpi: 2400 }, screen: { ...emptyDoc().screen, lpi: 300 } }, 100, 100);
  const why = plateOf(d);
  assert.equal(typeof why, 'string');
  assert.match(why as string, /Lower the frequency or the size/);
  const fm = plateOf({ ...d, screen: { ...d.screen, shape: 'stochastic' } });
  assert.match(fm as string, /Lower the DPI or the size/);
});

test('whole places the image inside the page, fill covers it; both centred', () => {
  const d = withSource(emptyDoc(), 1000, 1000);
  const whole = placement(d)!;
  assert.equal(Math.round(whole.w), 2480);
  assert.ok(whole.y > 0 && Math.abs(whole.x) < 1e-9);
  const fill = placement({ ...d, fit: 'cover' })!;
  assert.equal(Math.round(fill.h), 3508);
  assert.ok(fill.x < 0);
});

test('a transfer point moves alone, and the curve reads straight again when it goes back', () => {
  const c = withPoint([[0, 0], [1, 1]], 2, 0.7);
  assert.equal(curveAt(c, 0.5), 0.7);
  assert.equal(curveAt(c, 0.25), 0.25);
  assert.equal(curveAt(c, 0.75), 0.75);
  assert.ok(!isIdentity(c));
  assert.ok(isIdentity(withPoint(c, 2, 0.5)));
  assert.equal(curveAt(withPoint(c, 4, 2), 1), 1, 'outputs stay inside 0..1');
});

test('angles fold into one turn of a screen, and edits keep the page printable', () => {
  assert.equal(foldAngle(195), 15);
  assert.equal(foldAngle(-30), 150);
  const d = fix({ ...emptyDoc(), size: { w: 1, h: 99999, unit: 'mm', dpi: 5 }, screen: { shape: 'round', lpi: 9999, minDot: 1, gain: -1 } });
  assert.deepEqual([d.size.w, d.size.h, d.size.dpi], [10, 2000, 72]);
  assert.deepEqual([d.screen.lpi, d.screen.minDot, d.screen.gain], [300, 0.2, 0]);
});

test('inks a quarter turn apart share a round screen; a line screen repeats only every 180°', () => {
  const d = emptyDoc();
  assert.equal(sharedScreen(d), null);
  const turned = { ...d, inks: d.inks.map((i) => (i.process === 'y' ? { ...i, angle: 105 } : i)) };
  assert.deepEqual(sharedScreen(turned)?.map((i) => i.process), ['c', 'y']);
  assert.equal(sharedScreen({ ...turned, screen: { ...d.screen, shape: 'line' } }), null);
  assert.equal(sharedScreen({ ...turned, inks: turned.inks.map((i) => (i.process === 'c' ? { ...i, visible: false } : i)) }), null);
});
