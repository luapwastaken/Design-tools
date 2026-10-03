import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutLockup } from '../src/shared/logo/layout.ts';
import { proposeLockups } from '../src/shared/logo/propose.ts';
import { ALIGNS, KINDS, type Lockup, type LockupKind, type Part } from '../src/shared/logo/types.ts';
import { desc, icon, part, ICON_SVG, TYPE, WORD_SVG } from './logo-fixtures.ts';

const onKinds = (ls: Lockup[]) => ls.filter((l) => l.on).map((l) => l.kind).sort();
const get = (ls: Lockup[], k: LockupKind) => ls.find((l) => l.kind === k)!;
/** an icon of this width ÷ height */
const shaped = (aspect: number): Part => part('icon', ICON_SVG, { x: 0, y: 0, w: 80 * aspect, h: 80 });
/** a wordmark this many cap heights long */
const long = (caps: number, more: Partial<Part> = {}): Part => part('wordmark', WORD_SVG, { x: 0, y: 0, w: 70 * caps, h: 70 }, { type: TYPE, ...more });

test('all six kinds come back, each once, whatever the parts', () => {
  for (const [i, w] of [[icon(), long(8)], [icon(), null], [null, long(8)], [null, null], [shaped(0.4), long(2)]] as const) {
    const ls = proposeLockups(i, w);
    assert.deepEqual(ls.map((l) => l.kind).sort(), [...KINDS].sort());
    for (const l of ls) assert.ok(ALIGNS[l.kind].includes(l.align), `${l.kind} proposes an align it has`);
  }
});

test('icon only and wordmark only are on exactly when that part exists; pairs need both', () => {
  assert.deepEqual(onKinds(proposeLockups(icon(), null)), ['icon']);
  assert.deepEqual(onKinds(proposeLockups(null, long(8))), ['wordmark']);
  assert.deepEqual(onKinds(proposeLockups(null, null)), []);
});

test('a very wide wordmark proposes horizontal and stacked, not the reversed ones', () => {
  assert.deepEqual(onKinds(proposeLockups(icon(), long(9))), ['horizontal', 'icon', 'stacked', 'wordmark']);
});

test('where they fit: a compact icon and a short name add reversed horizontal, and a very short name the compact stack', () => {
  assert.deepEqual(onKinds(proposeLockups(icon(), long(3))), ['compact', 'horizontal', 'horizontal-rev', 'icon', 'stacked', 'wordmark']);
  assert.equal(get(proposeLockups(icon(), long(5)), 'compact').on, false);
  assert.equal(get(proposeLockups(icon(), long(5)), 'horizontal-rev').on, true);
  // under a tall mark the short name isn't a block
  assert.equal(get(proposeLockups(shaped(0.4), long(3)), 'compact').on, false);
  // compact sets the name as wide as the icon: 3 cap heights long under a square icon, a ratio of 3
  const c = get(proposeLockups(icon(), long(3)), 'compact');
  assert.equal(c.ratio, 3);
  const lay = layoutLockup({ icon: icon(), wordmark: long(3) }, c);
  assert.ok(Math.abs(lay.wordmark!.w - lay.icon!.w) < 0.02, `wordmark ${lay.wordmark!.w} as wide as the icon ${lay.icon!.w}`);
});

test('stacked never sets a wide icon far wider than the name under it', () => {
  // a 10:1 banner over a name 7.8 cap heights long: about as wide as the name, where the old floor made it 25
  const s = get(proposeLockups(shaped(10), long(7.8)), 'stacked');
  const lay = layoutLockup({ icon: shaped(10), wordmark: long(7.8) }, s);
  assert.ok(lay.icon!.w <= 1.3 * lay.wordmark!.w, `icon ${lay.icon!.w} about the wordmark's ${lay.wordmark!.w}`);
  // a square icon over a short name keeps the floor: a mark, not a stamp
  assert.equal(get(proposeLockups(icon(), long(3)), 'stacked').ratio, 2.5);
});

test('a tall icon favours stacked: it comes first and reversed horizontal stays off', () => {
  const ls = proposeLockups(shaped(0.5), long(5));
  assert.equal(ls[0].kind, 'stacked');
  assert.equal(get(ls, 'horizontal-rev').on, false);
  assert.equal(get(ls, 'stacked').on, true);
  // a square icon keeps horizontal first
  assert.equal(proposeLockups(icon(), long(5))[0].kind, 'horizontal');
});

test('a very wide icon goes stacked, not beside the name', () => {
  const ls = proposeLockups(shaped(3), long(6));
  assert.equal(get(ls, 'horizontal').on, false);
  assert.equal(ls[0].kind, 'stacked');
});

test('defaults: gap 0.5 beside and 0.3 stacked, cap alignment when the wordmark has type metrics', () => {
  const ls = proposeLockups(icon(), long(6));
  assert.equal(get(ls, 'horizontal').gap, 0.5);
  assert.equal(get(ls, 'stacked').gap, 0.3);
  assert.equal(get(ls, 'horizontal').align, 'cap');
  assert.equal(get(ls, 'horizontal-rev').align, 'cap');
  assert.equal(get(ls, 'stacked').align, 'center');
  assert.equal(get(proposeLockups(icon(), long(6, { type: undefined })), 'horizontal').align, 'center');
});

test('the ratio comes from the parts: beside, the icon stands taller than the whole wordmark; above, about half its length wide', () => {
  const plain = get(proposeLockups(icon(), long(6)), 'horizontal');
  assert.equal(plain.ratio, 1.75);
  // a wordmark 2.2 cap heights tall (a tagline under it) gets a taller icon, never shorter than the wordmark
  const tagline = long(6, { box: { x: 0, y: 0, w: 420, h: 154 } });
  const h = get(proposeLockups(icon(), tagline), 'horizontal');
  const lay = layoutLockup({ icon: icon(), wordmark: tagline }, h);
  assert.ok(lay.wordmark!.h < 1, `the icon (1) outstands the wordmark (${lay.wordmark!.h})`);
  // stacked: a square icon about half as wide as the wordmark is long
  const s = get(proposeLockups(icon(), long(8)), 'stacked');
  assert.equal(s.ratio, 4);
  const sl = layoutLockup({ icon: icon(), wordmark: long(8) }, s);
  assert.equal(+(sl.icon!.w / sl.wordmark!.w).toFixed(3), 0.5);
  // clamped: a tiny name can't shrink the icon under 2.5 cap heights, a huge one can't grow it past 6
  assert.equal(get(proposeLockups(icon(), long(2)), 'stacked').ratio, 2.5);
  assert.equal(get(proposeLockups(icon(), long(30)), 'stacked').ratio, 6);
  // descenders count in the artwork height but not in the cap height the ratio is measured against
  assert.equal(get(proposeLockups(icon(), desc()), 'horizontal').ratio, 1.75);
});
