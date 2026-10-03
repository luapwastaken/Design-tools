import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILT_INS, RECIPES } from '../src/renderer/tools/postfx/builtins.ts';
import { duplicateLayer, emptyDoc, fix, frameAt, isMoving, isStateful, layerOf, leadIn, LIMIT, moveLayer, offered, RUN_IN, runIn, startOf, timeline, type PostFxDoc, type Source } from '../src/renderer/tools/postfx/doc.ts';
import { effectOf } from '../src/renderer/tools/postfx/effects/index.ts';
import { decodeStack, encodeStack, layersFrom, PREFIX } from '../src/renderer/tools/postfx/share.ts';

const still: Source = { asset: 'dt://asset/postfx/a.png', name: 'a', kind: 'image', w: 640, h: 360, fps: null, frames: null, delays: null };
const clip: Source = { ...still, kind: 'video', fps: 30, frames: 90 };
const gif: Source = { ...still, kind: 'gif', fps: 10, frames: 3, delays: [100, 100, 250] };
const withStack = (source: Source | null, ...effects: Parameters<typeof layerOf>[0][]): PostFxDoc => ({ ...emptyDoc(), source, stack: effects.map((e) => layerOf(e)) });

test('a share code round-trips a stack: effects, order, hidden layers, opacity, blend and every value', () => {
  const d = withStack(still, 'grade', 'grain', 'bloom');
  d.stack[1] = { ...d.stack[1], on: false, opacity: 0.4, blend: 'screen', params: { ...d.stack[1].params, amount: 33 } };
  const code = encodeStack(d.stack);
  assert.ok(code.startsWith(PREFIX));
  assert.match(code.slice(PREFIX.length), /^[A-Za-z0-9_-]+$/, 'base64url, safe to paste anywhere');
  const back = decodeStack(code);
  assert.deepEqual(
    back.map(({ id: _, ...l }) => l),
    d.stack.map(({ id: _, ...l }) => l),
  );
  assert.ok(back.every((l, n) => l.id !== d.stack[n].id), 'a pasted stack makes its own ids');
});

test('a code with an effect this version lacks is refused in a sentence naming it, never half read', () => {
  const layers = [{ effect: 'grain', on: true, opacity: 1, blend: 'normal', params: {} }, { effect: 'droste', on: true, opacity: 1, blend: 'normal', params: {} }];
  const code = PREFIX + Buffer.from(JSON.stringify({ v: 2, layers })).toString('base64url');
  assert.throws(() => decodeStack(code), /“droste” \(layer 2\) that this version doesn’t have/);
});

test('old, damaged, foreign and newer codes each say what is wrong', () => {
  assert.throws(() => decodeStack('PFX1.eyJhIjoxfQ'), /old Post FX/);
  assert.throws(() => decodeStack('hello'), /starts with PFX2\./);
  assert.throws(() => decodeStack(`${PREFIX}%%%`), /cut short or damaged/);
  assert.throws(() => decodeStack(PREFIX + Buffer.from('{"v":9,"layers":[]}').toString('base64url')), /newer Design Tools/);
});

test('a code that holds no effects, or starts in lower case, is handled plainly', () => {
  const empty = PREFIX + Buffer.from(JSON.stringify({ v: 2, layers: [] })).toString('base64url');
  assert.throws(() => decodeStack(empty), /holds no effects/);
  const one = encodeStack([layerOf('grain')]);
  assert.equal(decodeStack(`pfx2.${one.slice(PREFIX.length)}`).length, 1, 'the prefix is read in either case');
  assert.throws(() => decodeStack(`xfp2.${one.slice(PREFIX.length)}`), /starts with PFX2\./);
});

test('values from outside are put back in range, missing ones take their defaults, odd blends go normal', () => {
  const [l] = layersFrom([{ effect: 'grain', opacity: 7, blend: 'dodge', params: { amount: 900, size: 'big', junk: 1 } }], 'This');
  assert.equal(l.opacity, 1);
  assert.equal(l.blend, 'normal');
  assert.equal(l.params.amount, 100);
  assert.equal(l.params.size, layerOf('grain').params.size);
  assert.equal('junk' in l.params, false);
  assert.equal(l.on, true);
  assert.throws(() => layersFrom(Array.from({ length: LIMIT.layers + 1 }, () => ({ effect: 'grain' })), 'This'), /up to 24/);
});

test('every built-in preset names only settings its effects have, and none needs a clip', () => {
  assert.ok(BUILT_INS.length >= 6);
  for (const r of RECIPES) {
    for (const l of r.layers) {
      const fx = effectOf(l.effect)!;
      assert.ok(fx, `${r.name}: ${l.effect}`);
      assert.ok(!fx.videoOnly, `${r.name} would do nothing on a still`);
      for (const key of Object.keys(l.params ?? {})) assert.ok(fx.params.some((p) => p.key === key), `${r.name}: ${l.effect} has no ${key}`);
    }
  }
  assert.equal(new Set(BUILT_INS.map((p) => p.name)).size, BUILT_INS.length);
});

