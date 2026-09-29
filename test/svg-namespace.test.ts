import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { namespace, parseSize } from '../src/shared/svg/index.ts';
import { mapRules, splitList } from '../src/shared/svg/css.ts';
import { getAttr, parseSvg, textOf, walk, type El } from '../src/shared/svg/xml.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
// two Illustrator "Export As" files: both are id="Layer_1", both have .cls-1 { fill: url(#linear-gradient) }
const A = fixture('svg-illustrator-a.svg');
const B = fixture('svg-illustrator-b.svg');
// an old "Save As SVG" file: namespaces in DOCTYPE entities, CDATA styles, .st0
const LEGACY = fixture('svg-illustrator-legacy.svg');

/** the SVGs side by side in one document, as a pattern tile holds its shapes */
const together = (...svgs: string[]) =>
  parseSvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${svgs.map((s) => `<g>${s}</g>`).join('')}</svg>`);

/**
 * What a renderer would paint an element with, for the class-only selectors Illustrator writes: the
 * last rule naming one of its classes wins, a url(#…) is followed to the gradient's stops (through
 * its href when it has none of its own).
 */
function paintOf(doc: El, el: El, prop: string): string | string[] {
  const rules: { sel: string[]; body: string }[] = [];
  for (const { el: s } of walk(doc)) if (s.name === 'style') mapRules(textOf(s), (sel, body) => (rules.push({ sel: splitList(sel).map((x) => x.trim()), body }), ''));
  const classes = (getAttr(el, 'class') ?? '').split(/\s+/).map((c) => `.${c}`);
  let value = getAttr(el, prop);
  for (const r of rules) {
    const m = new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`).exec(r.body);
    if (m && r.sel.some((s) => classes.includes(s))) value = m[1].trim();
  }
  const ref = value && /^url\(#([^)]+)\)$/.exec(value);
  return ref ? stopsOf(doc, ref[1]) : (value ?? '(unset)');
}

function byId(doc: El, id: string): El {
  const found = [...walk(doc)].filter(({ el }) => getAttr(el, 'id') === id);
  assert.equal(found.length, 1, `exactly one #${id}`);
  return found[0].el;
}

function stopsOf(doc: El, id: string): string[] {
  const g = byId(doc, id);
  const stops = g.children.filter((c): c is El => 'name' in c && c.name === 'stop').map((s) => getAttr(s, 'stop-color')!);
  const href = getAttr(g, 'xlink:href') ?? getAttr(g, 'href');
  if (stops.length) return stops;
  return href ? stopsOf(doc, href.slice(1)) : [`<${g.name}>`];
}

const find = (doc: El, name: string, cls: string) => [...walk(doc)].filter(({ el }) => el.name === name && getAttr(el, 'class')?.split(' ').includes(cls)).map(({ el }) => el);

test('without namespacing, two Illustrator exports collide (the v1 bug this fixes)', () => {
  const doc = together(A, B);
  const ids = [...walk(doc)].map(({ el }) => getAttr(el, 'id')).filter(Boolean);
  assert.equal(ids.filter((id) => id === 'linear-gradient').length, 2);
  // which #linear-gradient A's circle gets is up to the renderer
  assert.throws(() => paintOf(doc, find(doc, 'circle', 'cls-1')[0], 'fill'), /exactly one/);
  // B's yellow .cls-2 reaches A's clip group
  assert.equal(paintOf(doc, find(doc, 'g', 'cls-2')[0], 'fill'), '#ffde00');
});

