import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { namespace, recolour, svgColours } from '../src/shared/svg/index.ts';
import { toHex } from '../src/shared/color/index.ts';
import { getAttr, parseSvg, textOf, walk } from '../src/shared/svg/xml.ts';

const INK = '#123456';
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const els = (svg: string, name: string) => [...walk(parseSvg(svg))].filter(({ el }) => el.name === name).map(({ el }) => el);
const styleOf = (svg: string) => els(svg, 'style').map(textOf).join('').replace(/\s+/g, ' ').trim();

test('an outline icon stays an outline: fill="none" is kept, the stroke takes the colour', () => {
  // the shape of a Feather or Lucide icon: fill none on the root, stroke from currentColor
  const icon = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3 7h7l-5.5 4 2 7-6.5-4-6.5 4 2-7L2 9h7z"/><circle cx="12" cy="12" r="2" fill="none"/></svg>';
  const out = parseSvg(recolour(icon, INK));
  assert.equal(getAttr(out, 'fill'), 'none');
  assert.equal(getAttr(out, 'stroke'), INK);
  assert.equal(getAttr(els(recolour(icon, INK), 'circle')[0], 'fill'), 'none');
});

test('every painted fill and stroke becomes the one colour, in attributes, style and <style>', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:#f00;stroke-width:2px}.b{stroke: url(#g) !important;fill:none}</style>' +
    '<rect fill="red" stroke="blue" fill-opacity="0.5"/><path style="fill: rgb(0 128 0); stroke:none; fill-rule: evenodd"/><circle class="a"/><ellipse class="b"/></svg>';
  const out = recolour(svg, INK);
  const [rect] = els(out, 'rect');
  assert.equal(getAttr(rect, 'fill'), INK);
  assert.equal(getAttr(rect, 'stroke'), INK);
  assert.equal(getAttr(rect, 'fill-opacity'), '0.5');
  assert.equal(getAttr(els(out, 'path')[0], 'style'), `fill: ${INK}; stroke:none; fill-rule: evenodd`);
  assert.equal(styleOf(out), `.a {fill:${INK};stroke-width:2px}.b {stroke: ${INK} !important;fill:none}`);
  assert.deepEqual([...new Set(svgColours(out).map(toHex))], [INK]);
});

test('shapes that name no paint draw black by default, so the root passes the colour down', () => {
  const out = recolour('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>', INK);
  assert.equal(getAttr(parseSvg(out), 'fill'), INK);
});

test('gradients flatten, and Illustrator exports keep their outline strokes as outlines', () => {
  const out = recolour(namespace(fixture('svg-illustrator-a.svg'), 'a'), INK);
  const css = styleOf(out);
  assert.match(css, new RegExp(`\\.a-cls-1 \\{ fill: ${INK}; \\}`));
  assert.match(css, new RegExp(`\\.a-cls-3 \\{ fill: none; stroke: ${INK};`));
  assert.match(css, /\.a-cls-2 \{ clip-path: url\(#a-clippath\); \}/);
  const legacy = styleOf(recolour(fixture('svg-illustrator-legacy.svg'), INK));
  assert.equal(legacy, `.st0 {fill:${INK};} .st1 {fill:none;stroke:${INK};stroke-width:2;stroke-miterlimit:10;}`);
});

test('masks keep their own paint: a mask colour is how much shows, not what shows', () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><style>.cls-1{fill:#fff;}.cls-2{fill:#e6007e;}.cls-3{mask:url(#mask);}.cls-2, .cls-4{stroke:#000}</style>' +
    '<mask id="mask"><rect class="cls-1" width="50" height="100"/><rect class="cls-4" fill="#888" width="10" height="10"/><circle r="5"/></mask></defs>' +
    '<g class="cls-3"><rect class="cls-2" width="100" height="100"/></g></svg>';
  const out = recolour(svg, INK);
  assert.equal(styleOf(out), `.cls-1 {fill:#fff;}.cls-2 {fill:${INK};}.cls-3 {mask:url(#mask);}.cls-2 {stroke:${INK}} .cls-4 {stroke:#000}`);
  const [mask] = els(out, 'mask');
  assert.equal(getAttr(els(out, 'rect')[1], 'fill'), '#888');
  // the root now passes the colour down, so the mask pins the black its unpainted circle had
  assert.equal(getAttr(mask, 'fill'), 'black');
  assert.equal(getAttr(parseSvg(out), 'fill'), INK);
});

test('currentColor lets each <use> set its own colour', () => {
  const out = recolour('<svg xmlns="http://www.w3.org/2000/svg"><path fill="#f00" d="M0 0h1v1z"/></svg>', 'currentColor');
  assert.equal(getAttr(els(out, 'path')[0], 'fill'), 'currentColor');
});
