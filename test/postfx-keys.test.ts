import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboOf, isLive, keysOf, matches, parseCombo } from '../src/renderer/shell/core/keys.ts';
import type { Shortcut } from '../src/renderer/shell/tool.ts';
import { emptyDoc, layerOf, type PostFxDoc, type Source } from '../src/renderer/tools/postfx/doc.ts';
import { postfxKeys, type Acts } from '../src/renderer/tools/postfx/keys.ts';

const src = (kind: Source['kind'], frames: number | null): Source => ({ asset: 'dt://asset/postfx/x.png', name: 'x', kind, w: 8, h: 8, fps: frames ? 10 : null, frames, delays: null });
const doc = (d: Partial<PostFxDoc> = {}): PostFxDoc => ({ ...emptyDoc(), ...d });
const three = () => [layerOf('grade'), layerOf('grain'), layerOf('bloom')];

/** the keys for a doc, with every action logged as 'name:arg' */
function rows(d: PostFxDoc, over: Partial<Acts> = {}) {
  const log: string[] = [];
  const note = (n: string) => (x?: unknown) => void log.push(x === undefined ? n : `${n}:${x}`);
  const acts: Acts = {
    selected: d.stack[1]?.id ?? null,
    free: true,
    copy: note('copy'),
    open: note('open'),
    original: note('original'),
    select: note('select'),
    move: (id, to) => log.push(`move:${id}:${to}`),
    toggle: note('toggle'),
    duplicate: note('duplicate'),
    arm: note('arm'),
    step: note('step'),
    play: note('play'),
    ...over,
  };
  return { list: postfxKeys(d, acts), log };
}
const row = (list: Shortcut[], label: string) => list.find((r) => r.label === label)!;
const press = (list: Shortcut[], key: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) => {
  const c = comboOf({ key, code: '', ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift });
  return list.find((s) => isLive(s) && keysOf(s).some((k) => matches(k, c)));
};

const states: [string, PostFxDoc][] = [
  ['empty', doc()],
  ['a still with a stack', doc({ source: src('image', null), stack: three() })],
  ['a clip', doc({ source: src('video', 90), stack: three() })],
];

for (const [name, d] of states) {
  test(`no two live entries share a combo: ${name}`, () => {
    const seen = new Map<string, string>();
    for (const s of rows(d).list.filter(isLive))
      for (const k of keysOf(s)) {
        const c = parseCombo(k)!;
        const id = `${+c.ctrl}${+c.alt}${+c.shift}${c.key}`;
        assert.equal(seen.get(id), undefined, `${k} is on both "${seen.get(id)}" and "${s.label}"`);
        seen.set(id, s.label);
      }
  });
}

test('every row has a group; the frame rows are always listed, off on a still and live on a clip', () => {
  const frames = ['Play / pause', 'Previous frame', 'Next frame', '10 frames back', '10 frames forward'];
  const still = rows(doc({ source: src('image', null), stack: [layerOf('grade')] })).list; // grain would loop it
  assert.ok(still.every((s) => s.group));
  for (const l of frames) {
    assert.equal(row(still, l).when, 'more than one frame');
    assert.equal(row(still, l).off, true);
  }
  assert.equal(press(still, 'ArrowLeft'), undefined);
  const clip = rows(doc({ source: src('video', 90) })).list;
  for (const l of frames) assert.equal(row(clip, l).off, false, l);
});

test('Space is only printed, never a live entry; K plays', () => {
  const { list, log } = rows(doc({ source: src('video', 90) }));
  const k = row(list, 'Play / pause');
  assert.deepEqual(k.shown, ['Space']);
  assert.equal(press(list, ' '), undefined);
  assert.equal(press(list, 'k'), k);
  assert.ok(!list.some((s) => keysOf(s).some((x) => /^space$/i.test(x) || /^ctrl\+v$/i.test(x))));
  k.run!();
  assert.deepEqual(log, ['play']);
});

