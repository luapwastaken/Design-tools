import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex, type Oklch } from '../src/shared/color/index.ts';
import { cells, dots } from '../src/shared/halftone/screen.ts';
import { halftoneSvg, svgParts, svgProblem, type SvgDoc } from '../src/shared/halftone/svg.ts';
import { type Cells, type CellShape, type DrawInk } from '../src/shared/halftone/types.ts';
import { getAttr, isEl, parseSvg, walk, type El } from '../src/shared/svg/xml.ts';

const IDENTITY: [number, number][] = [[0, 0], [1, 1]];
type Ink = DrawInk & { angle: number };
type Doc = Omit<SvgDoc, 'inks'> & { inks: Ink[] };
const ink = (name: string, colour: Oklch, angle: number, visible = true): Ink => ({ name, colour, angle, visible, curve: IDENTITY });
const INKS = [ink('Cyan', [0.708, 0.1489, 234.36], 15), ink('Magenta', [0.6157, 0.2527, 355.14], 75), ink('Yellow', [0.9412, 0.2004, 105.69], 0), ink('Black', [0.2442, 0.0064, 0.59], 45)];
const BONE: Oklch = [0.9354, 0.0173, 84.59];

const docOf = (over: Partial<Doc> = {}): Doc => ({
  size: { w: 40, h: 30, unit: 'mm', dpi: 300 },
  screen: { shape: 'round', lpi: 30, minDot: 0, gain: 0 },
  inks: INKS,
  overlap: 'overprint',
  paper: { colour: BONE, include: true },
  ...over,
});

/** a soft blob, so some cells print nothing, some are solid and most sit between */
function plate(w: number, h: number, seed: number): Float32Array {
  return Float32Array.from({ length: w * h }, (_, i) => {
    const [x, y] = [(i % w) / w - 0.5, Math.floor(i / w) / h - 0.5];
    return Math.min(1, Math.max(0, 1.3 - 3 * Math.hypot(x + seed * 0.05, y)));
  });
}
const screensOf = (doc: Doc) => doc.inks.map((i, n) => cells(plate(80, 60, n), doc.size, doc.screen.lpi, i.angle, 80, 60));

const inkGroups = (root: El) => [...walk(root)].map((x) => x.el).filter((el) => el.name === 'g');
/** every subpath's start, with relative moves summed, in the file's own units */
function starts(d: string): [number, number][] {
  const out: [number, number][] = [];
  let [x, y] = [0, 0];
  for (const m of d.matchAll(/([Mm])(-?[\d.]+) ?(-?[\d.]+)/g)) {
    [x, y] = m[1] === 'M' ? [+m[2], +m[3]] : [x + +m[2], y + +m[3]];
    out.push([x, y]);
  }
  return out;
}

test('one group and one path per visible ink, named and coloured as the ink, nothing for a hidden one', () => {
  const doc = docOf({ inks: INKS.map((i) => ({ ...i, visible: i.name !== 'Magenta' })) });
  const root = parseSvg(halftoneSvg(doc, screensOf(doc)));
  const groups = inkGroups(root);
  assert.deepEqual(groups.map((g) => getAttr(g, 'id')), ['Cyan', 'Yellow', 'Black']);
  for (const g of groups) {
    const paths = g.children.filter(isEl);
    assert.equal(paths.length, 1);
    assert.equal(paths[0].name, 'path');
    assert.equal(getAttr(paths[0], 'fill'), toHex(INKS.find((i) => i.name === getAttr(g, 'id'))!.colour));
  }
  assert.equal([...walk(root)].filter((x) => x.el.name === 'path').length, 3);
});

test('a hidden ink needs no screen', () => {
  const doc = docOf({ inks: [INKS[0], { ...INKS[1], visible: false }] });
  assert.doesNotThrow(() => halftoneSvg(doc, [screensOf(doc)[0], null]));
  assert.throws(() => halftoneSvg(docOf({ inks: [INKS[0]] }), [null]), /Cyan/);
});

test('real units: width and height in the chosen unit, the view box at 96 px to the inch', () => {
  const mm = parseSvg(halftoneSvg(docOf(), screensOf(docOf())));
  assert.equal(getAttr(mm, 'width'), '40mm');
  assert.equal(getAttr(mm, 'height'), '30mm');
  assert.deepEqual(getAttr(mm, 'viewBox')!.split(' ').map(Number), [0, 0, 151.18, 113.39]);
  const inch = docOf({ size: { w: 25.4, h: 50.8, unit: 'in', dpi: 600 } });
  const root = parseSvg(halftoneSvg(inch, screensOf(inch)));
  assert.equal(getAttr(root, 'width'), '1in');
  assert.equal(getAttr(root, 'height'), '2in');
});

