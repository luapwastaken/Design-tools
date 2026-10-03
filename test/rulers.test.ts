import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ticks } from '../src/renderer/ui/rulers.ts';

const labels = (t: ReturnType<typeof ticks>) => t.filter((k) => k.label).map((k) => k.label);
const gaps = (t: ReturnType<typeof ticks>) => t.slice(1).map((k, i) => k.at - t[i].at);

test('mm at the board’s zoom: labels every 20, a tick every 2, the half-way tick at 10', () => {
  // 5.1 screen px per mm, content 0 at 273 px along a 1330 px ruler
  const t = ticks(1330, 273, 5.1, 'mm');
  assert.deepEqual(labels(t).slice(0, 4), ['-40', '-20', '0', '20']);
  const zero = t.findIndex((k) => k.label === '0');
  assert.equal(t[zero].at, 273);
  assert.deepEqual(t.slice(zero, zero + 6).map((k) => k.size), [2, 0, 0, 0, 0, 1]);
  for (const g of gaps(t)) assert.ok(Math.abs(g - 10.2) < 1e-9);
  // every tick is on the ruler
  assert.ok(t.every((k) => k.at >= 0 && k.at <= 1330));
});

test('labels stay apart and ticks stay readable at any zoom, in every unit', () => {
  for (const unit of ['mm', 'in', 'px'] as const) {
    for (let px = 0.001; px < 20000; px *= 1.37) {
      const t = ticks(1600, 211, px, unit);
      const lab = t.filter((k) => k.label);
      assert.ok(lab.length >= 1 || px > 1600, `${unit} ${px}: a label in view`);
      for (let i = 1; i < lab.length; i++) assert.ok(lab[i].at - lab[i - 1].at >= 64 - 1e-6, `${unit} ${px}: labels apart`);
      for (const g of gaps(t)) assert.ok(g >= 5 - 1e-6, `${unit} ${px}: ticks apart`);
      assert.ok(t.length < 400, `${unit} ${px}: bounded`);
    }
  }
});

test('inches halve below one and a px ruler never ticks between pixels', () => {
  const inch = ticks(700, 0, 100, 'in');
  assert.deepEqual(labels(inch).slice(0, 3), ['0', '1', '2']);
  assert.deepEqual(inch.slice(0, 9).map((k) => k.size), [2, 0, 0, 0, 1, 0, 0, 0, 2]);
  assert.deepEqual(labels(ticks(700, 0, 600, 'in')).slice(0, 3), ['0', '0.125', '0.25']);
  const zoomed = ticks(640, 0, 64, 'px');
  assert.deepEqual(labels(zoomed).slice(0, 3), ['0', '1', '2']);
  assert.ok(zoomed.every((k) => k.size === 2));
  assert.deepEqual(ticks(0, 0, 1, 'px'), []);
  assert.deepEqual(ticks(100, 0, 0, 'mm'), []);
});
