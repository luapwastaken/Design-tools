// The print and motion fixes of the 2026-10-11 UX sweep: invert, the knockout stack, SVG weight and
// marks, a spot start of two inks, Post FX's sequence, invert and preset label, the shared Y key, and
// Pattern's tile size in its unit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linearRgb, toOklch } from '../src/shared/color/index.ts';
import { INKS } from '../src/shared/palette/inks.ts';
import { applyTone } from '../src/shared/dither/tone.ts';
import { toPlates } from '../src/shared/halftone/separate.ts';
import { NEUTRAL_TONE, toneAt } from '../src/shared/halftone/tone.ts';
import type { SeparateInk } from '../src/shared/halftone/types.ts';
import { emptyDoc, spotInk, spotStart, stackOf, type HalftoneDoc } from '../src/renderer/tools/halftone/doc.ts';
import { BLEED_MM, MARGIN_MM, sheetOf, withMarks } from '../src/renderer/tools/halftone/plates.ts';
import { SVG_HEAVY_MB, svgMegabytes } from '../src/renderer/tools/halftone/screening.ts';
import { showOriginalKey } from '../src/renderer/tools/common/flip.ts';
import { isLook, LOOKS } from '../src/renderer/tools/dither/looks.ts';
import { emptyDoc as ditherDoc } from '../src/renderer/tools/dither/looks.ts';
import { BUILT_INS, presetReadout } from '../src/renderer/tools/postfx/builtins.ts';
import { emptyDoc as postDoc, layerOf, timeline, type PostFxDoc, type Source } from '../src/renderer/tools/postfx/doc.ts';
import { defaultsOf, EFFECTS, effectOf } from '../src/renderer/tools/postfx/effects/index.ts';
import { timingOf } from '../src/renderer/tools/postfx/media-time.ts';
import { emptyDoc as patternDoc, lengthIn, presetOf, PX_PER, rangeIn, scaleTile, withPreset, withTileSide, withUnit } from '../src/renderer/tools/pattern/doc.ts';
import { layoutTile } from '../src/shared/pattern/layout.ts';

// ── invert (il-01) ──

test('invert is the negative of the tone curve, after levels, gamma and contrast', () => {
  const t = { ...NEUTRAL_TONE, invert: true };
  assert.equal(toneAt(t, 0), 1);
  assert.equal(toneAt(t, 1), 0);
  assert.ok(Math.abs(toneAt(t, 0.2) - 0.8) < 1e-12);
  // after the rest: a black point of 20% makes everything under it 0, which inverts to 1
  assert.equal(toneAt({ ...t, black: 0.2 }, 0.1), 1);
  assert.equal(toneAt({ ...NEUTRAL_TONE, invert: false }, 0.3), 0.3);
});

test('a white logo on black separates to ink on paper once inverted', () => {
  const black: SeparateInk = { colour: toOklch({ mode: 'rgb', r: 0.1, g: 0.1, b: 0.1 }), curve: [[0, 0], [1, 1]] };
  const px = (v: number) => linearRgb(toOklch({ mode: 'rgb', r: v, g: v, b: v }));
  const [wr, wg, wb] = px(1);
  const [kr, kg, kb] = px(0);
  // two pixels: a white one and a black one, opaque
  const img = Float32Array.from([wr, wg, wb, 1, kr, kg, kb, 1]);
  const [plain] = toPlates(img, 2, 1, [black], 'spot', NEUTRAL_TONE);
  const [flipped] = toPlates(img, 2, 1, [black], 'spot', { ...NEUTRAL_TONE, invert: true });
  assert.ok(plain[0] < 0.05 && plain[1] > 0.5, `plain: white ${plain[0]}, black ${plain[1]}`);
  assert.ok(flipped[0] > 0.5 && flipped[1] < 0.05, `inverted: white ${flipped[0]}, black ${flipped[1]}`);
});

test('Dither inverts before it dithers, and a look counts an inverted tone as changed', () => {
  const img = Float32Array.from([0, 0, 0, 1, 1, 1]);
  const out = applyTone(img.slice(), { ...NEUTRAL_TONE, invert: true });
  assert.ok(out[0] > 0.99 && out[3] < 0.01);
  const d = ditherDoc();
  const look = LOOKS[0];
  assert.equal(isLook(d, look), true);
  assert.equal(isLook({ ...d, tone: { ...d.tone, invert: true } }, look), false);
});

