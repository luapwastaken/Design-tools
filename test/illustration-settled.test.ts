import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settledWithin, type SaveState } from '../src/renderer/tools/illustration/settled.ts';

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** a stand-in for the hook's refs: `change()` is soon(), `save(ms)` is the write the debounce starts */
function fake() {
  let unsaved = false;
  let saving: Promise<void> = Promise.resolve();
  const state: SaveState = { unsaved: () => unsaved, saving: () => saving };
  return {
    state,
    change: () => void (unsaved = true),
    save(ms: number) {
      unsaved = false;
      return (saving = saving.then(() => wait(ms)));
    },
  };
}

test('with nothing waiting and nothing under way it is settled at once', async () => {
  const t0 = Date.now();
  assert.equal(await settledWithin(fake().state, 5000), true);
  assert.ok(Date.now() - t0 < 2000);
});

test('a save under way is waited for, however long it takes', async () => {
  const f = fake();
  f.change();
  f.save(300);
  const t0 = Date.now();
  assert.equal(await settledWithin(f.state, 5000), true);
  assert.ok(Date.now() - t0 >= 250, 'it did not return before the write landed');
});

test('a change still in its debounce is waited for, and then its save', async () => {
  const f = fake();
  f.change();
  setTimeout(() => f.save(100), 150); // the debounce fires, the write starts
  const t0 = Date.now();
  assert.equal(await settledWithin(f.state, 5000), true);
  assert.ok(Date.now() - t0 >= 220, 'not before the debounce and the write both finished');
});

test('a save queued while another runs is waited for too', async () => {
  const f = fake();
  f.change();
  f.save(150);
  setTimeout(() => (f.change(), f.save(150)), 50);
  const t0 = Date.now();
  assert.equal(await settledWithin(f.state, 5000), true);
  assert.ok(Date.now() - t0 >= 280, 'both writes, one after the other');
});

test('a save that never lands is reported as not settled, at the limit', async () => {
  const hung: SaveState = { unsaved: () => false, saving: () => new Promise<void>(() => {}) };
  const t0 = Date.now();
  assert.equal(await settledWithin(hung, 200), false);
  assert.ok(Date.now() - t0 < 3000);
});

test('a change that is never saved is reported as not settled, at the limit', async () => {
  const f = fake();
  f.change();
  assert.equal(await settledWithin(f.state, 150), false);
});
