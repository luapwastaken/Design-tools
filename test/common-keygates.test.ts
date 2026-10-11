import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrowsAreMine, copyIsNative } from '../src/renderer/tools/common/keyGates.ts';

test('Ctrl+C is the page\'s while text is selected or a text field has focus', () => {
  assert.equal(copyIsNative('', null), false);
  assert.equal(copyIsNative('', { tagName: 'BUTTON' }), false);
  assert.equal(copyIsNative('some words', { tagName: 'BUTTON' }), true);
  assert.equal(copyIsNative('', { tagName: 'INPUT', type: 'text' }), true);
  assert.equal(copyIsNative('', { tagName: 'TEXTAREA' }), true);
  assert.equal(copyIsNative('', { tagName: 'INPUT', type: 'range' }), false);
});

test('the arrows are the tool\'s on the body or inside its view, not in the rail or a panel', () => {
  const body = { closest: () => null };
  const at = (...inside: string[]) => ({ closest: (s: string) => (inside.some((i) => s.includes(i) || i === s) ? {} : null) });
  assert.equal(arrowsAreMine('logo', null, body), true);
  assert.equal(arrowsAreMine('logo', body, body), true);
  assert.equal(arrowsAreMine('logo', at(), body), false);
  assert.equal(arrowsAreMine('logo', at('[data-tool="logo"]'), body), true);
  assert.equal(arrowsAreMine('logo', at('[data-tool="post"]'), body), false);
  assert.equal(arrowsAreMine('logo', at('[data-tool="logo"]'), body, '[data-board]'), false);
  assert.equal(arrowsAreMine('logo', at('[data-tool="logo"]', '[data-board]'), body, '[data-board]'), true);
});
