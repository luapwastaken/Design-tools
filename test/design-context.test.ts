import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contrast, type Oklch } from '../src/shared/color/index.ts';
import { readPaletteFile } from '../src/shared/color/palette-readers.ts';
import type { Swatch } from '../src/shared/types.ts';
import { describe, scene, type Mode, type Scene } from '../src/renderer/tools/design/context-slots.ts';

const sw = (name: string, oklch: Oklch, role: string | null = null): Swatch => ({ id: name, name, role, oklch, type: 'process' });
const MODES: Mode[] = ['light', 'dark'];
const must = (s: Scene | null) => {
  assert.ok(s);
  return s;
};

// the mockup's palette: a dark Background and a light Text role
const MONOLITH = [
  sw('Ground', [0.1998, 0.0086, 264.36], 'Background'),
  sw('Bone', [0.9354, 0.0173, 84.59], 'Text'),
  sw('Iron', [0.5406, 0.0119, 261.77], 'Muted'),
  sw('Ember', [0.6616, 0.1731, 37.3], 'Accent'),
  sw('Moss', [0.4873, 0.0668, 155.13], 'Secondary'),
  sw('Sky', [0.7665, 0.0703, 246.81], 'Highlight'),
];

test('every role drives its slot when it fits the ground', () => {
  const all = [
    sw('Paper', [0.97, 0.01, 90], 'Background'),
    sw('Card', [0.99, 0.005, 90], 'Surface'),
    sw('Ink', [0.22, 0.02, 260], 'Text'),
    sw('Slate', [0.45, 0.02, 260], 'Muted'),
    sw('Cobalt', [0.45, 0.2, 262], 'Primary'),
    sw('Coral', [0.6, 0.17, 30], 'Accent'),
    sw('Lemon', [0.92, 0.17, 105], 'Highlight'),
  ];
  const s = must(scene(all, 'light'));
  const ids = { page: s.page, surface: s.surface, text: s.text, muted: s.muted, primary: s.primary, accent: s.accent, highlight: s.highlight };
  assert.deepEqual(
    Object.fromEntries(Object.entries(ids).map(([k, v]) => [k, v.swatchId])),
    { page: 'Paper', surface: 'Card', text: 'Ink', muted: 'Slate', primary: 'Cobalt', accent: 'Coral', highlight: 'Lemon' },
  );
});

test('a dark Background leads the dark page; the light page falls back to the lightest colour', () => {
  const dark = must(scene(MONOLITH, 'dark'));
  assert.equal(dark.page.name, 'Ground');
  assert.equal(dark.text.name, 'Bone');
  assert.equal(dark.muted.name, 'Iron');
  const light = must(scene(MONOLITH, 'light'));
  assert.equal(light.page.name, 'Bone');
  // Bone is the Text role, but it is the page here: text follows the ground
  assert.equal(light.text.name, 'Ground');
  // no Primary role: the free chromatic colour, never one another brand role claims
  for (const s of [dark, light]) {
    assert.equal(s.primary.name, 'Moss');
    assert.equal(s.accent.name, 'Ember');
    assert.equal(s.highlight.name, 'Sky');
  }
});

test('the dark version derives its text from its own ground (v1 pinned it)', () => {
  const pal = [sw('Paper', [0.96, 0.01, 90], 'Background'), sw('Ink', [0.2, 0.03, 260], 'Text'), sw('Coral', [0.62, 0.17, 30], 'Accent')];
  const s = must(scene(pal, 'dark'));
  assert.equal(s.page.name, 'Ink');
  assert.equal(s.text.name, 'Paper');
  assert.ok(s.pairs.text.ok);
});

test('with no roles the page takes the lightest or darkest colour and text the best contrast', () => {
  const pal = [sw('Mid', [0.6, 0.02, 200]), sw('Night', [0.18, 0.02, 260]), sw('Leaf', [0.55, 0.14, 150]), sw('Snow', [0.97, 0.005, 90])];
  const light = must(scene(pal, 'light'));
  const dark = must(scene(pal, 'dark'));
  assert.equal(light.page.name, 'Snow');
  assert.equal(light.text.name, 'Night');
  assert.equal(dark.page.name, 'Night');
  assert.equal(dark.text.name, 'Snow');
  assert.equal(light.primary.name, 'Leaf');
});

