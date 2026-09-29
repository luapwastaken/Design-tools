import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearspaceRect, layoutLockup, type Layout } from '../src/shared/logo/layout.ts';
import type { Rect } from '../src/shared/logo/types.ts';
import { desc, doc, icon, lockup, padded, part, pngPart, word, ICON_SVG } from './logo-fixtures.ts';

const close = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} ≠ ${b}`);
const same = (a: Rect | undefined, b: Rect | undefined, what: string) => {
  if (!a && !b) return;
  assert.ok(a && b, `${what}: missing`);
  for (const k of ['x', 'y', 'w', 'h'] as const) close(a[k], b[k], `${what}.${k}`);
};
const sameLayout = (a: Layout, b: Layout, what: string) => {
  close(a.w, b.w, `${what} w`);
  close(a.h, b.h, `${what} h`);
  same(a.icon, b.icon, `${what} icon`);
  same(a.wordmark, b.wordmark, `${what} wordmark`);
};

// the wordmark at ratio 2: cap height 70 → 0.5 icon heights, so 1/140 units per part unit
const WW = 142 / 140;

test('measured by the artwork: an icon in a padded artboard lays out exactly like the tight one, in every lockup', () => {
  for (const kind of ['horizontal', 'horizontal-rev', 'stacked', 'compact', 'icon'] as const) {
    for (const align of ['cap', 'center', 'baseline', 'top', 'bottom', 'start', 'end'] as const) {
      const l = lockup(kind, { align });
      sameLayout(layoutLockup(doc({ icon: padded() }), l), layoutLockup(doc(), l), `${kind} ${align}`);
    }
  }
  // the file's box (300 × 200, aspect 1.5) never reaches the maths: the artwork is square
  assert.equal(layoutLockup(doc({ icon: padded() }), lockup('icon')).w, 1);
  // nor does a wordmark's margin
  const loose = part('wordmark', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -30 400 200"><rect width="142" height="70"/></svg>', { x: 0, y: 0, w: 142, h: 70 }, { type: { capTop: 0, baseline: 70 } });
  sameLayout(layoutLockup(doc({ wordmark: loose }), lockup('horizontal')), layoutLockup(doc(), lockup('horizontal')), 'wordmark margin');
});

test('horizontal: icon one unit high on the left, the gap in icon heights, then the wordmark at its ratio', () => {
  const l = layoutLockup(doc(), lockup('horizontal', { align: 'top' }));
  same(l.icon, { x: 0, y: 0, w: 1, h: 1 }, 'icon');
  same(l.wordmark, { x: 1.5, y: 0, w: WW, h: 0.5 }, 'wordmark');
  close(l.w, 1.5 + WW, 'w');
  close(l.h, 1, 'h');
  // the icon's width follows its artwork's aspect
  const wide = part('icon', ICON_SVG, { x: 10, y: 30, w: 80, h: 40 });
  same(layoutLockup(doc({ icon: wide }), lockup('horizontal', { align: 'top' })).icon, { x: 0, y: 0, w: 2, h: 1 }, 'wide icon');
});

test('horizontal reversed: the wordmark first, the icon after the gap', () => {
  const l = layoutLockup(doc(), lockup('horizontal-rev', { align: 'top' }));
  same(l.wordmark, { x: 0, y: 0, w: WW, h: 0.5 }, 'wordmark');
  same(l.icon, { x: WW + 0.5, y: 0, w: 1, h: 1 }, 'icon');
  close(l.w, WW + 1.5, 'w');
});

test('stacked: icon above, the gap, the wordmark; start, center and end align them across', () => {
  const base = { gap: 0.3 };
  const c = layoutLockup(doc(), lockup('stacked', { ...base, align: 'center' }));
  same(c.icon, { x: (WW - 1) / 2, y: 0, w: 1, h: 1 }, 'center icon');
  same(c.wordmark, { x: 0, y: 1.3, w: WW, h: 0.5 }, 'center wordmark');
  close(c.w, WW, 'w');
  close(c.h, 1.8, 'h');
  const s = layoutLockup(doc(), lockup('stacked', { ...base, align: 'start' }));
  assert.deepEqual([s.icon!.x, s.wordmark!.x], [0, 0]);
  const e = layoutLockup(doc(), lockup('stacked', { ...base, align: 'end' }));
  close(e.icon!.x + e.icon!.w, e.wordmark!.x + e.wordmark!.w, 'end: right edges meet');
  // an icon wider than the wordmark sets the width
  const wide = part('icon', ICON_SVG, { x: 10, y: 30, w: 80, h: 40 });
  const w = layoutLockup(doc({ icon: wide }), lockup('stacked', { ...base, align: 'center' }));
  close(w.w, 2, 'wide w');
  close(w.wordmark!.x, (2 - WW) / 2, 'wordmark centred under a wide icon');
});

test('compact: the icon over the wordmark, at a ratio that sets the name about as wide as the icon', () => {
  // the wordmark is 142 wide for a 70 cap: at ratio 142/70 it is one icon height (the icon's width) wide
  const l = layoutLockup(doc(), lockup('compact', { gap: 0.2, ratio: 142 / 70 }));
  close(l.icon!.y, 0, 'icon y');
  close(l.wordmark!.y, 1.2, 'wordmark y');
  close(l.wordmark!.w, 1, 'wordmark as wide as the icon');
  close(l.w, 1, 'w');
});

test('icon only and wordmark only; the wordmark keeps its ratio so its clearspace unit matches the lockups', () => {
  const i = layoutLockup(doc(), lockup('icon'));
  assert.deepEqual(i, { w: 1, h: 1, icon: { x: 0, y: 0, w: 1, h: 1 } });
  const w = layoutLockup(doc(), lockup('wordmark', { ratio: 4 }));
  same(w.wordmark, { x: 0, y: 0, w: 142 / 280, h: 0.25 }, 'wordmark');
  assert.equal(w.icon, undefined);
});

test('a missing part leaves what there is; nothing at all is 0 × 0', () => {
  const noIcon = layoutLockup(doc({ icon: null }), lockup('horizontal'));
  assert.equal(noIcon.icon, undefined);
  same(noIcon.wordmark, { x: 0, y: 0, w: WW, h: 0.5 }, 'wordmark alone');
  assert.equal(layoutLockup(doc({ wordmark: null }), lockup('stacked')).wordmark, undefined);
  assert.deepEqual(layoutLockup(doc({ icon: null }), lockup('icon')), { w: 0, h: 0 });
  assert.deepEqual(layoutLockup(doc({ icon: null, wordmark: null }), lockup('horizontal')), { w: 0, h: 0 });
  // a part with no markup and no pixels can't be drawn
  assert.deepEqual(layoutLockup(doc({ icon: { ...icon(), svg: null } }), lockup('icon')), { w: 0, h: 0 });
  // a raster part lays out by its box like any other
  same(layoutLockup(doc({ icon: pngPart() }), lockup('icon')).icon, { x: 0, y: 0, w: 2, h: 1 }, 'png icon');
});

test('cap centres the icon on the cap band, whatever hangs below the baseline', () => {
  for (const wm of [word(), desc()]) {
    const l = layoutLockup(doc({ wordmark: wm }), lockup('horizontal', { align: 'cap' }));
    // cap band: 0..0.5 of the wordmark (cap height 70 at 1/140); its centre is 0.25 down
    close(l.icon!.y + 0.5, l.wordmark!.y + 0.25, `${wm.box.h} high: icon centre on the cap centre`);
    close(l.icon!.y, 0, 'the icon is the tallest, so it starts the lockup');
  }
  // with a descender, centring on the artwork drops the icon towards it; cap doesn't
  const c = layoutLockup(doc({ wordmark: desc() }), lockup('horizontal', { align: 'center' }));
  close(c.icon!.y + 0.5, c.wordmark!.y + 90 / 140 / 2, 'center: icon centre on the artwork centre');
});

test('baseline sits the icon on the baseline; without type metrics cap and baseline fall back to the artwork box', () => {
  const b = layoutLockup(doc({ wordmark: desc() }), lockup('horizontal', { align: 'baseline' }));
  close(b.icon!.y + 1, b.wordmark!.y + 0.5, 'icon bottom on the baseline');
  close(b.h, b.wordmark!.y + 90 / 140, 'the descender reaches below the icon');
  const bare = { ...desc(), type: undefined };
  // no metrics: the ratio is to the artwork's height, cap is the centre and baseline the bottom
  const cap = layoutLockup(doc({ wordmark: bare }), lockup('horizontal', { align: 'cap' }));
  const mid = layoutLockup(doc({ wordmark: bare }), lockup('horizontal', { align: 'center' }));
  sameLayout(cap, mid, 'cap without metrics');
  close(cap.wordmark!.h, 0.5, 'ratio 2 to the artwork height');
  const base = layoutLockup(doc({ wordmark: bare }), lockup('horizontal', { align: 'baseline' }));
  sameLayout(base, layoutLockup(doc({ wordmark: bare }), lockup('horizontal', { align: 'bottom' })), 'baseline without metrics');
  // metrics that make no band are ignored
  const broken = { ...desc(), type: { capTop: 70, baseline: 70 } };
  sameLayout(layoutLockup(doc({ wordmark: broken }), lockup('horizontal')), mid, 'empty cap band');
});

test('top and bottom align the artwork edges; an align that means nothing for the kind falls back to center', () => {
  const t = layoutLockup(doc({ wordmark: desc() }), lockup('horizontal', { align: 'top' }));
  assert.deepEqual([t.icon!.y, t.wordmark!.y], [0, 0]);
  const b = layoutLockup(doc({ wordmark: desc() }), lockup('horizontal', { align: 'bottom' }));
  close(b.icon!.y + 1, b.wordmark!.y + b.wordmark!.h, 'bottoms meet');
  sameLayout(layoutLockup(doc(), lockup('horizontal', { align: 'start' })), layoutLockup(doc(), lockup('horizontal', { align: 'center' })), 'start on horizontal');
  sameLayout(layoutLockup(doc(), lockup('stacked', { align: 'cap' })), layoutLockup(doc(), lockup('stacked', { align: 'center' })), 'cap on stacked');
});

test('each lockup keeps its own proportions: changing one never moves another', () => {
  const d = doc();
  const before = d.lockups.map((l) => layoutLockup(d, l));
  const edited = { ...d, lockups: d.lockups.map((l, i) => (i === 0 ? { ...l, ratio: 5, gap: 2, align: 'bottom' as const } : l)) };
  const after = edited.lockups.map((l) => layoutLockup(edited, l));
  assert.notDeepEqual(after[0], before[0]);
  for (let i = 1; i < before.length; i++) assert.deepEqual(after[i], before[i]);
  // the ratio sets the icon against the cap height
  const r3 = layoutLockup(d, lockup('horizontal', { ratio: 3 }));
  close(r3.wordmark!.h, 1 / 3, 'cap height at ratio 3');
});

test('clearspace: the lockup grown by clearspace icon heights on every side', () => {
  const d = doc({ clearspace: 0.75 });
  const l = layoutLockup(d, lockup('horizontal'));
  assert.deepEqual(clearspaceRect(d, lockup('horizontal')), { x: -0.75, y: -0.75, w: l.w + 1.5, h: l.h + 1.5 });
});