test('Post FX has an Invert effect with nothing to set, in the Colour group', () => {
  const fx = effectOf('invert');
  assert.ok(fx);
  assert.equal(fx.group, 'colour');
  assert.deepEqual(fx.params, []);
  assert.deepEqual(defaultsOf('invert'), {});
  assert.ok(EFFECTS.includes(fx));
  assert.equal(layerOf('invert').effect, 'invert');
});

// ── the knockout stack (pm-01) ──

const riso = (name: string) => INKS.riso.find((i) => i.name === name)!.oklch;
const knock = (visible: boolean[]): HalftoneDoc => ({
  ...emptyDoc(),
  mode: 'spot',
  overlap: 'knockout',
  inks: [spotInk('Black', riso('Black'), 0), spotInk('Blue', riso('Blue'), 1), spotInk('Pink', riso('Fluorescent Pink'), 2)].map((k, i) => ({ ...k, visible: visible[i] })),
});

test('a hidden ink leaves a knockout stack, and nothing else does', () => {
  assert.deepEqual(stackOf(knock([true, true, true])), [true, true, true]);
  assert.deepEqual(stackOf(knock([false, true, true])), [false, true, true]);
  // every ink hidden: nothing to leave out, the stack stays whole
  assert.deepEqual(stackOf(knock([false, false, false])), [true, true, true]);
  // overprinted, hiding changes no plate
  assert.deepEqual(stackOf({ ...knock([false, true, true]), overlap: 'overprint' }), [true, true, true]);
  // CMYK always overprints
  assert.ok(stackOf({ ...emptyDoc(), inks: emptyDoc().inks.map((k, i) => ({ ...k, visible: i > 0 })) }).every(Boolean));
});

test('hiding Black in a knockout gives Blue the plate it has without Black, and Black an empty one', () => {
  const d = knock([false, true, true]);
  const inks: SeparateInk[] = d.inks.map((k) => ({ colour: k.colour, curve: k.curve }));
  // a small ramp of greys and a blue
  const n = 24;
  const img = new Float32Array(n * 4);
  for (let p = 0; p < n; p++) {
    const v = p / (n - 1);
    const [r, g, b] = linearRgb(toOklch({ mode: 'rgb', r: v, g: v, b: 1 - v / 2 }));
    img.set([r, g, b, 1], p * 4);
  }
  const opts = { overlap: 'knockout' as const, paper: d.paper.colour };
  const all = toPlates(img, n, 1, inks, 'spot', NEUTRAL_TONE, opts);
  const stacked = toPlates(img, n, 1, inks, 'spot', NEUTRAL_TONE, { ...opts, stack: stackOf(d) });
  const without = toPlates(img, n, 1, inks.slice(1), 'spot', NEUTRAL_TONE, opts);
  assert.ok(stacked[0].every((v) => v === 0), 'the hidden ink has an empty plate');
  assert.deepEqual(stacked[1], without[0]);
  assert.deepEqual(stacked[2], without[1]);
  assert.notDeepEqual(stacked[1], all[1], 'with Black in the stack Blue is cut back where Black covers it');
});

// ── the SVG's weight and the plates' sheet (pm-02, pm-03) ──

test('the SVG estimate counts bytes a dot by shape, and goes heavy past 20 MB', () => {
  const d = emptyDoc();
  const few = { inks: d.inks.map((k) => ({ id: k.id, count: 1e6 })) } as never;
  assert.equal(svgMegabytes(few, d), (4e6 * 60) / 1e6);
  const many = { inks: d.inks.map((k) => ({ id: k.id, count: 1e5 })) } as never;
  assert.ok(svgMegabytes(many, d) > SVG_HEAVY_MB);
  // a hidden ink adds nothing
  const hide = { ...d, inks: d.inks.map((k, i) => ({ ...k, visible: i === 0 })) };
  assert.ok(svgMegabytes(many, hide) < SVG_HEAVY_MB);
});

const plate = (w: number, h: number, fill: (x: number, y: number) => number) => Uint8Array.from({ length: w * h }, (_, i) => fill(i % w, (i / w) | 0));

test('marks put the plate on a larger sheet with the page untouched in the middle', () => {
  const [w, h, dpi] = [200, 150, 254];
  const sheet = sheetOf(w, h, dpi);
  // 254 dpi is 10 px a mm
  assert.equal(sheet.margin, MARGIN_MM * 10);
  assert.equal(sheet.bleed, BLEED_MM * 10);
  assert.deepEqual([sheet.w, sheet.h], [w + 2 * sheet.margin, h + 2 * sheet.margin]);
  const grey = plate(w, h, (x, y) => (x + y) % 2 ? 255 : 128);
  const out = withMarks(grey, w, h, dpi, null);
  assert.equal(out.length, sheet.w * sheet.h);
  for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1], [77, 41]]) assert.equal(out[(y + sheet.margin) * sheet.w + x + sheet.margin], grey[y * w + x], `page pixel ${x},${y}`);
});

