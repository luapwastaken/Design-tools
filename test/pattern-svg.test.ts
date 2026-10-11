import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex, type Oklch } from '../src/shared/color/index.ts';
import { BUILTIN_SHAPES } from '../src/shared/pattern/builtins.ts';
import { layoutTile, reachOf } from '../src/shared/pattern/layout.ts';
import { artboardProblem, artboardSvg, previewSvg, PX_PER, stacked, tileSvg } from '../src/shared/pattern/svg.ts';
import type { Item, PatternDoc, ShapeSlot, Tile } from '../src/shared/pattern/types.ts';
import { wrapItems } from '../src/shared/pattern/wrap.ts';
import { clipToView, namespace, parseSize } from '../src/shared/svg/index.ts';
import { getAttr, isEl, parseSvg, serialize, walk, type El } from '../src/shared/svg/xml.ts';

const RED: Oklch = [0.6, 0.2, 25];
const GREEN: Oklch = [0.7, 0.15, 145];
const BLUE: Oklch = [0.5, 0.15, 260];

/** a slot as the tool makes one: the markup namespaced under its id, bounds from the viewBox */
const slotOf = (id: string, svg: string, more: Partial<ShapeSlot> = {}): ShapeSlot => {
  const [x, y, w, h] = parseSize(svg).viewBox;
  return { id, svg: namespace(svg, id), name: id, weight: 1, recolour: false, colour: null, bounds: { x, y, w, h }, ...more };
};
const square = (id = 's0', more: Partial<ShapeSlot> = {}) =>
  slotOf(id, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ff8800"/></svg>', more);
// an Illustrator export: class rules in a <style>
const styled = (id: string, more: Partial<ShapeSlot> = {}) =>
  slotOf(id, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><defs><style>.cls-1{fill:#123456;}</style></defs><circle class="cls-1" cx="25" cy="25" r="25"/></svg>', more);

const doc = (over: Partial<PatternDoc> = {}): PatternDoc => ({
  slots: [square()],
  arrangement: 'grid',
  cols: 1,
  rows: 2,
  gapX: 12,
  gapY: 12,
  sizeMin: 84,
  sizeMax: 84,
  rotation: { mode: 'fixed', angle: 0, min: 0, max: 0 },
  jitter: 0,
  seed: 5,
  background: null,
  palette: [],
  paletteMode: 'by-slot',
  exportUnit: 'px',
  dpi: 96,
  artboard: { w: 100, h: 100 },
  ...over,
});

const kids = (el: El) => el.children.filter(isEl);
const all = (root: El, name: string) => [...walk(root)].map((w) => w.el).filter((e) => e.name === name);
const place = (u: El) => {
  const m = /translate\(([-\d.e]+) ([-\d.e]+)\)(?: rotate\(([-\d.e]+)\))? scale\(([-\d.e]+)\)/.exec(getAttr(u, 'transform') ?? '')!;
  return { x: +m[1], y: +m[2], rotation: +(m[3] ?? 0), scale: +m[4] };
};
const itemUses = (root: El) => all(root, 'use').filter((u) => getAttr(u, 'xlink:href') !== '#dtp-tile');

test('sizes are written in real units: 1in = 96 px, 1 mm = 96 / 25.4 px, whatever the DPI', () => {
  assert.equal(PX_PER.in, 96);
  assert.equal(PX_PER.mm, 96 / 25.4);
  const t = layoutTile(doc()); // 84 + 12 by 2 × (84 + 12)
  assert.deepEqual([t.width, t.height], [96, 192]);
  for (const [unit, w, h] of [['px', '96px', '192px'], ['in', '1in', '2in'], ['mm', '25.4mm', '50.8mm']] as const) {
    for (const dpi of [72, 300]) {
      const root = parseSvg(tileSvg(doc({ dpi }), t, unit));
      assert.deepEqual([getAttr(root, 'width'), getAttr(root, 'height'), getAttr(root, 'viewBox')], [w, h, '0 0 96 192'], `${unit} at ${dpi} dpi`);
      assert.deepEqual(parseSize(tileSvg(doc({ dpi }), t, unit)).width, 96);
    }
  }
});

test('the Illustrator swatch: backmost unfilled, unstroked tile rectangle, then the background, then the items clipped to the tile', () => {
  const d = doc({ cols: 3, rows: 3, background: GREEN });
  const t = layoutTile(d);
  const root = parseSvg(tileSvg(d, t, 'mm'));
  const [defs, bounds, bg, items] = kids(root);
  assert.equal(defs.name, 'defs');
  assert.deepEqual(bounds.attrs, [{ name: 'width', value: '288' }, { name: 'height', value: '288' }, { name: 'fill', value: 'none' }, { name: 'stroke', value: 'none' }]);
  assert.equal(getAttr(bg, 'fill'), toHex(GREEN));
  assert.equal(getAttr(items, 'clip-path'), 'url(#dtp-clip)');
  const clip = all(root, 'clipPath').find((c) => getAttr(c, 'id') === 'dtp-clip')!;
  assert.deepEqual([getAttr(kids(clip)[0], 'width'), getAttr(kids(clip)[0], 'height')], ['288', '288']);
});

test('the swatch holds every item and every copy over an edge, each placed, turned and sized as laid out', () => {
  for (const arrangement of ['grid', 'halfdrop', 'brick', 'scatter'] as const) {
    const d = doc({
      arrangement,
      cols: 3,
      rows: 3,
      gapX: -20,
      gapY: -20,
      slots: [square('a'), styled('b', { recolour: true })],
      sizeMin: 30,
      sizeMax: 80,
      rotation: { mode: 'random', angle: 0, min: -45, max: 45 },
      jitter: 10,
      palette: [RED, GREEN],
      paletteMode: 'random',
    });
    const t = layoutTile(d);
    const want = stacked(wrapItems(t.items, t.width, t.height, reachOf(d.slots)));
    const uses = itemUses(parseSvg(tileSvg(d, t, 'px')));
    assert.equal(uses.length, want.length, arrangement);
    assert.ok(want.length > t.items.length, `${arrangement}: nothing crossed an edge`);
    uses.forEach((u, i) => {
      const p = place(u);
      const it = want[i];
      assert.ok(Math.abs(p.x - it.x) < 1e-3 && Math.abs(p.y - it.y) < 1e-3 && Math.abs(p.rotation - it.rotation) < 1e-3, arrangement);
      const b = d.slots.find((s) => s.id === it.slot)!.bounds;
      assert.ok(Math.abs(p.scale * Math.max(b.w, b.h) - it.size) < 1e-3);
      // the symbol's box is the artwork's bounds, centred on the item
      assert.deepEqual([+getAttr(u, 'x')!, +getAttr(u, 'y')!, +getAttr(u, 'width')!, +getAttr(u, 'height')!], [-b.w / 2, -b.h / 2, b.w, b.h]);
    });
  }
});

test('a symbol per slot and colour: own colours kept, palette colours flattened, style rules kept apart', () => {
  const d = doc({ cols: 8, rows: 8, slots: [square('a'), styled('b', { recolour: true })], palette: [RED, GREEN, BLUE], paletteMode: 'random' });
  const svg = tileSvg(d, layoutTile(d), 'px');
  const root = parseSvg(svg);
  const symbols = all(root, 'symbol');
  assert.equal(symbols.length, 4);
  const text = symbols.map(serialize);
  assert.equal(text.filter((s) => s.includes('#ff8800')).length, 1); // the square keeps its own colour
  assert.ok(text.every((s) => !s.includes('#123456'))); // the circle's own colour is gone from every copy
  const styles = all(root, 'style').map((s) => s.children.map((c) => ('text' in c ? c.text : 'cdata' in c ? c.cdata : '')).join(''));
  // each colour of the styled shape has its own rule under its own prefix, so none paints another
  for (const colour of [RED, GREEN, BLUE]) {
    const own = styles.filter((css) => css.includes(toHex(colour)));
    assert.equal(own.length, 1, toHex(colour));
    // the symbol's id is the slot's place and the colour, so it stays put between edits
    assert.match(own[0], new RegExp(`^\\s*\\.dtp-1-${toHex(colour).slice(1)}-b-cls-1\\s*\\{`));
  }
  assert.equal(new Set(styles.map((css) => /\.(dtp-1-[0-9a-f]{6})-/.exec(css)![1])).size, 3);
  // symbol ids are unique across the file
  const ids = [...walk(root)].map((w) => getAttr(w.el, 'id')).filter((id) => id !== null);
  assert.equal(new Set(ids).size, ids.length);
  // the recoloured symbols' roots pass the colour on (their class carries the scoped rules)
  const b = symbols.filter((s) => kids(s)[0]?.name === 'g' && getAttr(kids(s)[0], 'fill') !== null);
  assert.deepEqual(b.map((s) => getAttr(kids(s)[0], 'fill')).sort(), [RED, GREEN, BLUE].map(toHex).sort());
});

test('namespaces an Illustrator file declares (even through DOCTYPE entities) are declared on the output root', () => {
  const ai =
    '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x" [<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">]>' +
    '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:i="&ns_ai;" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px" width="40px" height="20px" viewBox="0 0 40 20">' +
    '<i:pgf id="adobe_illustrator_pgf">data</i:pgf><rect width="40" height="20" i:knockout="Off"/></svg>';
  const d = doc({ slots: [slotOf('a', ai)] });
  const root = parseSvg(tileSvg(d, layoutTile(d), 'px'));
  assert.equal(getAttr(root, 'xmlns:i'), 'http://ns.adobe.com/AdobeIllustrator/10.0/');
  assert.equal(root.attrs.filter((a) => a.name === 'xmlns:xlink').length, 1);
  // the slot root's own size never reaches its symbol
  const art = kids(all(root, 'symbol')[0]);
  assert.ok(art.every((e) => getAttr(e, 'width') !== '40px' && getAttr(e, 'viewBox') === null));
});

test('the artboard: its size in the chosen unit, every shape the repeat puts on it once and whole, clipped once at the edge', () => {
  const d = doc({ background: RED });
  const t = layoutTile(d); // 96 × 192 px
  const root = parseSvg(artboardSvg(d, t, 210, 297, 'mm'));
  const [aw, ah] = [793.701, 1122.52];
  assert.deepEqual([getAttr(root, 'width'), getAttr(root, 'height'), getAttr(root, 'viewBox')], ['210mm', '297mm', `0 0 ${aw} ${ah}`]);
  // one clip, at the artboard's edge: a clip per tile would leave a hairline along every seam
  assert.deepEqual(all(root, 'clipPath').map((c) => getAttr(c, 'id')), ['dtp-board']);
  // every repeat of every item that reaches the board, and nothing else
  const reach = reachOf(d.slots);
  const want = new Set<string>();
  for (const it of t.items) {
    const r = reach(it);
    for (let j = -3; j < 10; j++) {
      for (let i = -3; i < 12; i++) {
        const [x, y] = [it.x + i * 96, it.y + j * 192];
        if (x + r > 0 && x - r < aw && y + r > 0 && y - r < ah) want.add(`${x.toFixed(3)} ${y.toFixed(3)}`);
      }
    }
  }
  const got = itemUses(root).map((u) => `${place(u).x.toFixed(3)} ${place(u).y.toFixed(3)}`);
  assert.equal(got.length, want.size);
  assert.deepEqual(new Set(got), want);
  assert.ok(want.has(`${(t.items[0].x - 96).toFixed(3)} ${t.items[0].y.toFixed(3)}`), 'a repeat over the left edge');
  const [, bg, board] = kids(root);
  assert.deepEqual([getAttr(bg, 'width'), getAttr(bg, 'fill')], [String(aw), toHex(RED)]);
  assert.equal(getAttr(board, 'clip-path'), 'url(#dtp-board)');
  const inches = parseSvg(artboardSvg(d, t, 2, 1.5, 'in'));
  assert.deepEqual([getAttr(inches, 'width'), getAttr(inches, 'viewBox')], ['2in', '0 0 192 144']);
});

test('an artboard of absurdly many shapes says so, beforehand and instead of building a huge file', () => {
  const t: Tile = { width: 2, height: 2, items: [{ slot: 's0', x: 1, y: 1, size: 1, rotation: 0, colour: null }] };
  const why = /about 256,032,001 shapes/;
  assert.match(artboardProblem(t, 32000, 32000, 'px') ?? '', why);
  assert.throws(() => artboardSvg(doc(), t, 32000, 32000, 'px'), why);
  assert.equal(artboardProblem(layoutTile(doc()), 210, 297, 'mm'), null);
});

/** the centres of the placed shapes, in the order the file draws them */
const order = (svg: string) => itemUses(parseSvg(svg)).map((u) => place(u));

/**
 * For every two overlapping shapes, which one is on top must depend only on where they sit to each
 * other, never on where the pair is: otherwise the stacking flips at the seams and the grid shows.
 */
function stackingFlips(drawn: { x: number; y: number }[], r: number): number {
  const seen = new Map<string, boolean>();
  let flips = 0;
  for (let i = 0; i < drawn.length; i++) {
    for (let j = 0; j < drawn.length; j++) {
      const [dx, dy] = [+(drawn[j].x - drawn[i].x).toFixed(2), +(drawn[j].y - drawn[i].y).toFixed(2)];
      if (i === j || Math.hypot(dx, dy) >= 2 * r || dy < 0 || (dy === 0 && dx <= 0)) continue;
      const key = `${dx},${dy}`;
      if (seen.has(key) && seen.get(key) !== j > i) flips++;
      if (!seen.has(key)) seen.set(key, j > i);
    }
  }
  return flips;
}

test('overlapping shapes stack alike at the seams and inside the tile: in the swatch and the artboard, and the two agree', () => {
  const circle = slotOf('c', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>');
  for (const arrangement of ['grid', 'halfdrop', 'brick', 'scatter'] as const) {
    // fish scales: 60 px circles 20 px into each other, and a jittered, turned busy one
    for (const d of [
      doc({ arrangement, slots: [circle], cols: 3, rows: 3, gapX: -20, gapY: -20, sizeMin: 60, sizeMax: 60 }),
      doc({ arrangement, slots: [circle, square('q')], cols: 4, rows: 3, gapX: -30, gapY: -25, sizeMin: 40, sizeMax: 70, jitter: 12, rotation: { mode: 'random', angle: 0, min: -45, max: 45 } }),
    ]) {
      const t = layoutTile(d);
      const reach = Math.max(...t.items.map(reachOf(d.slots)));
      assert.equal(stackingFlips(order(tileSvg(d, t, 'px')), reach), 0, `${arrangement}: the swatch`);
      assert.equal(stackingFlips(order(artboardSvg(d, t, 3 * t.width, 3 * t.height, 'px')), reach), 0, `${arrangement}: the artboard`);
      // the swatch's shapes, seen through the artboard's second repeat, are drawn in the artboard's order
      const inTile = (p: { x: number; y: number }) => p.x > t.width && p.x < 2 * t.width && p.y > t.height && p.y < 2 * t.height;
      const board = order(artboardSvg(d, t, 3 * t.width, 3 * t.height, 'px')).filter(inTile);
      const swatch = order(tileSvg(d, t, 'px')).filter((p) => p.x > 0 && p.x < t.width && p.y > 0 && p.y < t.height);
      assert.equal(board.length, swatch.length, arrangement);
      assert.ok(board.every((p, k) => Math.abs(p.x - t.width - swatch[k].x) < 0.01 && Math.abs(p.y - t.height - swatch[k].y) < 0.01), arrangement);
    }
  }
  // the order itself: top row first, then left to right, whatever the float noise of a tile's width
  const at = (x: number, y: number): Item => ({ slot: 'a', x, y, size: 1, rotation: 0, colour: null });
  assert.deepEqual(stacked([at(5, 1), at(1, 2), at(1, 1 + 1e-12), at(0, 1)]).map((it) => [it.x, Math.round(it.y)]), [[0, 1], [1, 1], [5, 1], [1, 2]]);
});

test('a shape clipped to its viewBox keeps the clip inside its symbol, so what lay past it stays hidden', () => {
  const half = clipToView(namespace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="100" r="50"/></svg>', 'h'), 'h_view');
  const clip = all(parseSvg(half), 'clipPath')[0];
  assert.equal(getAttr(clip, 'id'), 'h_view');
  assert.deepEqual(kids(clip)[0].attrs.map((a) => a.value), ['0', '0', '100', '100']);
  const d = doc({ slots: [slotOf('h', half, { bounds: { x: 0, y: 50, w: 100, h: 50 } })] });
  const symbol = all(parseSvg(tileSvg(d, layoutTile(d), 'px')), 'symbol')[0];
  const g = all(symbol, 'g').find((e) => getAttr(e, 'clip-path'));
  assert.equal(getAttr(g!, 'clip-path'), `url(#${getAttr(all(symbol, 'clipPath')[0], 'id')})`);
  assert.ok(all(g!, 'circle').length === 1);
});

test('previewSvg: one tile in pixels with its size', () => {
  const d = doc({ cols: 2, rows: 3 });
  const t = layoutTile(d);
  const p = previewSvg(d, t);
  assert.deepEqual([p.tileWidth, p.tileHeight], [t.width, t.height]);
  assert.equal(p.svg, tileSvg(d, t, 'px'));
});

test('built-in shapes: the eight from the plan, each well-formed with its viewBox tight to the artwork', () => {
  assert.deepEqual(BUILTIN_SHAPES.map((b) => b.name), ['Circle', 'Square', 'Star 5', 'Sparkle 4', 'Cross', 'Diamond', 'Blob', 'Chevron']);
  assert.equal(new Set(BUILTIN_SHAPES.map((b) => b.id)).size, 8);
  for (const b of BUILTIN_SHAPES) assert.ok(parseSize(b.svg).viewBox[2] > 0, b.name);
  // the star's box is its points' bounds
  const star = BUILTIN_SHAPES.find((b) => b.id === 'star-5')!;
  const pts = getAttr(kids(parseSvg(star.svg))[0], 'points')!.split(' ').map(Number);
  const xs = pts.filter((_, i) => i % 2 === 0);
  const ys = pts.filter((_, i) => i % 2 === 1);
  const [x, y, w, h] = parseSize(star.svg).viewBox;
  assert.deepEqual([x, y], [Math.min(...xs), Math.min(...ys)]);
  assert.ok(Math.abs(x + w - Math.max(...xs)) < 1e-3 && Math.abs(y + h - Math.max(...ys)) < 1e-3);
  // all of them in one swatch
  const d = doc({ cols: 4, rows: 2, slots: BUILTIN_SHAPES.map((b) => slotOf(b.id, b.svg, { recolour: true })), palette: [BLUE] });
  assert.equal(all(parseSvg(tileSvg(d, layoutTile(d), 'px')), 'symbol').length, new Set(layoutTile(d).items.map((it) => it.slot)).size);
});

test('expanded, every item is a plain group in the same place and nothing is a symbol or a <use>', () => {
  const offset = slotOf('o', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 30 60 40"><defs><style>.cls-1{fill:#123456;}</style></defs><rect class="cls-1" x="20" y="30" width="60" height="40"/></svg>', { recolour: true });
  const d = doc({ cols: 3, rows: 2, slots: [square('a'), offset], palette: [RED, GREEN], paletteMode: 'random', rotation: { mode: 'random', angle: 0, min: -30, max: 30 } });
  const t = layoutTile(d);
  for (const [name, svg] of [['swatch', (e: boolean) => tileSvg(d, t, 'px', e)], ['artboard', (e: boolean) => artboardSvg(d, t, 200, 150, 'px', e)]] as const) {
    const linked = parseSvg(svg(false));
    const flat = parseSvg(svg(true));
    assert.equal(all(flat, 'symbol').length + all(flat, 'use').length, 0, name);
    const groups = all(flat, 'g').filter((g) => /^translate\(/.test(getAttr(g, 'transform') ?? ''));
    const uses = itemUses(linked);
    assert.equal(groups.length, uses.length, name);
    groups.forEach((g, i) => {
      // the <use> shifts its symbol's viewBox corner to -w/2 -h/2; the group does the same in its transform
      const [x, y, rot, scale] = Object.values(place(uses[i]));
      const m = /^translate\(([-\d.e]+) ([-\d.e]+)\)(?: rotate\(([-\d.e]+)\))? scale\(([-\d.e]+)\) translate\(([-\d.e]+) ([-\d.e]+)\)$/.exec(getAttr(g, 'transform')!);
      assert.ok(m, getAttr(g, 'transform')!);
      assert.deepEqual([+m[1], +m[2], +(m[3] ?? 0), +m[4]], [x, y, rot, scale]);
      const slot = d.slots.find((s) => getAttr(uses[i], 'xlink:href')!.startsWith(`#dtp-${d.slots.indexOf(s)}`))!;
      assert.ok(Math.abs(+m[5] - (-slot.bounds.w / 2 - slot.bounds.x)) < 1e-3 && Math.abs(+m[6] - (-slot.bounds.h / 2 - slot.bounds.y)) < 1e-3, `${name}: the viewBox corner`);
    });
    // the rules and clips stay once per colour in <defs>, not once per place
    const styles = all(flat, 'style').length;
    assert.ok(styles > 0 && styles < groups.length, `${name}: ${styles} style blocks for ${groups.length} places`);
    const ids = [...walk(flat)].map((w) => getAttr(w.el, 'id')).filter((v) => v !== null);
    assert.equal(new Set(ids).size, ids.length, `${name}: ids are unique`);
  }
});
