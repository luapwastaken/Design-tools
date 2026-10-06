import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inSrgb, READOUT_TOL } from '../src/shared/color/index.ts';
import { curveAt, emptyDoc, fix, foldAngle, groundIsPaper, isIdentity, opaqueOf, printPx, sharedScreen, spotInk, withPoint, type HalftoneDoc } from '../src/renderer/tools/halftone/doc.ts';
import { holds, placement, plateOf, screenKey, shownDots, svgOver } from '../src/renderer/tools/halftone/screening.ts';

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

test('a screen too fine to hold whole is still screened, region by region, on a plate of bounded size (spec §6.2)', () => {
  const d = withSource({ ...emptyDoc(), size: { w: 2000, h: 2000, unit: 'mm', dpi: 2400 }, screen: { ...emptyDoc().screen, lpi: 300 } }, 100, 100);
  const p = plateOf(d);
  assert.ok(typeof p === 'object' && p.w * p.h <= 8.1e6, 'the plate stays small');
  assert.equal(holds(d), false);
  assert.equal(holds(withSource(emptyDoc(), 100, 100)), true);
  // an FM screen is print pixel by print pixel, so it still has its own limit
  const fm = plateOf({ ...d, screen: { ...d.screen, shape: 'stochastic' } });
  assert.match(fm as string, /Lower the DPI or the size/);
});

test('the dot cap is the SVG only, and counts the inks that show', () => {
  const d = emptyDoc();
  const inks = d.inks.map((ink) => ({ id: ink.id, count: 4e6 }));
  assert.equal(shownDots({ inks } as never, d), 16e6);
  assert.match(svgOver(shownDots({ inks } as never, d))!, /^16\.0 million dots is more than the SVG takes.*hide an ink/);
  const two = { ...d, inks: d.inks.map((ink, n) => ({ ...ink, visible: n < 2 })) };
  assert.equal(svgOver(shownDots({ inks } as never, two)), null);
  assert.match(svgOver(13e6, true)!, /^About 13\.0 million/);
});

test('Opaque is on by itself for near-white spot inks only, and a choice sticks', () => {
  assert.equal(opaqueOf(spotInk('White', [1, 0, 0], 0)), true);
  assert.equal(opaqueOf(spotInk('Cream', [0.93, 0.03, 90], 0)), true);
  assert.equal(opaqueOf(spotInk('Yellow', [0.88, 0.17, 100], 0)), false);
  assert.equal(opaqueOf({ ...spotInk('White', [1, 0, 0], 0), opaque: false }), false);
  assert.equal(opaqueOf({ ...spotInk('Blue', [0.4, 0.2, 260], 0), opaque: true }), true);
  // process inks are transparent by nature
  assert.ok(emptyDoc().inks.every((ink) => !opaqueOf({ ...ink, colour: [1, 0, 0], opaque: true })));
});

test('the paper enters the screen only through an ink that covers, so a new paper redraws without screening again', () => {
  const d = withSource({ ...emptyDoc(), mode: 'spot', inks: [spotInk('Black', [0.2, 0, 0], 0)] }, 100, 100);
  const dark = { ...d, paper: { ...d.paper, colour: [0.2, 0, 0] as [number, number, number] } };
  assert.equal(screenKey(dark), screenKey(d));
  const white = { ...d, inks: [...d.inks, spotInk('White', [1, 0, 0], 1)] };
  assert.notEqual(screenKey({ ...white, paper: dark.paper }), screenKey(white));
  assert.notEqual(screenKey({ ...d, overlap: 'knockout' as const, paper: dark.paper }), screenKey({ ...d, overlap: 'knockout' as const }));
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

test("a palette's dark ground becomes the paper once a white ink can print the lights on it", () => {
  const [dark, cream, pink, white] = [[0.2, 0, 0], [0.95, 0.02, 90], [0.65, 0.25, 350], [1, 0, 0]] as [number, number, number][];
  assert.equal(groundIsPaper(cream, [pink, dark]), true, 'inks darker than the ground');
  assert.equal(groundIsPaper(dark, [pink]), false, 'a transparent pink would only darken it');
  assert.equal(groundIsPaper(dark, [white, pink]), true, 'white under the pink');
});

test('the stock process inks sit in sRGB, so the picker never calls them outside it', () => {
  for (const ink of emptyDoc().inks) assert.ok(inSrgb(ink.colour, READOUT_TOL), ink.name);
});
