import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocController } from '../src/shared/doc.ts';
import { comboOf, isLive, keysOf, matches, parseCombo } from '../src/renderer/shell/core/keys.ts';
import type { Shortcut } from '../src/renderer/shell/tool.ts';
import type { DitherDoc, Source } from '../src/renderer/tools/dither/doc.ts';
import { emptyDoc } from '../src/renderer/tools/dither/looks.ts';
import { nextPixel, playhead } from '../src/renderer/tools/dither/steps.ts';
import { ditherShortcuts } from '../src/renderer/tools/dither/keys.ts';

// copyOff() reads the page's selection and focus; here there is neither
Object.assign(globalThis, { window: { getSelection: () => null }, document: { activeElement: null } });

const src = (frames: number): Source => ({ assets: ['dt://asset/dither/x.png'], name: 'x', w: 8, h: 8, fps: frames > 1 ? 10 : null, delays: null, frames });
const make = (d: Partial<DitherDoc> = {}) => createDocController<DitherDoc>('dither', { ...emptyDoc(), ...d }, { strict: true });
const rows = (d: Partial<DitherDoc> = {}) => {
  const doc = make(d);
  return { doc, list: ditherShortcuts(doc, () => {}, () => {}) };
};
const row = (list: Shortcut[], label: string) => list.find((r) => r.label === label)!;
const press = (list: Shortcut[], key: string, mods: Partial<{ ctrl: boolean; shift: boolean }> = {}) => {
  const c = comboOf({ key, code: '', ctrlKey: !!mods.ctrl, altKey: false, shiftKey: !!mods.shift });
  return list.find((s) => isLive(s) && keysOf(s).some((k) => matches(k, c)));
};

const states: [string, Partial<DitherDoc>][] = [
  ['empty', {}],
  ['a still, an ordered algorithm', { source: src(1), algorithm: 'bayer4' }],
  ['a still, a seeded algorithm', { source: src(1), algorithm: 'random' }],
  ['an animation', { source: src(12), algorithm: 'random' }],
];

for (const [name, d] of states) {
  test(`no two live entries share a combo: ${name}`, () => {
    const seen = new Map<string, string>();
    for (const s of rows(d).list.filter(isLive))
      for (const k of keysOf(s)) {
        const c = parseCombo(k)!;
        const id = `${+c.ctrl}${+c.alt}${+c.shift}${c.key}`;
        assert.equal(seen.get(id), undefined, `${k} is on both ${seen.get(id)} and ${s.label}`);
        seen.set(id, s.label);
      }
  });
}

test('every row has a group; Space is shown but never matched, and Ctrl+V is not an entry', () => {
  const { list } = rows({ source: src(12) });
  assert.ok(list.every((r) => r.group));
  assert.deepEqual(row(list, 'Play / pause').shown, ['Space']);
  assert.equal(press(list, ' '), undefined);
  assert.equal(list.some((r) => keysOf(r).some((k) => /^(Ctrl\+V|Space)$/i.test(k))), false);
});

test('playback rows are always listed, off unless animated', () => {
  for (const label of ['Play / pause', 'Previous frame', 'Next frame', '10 frames back', '10 frames forward']) {
    assert.equal(row(rows({ source: src(1) }).list, label).off, true, label);
    assert.equal(row(rows({ source: src(12) }).list, label).off, false, label);
  }
});

test('K plays; the arrows step one frame and Shift ten, wrapping, and each pauses', () => {
  const { list } = rows({ source: src(12) });
  playhead.set({ frame: 0, playing: false });
  press(list, 'k')!.run!();
  assert.equal(playhead.get().playing, true);
  press(list, 'ArrowRight')!.run!();
  assert.deepEqual(playhead.get(), { frame: 1, playing: false });
  press(list, 'ArrowLeft', { shift: true })!.run!();
  assert.equal(playhead.get().frame, 3);
  press(list, 'ArrowRight', { shift: true })!.run!();
  assert.equal(playhead.get().frame, 1);
});

test(', and . step the pixel size through the picks, [ and ] on a US keyboard', () => {
  const { doc, list } = rows({ source: src(1), pixel: 2 });
  press(list, '.')!.run!();
  assert.equal(doc.get().pixel, 4);
  press(list, ']')!.run!();
  assert.equal(doc.get().pixel, 8);
  press(list, ']')!.run!();
  assert.equal(doc.get().pixel, 8);
  press(list, '[')!.run!();
  press(list, ',')!.run!();
  assert.equal(doc.get().pixel, 2);
  assert.equal(nextPixel(3, 1), 4);
  assert.equal(nextPixel(3, -1), 2);
  assert.equal(nextPixel(12, 1), null);
  assert.equal(nextPixel(1, -1), null);
});

test('R makes a new seed, and is off where the algorithm has none', () => {
  assert.equal(row(rows({ source: src(1), algorithm: 'bayer4' }).list, 'New seed').off, true);
  const { doc, list } = rows({ source: src(1), algorithm: 'random', seed: 5 });
  assert.equal(row(list, 'New seed').off, false);
  press(list, 'r')!.run!();
  assert.notEqual(doc.get().seed, 5);
});

test('Ctrl+Shift+C is off until a view can copy', () => {
  const r = row(rows({ source: src(1) }).list, 'Copy the PNG');
  assert.equal(r.off, true);
  assert.ok(r.run);
});
