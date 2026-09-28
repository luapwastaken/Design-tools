import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comboOf, fieldOwnsUndo, isTextField, keyOf, type KeyLike, matches, parseCombo, shellKey, toolMayTake } from '../src/renderer/shell/core/keys.ts';

const key = (k: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, code, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
const ctrl = (k: string, code: string, mods: Partial<KeyLike> = {}) => comboOf(key(k, code, { ctrlKey: true, ...mods }));

test('keys are named by what they are, not what Shift makes them type', () => {
  assert.equal(keyOf({ key: '!', code: 'Digit1' }), '1');
  assert.equal(keyOf({ key: 'z', code: 'KeyZ' }), 'Z');
  assert.equal(keyOf({ key: 'Z', code: 'KeyZ' }), 'Z');
  // a QWERTZ keyboard: the key labelled Z sits where KeyY is, and still means Z
  assert.equal(keyOf({ key: 'z', code: 'KeyY' }), 'Z');
  assert.equal(keyOf({ key: ' ', code: 'Space' }), 'SPACE');
  assert.equal(keyOf({ key: 'Delete', code: 'Delete' }), 'DELETE');
  assert.equal(keyOf({ key: ',', code: 'Comma' }), ',');
});

test('shortcut strings parse', () => {
  assert.deepEqual(parseCombo('Ctrl+Alt+0'), { ctrl: true, alt: true, shift: false, key: '0' });
  assert.deepEqual(parseCombo('I'), { ctrl: false, alt: false, shift: false, key: 'I' });
  assert.deepEqual(parseCombo('Shift+Delete'), { ctrl: false, alt: false, shift: true, key: 'DELETE' });
  assert.deepEqual(parseCombo('Ctrl++'), { ctrl: true, alt: false, shift: false, key: '+' });
  assert.deepEqual(parseCombo('Ctrl+='), { ctrl: true, alt: false, shift: false, key: '=' });
  assert.deepEqual(parseCombo('Del'), { ctrl: false, alt: false, shift: false, key: 'DELETE' });
  assert.deepEqual(parseCombo('Space'), { ctrl: false, alt: false, shift: false, key: 'SPACE' });
  assert.equal(parseCombo('Hyper+K'), null);
  assert.equal(parseCombo(''), null);
});

test('a shortcut matches only its exact modifiers', () => {
  assert.equal(matches('Ctrl+Alt+0', ctrl('0', 'Digit0', { altKey: true })), true);
  assert.equal(matches('Ctrl+0', ctrl('0', 'Digit0', { altKey: true })), false);
  assert.equal(matches('I', comboOf(key('i', 'KeyI'))), true);
  assert.equal(matches('I', comboOf(key('I', 'KeyI', { shiftKey: true }))), false);
  assert.equal(matches('Shift+Delete', comboOf(key('Delete', 'Delete', { shiftKey: true }))), true);
  assert.equal(matches('Ctrl+Shift+1', ctrl('!', 'Digit1', { shiftKey: true })), true);
});

test('the shell keys', () => {
  assert.deepEqual(shellKey(ctrl('1', 'Digit1')), { t: 'tool', n: 1 });
  assert.deepEqual(shellKey(ctrl('7', 'Digit7')), { t: 'tool', n: 7 });
  assert.equal(shellKey(ctrl('0', 'Digit0')), null); // Ctrl+0 is a Viewport's Fit
  assert.equal(shellKey(ctrl('!', 'Digit1', { shiftKey: true })), null);
  assert.deepEqual(shellKey(ctrl('l', 'KeyL')), { t: 'library' });
  assert.deepEqual(shellKey(ctrl(',', 'Comma')), { t: 'settings' });
  assert.deepEqual(shellKey(ctrl('z', 'KeyZ')), { t: 'undo' });
  assert.deepEqual(shellKey(ctrl('Z', 'KeyZ', { shiftKey: true })), { t: 'redo' });
  assert.deepEqual(shellKey(ctrl('y', 'KeyY')), { t: 'redo' });
  assert.deepEqual(shellKey(comboOf(key('F6', 'F6'))), { t: 'region', back: false });
  assert.deepEqual(shellKey(comboOf(key('F6', 'F6', { shiftKey: true }))), { t: 'region', back: true });
  // AltGr arrives as Ctrl+Alt: never a shell key
  assert.equal(shellKey(ctrl('z', 'KeyZ', { altKey: true })), null);
  assert.equal(shellKey(comboOf(key('z', 'KeyZ'))), null);
  assert.equal(shellKey(comboOf(key('Tab', 'Tab'))), null);
});

test('Tab is never a tool shortcut; text fields keep bare keys, Space and editing keys', () => {
  const tab = comboOf(key('Tab', 'Tab'));
  assert.equal(toolMayTake(tab, false), false);
  assert.equal(toolMayTake(comboOf(key('Tab', 'Tab', { shiftKey: true })), false), false);
  assert.equal(toolMayTake(comboOf(key('i', 'KeyI')), false), true);
  assert.equal(toolMayTake(comboOf(key('i', 'KeyI')), true), false);
  assert.equal(toolMayTake(comboOf(key('I', 'KeyI', { shiftKey: true })), true), false);
  assert.equal(toolMayTake(comboOf(key(' ', 'Space')), true), false);
  assert.equal(toolMayTake(ctrl('c', 'KeyC'), true), false);
  assert.equal(toolMayTake(ctrl('v', 'KeyV'), true), false);
  assert.equal(toolMayTake(ctrl('x', 'KeyX'), true), false);
  assert.equal(toolMayTake(ctrl('ArrowLeft', 'ArrowLeft', { shiftKey: true }), true), false);
  assert.equal(toolMayTake(ctrl('0', 'Digit0', { altKey: true }), true), true);
  assert.equal(toolMayTake(ctrl('c', 'KeyC'), false), true);
});

test('text fields, and who owns Ctrl+Z', () => {
  const input = (type: string | undefined, dirty?: string) => ({ tagName: 'INPUT', type, dataset: dirty ? { dirty } : {} });
  assert.equal(isTextField(input('text')), true);
  assert.equal(isTextField(input(undefined)), true);
  assert.equal(isTextField(input('search')), true);
  assert.equal(isTextField(input('checkbox')), false);
  assert.equal(isTextField(input('range')), false);
  assert.equal(isTextField({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTextField({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTextField({ tagName: 'BUTTON' }), false);
  assert.equal(isTextField(null), false);

  assert.equal(fieldOwnsUndo(input('text', 'true')), true); // an uncommitted edit: native undo
  assert.equal(fieldOwnsUndo(input('text')), false); // nothing typed: the tool's history
  assert.equal(fieldOwnsUndo({ tagName: 'TEXTAREA' }), true);
  assert.equal(fieldOwnsUndo({ tagName: 'BUTTON' }), false);
  assert.equal(fieldOwnsUndo(null), false);
});
