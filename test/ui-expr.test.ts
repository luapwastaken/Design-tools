// What a NumberField reads: arithmetic, units, and a hue wrapping round.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parseNumber } from '../src/renderer/ui/expr.ts';
import { wrapTo } from '../src/renderer/ui/scrub.ts';

test('numbers read as they always did', () => {
  assert.equal(evaluate('12'), 12);
  assert.equal(evaluate(' 0.5 '), 0.5);
  assert.equal(evaluate('.5'), 0.5);
  assert.equal(evaluate('5.'), 5);
  assert.equal(evaluate('1,5'), 1.5, 'a comma decimal');
  assert.equal(evaluate('1e3'), 1000);
  assert.equal(evaluate('-3'), -3);
  assert.equal(evaluate('+3'), 3);
});

test('+ - * / with the usual precedence, left to right', () => {
  assert.equal(evaluate('62+5'), 67);
  assert.equal(evaluate('0.2*0.8'), 0.2 * 0.8);
  assert.equal(evaluate('70/100'), 0.7);
  assert.equal(evaluate('2+3*4'), 14);
  assert.equal(evaluate('2*3+4'), 10);
  assert.equal(evaluate('10-4-3'), 3);
  assert.equal(evaluate('100/10/5'), 2);
  assert.equal(evaluate('8 / 4 * 2'), 4);
});

test('parentheses and a unary minus', () => {
  assert.equal(evaluate('(2+3)*4'), 20);
  assert.equal(evaluate('-(3+1)/2'), -2);
  assert.equal(evaluate('2*-3'), -6);
  assert.equal(evaluate('2--3'), 5);
  assert.equal(evaluate('--3'), 3);
  assert.equal(evaluate('((1+2)*(3+4))'), 21);
  assert.equal(evaluate('−5+2'), -3, 'a typographic minus');
  assert.equal(evaluate('6×7'), 42);
});

test('anything else is not a number', () => {
  for (const bad of ['', '  ', 'abc', '1+', '*2', '(1+2', '1+2)', '()', '2(3)', '1 2', '1/0', '0/0', '1..2', '1+a', '12px', 'Infinity', '0x10']) {
    assert.equal(evaluate(bad), null, `"${bad}"`);
  }
});

test('the field unit may follow, and arithmetic is read before it', () => {
  assert.equal(parseNumber('50%', '%'), 50);
  assert.equal(parseNumber('180 °', '°'), 180);
  assert.equal(parseNumber('62+5%', '%'), 67);
  assert.equal(parseNumber('50%'), null);
  assert.equal(parseNumber('abc', '%'), null);
});

test('a hue wraps round and stays put inside 0 to 360', () => {
  assert.equal(wrapTo(361, 0, 360), 1);
  assert.equal(wrapTo(-10, 0, 360), 350);
  assert.equal(wrapTo(0, 0, 360), 0);
  assert.equal(wrapTo(360, 0, 360), 360);
  assert.equal(wrapTo(720.5, 0, 360), 0.5);
  assert.equal(wrapTo(-370, 0, 360), 350);
  assert.equal(wrapTo(-1, 0, 360), 359);
});