test('the bleed is the page mirrored over its edge, three millimetres of it', () => {
  const [w, h, dpi] = [100, 80, 254];
  const { margin: m, bleed: b, w: W } = sheetOf(w, h, dpi);
  const grey = plate(w, h, (x, y) => (x * 3 + y * 5) % 251);
  const out = withMarks(grey, w, h, dpi, null);
  const at = (x: number, y: number) => out[(m + y) * W + m + x];
  assert.equal(at(-1, 10), grey[10 * w + 0]);
  assert.equal(at(-b, 10), grey[10 * w + (b - 1)]);
  assert.equal(at(w, 10), grey[10 * w + (w - 1)]);
  assert.equal(at(20, -1), grey[0 * w + 20]);
  assert.equal(at(20, h + b - 1), grey[(h - b) * w + 20]);
  // past the bleed is paper
  assert.equal(at(-b - 1, 10) === 255 || at(-b - 1, 10) === 0, true);
  assert.equal(at(-b - 4, 40), 255);
});

test('crop marks sit at the trim corners clear of the bleed, a registration target at each side, and none on the page', () => {
  const [w, h, dpi] = [300, 200, 254];
  const { margin: m, bleed: b, w: W, h: H } = sheetOf(w, h, dpi);
  const paper = new Uint8Array(w * h).fill(255);
  const out = withMarks(paper, w, h, dpi, null);
  const ink = (x: number, y: number) => out[(m + y) * W + m + x] === 0;
  // the page and its bleed hold no mark
  for (let y = -b; y < h + b; y += 3) for (let x = -b; x < w + b; x += 3) assert.equal(ink(x, y), false, `${x},${y}`);
  // a crop mark along the top edge, left of the top-left corner, and one above it
  const gap = b + 10;
  assert.equal(ink(-gap - 10, 0) || ink(-gap - 10, -1), true, 'a horizontal mark beside the corner');
  assert.equal(ink(0, -gap - 10) || ink(-1, -gap - 10), true, 'a vertical mark above the corner');
  assert.equal(ink(w + gap + 10, h) || ink(w + gap + 10, h - 1), true, 'the bottom-right corner');
  // targets: ink at the middle of each side, 7.5 mm out
  assert.equal(ink(w >> 1, -75), true, 'top');
  assert.equal(ink(w >> 1, h + 75), true, 'bottom');
  assert.equal(ink(-75, h >> 1), true, 'left');
  assert.equal(ink(w + 75, h >> 1), true, 'right');
  // nothing is drawn outside the sheet
  assert.equal(out.length, W * H);
});

test('the ink name is set under the trim at the left, over paper only and never lightening a mark', () => {
  const [w, h, dpi] = [300, 200, 254];
  const { margin: m, w: W } = sheetOf(w, h, dpi);
  const slug = { data: Uint8Array.from({ length: 40 * 12 }, (_, i) => (i % 40 < 20 ? 255 : 0)), w: 40, h: 12 };
  const out = withMarks(new Uint8Array(w * h).fill(255), w, h, dpi, slug);
  const x0 = m + 20;
  const y1 = m + h + 90;
  assert.equal(out[(y1 - 1) * W + x0 + 5], 0, 'inked where the slug is');
  assert.equal(out[(y1 - 1) * W + x0 + 30], 255, 'paper where it is not');
});

// ── the first-run defaults (pm-04) ──

test('a first switch to spot inks starts with two Riso inks, neither of them Black', () => {
  const inks = spotStart();
  assert.equal(inks.length, 2);
  assert.deepEqual(inks.map((k) => k.name), ['Blue', 'Fluorescent Pink']);
  assert.notEqual(inks[0].angle, inks[1].angle);
  assert.ok(inks.every((k) => k.visible && !k.process));
});

// ── Post FX: a sequence, the preset label, the shared Y key (pm-06, pm-08) ──

const seq: Source = { asset: 'dt://asset/postfx/a.png', assets: ['dt://asset/postfx/a.png', 'dt://asset/postfx/b.png', 'dt://asset/postfx/c.png', 'dt://asset/postfx/d.png'], name: 'frames', kind: 'sequence', w: 64, h: 64, fps: 24, frames: 4, delays: null };

