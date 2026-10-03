import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asZoom, clampView, fitView, MAX_SCALE, MIN_SCALE, originOf, panBy, snapScale, stepScale, toContent, wheelFactor, zoomAt, zoomKey } from '../src/renderer/ui/viewport.ts';
import type { KeyLike } from '../src/renderer/shell/core/keys.ts';

const box = { w: 800, h: 600 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('Fit centres the content with pasteboard around it, and shrinks or enlarges to fill', () => {
  const v = fitView({ w: 1600, h: 400 }, box);
  near(v.scale, (800 - 48) / 1600);
  assert.deepEqual([v.x, v.y], [800, 200]);
  const o = originOf(v, box);
  near(o.x, 24);
  assert.equal(fitView({ w: 100, h: 100 }, box).scale, (600 - 48) / 100);
  // a zero-size content or view never divides by zero
  assert.ok(Number.isFinite(fitView({ w: 0, h: 0 }, box).scale));
  assert.ok(fitView({ w: 1e9, h: 1 }, box).scale >= MIN_SCALE);
});

test('on a pixel grid, zoom lands where each cell is a whole number of device pixels', () => {
  // Dither at 2 px blocks: Fit at 65.6% would draw blocks 1 or 2 screen pixels wide
  near(snapScale(0.656, 2, 1, -1), 0.5);
  near(snapScale(2.1, 2, 1, 0), 2);
  near(snapScale(2.1, 2, 1, 1), 2.5);
  // at 125% display scaling a 2 px block at 100% is 2.5 device pixels: the nearest whole is 3
  near(snapScale(1, 2, 1.25, 0), 1.2);
  // below one device pixel a block the view smooths, so any zoom stands
  near(snapScale(0.3, 2, 1, -1), 0.3);
  // a step always moves: down from 1 device pixel a block goes below it, up from 2 goes to 3
  assert.ok(snapScale(stepScale(0.5, -1), 2, 1, -1) < 0.5);
  near(snapScale(stepScale(1, 1), 2, 1, 1), 1.5);
});

test('zooming keeps the content point under the pointer where it was', () => {
  const v = { scale: 0.5, x: 300, y: 200 };
  const at = { x: 610, y: 95 };
  const before = toContent(v, box, at);
  const z = zoomAt(v, 3, at, box);
  const after = toContent(z, box, at);
  near(after.x, before.x);
  near(after.y, before.y);
  assert.equal(zoomAt(v, 1000, at, box).scale, MAX_SCALE);
  assert.equal(zoomAt(v, 0, at, box).scale, MIN_SCALE);
});

test('panning moves the content with the pointer, and never loses it', () => {
  const v = { scale: 2, x: 100, y: 100 };
  const p = panBy(v, 40, -20);
  near(originOf(p, box).x - originOf(v, box).x, 40);
  near(originOf(p, box).y - originOf(v, box).y, -20);
  const content = { w: 200, h: 200 };
  // dragged far up and left, the content's right and bottom edges stay 48px inside the view
  const far = clampView(panBy(v, -1e6, -1e6), content, box);
  near(originOf(far, box).x + content.w * far.scale, 48);
  near(originOf(far, box).y + content.h * far.scale, 48);
  // and far down and right, its left and top edges
  const back = clampView(panBy(v, 1e6, 1e6), content, box);
  near(originOf(back, box).x, box.w - 48);
  near(originOf(back, box).y, box.h - 48);
  // inside the limits nothing moves
  assert.deepEqual(clampView(v, content, box), v);
});

test('zoom steps land on 100% and the familiar stops, and stop at the ends', () => {
  assert.equal(stepScale(0.9, 1), 1);
  assert.equal(stepScale(1, 1), 1.5);
  assert.equal(stepScale(1, -1), 2 / 3);
  assert.equal(stepScale(1.2, -1), 1);
  assert.equal(stepScale(MAX_SCALE, 1), MAX_SCALE);
  assert.equal(stepScale(MIN_SCALE, -1), MIN_SCALE);
});

test('a wheel notch zooms by about a fifth; a pinch by its own small deltas; one event never jumps more than 2x', () => {
  const notch = wheelFactor({ deltaY: 100, deltaMode: 0, ctrlKey: false });
  assert.ok(notch > 0.8 && notch < 0.85);
  assert.ok(wheelFactor({ deltaY: -100, deltaMode: 0, ctrlKey: false }) > 1.2);
  assert.ok(wheelFactor({ deltaY: -3, deltaMode: 1, ctrlKey: false }) > 1);
  near(wheelFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true }), Math.exp(0.1));
  assert.equal(wheelFactor({ deltaY: 1e5, deltaMode: 0, ctrlKey: false }), 0.5);
});

const key = (k: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, code, ctrlKey: true, altKey: false, shiftKey: false, ...mods });

test('the zoom keys', () => {
  assert.equal(zoomKey(key('0', 'Digit0')), 'fit');
  assert.equal(zoomKey(key('0', 'Numpad0')), 'fit');
  assert.equal(zoomKey(key('0', 'Digit0', { altKey: true })), 'actual');
  assert.equal(zoomKey(key('=', 'Equal')), 'in');
  assert.equal(zoomKey(key('+', 'Equal', { shiftKey: true })), 'in');
  assert.equal(zoomKey(key('+', 'NumpadAdd')), 'in');
  assert.equal(zoomKey(key('-', 'Minus')), 'out');
  assert.equal(zoomKey(key('-', 'NumpadSubtract')), 'out');
  // not ours: no Ctrl, Ctrl+Shift+0, and AltGr+0 (which types "}" on a German keyboard)
  assert.equal(zoomKey(key('0', 'Digit0', { ctrlKey: false })), null);
  assert.equal(zoomKey(key(')', 'Digit0', { shiftKey: true })), null);
  assert.equal(zoomKey(key('}', 'Digit0', { altKey: true }), true), null);
  assert.equal(zoomKey(key('1', 'Digit1')), null);
});

test('a saved zoom is read back, and anything odd is Fit', () => {
  assert.deepEqual(asZoom({ scale: 2, x: 10, y: -4, extra: 1 }), { scale: 2, x: 10, y: -4 });
  assert.equal(asZoom('fit'), 'fit');
  assert.equal(asZoom(undefined), 'fit');
  assert.equal(asZoom({ scale: 0, x: 0, y: 0 }), 'fit');
  assert.equal(asZoom({ scale: 1, x: Number.NaN, y: 0 }), 'fit');
  assert.equal(asZoom({ scale: '2', x: 0, y: 0 }), 'fit');
});
