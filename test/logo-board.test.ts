import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fix, mapLockup, shownLockups } from '../src/renderer/tools/logo/doc.ts';
import { boardLayout, CAP, CELL, columns, GAP, place } from '../src/renderer/tools/logo/board.ts';
import { corners } from '../src/renderer/tools/logo/geometry.ts';
import { doc } from './logo-fixtures.ts';

test('artboards go three to a row, or two for two and four, one for one', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(columns), [1, 2, 3, 2, 3, 3]);
});

test('the board holds one artboard per lockup that is on, in the document order, in a grid', () => {
  const d = fix(doc());
  const b = boardLayout(d);
  const on = shownLockups(d);
  assert.deepEqual(b.cells.map((c) => c.l.kind), on.map((l) => l.kind));
  const cols = columns(on.length);
  assert.equal(b.w, cols * CELL.w + (cols - 1) * GAP);
  assert.ok(b.cells.every((c) => c.x >= 0 && c.x + CELL.w <= b.w && c.y + CELL.h <= b.h));
  // no two artboards overlap
  for (const a of b.cells) for (const o of b.cells) if (a !== o) assert.ok(a.x + CELL.w <= o.x || o.x + CELL.w <= a.x || a.y + CELL.h <= o.y || o.y + CELL.h <= a.y);
});

test('every logo is centred on its artboard, inside it', () => {
  const d = fix(doc());
  const b = boardLayout(d);
  for (const c of b.cells) {
    assert.ok(Math.abs(c.img.x + c.img.w / 2 - (c.x + CELL.w / 2)) < 1e-6);
    assert.ok(Math.abs(c.img.y + c.img.h / 2 - (c.y + CELL.h / 2)) < 1e-6);
    assert.ok(c.img.w <= CELL.w && c.img.h <= CELL.h);
  }
});

test('a logo too big for its artboard shrinks to fit it, and never grows past its natural size', () => {
  const d = fix(doc());
  const big = mapLockup(d, 'horizontal', (l) => ({ ...l, ratio: 8 }));
  const h = place(big, big.lockups.find((l) => l.kind === 'horizontal')!, { x: 0, y: 0 });
  assert.ok(h.k < 1 && h.img.w <= CELL.w && h.img.h <= CELL.h);
  assert.ok(boardLayout(d).cells.every((c) => c.k <= 1));
});

test('held by a corner, the icon’s opposite corner stays put as the ratio changes', () => {
  const d = fix(doc());
  const l = d.lockups.find((l) => l.kind === 'horizontal')!;
  const start = place(d, l, { x: 0, y: 0 });
  for (const corner of [0, 1, 2, 3]) {
    const a = corners(start.lay.icon!)[(corner + 2) % 4];
    const anchor = { x: start.img.x + (a.x + d.clearspace) * start.u, y: start.img.y + (a.y + d.clearspace) * start.u };
    const drag = { kind: l.kind, k: start.k, anchor, corner };
    for (const ratio of [1, 2.5, 4]) {
      const next = fix(mapLockup(d, l.kind, (x) => ({ ...x, ratio })));
      const c = place(next, next.lockups.find((x) => x.kind === l.kind)!, { x: 0, y: 0 }, drag);
      const b = corners(c.lay.icon!)[(corner + 2) % 4];
      assert.ok(Math.abs(c.img.x + (b.x + d.clearspace) * c.u - anchor.x) < 1e-6);
      assert.ok(Math.abs(c.img.y + (b.y + d.clearspace) * c.u - anchor.y) < 1e-6);
      // the wordmark keeps its size: cap px = k * CAP, whatever the ratio
      assert.ok(Math.abs(c.u / c.l.ratio - CAP * start.k) < 1e-6);
    }
  }
});