test('a sequence is a timeline of its frames at its own rate', () => {
  const d: PostFxDoc = { ...postDoc(), source: seq };
  const t = timeline(d);
  assert.equal(t.kind, 'sequence');
  assert.equal(t.count, 4);
  assert.equal(t.fps, 24);
  assert.equal(t.delays, null);
  assert.ok(Math.abs(t.seconds - 4 / 24) < 1e-9);
  assert.equal(timingOf('sequence', { frames: 4, fps: 12, delays: null }, { seconds: 1, fps: 1 }).count, 4);
  // another rate retimes it
  assert.equal(timeline({ ...d, source: { ...seq, fps: 12 } }).fps, 12);
});

test('the preset label drops "changed" when Undo brings back the stack the preset replaced', () => {
  const [film, vhs] = BUILT_INS;
  const all = [film, vhs];
  const before = [layerOf('grade'), layerOf('bloom')];
  const last = { id: vhs.id, before };
  // the preset itself
  assert.equal(presetReadout(all, vhs.layers, null), vhs.name);
  // edited away from it
  const edited = vhs.layers.map((l, n) => (n ? { ...l, opacity: 0.5 } : l));
  assert.equal(presetReadout(all, edited, last), `${vhs.name}, changed`);
  // Undo took it back to the stack it replaced: no longer "changed"
  assert.equal(presetReadout(all, before, last), undefined);
  // and Redo is the preset again
  assert.equal(presetReadout(all, vhs.layers, last), vhs.name);
  // an empty stack says nothing, and so does one with no preset behind it
  assert.equal(presetReadout(all, [], last), undefined);
  assert.equal(presetReadout(all, edited, null), undefined);
});

test('every image tool answers Y with the same words', () => {
  let ran = 0;
  const k = showOriginalKey(() => ran++);
  assert.equal(k.keys, 'Y');
  assert.equal(k.label, 'Show the original, or the result again');
  k.run();
  assert.equal(ran, 1);
});

// ── Pattern: the tile in the tool's unit (pl-02) ──

test('the unit applies to the whole tool and a print preset is mm at 300 dpi', () => {
  const d = patternDoc();
  assert.equal(presetOf(d), 'screen');
  const print = withPreset(d, 'print');
  assert.deepEqual([print.exportUnit, print.dpi], ['mm', 300]);
  assert.equal(presetOf(print), 'print');
  assert.equal(presetOf(withUnit(print, 'in')), null, 'inches at 300 dpi is neither');
  assert.deepEqual([withPreset(print, 'screen').exportUnit, withPreset(print, 'screen').dpi], ['px', 96]);
  // lengths are shown in the unit, on its precision
  assert.equal(lengthIn(PX_PER.mm * 100, 'mm'), '100.0');
  assert.equal(lengthIn(96, 'in'), '1.00');
  assert.equal(lengthIn(96.4, 'px'), '96');
  // a px range put on mm steps stays inside it
  const [lo, hi] = rangeIn('mm', [4, 600]);
  assert.ok(lo * PX_PER.mm >= 4 && hi * PX_PER.mm <= 600);
  assert.equal(lo, 1.1);
});

test('a tile asked for in mm scales the whole tile, shapes and gaps, and lands on the size', () => {
  const d = { ...patternDoc(), arrangement: 'grid' as const, cols: 3, rows: 2 };
  const t = layoutTile(d);
  const want = 40 * PX_PER.mm;
  const wider = withTileSide(d, 'width', want);
  assert.ok(Math.abs(layoutTile(wider).width - want) < 0.5, `width ${layoutTile(wider).width} want ${want}`);
  // the shapes and gaps scaled by the same factor, so the look is the same
  const k = want / t.width;
  assert.ok(Math.abs(wider.sizeMax - d.sizeMax * k) < 0.01 && Math.abs(wider.gapX - d.gapX * k) < 0.01);
  assert.ok(Math.abs(layoutTile(wider).height / layoutTile(wider).width - t.height / t.width) < 1e-3, 'the proportions stay');
  // the height asked for sets the width through the same scale
  const taller = withTileSide(d, 'height', t.height * 2);
  assert.ok(Math.abs(layoutTile(taller).width - t.width * 2) < 0.5);
  // nothing goes past the limits, and a nonsense size changes nothing
  const huge = scaleTile(d, 1000);
  assert.ok(huge.sizeMax <= 600);
  assert.equal(withTileSide(d, 'width', 0), d);
});
