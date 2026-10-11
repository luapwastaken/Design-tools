import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex } from '../src/shared/color/index.ts';
import { layoutLockup } from '../src/shared/logo/layout.ts';
import { clearspaceRect, lockupSvg, previewSvg, source, UNIT_PX } from '../src/shared/logo/svg.ts';
import { parseSize } from '../src/shared/svg/index.ts';
import { serialize } from '../src/shared/svg/xml.ts';
import { VERSIONS, type LogoDoc, type Version } from '../src/shared/logo/types.ts';
import { svgColours } from '../src/shared/svg/index.ts';
import { getAttr, isEl, parseSvg, textOf, walk, type El } from '../src/shared/svg/xml.ts';
import { doc, icon, lockup, padded, part, pngPart, word, ICON_BOX, ICON_SVG, PADDED_BOX, PADDED_SHIFT, PNG_URL, WORD_BOX, WORD_SVG } from './logo-fixtures.ts';

const H = lockup('horizontal', { align: 'cap' });
const els = (root: El) => [...walk(root)].map((w) => w.el);
const byId = (root: El, id: string) => els(root).find((e) => getAttr(e, 'id') === id);
const hexes = (svg: string) => [...new Set(svgColours(svg).map(toHex))].sort();
/** an element as a file of its own, for reading its colours */
const serializeEl = (el: El) => `<svg xmlns="http://www.w3.org/2000/svg">${serialize(el.name === 'mask' ? { ...el, name: 'g' } : el)}</svg>`;

