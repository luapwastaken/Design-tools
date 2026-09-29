import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex } from '../src/shared/color/index.ts';
import { brandSheetSvg } from '../src/shared/logo/sheet.ts';
import { KIND_LABEL, VERSION_LABEL, VERSIONS, type LogoDoc } from '../src/shared/logo/types.ts';
import { getAttr, parseSvg, walk } from '../src/shared/svg/xml.ts';
import { doc, lockup, padded, pngPart } from './logo-fixtures.ts';

const els = (svg: string) => [...walk(parseSvg(svg))].map((w) => w.el);
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1].replace(/&#(\d+);/g, (_, c) => String.fromCharCode(+c)));

test('the sheet holds every lockup that is on in every version that is on, and nothing that is off', () => {
  const d: LogoDoc = {
    ...doc({ icon: padded() }),
    lockups: [lockup('horizontal', { align: 'cap' }), lockup('stacked'), lockup('horizontal-rev', { on: false }), lockup('icon'), lockup('wordmark')],
    versions: ['original', 'white', 'knockout'],
  };
  const svg = brandSheetSvg(d, { name: 'Test mark' });
  const t = texts(svg);
  for (const l of d.lockups) {
    for (const v of VERSIONS) {
      const caption = `${KIND_LABEL[l.kind]} · ${VERSION_LABEL[v]}`.toUpperCase();
      assert.equal(t.includes(caption), l.on && d.versions.includes(v), caption);
    }
  }
  assert.ok(t.includes('Test mark'));
  // each part is drawn once per version and placed by <use>; every <use> finds its art
  const ids = new Set(els(svg).map((e) => getAttr(e, 'id')).filter(Boolean));
  const uses = els(svg).filter((e) => e.name === 'use');
  for (const u of uses) assert.ok(ids.has(getAttr(u, 'xlink:href')!.slice(1)));
  const defs = els(svg).find((e) => e.name === 'defs')!;
  assert.deepEqual(new Set(defs.children.map((c) => ('name' in c ? getAttr(c, 'id')!.replace(/^sheet-\w+-/, '') : ''))), new Set(['original-icon', 'original-wordmark', 'white-icon', 'white-wordmark', 'knockout-icon', 'knockout-wordmark']));
  // the on lockups place 2 + 2 + 1 + 1 parts: in 3 versions, once in the clearspace row, at 4 small sizes
  const once = 6;
  assert.equal(uses.length, once * 3 + once + once * 4);
  assert.doesNotMatch(svg, /filter|<image/);
});

test('the white version sits on a dark tile and the knockout on its colour; the rest on light paper', () => {
  const d = doc();
  const svg = brandSheetSvg({ ...d, lockups: [lockup('icon')] });
  const fills = els(svg).filter((e) => e.name === 'rect' && getAttr(e, 'width') === '240').map((e) => getAttr(e, 'fill'));
  // lockup tiles in version order, then the clearspace tile
  assert.deepEqual(fills, ['#f0f0f0', '#f0f0f0', '#1c1c1c', '#f0f0f0', toHex(d.colour), '#f0f0f0']);
  // a logo drawn in white on its own goes on the dark tile in its original version too
  const white = doc({ versions: ['original'], wordmark: null });
  const whiteIcon = { ...white.icon!, svg: white.icon!.svg!.replace(/#e4572e|#29335c/g, '#fafafa') };
  const onDark = brandSheetSvg({ ...white, icon: whiteIcon, lockups: [lockup('icon')] });
  assert.ok(els(onDark).some((e) => e.name === 'rect' && getAttr(e, 'width') === '240' && getAttr(e, 'fill') === '#1c1c1c'));
});

test('one white detail in a dark logo leaves the original on light paper; a drawn verdict decides when given', () => {
  const d = doc({ versions: ['original'] });
  const dotted = { ...d.icon!, svg: d.icon!.svg!.replace('</svg>', '<circle cx="40" cy="40" r="3" fill="#ffffff"/></svg>') };
  const tiles = (svg: string) => els(svg).filter((e) => e.name === 'rect' && getAttr(e, 'width') === '240').map((e) => getAttr(e, 'fill'));
  assert.deepEqual([...new Set(tiles(brandSheetSvg({ ...d, icon: dotted, lockups: [lockup('horizontal')] })))], ['#f0f0f0']);
  // the tool draws the logo and weighs its colours by how much each covers (raster.ts groundOf)
  assert.deepEqual([...new Set(tiles(brandSheetSvg({ ...d, lockups: [lockup('horizontal')] }, { ground: 'dark' })))], ['#1c1c1c']);
});

test('clearspace diagrams, the small sizes at real pixels, the parts and the colour values', () => {
  const d = doc({ versions: ['original', 'colour'] });
  const svg = brandSheetSvg({ ...d, lockups: [lockup('horizontal', { align: 'cap' })] });
  const t = texts(svg);
  assert.ok(t.includes('CLEARSPACE · 0.5× ICON HEIGHT'));
  assert.ok(els(svg).some((e) => e.name === 'rect' && getAttr(e, 'stroke-dasharray')), 'a dashed clearspace box');
  for (const px of [16, 24, 32, 48]) assert.ok(t.includes(`${px} PX`));
  // the small sizes really are that tall: each icon placement's scale × artwork height (80)
  const scales = els(svg).filter((e) => e.name === 'use' && /-original-icon$/.test(getAttr(e, 'xlink:href')!)).map((e) => +/scale\(([-\d.e]+)\)/.exec(getAttr(e, 'transform')!)![1] * 80);
  for (const px of [16, 24, 32, 48]) assert.ok(scales.some((h) => Math.abs(h - px) < 1e-3), `an icon ${px} px tall`);
  assert.ok(t.includes('ICON') && t.includes('icon') && t.includes('WORDMARK') && t.includes('wordmark'));
  assert.ok(t.some((s) => s.startsWith(toHex(d.colour).toUpperCase()) && s.includes('OKLCH') && s.includes('≈CMYK')));
  assert.ok(t.includes('#E4572E') && t.includes('#29335C'), 'the original colours');
});

test('a raster part shows as a picture and says so; nothing on at all is an error', () => {
  const svg = brandSheetSvg(doc({ icon: pngPart() }));
  assert.ok(texts(svg).includes('PNG'));
  assert.match(svg, /<image/);
  assert.throws(() => brandSheetSvg({ ...doc(), lockups: [lockup('icon', { on: false })] }), /Add an icon or a wordmark/);
  // a very wide wordmark widens the page so its small sizes fit
  const wide = doc();
  wide.wordmark = { ...wide.wordmark!, box: { ...wide.wordmark!.box, w: 2000 } };
  const root = parseSvg(brandSheetSvg({ ...wide, lockups: [lockup('wordmark')] }));
  assert.ok(parseFloat(getAttr(root, 'width')!) > 2000);
});

test('the sheet names its ids by what the parts draw, not their root tags, so a reopened logo writes the same sheet', () => {
  const d = doc({ versions: ['original'] });
  const reframed = { ...d, icon: { ...d.icon!, svg: d.icon!.svg!.replace('<svg ', '<svg width="80" height="80" ') } };
  const id = (x: LogoDoc) => /id="(sheet-[^-"]+)/.exec(brandSheetSvg(x))![1];
  assert.equal(id(d), id(reframed));
  // a long part name keeps to its column
  const named = brandSheetSvg({ ...d, wordmark: { ...d.wordmark!, name: 'x'.repeat(60) } });
  assert.ok(texts(named).some((t) => t.length < 40 && t.endsWith('…')));
});
