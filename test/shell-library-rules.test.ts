import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveNeedsConfirm } from '../src/renderer/shell/library/rules.ts';
import { PROOFS } from '../src/renderer/tools/illustration/proof.ts';
import { VISION_NAME } from '../src/renderer/tools/common/vision-names.ts';

test('a move between unlocked collections needs no confirm; a lock on either side asks', () => {
  assert.equal(moveNeedsConfirm(false, false), false);
  assert.equal(moveNeedsConfirm(true, false), true);
  assert.equal(moveNeedsConfirm(false, true), true);
  assert.equal(moveNeedsConfirm(true, true), true);
});

test('Seen as names each colour vision the way the Colour vision check does', () => {
  assert.deepEqual(PROOFS.filter((p) => p.value !== 'off').map((p) => p.label).sort(), [VISION_NAME.achromat, VISION_NAME.deutan, VISION_NAME.protan, VISION_NAME.tritan].sort());
  assert.ok(PROOFS.every((p) => !/opia$/.test(p.label)));
  assert.equal(PROOFS[0].label, 'Off');
});
