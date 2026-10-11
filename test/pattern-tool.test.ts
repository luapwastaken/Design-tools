import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Oklch } from '../src/shared/color/index.ts';
import { layoutTile } from '../src/shared/pattern/layout.ts';
import type { PatternPayload } from '../src/shared/types.ts';
import { emptyDoc, fromPayload, MAX_COLOURS, mapSlot, paletteColour, PX_PER, toPayload, withPalette, withUnit, type PatternDoc, type ShapeSlot } from '../src/renderer/tools/pattern/doc.ts';
import type { Swatch } from '../src/shared/types.ts';

const RED: Oklch = [0.6, 0.2, 25];
const GREEN: Oklch = [0.7, 0.15, 145];
const BLUE: Oklch = [0.5, 0.15, 260];

const slot = (id: string, more: Partial<ShapeSlot> = {}): ShapeSlot => ({
  id,
  svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
  name: id,
  weight: 1,
  recolour: false,
  colour: null,
  bounds: { x: 0, y: 0, w: 10, h: 10 },
  ...more,
});

/** every colour the layout gives a slot's items */
const drawn = (d: PatternDoc, id: string) => [...new Set(layoutTile(d).items.filter((it) => it.slot === id).map((it) => JSON.stringify(it.colour)))];

test("a shape's colour field shows the colour the pattern draws it in, and picking one moves no other shape's", () => {
  const d: PatternDoc = {
    ...emptyDoc(),
    cols: 10,
    rows: 10,
    slots: [slot('own'), slot('p1', { recolour: true }), slot('p2', { recolour: true }), slot('p3', { recolour: true })],
    palette: [RED, GREEN, BLUE],
  };
  for (const id of ['p1', 'p2', 'p3']) assert.deepEqual(drawn(d, id), [JSON.stringify(paletteColour(d, id))], id);
  assert.deepEqual(drawn(d, 'own'), ['null']);
  const picked = mapSlot(d, 'p1', (s) => ({ ...s, colour: [0.3, 0.1, 90] }));
  for (const id of ['p2', 'p3']) assert.deepEqual(drawn(picked, id), drawn(d, id), id);
});

test('a pattern file opens as the document it was written from; a damaged one opens with defaults', () => {
  const d: PatternDoc = { ...emptyDoc(), arrangement: 'brick', cols: 5, gapX: -4, palette: [RED, BLUE], exportUnit: 'mm', artboard: { w: 210 * PX_PER.mm, h: 297 * PX_PER.mm } };
  const { preview, ...settings } = toPayload(d) as PatternPayload;
  assert.ok(preview.svg.startsWith('<?xml') && preview.tileWidth > 0);
  assert.deepEqual(fromPayload(settings), d);
  const odd = fromPayload({ arrangement: 'spiral', cols: 'four', slots: [{ svg: 'not svg' }], artboard: { w: -1 } } as never);
  assert.equal(odd.arrangement, emptyDoc().arrangement);
  assert.equal(odd.cols, emptyDoc().cols);
  assert.deepEqual(odd.slots, emptyDoc().slots);
  assert.deepEqual(odd.artboard, emptyDoc().artboard);
});

test('the export unit only changes how the artboard is shown and written: looking at A4 in inches and back leaves it A4', () => {
  const a4: PatternDoc = { ...emptyDoc(), exportUnit: 'mm', artboard: { w: 210 * PX_PER.mm, h: 297 * PX_PER.mm } };
  let d = a4;
  for (const unit of ['in', 'px', 'mm', 'in', 'mm'] as const) d = withUnit(d, unit);
  assert.deepEqual(d.artboard, a4.artboard);
  // and the file keeps it to the last digit
  const { preview: _, ...settings } = toPayload(withUnit(a4, 'in')) as PatternPayload;
  assert.deepEqual(fromPayload(settings).artboard, a4.artboard);
});

test('a palette sent here colours the shapes that take palette colours; a shape keeping its own colours keeps them', () => {
  const sw = (oklch: typeof RED, role: string | null = null): Swatch => ({ id: String(oklch), name: '', role, oklch, type: 'process' });
  const d: PatternDoc = { ...emptyDoc(), slots: [slot('logo'), slot('star', { recolour: true, colour: GREEN })] };
  const next = withPalette(d, [sw(RED), sw(BLUE), sw(GREEN, 'Background')]).doc;
  assert.deepEqual(next.palette, [RED, BLUE]);
  assert.deepEqual(next.background, GREEN);
  assert.equal(next.slots[0], d.slots[0]); // the logo keeps its own colours
  assert.deepEqual([next.slots[1].recolour, next.slots[1].colour], [true, null]); // the star follows the palette again
  // with no shape taking palette colours, none is made to
  const own = withPalette({ ...d, slots: [slot('logo'), slot('mark')] }, [sw(RED)]).doc;
  assert.ok(own.slots.every((s) => !s.recolour));
  // a big palette stops at the colour cap, and says how many stayed out
  const big = withPalette(d, Array.from({ length: 30 }, (_, i) => sw([0.5, 0.1, i * 10] as typeof RED)));
  assert.equal(big.doc.palette.length, MAX_COLOURS);
  assert.equal(big.left, 18);
});

test('a role palette sent here leaves out what would vanish into its background, and says which', () => {
  const sw = (name: string, oklch: [number, number, number], role: string | null = null): Swatch => ({ id: name, name, role, oklch, type: 'process' });
  const snow = sw('Snow', [0.97, 0.01, 20], 'Background');
  const out = withPalette(emptyDoc(), [snow, sw('White', [0.99, 0.0, 20], 'Surface'), sw('Berry', [0.55, 0.18, 10], 'Primary'), sw('Ink', [0.2, 0.02, 20], 'Text')]);
  assert.deepEqual(out.doc.palette, [[0.55, 0.18, 10], [0.2, 0.02, 20]]);
  assert.deepEqual(out.doc.background, snow.oklch);
  assert.deepEqual(out.skipped, ['White']);
  // every colour too close: they still go in, rather than an empty palette
  const all = withPalette(emptyDoc(), [snow, sw('White', [0.99, 0.0, 20], 'Surface')]);
  assert.equal(all.doc.palette.length, 1);
  assert.deepEqual(all.skipped, []);
});

test('an Illustration palette sent here sends each ramp base first, so the cap cuts steps and not the brand', () => {
  const ramp = (group: string, h: number): Swatch[] => [-2, -1, 0, 1, 2].map((step) => ({ id: `${group}${step}`, name: '', role: null, oklch: [0.6 - step * 0.08, 0.1, h], type: 'process', group, step }));
  const swatches = ['a', 'b', 'c', 'd'].flatMap((g, i) => ramp(g, i * 80)); // 20 colours, four bases
  const out = withPalette(emptyDoc(), swatches);
  assert.equal(out.doc.palette.length, MAX_COLOURS);
  assert.equal(out.bases, 4);
  assert.deepEqual(out.doc.palette.slice(0, 4), swatches.filter((w) => w.step === 0).map((w) => w.oklch));
  assert.equal(out.left, 8);
});