test('the file holds the dots the preview draws: the same count, each at its cell', () => {
  for (const shape of ['round', 'ellipse', 'square', 'line', 'diamond', 'cross'] as CellShape[]) {
    const doc = docOf({ screen: { shape, lpi: 30, minDot: 0.03, gain: 0.1 } });
    const screens = screensOf(doc);
    const svg = halftoneSvg(doc, screens);
    const paths = [...walk(parseSvg(svg))].map((x) => x.el).filter((el) => el.name === 'path');
    paths.forEach((path, i) => {
      const c: Cells = screens[i];
      const { geom, count } = dots(c, doc.screen);
      const d = getAttr(path, 'd')!;
      const at = starts(d);
      assert.equal(at.length, count, `${shape}, ${INKS[i].name}: dot count`);
      assert.equal((d.match(/z/g) ?? []).length, count, 'each dot closed');
      // where each dot's outline starts, from its cell centre, as pathData writes it
      const scale = 96 / doc.size.dpi;
      const t = (-c.angle * Math.PI) / 180;
      const [ux, uy, vx, vy] = [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t)];
      let k = 0;
      for (let n = 0; n < c.n; n++) {
        const [a, b] = [geom[2 * n], geom[2 * n + 1]];
        if (!(a > 0 && b > 0)) continue;
        const [du, dv] = shape === 'round' || shape === 'ellipse' ? [-a, 0] : shape === 'diamond' ? [a, 0] : [a, b];
        const want = [(c.x[n] + du * ux + dv * vx) * scale, (c.y[n] + du * uy + dv * vy) * scale];
        assert.ok(Math.abs(at[k][0] - want[0]) < 1e-2 && Math.abs(at[k][1] - want[1]) < 1e-2, `${shape} dot ${k} at ${at[k]} not ${want}`);
        k++;
      }
    });
  }
});

test('overprint blends the inks by multiply; knockout stacks them plainly', () => {
  const over = inkGroups(parseSvg(halftoneSvg(docOf(), screensOf(docOf()))));
  assert.ok(over.every((g) => getAttr(g, 'style') === 'mix-blend-mode:multiply'));
  const knock = inkGroups(parseSvg(halftoneSvg(docOf({ overlap: 'knockout' }), screensOf(docOf()))));
  assert.ok(knock.every((g) => getAttr(g, 'style') === null));
});

test('the paper is a rect in its colour when included, and absent when not', () => {
  const rects = (doc: Doc) => parseSvg(halftoneSvg(doc, screensOf(doc))).children.filter((c): c is El => isEl(c) && c.name === 'rect');
  assert.deepEqual(rects(docOf()).map((r) => getAttr(r, 'fill')), [toHex(BONE)]);
  assert.equal(rects(docOf({ paper: { colour: BONE, include: false } })).length, 0);
});

test('ink names become unique, valid ids and stay readable in data-name', () => {
  const doc = docOf({ inks: [ink('Fluorescent Pink', [0.7, 0.2, 350], 45), ink('Fluorescent Pink', [0.7, 0.2, 350], 75), ink('2 & "Blue"', [0.5, 0.15, 250], 15)] });
  const groups = inkGroups(parseSvg(halftoneSvg(doc, screensOf(doc))));
  assert.deepEqual(groups.map((g) => getAttr(g, 'id')), ['Fluorescent_Pink', 'Fluorescent_Pink_2', 'Ink_2_Blue_']);
  assert.equal(getAttr(groups[2], 'data-name'), '2 &amp; &quot;Blue&quot;');
});

test('a stochastic screen has no SVG, and says why', () => {
  const doc = docOf({ screen: { shape: 'stochastic', lpi: 30, minDot: 0, gain: 0 } });
  assert.match(svgProblem(doc)!, /millions/);
  assert.throws(() => halftoneSvg(doc, []), /millions/);
  assert.equal(svgProblem(docOf()), null);
});

/**
 * Each round or elliptical dot's two half arcs read as SVG's arc rules say a renderer draws them
 * (the endpoint to centre conversion, radii scaled up when too small): both halves share one centre
 * on the dot's own, and the radii are the dot's half-axes.
 */