test('the brand colours never become the page', () => {
  const pal = [sw('Butter', [0.96, 0.1, 100], 'Primary'), sw('Linen', [0.9, 0.01, 90]), sw('Soot', [0.2, 0, 0])];
  assert.equal(must(scene(pal, 'light')).page.name, 'Linen');
});

test('a derived muted only just clears 4.5:1 on both the page and the card', () => {
  for (const mode of MODES) {
    const s = must(scene([sw('White', [0.99, 0, 0]), sw('Black', [0.15, 0, 0])], mode));
    assert.equal(s.muted.swatchId, null);
    assert.equal(s.surface.swatchId, null);
    const [onPage, onCard] = [s.page, s.surface].map((bg) => contrast(s.muted.oklch, bg.oklch));
    assert.ok(Math.min(onPage, onCard) >= 4.5 && Math.min(onPage, onCard) < 5, `${mode}: muted ${onPage} / ${onCard}`);
    assert.ok(s.pairs.muted.ok && s.pairs.cardMeta.ok);
  }
});

test('status colours come from the nearest palette hues, each used once, and are made otherwise', () => {
  const s = must(scene(MONOLITH, 'light'));
  assert.equal(s.status.success.fill.name, 'Moss');
  assert.equal(s.status.error.fill.name, 'Ember');
  // Ember is nearest amber too, but it is taken
  assert.equal(s.status.warning.fill.swatchId, null);
  assert.equal(s.status.warning.fill.name, 'amber (added)');
  assert.ok(Math.abs(s.status.warning.fill.oklch[2] - 75) < 1e-9);
  // the ink on a pill is one of the ground pair, whichever reads better
  for (const st of Object.values(s.status)) assert.ok([s.page.name, s.text.name].includes(st.ink.name));
});

test('pairs carry the shared ratio, grade and a hover text for failures', () => {
  const s = must(scene(MONOLITH, 'dark'));
  const p = s.pairs.muted;
  assert.equal(p.ratio, contrast(p.fg.oklch, p.bg.oklch));
  assert.equal(p.ok, p.ratio >= 4.5);
  assert.equal(p.ok, false); // Iron on Ground is 3.59:1 in the mockup
  assert.equal(p.grade, 'AA large · non-text');
  assert.match(describe(p), /^Iron on Ground: 3\.\d\d:1, AA large · non-text\. Body text needs 4\.5:1\.$/);
  assert.equal(s.pairs.mark.need, 3);
  assert.equal(s.pairs.bars.need, 3);
});

test('an empty palette gives nothing; a single colour still gives a whole page', () => {
  assert.equal(scene([], 'light'), null);
  for (const mode of MODES) {
    const s = must(scene([sw('Only', [0.6, 0.15, 30])], mode));
    assert.equal(s.page.name, 'Only');
    assert.equal(s.text.swatchId, null);
    for (const p of Object.values(s.pairs)) assert.ok(Number.isFinite(p.ratio));
  }
});

test('the fixture palettes resolve to finite colours and ratios in both versions', () => {
  for (const file of ['chalk_palette.ase', 'glossy-pastic_palette.ase']) {
    const bytes = new Uint8Array(readFileSync(new URL(`fixtures/${file}`, import.meta.url)));
    const { swatches } = readPaletteFile('ase', bytes, file);
    assert.ok(swatches.length > 2, file);
    for (const mode of MODES) {
      const s = must(scene(swatches, mode));
      const slots = [s.page, s.surface, s.line, s.text, s.muted, s.primary, s.onPrimary, s.accent, s.highlight, s.onHighlight, ...Object.values(s.status).flatMap((x) => [x.fill, x.ink])];
      for (const sl of slots) assert.ok(sl.oklch.every(Number.isFinite), `${file} ${mode} ${sl.name}`);
      for (const p of Object.values(s.pairs)) assert.ok(p.ratio >= 1 && p.ratio <= 21, `${file} ${mode}`);
    }
  }
});
