import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutLockup, spaceUnit } from '../src/shared/logo/layout.ts';
import { parseSize } from '../src/shared/svg/index.ts';
import type { LogoPayload } from '../src/shared/types.ts';
import { emptyDoc, fix, fromPayload, isEmpty, toPayload, withPart, type LogoDoc } from '../src/renderer/tools/logo/doc.ts';
import { corners, handleAt, heldView, pxPerUnit, ratioFor, type Grip } from '../src/renderer/tools/logo/geometry.ts';
import { doc, icon, lockup, padded, pngPart, word } from './logo-fixtures.ts';

const file = (d: LogoDoc) => ({ kind: 'logo', id: 'x', version: 1, ...toPayload(d) }) as LogoPayload;

test('a logo file opens as the document it was written from, each part framed to its artwork', () => {
  const d = fix(doc({ icon: padded() }));
  const back = fromPayload(file(d));
  const { icon, wordmark, ...rest } = back;
  assert.deepEqual({ ...d, icon: null, wordmark: null }, { ...rest, icon: null, wordmark: null });
  assert.deepEqual(icon!.box, d.icon!.box);
  assert.deepEqual(parseSize(icon!.svg!).viewBox, [120, 70, 80, 80]);
  assert.equal(icon!.svg!.replace(/<svg[^>]*>/, ''), d.icon!.svg!.replace(/<svg[^>]*>/, ''));
  assert.deepEqual(wordmark!.type, d.wordmark!.type);
});

test('the file names each part by its markup, as other tools read it; a PNG part travels as an SVG of its pixels', () => {
  const d = fix(doc({ icon: pngPart() }));
  const p = file(d);
  assert.match(p.wordmark!, /^<svg[^>]*viewBox="0 0 142 70"/);
  assert.equal(p.wordmark!.replace(/<svg[^>]*>/, ''), d.wordmark!.svg!.replace(/<svg[^>]*>/, ''));
  assert.match(p.icon!, /^<svg[^>]*><image [^>]*href="data:image\/png/);
  const back = fromPayload(p);
  assert.equal(back.icon!.svg, null);
  assert.equal(back.icon!.png, d.icon!.png);
  assert.deepEqual(back.icon!.box, d.icon!.box);
});

test('the preview is the main lockup in its own colours, trimmed, with no filter', () => {
  const d = fix(doc());
  const svg = file(d).preview.svg;
  const lay = layoutLockup(d, d.lockups.find((l) => l.on)!);
  const [w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg)!.slice(1).map(Number);
  assert.ok(Math.abs(w / h - lay.w / lay.h) < 1e-3);
  assert.doesNotMatch(svg, /filter/);
});

test('a hand-edited or broken file still opens, taking the defaults', () => {
  const d = fromPayload({ icon: 'not svg', wordmark: null, lockups: 'nope', versions: [7], colour: 'red', clearspace: 99, pngHeight: -3, preview: { svg: '' } });
  assert.equal(d.icon, null);
  assert.equal(d.lockups.length, 6);
  assert.deepEqual(d.versions, emptyDoc().versions);
  assert.equal(d.clearspace, 2);
  assert.equal(d.pngHeight, 16);
  assert.ok(isEmpty(d));
});

test('the second part proposes the lockups; replacing a part of a pair keeps every lockup’s proportions', () => {
  const one = withPart(emptyDoc(), 'icon', icon());
  assert.deepEqual(
    one.lockups.filter((l) => l.on).map((l) => l.kind),
    ['icon'],
  );
  const both = withPart(one, 'wordmark', word());
  assert.ok(both.lockups.find((l) => l.kind === 'horizontal')!.on);
  const tuned = { ...both, lockups: both.lockups.map((l) => ({ ...l, ratio: 3.21, gap: 1.23 })) };
  const replaced = withPart(tuned, 'icon', padded());
  assert.deepEqual(
    replaced.lockups.map((l) => [l.ratio, l.gap]),
    tuned.lockups.map(() => [3.21, 1.23]),
  );
});

test('an icon handle follows the pointer along its corner’s line, for every corner', () => {
  const d = fix(doc());
  for (const corner of [0, 1, 2, 3])
    for (const want of [0.8, 1.9, 4.4]) {
      const g: Grip = { corner, a0: { x: 400, y: 300 }, cap: 22 };
      const at = handleAt(d, lockup('horizontal', { ratio: want }), g);
      assert.equal(ratioFor(d, g, at), want);
      // off the line, the nearest point on it
      assert.equal(ratioFor(d, g, { x: at.x + 30 * (corner % 3 ? -1 : 1), y: at.y + 30 * (corner < 2 ? -1 : 1) }), want);
    }
});

test('while a handle drags, the icon’s far corner stays put and the wordmark keeps its size', () => {
  const d = fix(doc());
  const box = { w: 900, h: 600 };
  for (const kind of ['horizontal', 'compact'] as const)
    for (const corner of [0, 2])
      for (const ratio of [0.7, 2, 5]) {
        const g: Grip = { corner, a0: { x: 320, y: 210 }, cap: 18 };
        const l = lockup(kind, { ratio });
        const v = heldView(d, l, g, box)!;
        const lay = layoutLockup(d, l);
        const u = pxPerUnit(d, lay);
        const screen = (x: number, y: number) => ({ x: box.w / 2 + ((x + d.clearspace) * u - v.x) * v.scale, y: box.h / 2 + ((y + d.clearspace) * u - v.y) * v.scale });
        const a = corners(lay.icon!)[(corner + 2) % 4];
        const at = screen(a.x, a.y);
        assert.ok(Math.abs(at.x - g.a0.x) < 1e-6 && Math.abs(at.y - g.a0.y) < 1e-6);
        // the wordmark's cap band is 1 / ratio layout units
        assert.ok(Math.abs((u * v.scale) / ratio - g.cap) < 1e-9);
        const c = corners(lay.icon!)[corner];
        const h = screen(c.x, c.y);
        const want = handleAt(d, l, g);
        assert.ok(Math.abs(h.x - want.x) < 1e-6 && Math.abs(h.y - want.y) < 1e-6);
      }
});

test('the wordmark alone takes the main pair’s ratio, so its clearspace is in the same icon heights; with no icon, cap heights', () => {
  const d = fix({ ...doc(), lockups: [lockup('horizontal', { ratio: 4 }), lockup('stacked', { ratio: 3 }), lockup('wordmark', { ratio: 1.75 })] });
  assert.equal(d.lockups.find((l) => l.kind === 'wordmark')!.ratio, 4);
  // the first pair on is the main one
  const off = fix({ ...d, lockups: d.lockups.map((l) => (l.kind === 'horizontal' ? { ...l, on: false } : l)) });
  assert.equal(off.lockups.find((l) => l.kind === 'wordmark')!.ratio, 3);
  const alone = fix({ ...d, icon: null });
  assert.equal(alone.lockups.find((l) => l.kind === 'wordmark')!.ratio, 1);
  assert.equal(spaceUnit(alone), 'cap height');
  assert.equal(spaceUnit(d), 'icon height');
});

test('a raster part’s silhouette travels with it through the file', () => {
  const d = withPart(emptyDoc(), 'icon', { ...pngPart(), silhouette: pngPart().png! });
  assert.equal(fromPayload(file(d)).icon!.silhouette, pngPart().png);
});