test('a still with nothing moving is one frame; a moving effect makes it a loop of seconds × fps', () => {
  assert.equal(timeline(withStack(still, 'grade')).count, 1);
  assert.equal(timeline(withStack(still, 'grade')).kind, 'still');
  const moving = withStack(still, 'grain');
  assert.ok(isMoving(moving));
  const t = timeline({ ...moving, loop: { seconds: 2, fps: 25 } });
  assert.deepEqual([t.kind, t.count, t.seconds], ['loop', 50, 2]);
  assert.equal(t.phase(0), 0);
  assert.ok(t.phase(49) < 1, 'the last frame stops short of 1, so it runs into the first');
  const hidden = { ...moving, stack: moving.stack.map((l) => ({ ...l, on: false })) };
  assert.equal(timeline(hidden).count, 1, 'a hidden moving effect moves nothing');
});

test('a clip and a GIF are their own loop, whatever the loop settings say', () => {
  const t = timeline({ ...withStack(clip, 'grain'), loop: { seconds: 9, fps: 5 } });
  assert.deepEqual([t.kind, t.count, t.fps], ['video', 90, 30]);
  const g = timeline(withStack(gif));
  assert.deepEqual([g.kind, g.count, g.seconds], ['gif', 3, 0.45]);
  assert.equal(frameAt(g, 0.2), 2, 'a GIF keeps its own frame times');
  assert.equal(startOf(g, 2), 0.2);
});

test('the loop keeps to what the controls allow', () => {
  const loop = fix({ ...withStack(still, 'grain'), loop: { seconds: 40, fps: 400 } });
  assert.deepEqual(loop.loop, { seconds: LIMIT.seconds[1], fps: LIMIT.fps[1] });
});

test('reordering puts a layer before the slot it is dropped on, either way; a duplicate sits under its original', () => {
  const d = withStack(still, 'grade', 'grain', 'bloom', 'vignette');
  const ids = (x: PostFxDoc) => x.stack.map((l) => l.effect);
  assert.deepEqual(ids(moveLayer(d, 0, 2)), ['grain', 'grade', 'bloom', 'vignette']);
  assert.deepEqual(ids(moveLayer(d, 3, 0)), ['vignette', 'grade', 'grain', 'bloom']);
  const { doc, copy } = duplicateLayer(d, d.stack[1].id);
  assert.deepEqual(ids(doc), ['grade', 'grain', 'grain', 'bloom', 'vignette']);
  assert.notEqual(copy!.id, d.stack[1].id);
  assert.notEqual(copy!.params, d.stack[1].params, 'its settings are its own');
});

test('datamosh is offered on a clip only', () => {
  assert.equal(offered({ source: still }, 'datamosh'), false);
  assert.equal(offered({ source: gif }, 'datamosh'), false);
  assert.equal(offered({ source: clip }, 'datamosh'), true);
  assert.equal(offered({ source: still }, 'grain'), true);
});

test('datamosh is drawn after its run-in: the frames before it, or none when it has them', () => {
  assert.deepEqual(runIn(0), []);
  assert.deepEqual(runIn(3), [0, 1, 2]);
  assert.deepEqual(runIn(100), Array.from({ length: RUN_IN }, (_, k) => 70 + k));
  const mem = (f: number, run: number) => ({ f, run });
  assert.deepEqual(leadIn(100, [undefined]), runIn(100), 'a layer that has drawn nothing needs all of it');
  assert.deepEqual(leadIn(100, [mem(99, RUN_IN)]), [], 'one step on from a frame that had it');
  assert.deepEqual(leadIn(100, [mem(100, RUN_IN)]), [], 'the same frame again');
  assert.deepEqual(leadIn(100, [mem(99, 5)]), runIn(100), 'a run that began clean a few frames ago is not enough');
  assert.deepEqual(leadIn(100, [mem(40, 40)]), runIn(100), 'a seek');
  assert.deepEqual(leadIn(100, [mem(99, RUN_IN), undefined]), runIn(100), 'every layer has to have it');
  assert.deepEqual(leadIn(4, [mem(3, 3)]), [], 'near the start there are only so many before it');
  assert.deepEqual(leadIn(4, [mem(3, 0)]), runIn(4));
});

test('only a clip with datamosh drawing has frames to remember', () => {
  assert.equal(isStateful(withStack(clip, 'datamosh')), true);
  assert.equal(isStateful(withStack(clip, 'grain')), false);
  assert.equal(isStateful(withStack(still, 'grain')), false);
  const hidden = withStack(clip, 'datamosh');
  hidden.stack[0] = { ...hidden.stack[0], on: false };
  assert.equal(isStateful(hidden), false);
});
