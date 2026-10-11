import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';

// the store reads the document's focus and nothing else of the page
Object.assign(globalThis, { document: { hasFocus: () => true } });
const { toast, toastStore, MAX_SHOWN, LEAVE_MS } = await import('../src/renderer/ui/toast.ts');

const shown = () => toastStore.get().filter((t) => !t.leaving);
/** time passes; a toast that closed in it has then left, a step later (a timer a tick starts runs in the next tick) */
const wait = (ms: number) => {
  mock.timers.tick(ms);
  mock.timers.tick(LEAVE_MS + 1);
};

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => {
  for (const t of toastStore.get()) toast.dismiss(t.id);
  mock.timers.tick(LEAVE_MS + 1);
  mock.timers.reset();
});

test('an error toast goes after 8 seconds, not never', () => {
  const id = toast.show({ kind: 'error', message: 'A file could not be read.' });
  mock.timers.tick(7_900);
  assert.ok(shown().some((t) => t.id === id));
  wait(200);
  assert.ok(!toastStore.get().some((t) => t.id === id));
});

test('a plain notice goes after 5 seconds and one with Undo after 8', () => {
  const plain = toast.show({ message: 'Copied.' });
  const withUndo = toast.show({ message: 'Deleted it.', undo: () => {} });
  wait(5_100);
  assert.ok(!toastStore.get().some((t) => t.id === plain));
  assert.ok(toastStore.get().some((t) => t.id === withUndo));
  wait(3_000);
  assert.ok(!toastStore.get().some((t) => t.id === withUndo));
});

test('plain notices stack three deep: a fourth takes the oldest away', () => {
  const ids = ['one', 'two', 'three', 'four'].map((message) => toast.show({ message }));
  assert.equal(MAX_SHOWN, 3);
  assert.deepEqual(shown().map((t) => t.id), ids.slice(1));
});

test('errors and Undo toasts are not pushed out by plain notices', () => {
  const err = toast.show({ kind: 'error', message: 'Something failed.' });
  const undo = toast.show({ message: 'Deleted it.', undo: () => {} });
  for (const message of ['a', 'b', 'c', 'd']) toast.show({ message });
  const ids = shown().map((t) => t.id);
  assert.ok(ids.includes(err) && ids.includes(undo));
  assert.equal(shown().filter((t) => !t.undo && t.kind !== 'error').length, 3);
});
