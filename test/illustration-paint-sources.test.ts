import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIGMENTS, type Pigment } from '../src/shared/paint/pigments.ts';
import type { Recipe } from '../src/shared/paint/recipe.ts';
import type { Swatch } from '../src/shared/types.ts';
import { comboOf } from '../src/renderer/shell/core/keys.ts';
import { paintUndoKey } from '../src/renderer/tools/illustration/paint-keys.ts';
import {
  addToWell,
  DEFAULT_PAINT,
  loadedOf,
  neighbourOf,
  paintSettings,
  PARTS_MAX,
  sourcesOf,
  WELL_MAX,
  wellFromRecipe,
  wellMix,
} from '../src/renderer/tools/illustration/paint-sources.ts';

const P = Object.fromEntries(PIGMENTS.map((p) => [p.id, p])) as Record<string, Pigment>;
const swatch = (id: string, oklch: [number, number, number]): Swatch => ({ id, name: '', role: null, oklch, type: 'process' });

// ── the tray and the well ────────────────────────────────────────────────────────────────────────

test('the tray offers the owned pigments, then the palette colours by id, in their sets', () => {
  const s = sourcesOf([P.ultra, P.hansa], [{ key: 'r', name: 'Skin', swatches: [{ ...swatch('a', [0.6, 0.1, 40]), name: 'Skin shadow' }, swatch('b', [0.5, 0.1, 40])] }]);
  assert.deepEqual(s.map((x) => x.id), ['ultra', 'hansa', 'swatch:a', 'swatch:b']);
  assert.ok(s[2].swatch && s[2].name === 'Skin shadow' && s[2].set?.name === 'Skin');
  assert.ok(/^#[0-9A-F]{6}$/.test(s[3].name));
});

test('a loaded brush carries the traits the engine reads, staining included', () => {
  const l = loadedOf(P.phthaloB);
  assert.equal(l.staining, P.phthaloB.staining);
  assert.equal(l.granulation, P.phthaloB.granulation);
  assert.equal(l.opacity, P.phthaloB.opacity);
});

test('a palette colour is marked for the engine to lay harder; a tube is not', () => {
  const [tube, palette] = sourcesOf([P.ultra], [{ key: 'r', name: 'Skin', swatches: [swatch('a', [0.6, 0.1, 40])] }]);
  assert.equal(loadedOf(tube.pigment, tube.swatch).swatch, undefined);
  assert.equal(loadedOf(palette.pigment, palette.swatch).swatch, true);
  assert.equal(loadedOf(P.ultra).swatch, undefined);
});

test('a well of palette colours alone is laid as they are; one tube in it and the mix is the tubes to weigh', () => {
  const sources = sourcesOf([P.ultra], [{ key: 'r', name: 'Skin', swatches: [swatch('a', [0.6, 0.1, 40]), swatch('b', [0.5, 0.1, 60])] }]);
  assert.equal(wellMix([{ id: 'swatch:a', parts: 1 }, { id: 'swatch:b', parts: 2 }], sources)!.loaded.swatch, true);
  assert.equal(wellMix([{ id: 'swatch:a', parts: 1 }, { id: 'ultra', parts: 1 }], sources)!.loaded.swatch, undefined);
});

test('the well mixes by parts with km.ts: ultramarine and hansa make a green, its traits averaged by parts', () => {
  const sources = sourcesOf(PIGMENTS, []);
  assert.equal(wellMix([], sources), null);
  const mix = wellMix([{ id: 'ultra', parts: 1 }, { id: 'hansa', parts: 2 }], sources)!;
  assert.ok(mix.oklch[2] > 110 && mix.oklch[2] < 190, `hue ${mix.oklch[2].toFixed(0)}`);
  assert.ok(mix.loaded.opacity > P.ultra.opacity && mix.loaded.opacity < P.hansa.opacity);
  assert.ok(Math.abs(mix.loaded.staining - (P.ultra.staining + 2 * P.hansa.staining) / 3) < 1e-12);
});

test('adding to the well: a part more of a paint already there, a new paint at 1, never past the limit', () => {
  let well = addToWell([], 'ultra')!;
  well = addToWell(well, 'ultra')!;
  assert.deepEqual(well, [{ id: 'ultra', parts: 2 }]);
  for (const id of ['hansa', 'cadred', 'tiwhite']) well = addToWell(well, id)!;
  assert.equal(well.length, WELL_MAX);
  assert.equal(addToWell(well, 'lampblack'), null);
  assert.deepEqual(addToWell([{ id: 'tiwhite', parts: PARTS_MAX }], 'tiwhite'), [{ id: 'tiwhite', parts: PARTS_MAX }]);
});

test('any recipe fits the well: white at 128 parts stays 128', () => {
  assert.equal(PARTS_MAX, 128);
  const r: Recipe = { parts: [{ pigment: P.tiwhite, parts: 128 }, { pigment: P.ultra, parts: 1 }], result: [0.9, 0.02, 260], deltaE: 1 };
  assert.deepEqual(wellFromRecipe(r), [{ id: 'tiwhite', parts: 128 }, { id: 'ultra', parts: 1 }]);
  assert.deepEqual(paintSettings({ well: wellFromRecipe(r) }).well, wellFromRecipe(r));
});

test('the paint that takes over when the loaded one leaves the tray: the next still there, else the one before, else none', () => {
  const tray = ['tiwhite', 'hansa', 'ultra', 'phthaloB', 'lampblack'];
  assert.equal(neighbourOf(tray, ['tiwhite', 'hansa', 'phthaloB', 'lampblack'], 'ultra'), 'phthaloB');
  // the next one went with it (a whole ramp deleted): the one after that
  assert.equal(neighbourOf(tray, ['tiwhite', 'hansa', 'lampblack'], 'ultra'), 'lampblack');
  assert.equal(neighbourOf(tray, ['tiwhite', 'hansa', 'ultra', 'phthaloB'], 'lampblack'), 'phthaloB');
  assert.equal(neighbourOf(tray, ['hansa'], 'lampblack'), 'hansa');
  assert.equal(neighbourOf(tray, [], 'ultra'), null);
  assert.equal(neighbourOf(tray, ['hansa'], 'gone'), 'hansa');
});

// ── the settings ─────────────────────────────────────────────────────────────────────────────────

test('saved settings are read field by field; anything odd falls back', () => {
  assert.deepEqual(paintSettings(undefined), DEFAULT_PAINT);
  const s = paintSettings({ tool: 'smudge', medium: 'dry', brushes: { wet: 'flat', dry: 'mop' }, size: 900, load: -4, paint: 'hansa', well: [{ id: 'ultra', parts: 400 }, { id: 3 }, 'x'] });
  assert.deepEqual(s, { tool: 'smudge', medium: 'dry', brushes: { wet: 'flat', dry: 'flat' }, size: 400, load: 5, paint: 'hansa', well: [{ id: 'ultra', parts: 128 }] });
  assert.equal(paintSettings({ tool: 'erase' }).tool, 'paint');
});

test('the brush follows the medium: Round for watercolour, Flat for gouache, each remembered', () => {
  assert.deepEqual(DEFAULT_PAINT.brushes, { wet: 'round', dry: 'flat' });
  assert.deepEqual(paintSettings({ brushes: { wet: 'dry', dry: 'round' } }).brushes, { wet: 'dry', dry: 'round' });
  assert.deepEqual(paintSettings({ brushes: 'round' }).brushes, DEFAULT_PAINT.brushes);
});

test('a size saved before the 2048 painting is doubled, so the brush looks the same; a new one is kept', () => {
  assert.equal(DEFAULT_PAINT.size, 80);
  assert.equal(paintSettings({ size: 40 }).size, 80);
  assert.equal(paintSettings({ size: 200 }).size, 400);
  assert.equal(paintSettings({ size: 40, brushes: DEFAULT_PAINT.brushes }).size, 40);
  // read back as written, it stays put
  const once = paintSettings({ size: 30 });
  assert.equal(paintSettings(once).size, 60);
});

// ── the canvas's undo keys ───────────────────────────────────────────────────────────────────────

const key = (k: string, o: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  comboOf({ key: k, code: `Key${k.toUpperCase()}`, ctrlKey: !!o.ctrl, altKey: !!o.alt, shiftKey: !!o.shift });

test('over the paper or with the canvas focused, Ctrl+Z undoes and Ctrl+Y or Ctrl+Shift+Z redoes', () => {
  const over = { over: true, focused: false, fieldOwnsUndo: false };
  const focused = { over: false, focused: true, fieldOwnsUndo: false };
  assert.equal(paintUndoKey(key('z', { ctrl: true }), over), 'undo');
  assert.equal(paintUndoKey(key('z', { ctrl: true }), focused), 'undo');
  assert.equal(paintUndoKey(key('z', { ctrl: true, shift: true }), over), 'redo');
  assert.equal(paintUndoKey(key('y', { ctrl: true }), focused), 'redo');
  assert.equal(paintUndoKey(key('y', { ctrl: true, shift: true }), over), null);
  assert.equal(paintUndoKey(key('z', { ctrl: true, alt: true }), over), null);
  assert.equal(paintUndoKey(key('z'), over), null);
  assert.equal(paintUndoKey(key('d', { ctrl: true }), over), null);
});

test('away from the paper the keys are the palette’s, and a field with its own edit keeps them', () => {
  assert.equal(paintUndoKey(key('z', { ctrl: true }), { over: false, focused: false, fieldOwnsUndo: false }), null);
  assert.equal(paintUndoKey(key('z', { ctrl: true }), { over: true, focused: false, fieldOwnsUndo: true }), null);
  assert.equal(paintUndoKey(key('y', { ctrl: true }), { over: true, focused: true, fieldOwnsUndo: true }), null);
});