test('namespace keeps two Illustrator exports with the same ids and .cls-1 styles apart', () => {
  const doc = together(namespace(A, 'a'), namespace(B, 'b'), namespace(LEGACY, 'c'));

  const ids = [...walk(doc)].map(({ el }) => getAttr(el, 'id')).filter((x): x is string => !!x);
  assert.equal(new Set(ids).size, ids.length, 'every id is unique');
  assert.ok(ids.includes('a-Layer_1') && ids.includes('b-Layer_1') && ids.includes('a-linear-gradient') && ids.includes('b-linear-gradient'));

  // A: the gradient circle, the rect whose gradient borrows A's stops through xlink:href, the stroke-only path
  const [aCircle] = find(doc, 'circle', 'a-cls-1');
  assert.deepEqual(paintOf(doc, aCircle, 'fill'), ['#e6007e', '#312783']);
  assert.deepEqual(paintOf(doc, find(doc, 'rect', 'a-cls-4')[0], 'fill'), ['#e6007e', '#312783']);
  assert.equal(paintOf(doc, find(doc, 'path', 'a-cls-3')[0], 'fill'), 'none');
  assert.equal(paintOf(doc, find(doc, 'path', 'a-cls-3')[0], 'stroke'), '#1d1d1b');
  assert.deepEqual(paintOf(doc, find(doc, 'g', 'a-cls-2')[0], 'clip-path'), ['<clipPath>']);
  assert.equal(getAttr(byId(doc, 'a-clippath'), 'id'), 'a-clippath');

  // B: its own gradient and its own .cls-2
  assert.deepEqual(paintOf(doc, find(doc, 'rect', 'b-cls-1')[0], 'fill'), ['#00a19a', '#95c11f']);
  assert.equal(paintOf(doc, find(doc, 'circle', 'b-cls-2')[0], 'fill'), '#ffde00');
  assert.equal(find(doc, 'circle', 'a-cls-2').length, 0);

  // legacy: CDATA styles scoped
  assert.equal(paintOf(doc, find(doc, 'circle', 'c-st0')[0], 'fill'), '#E30613');
  assert.equal(paintOf(doc, find(doc, 'rect', 'c-st1')[0], 'stroke'), '#1D1D1B');

  // every reference in each file points at its own ids
  for (const { el } of walk(doc)) {
    for (const a of el.attrs) {
      const refs = [...a.value.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
      if (/href$/.test(a.name) && a.value.startsWith('#')) refs.push(a.value.slice(1));
      for (const r of refs) byId(doc, r);
    }
  }
});

test('the output stands on its own: no prolog or DOCTYPE, entities written out, namespaces kept', () => {
  const out = namespace(LEGACY, 'c');
  assert.ok(out.startsWith('<svg '));
  assert.ok(!out.includes('&ns_'), 'DOCTYPE entities are expanded, so nothing is left undefined');
  const root = parseSvg(out);
  assert.equal(getAttr(root, 'xmlns:i'), 'http://ns.adobe.com/AdobeIllustrator/10.0/');
  assert.equal(getAttr(root, 'class'), 'c');
  assert.match(out, /<!\[CDATA\[[\s\S]*\.c-st0\s*\{fill:#E30613;\}/);
  assert.deepEqual(parseSize(out), parseSize(LEGACY));
});

test('a snippet pasted from a web page gets its namespaces', () => {
  const out = namespace('<svg viewBox="0 0 24 24"><use xlink:href="#a"/><path id="a" d="M0 0h24v24z"/></svg>', 'p');
  const root = parseSvg(out);
  assert.equal(getAttr(root, 'xmlns'), 'http://www.w3.org/2000/svg');
  assert.equal(getAttr(root, 'xmlns:xlink'), 'http://www.w3.org/1999/xlink');
  assert.match(out, /<use xlink:href="#p-a"\/><path id="p-a"/);
});

test('style rules that name no class or id are scoped under the root', () => {
  const css = (rules: string) => {
    const out = namespace(`<svg xmlns="http://www.w3.org/2000/svg"><style>${rules}</style></svg>`, 'p');
    return textOf([...walk(parseSvg(out))].find(({ el }) => el.name === 'style')!.el).replace(/\s+/g, ' ').trim();
  };
  assert.equal(css('path{fill:red}'), '.p path {fill:red}');
  assert.equal(css('svg{fill:red} svg > g{stroke:blue}'), '.p {fill:red} .p > g {stroke:blue}');
  assert.equal(css(':root .a, #b rect, path:not(.c){fill:red}'), ':root .p-a, #p-b rect, .p path:not(.p-c) {fill:red}');
  assert.equal(css('[href="#x"].a{fill:url(#g)}'), '[href="#x"].p-a {fill:url(#p-g)}');
  assert.equal(css('@import url(x.css); @media (min-width: 1px) { .a { fill: red } } @font-face { font-family: X }'), '@media (min-width: 1px) { .p-a { fill: red } } @font-face { font-family: X }');
  assert.equal(css('.a{content:"}"} /* .b{} */ .c{fill:red}'), '.p-a {content:"}"} .p-c {fill:red}');
});

test("Illustrator's editing data goes: its foreignObject would taint every canvas the SVG is drawn on", () => {
  const out = namespace(LEGACY, 'c');
  assert.doesNotMatch(out, /foreignObject|i:pgf|eJzLSM3J/);
  const sw = [...walk(parseSvg(out))].find(({ el }) => el.name === 'switch')!.el;
  assert.deepEqual(sw.children.filter((c) => 'name' in c).map((c) => (c as El).name), ['g']);
});

test('scripts, event handlers and javascript: links go', () => {
  const out = namespace(
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)"><rect onclick="x()" width="1" height="1"/></a><a href="https://example.com"/></svg>',
    'p',
  );
  assert.doesNotMatch(out, /alert|onclick|onload|<script/);
  assert.match(out, /href="https:\/\/example.com"/);
});

test('unreadable markup and bad prefixes fail with a sentence', () => {
  assert.throws(() => namespace('<svg><g></svg>', 'p'), /couldn't be read/);
  assert.throws(() => namespace('<svg width=10/>', 'p'), /couldn't be read/);
  assert.throws(() => namespace('<html/>', 'p'), /isn't an SVG/);
  assert.throws(() => namespace('<svg/><svg/>', 'p'), /couldn't be read/);
  assert.throws(() => namespace('<svg/>', '1a'), /can't start an SVG id/);
});