test('arrows and Shift and an arrow step the frame by 1 and 10', () => {
  const { list, log } = rows(doc({ source: src('video', 90) }));
  press(list, 'ArrowRight')!.run!();
  press(list, 'ArrowLeft')!.run!();
  press(list, 'ArrowRight', { shift: true })!.run!();
  press(list, 'ArrowLeft', { shift: true })!.run!();
  assert.deepEqual(log, ['step:1', 'step:-1', 'step:10', 'step:-10']);
});

test('arrows choose a layer, Alt and an arrow move it, Ctrl+Shift+H hides it, Delete or Backspace arms the confirm', () => {
  const d = doc({ source: src('image', null), stack: three() });
  const [a, b, c] = d.stack.map((l) => l.id);
  const { list, log } = rows(d);
  press(list, 'ArrowUp')!.run!();
  press(list, 'ArrowDown')!.run!();
  press(list, 'ArrowUp', { alt: true })!.run!();
  press(list, 'ArrowDown', { alt: true })!.run!();
  press(list, 'h', { ctrl: true, shift: true })!.run!();
  press(list, 'd', { ctrl: true })!.run!();
  assert.equal(press(list, 'Delete'), press(list, 'Backspace'));
  press(list, 'Backspace')!.run!();
  assert.deepEqual(log, [`select:${a}`, `select:${c}`, `move:${b}:0`, `move:${b}:3`, `toggle:${b}`, `duplicate:${b}`, `arm:${b}`]);
});

test('the arrows stop at the ends of the stack', () => {
  const d = doc({ source: src('image', null), stack: three() });
  const [a, , c] = d.stack.map((l) => l.id);
  const top = rows(d, { selected: a });
  press(top.list, 'ArrowUp')!.run!();
  const bottom = rows(d, { selected: c });
  press(bottom.list, 'ArrowDown')!.run!();
  assert.deepEqual([...top.log, ...bottom.log], [`select:${a}`, `select:${c}`]);
  // Alt+arrow is off at the ends, not a wrong reorder or an empty undo step
  assert.equal(press(top.list, 'ArrowUp', { alt: true }), undefined);
  assert.equal(press(bottom.list, 'ArrowDown', { alt: true }), undefined);
  assert.ok(press(top.list, 'ArrowDown', { alt: true }) && press(bottom.list, 'ArrowUp', { alt: true }));
});

test('layer rows are listed but off without a selection, and the arrows off while focus is in the rail', () => {
  const none = rows(doc({ source: src('image', null) })).list;
  for (const l of ['Previous layer', 'Next layer', 'Move the layer up', 'Move the layer down', 'Show or hide the layer', 'Duplicate the layer', 'Delete the layer (asks first)']) assert.equal(row(none, l).off, true, l);
  assert.equal(press(none, 'Delete'), undefined);
  const held = rows(doc({ source: src('image', null), stack: three() }), { free: false }).list;
  for (const l of ['Previous layer', 'Next layer', 'Move the layer up', 'Move the layer down', 'Delete the layer (asks first)']) assert.equal(row(held, l).off, true, l);
  assert.equal(row(held, 'Duplicate the layer').off, false, 'Ctrl+D is no arrow');
});

test('Ctrl+Shift+C copies the PNG, and is off until the view offers it', () => {
  const on = rows(doc());
  press(on.list, 'c', { ctrl: true, shift: true })!.run!();
  assert.deepEqual(on.log, ['copy']);
  const off = rows(doc(), { copy: null }).list;
  assert.equal(row(off, 'Copy the PNG').off, true);
  assert.equal(press(off, 'c', { ctrl: true, shift: true }), undefined);
});

test('Y and Ctrl+O stay live', () => {
  const { list, log } = rows(doc());
  press(list, 'y')!.run!();
  press(list, '\\')!.run!();
  press(list, 'o', { ctrl: true })!.run!();
  assert.deepEqual(log, ['original', 'original', 'open']);
});