/** every id, url(#) and href="#" in a file: dangling references and duplicate ids break a file opened on its own */
function selfContained(svg: string) {
  const root = parseSvg(svg);
  const ids = els(root).map((e) => getAttr(e, 'id')).filter((v): v is string => !!v);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  const refs = [...svg.matchAll(/url\(\s*['"]?#([^)'"]+)/g), ...svg.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
  for (const r of refs) assert.ok(ids.includes(r), `#${r} is defined in the file`);
  // every class a style rule names is on an element of the file, so no rule was cut loose from its art
  const used = new Set(els(root).flatMap((e) => (getAttr(e, 'class') ?? '').split(/\s+/).filter(Boolean)));
  for (const s of els(root).filter((e) => e.name === 'style')) {
    for (const m of textOf(s).matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) assert.ok(used.has(m[1]), `.${m[1]} is used`);
  }
  assert.equal(getAttr(root, 'xmlns'), 'http://www.w3.org/2000/svg');
  assert.equal(getAttr(root, 'xmlns:xlink'), 'http://www.w3.org/1999/xlink');
  return { root, ids };
}

/** where a placed group puts a point of its part's own units, in file px */
function mapper(g: El) {
  const m = /^translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)$/.exec(getAttr(g, 'transform') ?? '');
  assert.ok(m, `a translate + scale on ${getAttr(g, 'id')}`);
  const [tx, ty, k] = [+m[1], +m[2], +m[3]];
  return (x: number, y: number) => [tx + k * x, ty + k * y];
}
const group = (svg: string, role: 'icon' | 'wordmark') => els(parseSvg(svg)).find((e) => e.name === 'g' && getAttr(e, 'id')?.endsWith(`-${role}`))!;
const near = (a: number[], b: number[], what: string) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 2e-3, `${what}: ${a} ≠ ${b}`));

test('every version is real vector art: no filters, no embedded pictures, a file that stands on its own', () => {
  for (const v of VERSIONS) {
    for (const d of [doc(), doc({ icon: padded() })]) {
      for (const l of d.lockups) {
        const svg = lockupSvg(d, l, v, { padding: 'clearspace' });
        assert.doesNotMatch(svg, /filter/i, `${l.kind} ${v}: no filter`);
        assert.doesNotMatch(svg, /<image/, `${l.kind} ${v}: no <image>`);
        assert.match(svg, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<svg /);
        selfContained(svg);
      }
    }
  }
});

test('versions are real fills: black, white, one colour, knockout; the original keeps the artwork colours', () => {
  const d = doc({ icon: padded() });
  const own = ['#29335c', '#e4572e'];
  const c = toHex(d.colour);
  const want: Record<Version, string[]> = { original: own, black: ['#000000'], white: ['#ffffff'], colour: [c], knockout: [c, '#ffffff'].sort() };
  for (const v of VERSIONS) assert.deepEqual(hexes(lockupSvg(d, H, v, { padding: 'tight' })), want[v], v);
  // the knockout field is a rect over the whole file, behind the logo
  const root = parseSvg(lockupSvg(d, H, 'knockout', { padding: 'clearspace' }));
  const first = root.children.filter(isEl)[0];
  assert.equal(first.name, 'rect');
  assert.deepEqual([getAttr(first, 'width'), getAttr(first, 'height'), getAttr(first, 'fill')], [getAttr(root, 'width')!.replace('px', ''), getAttr(root, 'height')!.replace('px', ''), c]);
  // nothing but the knockout has a background
  for (const v of ['original', 'black', 'white', 'colour'] as const) {
    assert.ok(parseSvg(lockupSvg(d, H, v, { padding: 'clearspace' })).children.filter(isEl).every((e) => e.name === 'g'), `${v} is transparent`);
  }
});

test('a padded artboard exports exactly like the tight file: the artwork lands on the same pixels', () => {
  for (const l of doc().lockups.filter((x) => x.kind !== 'wordmark')) {
    for (const padding of ['clearspace', 'tight'] as const) {
      const tight = mapper(group(lockupSvg(doc(), l, 'original', { padding }), 'icon'));
      const loose = mapper(group(lockupSvg(doc({ icon: padded() }), l, 'original', { padding }), 'icon'));
      near(loose(PADDED_BOX.x, PADDED_BOX.y), tight(ICON_BOX.x, ICON_BOX.y), `${l.kind} ${padding} top left`);
      near(loose(PADDED_BOX.x + 80, PADDED_BOX.y + 80), tight(ICON_BOX.x + 80, ICON_BOX.y + 80), `${l.kind} ${padding} bottom right`);
      // the circle's centre too: the art moved with its box
      near(loose(50 + PADDED_SHIFT.x, 50 + PADDED_SHIFT.y), tight(50, 50), `${l.kind} ${padding} centre`);
    }
  }
});

test('the parts land on their layout rects, in px, inside the padding', () => {
  const d = doc();
  const lay = layoutLockup(d, H);
  const c = d.clearspace;
  const svg = lockupSvg(d, H, 'original', { padding: 'clearspace' });
  const root = parseSvg(svg);
  const [w, h] = [(lay.w + 2 * c) * UNIT_PX, (lay.h + 2 * c) * UNIT_PX];
  assert.equal(getAttr(root, 'width'), `${+w.toFixed(2)}px`);
  assert.equal(getAttr(root, 'height'), `${+h.toFixed(2)}px`);
  assert.equal(getAttr(root, 'viewBox'), `0 0 ${+w.toFixed(2)} ${+h.toFixed(2)}`);
  const at = (r: { x: number; y: number; w: number; h: number }) => [(c + r.x) * UNIT_PX, (c + r.y) * UNIT_PX, (c + r.x + r.w) * UNIT_PX, (c + r.y + r.h) * UNIT_PX];
  const i = mapper(group(svg, 'icon'));
  near([...i(ICON_BOX.x, ICON_BOX.y), ...i(ICON_BOX.x + ICON_BOX.w, ICON_BOX.y + ICON_BOX.h)], at(lay.icon!), 'icon');
  const wm = mapper(group(svg, 'wordmark'));
  near([...wm(0, 0), ...wm(WORD_BOX.w, WORD_BOX.h)], at(lay.wordmark!), 'wordmark');
  // tight: no margin, the art touches the edges
  const t = parseSvg(lockupSvg(d, H, 'original', { padding: 'tight' }));
  assert.equal(getAttr(t, 'height'), `${+(lay.h * UNIT_PX).toFixed(2)}px`);
  // the padding is the clearspace rect
  const cs = clearspaceRect(d, H);
  assert.deepEqual([cs.w * UNIT_PX, cs.h * UNIT_PX].map((v) => +v.toFixed(2)), [+w.toFixed(2), +h.toFixed(2)]);
});

test('a height sets the whole file in px, padding included, and keeps the proportions', () => {
  const d = doc();
  for (const padding of ['clearspace', 'tight'] as const) {
    const root = parseSvg(lockupSvg(d, H, 'black', { padding, height: 64 }));
    const cs = padding === 'clearspace' ? clearspaceRect(d, H) : { ...layoutLockup(d, H) };
    assert.equal(getAttr(root, 'height'), '64px');
    assert.equal(getAttr(root, 'width'), `${+((64 * cs.w) / cs.h).toFixed(2)}px`);
  }
  // without one, an icon height is UNIT_PX in every lockup's file, so the files match when placed together
  for (const l of d.lockups.filter((x) => x.kind !== 'wordmark')) {
    const g = mapper(group(lockupSvg(d, l, 'original', { padding: 'tight' }), 'icon'));
    assert.equal(+(g(0, ICON_BOX.y + ICON_BOX.h)[1] - g(0, ICON_BOX.y)[1]).toFixed(6), UNIT_PX, l.kind);
  }
});

test('namespaced per file: no two exports share an id, even two logos, even two parts from one file', () => {
  const seen = new Map<string, string>();
  const other = doc({ icon: part('icon', ICON_SVG.replace('r="40"', 'r="39"'), ICON_BOX) });
  for (const [name, d] of [['a', doc({ icon: padded() })], ['b', other]] as const) {
    for (const v of VERSIONS) {
      for (const l of d.lockups) {
        const { ids } = selfContained(lockupSvg(d, l, v, { padding: 'tight' }));
        for (const id of ids) {
          assert.ok(!seen.has(id), `${id} in ${name} ${l.kind} ${v} and ${seen.get(id)}`);
          seen.set(id, `${name} ${l.kind} ${v}`);
        }
      }
    }
  }
  // the same markup under the same prefix as both parts (one file split in two) still can't clash
  const twin = part('art', ICON_SVG.replace('<circle', '<circle class="dot"').replace('</svg>', '<style>.dot{fill:#00ff00}</style></svg>'), ICON_BOX);
  const svg = lockupSvg(doc({ icon: twin, wordmark: { ...twin, type: undefined } }), H, 'original', { padding: 'tight' });
  selfContained(svg);
  assert.equal(new Set([...svg.matchAll(/class="([^"]+)"/g)].map((m) => m[1])).size, 4, 'each part has its own classes');
});

test('parts go in as editable groups: one group per part, its paths as drawn, the Illustrator root id dropped unless used', () => {
  const svg = lockupSvg(doc({ icon: padded() }), H, 'original', { padding: 'tight' });
  const g = group(svg, 'icon');
  assert.deepEqual(g.children.filter(isEl).map((e) => e.name), ['defs', 'circle', 'rect']);
  assert.ok(!svg.includes('Layer_1'));
  assert.equal(getAttr(g, 'data-name'), 'Layer 1');
  // a root id a style rule points at stays, on a group of its own inside the placed one
  const pointed = part('icon', ICON_SVG.replace('<svg ', '<svg id="mark" ').replace('</svg>', '<style>#mark circle{fill:#00ff00}</style></svg>'), ICON_BOX);
  const kept = lockupSvg(doc({ icon: pointed }), H, 'original', { padding: 'tight' });
  const inner = group(kept, 'icon').children.filter(isEl);
  assert.equal(inner.length, 1);
  assert.match(getAttr(inner[0], 'id')!, /-mark$/);
  assert.ok(kept.includes(`#${getAttr(inner[0], 'id')} circle`));
  selfContained(kept);
});

test('raster parts: the picture as an <image>, tinted through its white silhouette with a luminance mask, never a filter', () => {
  const d = doc({ icon: { ...pngPart(), silhouette: PNG_URL } });
  const original = lockupSvg(d, H, 'original', { padding: 'tight' });
  const img = els(parseSvg(original)).find((e) => e.name === 'image')!;
  assert.match(getAttr(img, 'xlink:href')!, /^data:image\/png;base64,/);
  assert.deepEqual(['x', 'y', 'width', 'height'].map((a) => getAttr(img, a)), ['0', '0', '4', '2']);
  assert.ok(!original.includes('<mask'));
  for (const v of ['black', 'white', 'colour', 'knockout'] as const) {
    const svg = lockupSvg(d, H, v, { padding: 'tight' });
    assert.doesNotMatch(svg, /filter/i);
    const root = parseSvg(svg);
    const mask = els(root).find((e) => e.name === 'mask')!;
    // a luminance mask, as SVG 1.1 readers and Illustrator apply every mask; the silhouette is white
    assert.equal(getAttr(mask, 'mask-type'), null);
    const tinted = els(root).find((e) => getAttr(e, 'mask') === `url(#${getAttr(mask, 'id')})`)!;
    assert.equal(tinted.name, 'rect');
    assert.equal(getAttr(tinted, 'fill'), v === 'black' ? '#000000' : v === 'colour' ? toHex(d.colour) : '#ffffff');
    selfContained(svg);
  }
  // the SVG part beside it stays vector
  assert.equal([...original.matchAll(/<image/g)].length, 1);
});

test('the preview is the first lockup that is on, in its own colours, trimmed and transparent', () => {
  const d: LogoDoc = { ...doc(), lockups: [lockup('horizontal', { on: false }), lockup('stacked'), lockup('icon')] };
  assert.equal(previewSvg(d), lockupSvg(d, d.lockups[1], 'original', { padding: 'tight' }));
  // a lockup whose parts are missing is passed over
  assert.equal(previewSvg({ ...d, icon: null, lockups: [lockup('icon'), lockup('wordmark')] }), lockupSvg({ ...d, icon: null }, lockup('wordmark'), 'original', { padding: 'tight' }));
  assert.equal(previewSvg({ ...d, icon: null, wordmark: null }), null);
  assert.throws(() => lockupSvg({ ...d, icon: null, wordmark: null }, H, 'original', { padding: 'tight' }), /Add an icon or a wordmark/);
});

test('a part whose markup names no fill still exports black in the original and the colour in a version', () => {
  const bare = part('wordmark', WORD_SVG.replace(' fill="#29335c"', ''), WORD_BOX);
  const d = doc({ icon: icon(), wordmark: bare });
  assert.deepEqual(hexes(lockupSvg(d, lockup('wordmark'), 'original', { padding: 'tight' })), ['#000000']);
  assert.deepEqual(hexes(lockupSvg(d, lockup('wordmark'), 'white', { padding: 'tight' })), ['#ffffff']);
  assert.deepEqual(hexes(lockupSvg(d, lockup('horizontal'), 'colour', { padding: 'tight' })), [toHex(d.colour)]);
  assert.ok(word().svg);
});

test('one-colour versions cut near-white paper out of the artwork with a luminance mask; an all-white logo keeps its white', () => {
  const smile = part('icon', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#1d4ed8"/><path d="M30 55h40v8H30z" fill="#fff"/></svg>', ICON_BOX);
  const d = doc({ icon: smile });
  const I = lockup('icon');
  assert.ok(!lockupSvg(d, I, 'original', { padding: 'tight' }).includes('<mask'), 'the original draws its own white');
  for (const v of ['black', 'white', 'colour', 'knockout'] as const) {
    const svg = lockupSvg(d, I, v, { padding: 'tight' });
    const root = parseSvg(svg);
    const mask = els(root).find((e) => e.name === 'mask')!;
    assert.ok(mask, `${v} has a mask`);
    assert.equal(getAttr(mask, 'mask-type'), null, 'luminance, as every reader applies it');
    // the mask draws the circle white and the smile black: ink shows, paper is a hole
    assert.deepEqual(hexes(serializeEl(mask)), ['#000000', '#ffffff']);
    const masked = els(root).find((e) => getAttr(e, 'mask') === `url(#${getAttr(mask, 'id')})`)!;
    assert.deepEqual(hexes(serializeEl(masked)), [v === 'black' ? '#000000' : v === 'colour' ? toHex(d.colour) : '#ffffff']);
    assert.doesNotMatch(svg, /filter/i);
    selfContained(svg);
  }
  // a logo drawn all in white has no paper to cut, or it would vanish
  const white = part('icon', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#fff"/></svg>', ICON_BOX);
  assert.ok(!lockupSvg(doc({ icon: white }), I, 'black', { padding: 'tight' }).includes('<mask'));
});

test('knockout keeps its field round the logo even when exports are trimmed tight', () => {
  const d = doc();
  const tight = parseSize(lockupSvg(d, lockup('icon'), 'black', { padding: 'tight' }));
  const knock = parseSize(lockupSvg(d, lockup('icon'), 'knockout', { padding: 'tight' }));
  assert.equal(tight.width, UNIT_PX);
  assert.equal(knock.width, UNIT_PX * (1 + 2 * d.clearspace));
});

test('a part’s id tag ignores its root tag, even a quoted > in it, so a reopened logo names its files alike', () => {
  const a = { ...icon(), svg: icon().svg!.replace('<svg ', '<svg data-name="A > B" ') };
  const b = { ...a, svg: a.svg!.replace('data-name="A > B" ', 'width="80" ') };
  assert.equal(source(a), source(b));
  const ids = (d: LogoDoc) => lockupSvg(d, H, 'black', { padding: 'tight' }).match(/id="([^"]+)"/)![1];
  assert.equal(ids(doc({ icon: a })), ids(doc({ icon: b })));
});

test('the file has a title, and the same logo exports the same bytes twice (ids included)', () => {
  const d = doc();
  const a = lockupSvg(d, H, 'original', { padding: 'clearspace', title: 'Acme <horizontal> & co' });
  const root = parseSvg(a);
  const first = root.children.find(isEl)!;
  assert.equal(first.name, 'title', 'the title comes before the drawing');
  assert.equal(textOf(first), 'Acme &lt;horizontal&gt; &amp; co');
  assert.equal(a, lockupSvg(d, H, 'original', { padding: 'clearspace', title: 'Acme <horizontal> & co' }));
  assert.doesNotMatch(lockupSvg(d, H, 'original', { padding: 'clearspace' }), /<title/, 'no title asked, none written');
});

test('the file’s sizes are rounded to two decimals', () => {
  const svg = lockupSvg(doc(), lockup('stacked', { gap: 0.37, ratio: 2.9 }), 'black', { padding: 'clearspace', height: 333.333 });
  const root = parseSvg(svg);
  for (const a of ['width', 'height', 'viewBox']) assert.doesNotMatch(getAttr(root, a)!, /\.\d{3}/, a);
});

test('a clip path far outside the artwork is dropped with everything that pointed at it; one that touches it stays', () => {
  const art = (clip: string) =>
    part('icon', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><defs><style>.cls-1{fill:none;stroke:#29335c;stroke-width:4px;clip-path:url(#clippath);}</style><clipPath id="clippath">${clip}</clipPath></defs><g clip-path="url(#clippath)"><circle class="cls-1" cx="160" cy="110" r="40"/></g></svg>`, PADDED_BOX);
  const d = (clip: string) => doc({ icon: art(clip) });
  const loose = lockupSvg(d('<rect width="300" height="200"/>'), lockup('icon'), 'original', { padding: 'tight' });
  assert.doesNotMatch(loose, /clip/i, 'no clipPath, no clip-path attribute, no clip-path rule');
  selfContained(loose);
  // the artboard-sized clip is gone but the drawing is whole
  assert.match(loose, /<circle/);
  // exactly the artwork's bounds: it may trim the stroke, so it stays
  const snug = lockupSvg(d('<rect x="120" y="70" width="80" height="80"/>'), lockup('icon'), 'original', { padding: 'tight' });
  assert.match(snug, /<clipPath/);
  assert.match(snug, /<g clip-path="url\(#[\w-]+clippath\)">/);
  selfContained(snug);
  // a clip that is not a plain rectangle is left alone
  const odd = lockupSvg(d('<rect width="300" height="200" rx="20"/>'), lockup('icon'), 'original', { padding: 'tight' });
  assert.match(odd, /<clipPath/);
});