test('round and elliptical dots draw as exact circles and ellipses, the size screen.dots gives', () => {
  for (const shape of ['round', 'ellipse'] as CellShape[]) {
    for (const lpi of [30, 60, 100, 150]) {
      const doc = docOf({ screen: { shape, lpi, minDot: 0, gain: 0 }, inks: [ink('K', [0.2, 0, 0], shape === 'round' ? 0 : 15)] });
      const [c] = screensOf(doc);
      const { geom } = dots(c, doc.screen);
      const d = getAttr([...walk(parseSvg(halftoneSvg(doc, [c])))].map((x) => x.el).find((el) => el.name === 'path')!, 'd')!;
      const scale = 96 / doc.size.dpi;
      const want: [number, number][] = [];
      for (let n = 0; n < c.n; n++) if (geom[2 * n] > 0 && geom[2 * n + 1] > 0) want.push([geom[2 * n] * scale, geom[2 * n + 1] * scale]);
      const num = String.raw`(-?(?:\d+\.?\d*|\.\d+))`;
      // a dot is `a rx ry rotation 1 0 dx dy rx ry rotation 1 0 -dx -dy z`, the second arc's letter implied
      const half = String.raw`${num} ?${num} ?${num} 1 0 ?${num} ?${num}`;
      const arc = new RegExp(String.raw`a${half} ?${half}z`, 'g');
      const halves = [...d.matchAll(arc)].flatMap((m) => [m.slice(1, 6).map(Number), m.slice(6, 11).map(Number)]);
      assert.equal(halves.length, 2 * want.length);
      halves.forEach(([rx, ry, rot, dx, dy], i) => {
        const [a, b] = want[i >> 1];
        // SVG F.6.5 and F.6.6, from the arc's start at (0, 0) to (dx, dy)
        const t = (rot * Math.PI) / 180;
        const [x1, y1] = [Math.cos(t) * (-dx / 2) + Math.sin(t) * (-dy / 2), -Math.sin(t) * (-dx / 2) + Math.cos(t) * (-dy / 2)];
        const grow = Math.sqrt(Math.max(1, (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)));
        const [Rx, Ry] = [rx * grow, ry * grow];
        const off = Math.sqrt(Math.max(0, (Rx * Rx * Ry * Ry - Rx * Rx * y1 * y1 - Ry * Ry * x1 * x1) / (Rx * Rx * y1 * y1 + Ry * Ry * x1 * x1)));
        const centreOff = off * Math.hypot((Rx * y1) / Ry, (Ry * x1) / Rx);
        assert.ok(centreOff < 2e-2, `${shape} ${lpi} lpi, dot ${i >> 1}: halves ${centreOff.toFixed(4)} off the centre`);
        assert.ok(Math.abs(Rx - a) < 1e-2 && Math.abs(Ry - b) < 1e-2 * Math.max(1, b / a) + 1e-2, `${shape} ${lpi} lpi, dot ${i >> 1}: ${Rx} × ${Ry}, want ${a} × ${b}`);
      });
    }
  }
});

test('overprinted, an opaque ink keeps Normal blending and covers; the note says which', () => {
  const doc = docOf({ inks: [{ ...ink('White', [1, 0, 0], 45), opaque: true }, INKS[0], INKS[1]] });
  const svg = halftoneSvg(doc, screensOf(doc));
  assert.deepEqual(inkGroups(parseSvg(svg)).map((g) => getAttr(g, 'style')), [null, 'mix-blend-mode:multiply', 'mix-blend-mode:multiply']);
  assert.match(svg, /opaque inks \(White\) keep Normal blending/);
  assert.doesNotMatch(halftoneSvg(docOf(), screensOf(docOf())), /opaque/);
});

test('the file comes in pieces that join to the one SVG (a page of dots can outgrow a string)', () => {
  const doc = docOf();
  const parts = svgParts(doc, screensOf(doc));
  assert.equal(parts.length, 2 + 3 * INKS.length);
  assert.equal(parts.join(''), halftoneSvg(doc, screensOf(doc)));
});

test('path numbers are rounded to two decimals, so the file is not weight no press can print', () => {
  for (const shape of ['round', 'ellipse', 'square', 'line', 'diamond', 'cross'] as CellShape[]) {
    const doc = docOf({ screen: { shape, lpi: 30, minDot: 0.03, gain: 0.1 } });
    const svg = halftoneSvg(doc, screensOf(doc));
    const paths = [...svg.matchAll(/ d="([^"]*)"/g)].map((m) => m[1]);
    assert.ok(paths.length > 0);
    for (const d of paths) assert.equal(/\d\.\d{3,}/.test(d), false, `${shape}: a number past two decimals`);
  }
});
