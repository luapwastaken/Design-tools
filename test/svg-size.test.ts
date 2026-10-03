import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { framed, parseSize, toDataUrl } from '../src/shared/svg/index.ts';
import { getAttr, parseSvg, serialize } from '../src/shared/svg/xml.ts';

const svg = (attrs: string) => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><rect width="1" height="1"/></svg>`;
const near = (a: number[], b: number[]) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < 1e-9), `${a} ~ ${b}`);
const sized = (attrs: string) => {
  const s = parseSize(svg(attrs));
  return [...s.viewBox, s.width, s.height];
};

test('absolute units come out in CSS px, 96 per inch', () => {
  near(sized('width="1in" height="72pt"'), [0, 0, 96, 96, 96, 96]);
  near(sized('width="2.54cm" height="25.4mm"'), [0, 0, 96, 96, 96, 96]);
  near(sized('width="6pc" height="101.6Q"'), [0, 0, 96, 96, 96, 96]);
  near(sized('width="96px" height="48"'), [0, 0, 96, 48, 96, 48]);
  near(sized('width=" 1.5e2 " height="+.5in"'), [0, 0, 150, 48, 150, 48]);
});

test('without a viewBox the user space is px: width="100mm" is not 100 × 100 (the v1 bug)', () => {
  const k = 96 / 25.4;
  near(sized('width="100mm" height="50mm"'), [0, 0, 100 * k, 50 * k, 100 * k, 50 * k]);
});

test('the viewBox keeps its origin', () => {
  near(sized('viewBox="-50 -25 100 50"'), [-50, -25, 100, 50, 100, 50]);
  near(sized('viewBox="10,20,30,40"'), [10, 20, 30, 40, 30, 40]);
  near(sized('viewBox=" 10 20  30\n40 " width="60"'), [10, 20, 30, 40, 60, 80]);
});

test('a missing or relative size follows the viewBox', () => {
  near(sized('viewBox="0 0 200 100" width="100%" height="100%"'), [0, 0, 200, 100, 200, 100]);
  near(sized('viewBox="0 0 24 24" width="1em" height="1em"'), [0, 0, 24, 24, 24, 24]);
  near(sized('viewBox="0 0 200 100" width="300"'), [0, 0, 200, 100, 300, 150]);
  near(sized('viewBox="0 0 2 1" height="10mm"'), [0, 0, 2, 1, (20 * 96) / 25.4, (10 * 96) / 25.4]);
});

test('with neither, a browser shows 300 × 150; a broken viewBox counts as none', () => {
  near(sized(''), [0, 0, 300, 150, 300, 150]);
  near(sized('width="-5" height="0"'), [0, 0, 300, 150, 300, 150]);
  near(sized('viewBox="0 0 0 10" width="40" height="20"'), [0, 0, 40, 20, 40, 20]);
  near(sized('viewBox="0 0 10" width="40"'), [0, 0, 40, 150, 40, 150]);
});

test('an old Illustrator file in mm, with its DOCTYPE', () => {
  const s = parseSize(readFileSync(new URL('./fixtures/svg-illustrator-legacy.svg', import.meta.url), 'utf8'));
  near([...s.viewBox, s.width, s.height], [0, 0, 102.047, 51.023, (36 * 96) / 25.4, (18 * 96) / 25.4]);
});

test('framed draws a chosen box of user space at a chosen size, stretched', () => {
  const root = parseSvg(framed('<svg viewBox="0 0 10 10" width="5mm"><path d="M0 0h1"/></svg>', 200, 100, [2, 3, 4, 5]));
  assert.equal(getAttr(root, 'viewBox'), '2 3 4 5');
  assert.equal(getAttr(root, 'width'), '200');
  assert.equal(getAttr(root, 'height'), '100');
  assert.equal(getAttr(root, 'preserveAspectRatio'), 'none');
  assert.equal(getAttr(root, 'xmlns'), 'http://www.w3.org/2000/svg');
  // no viewBox of its own: one is made from its size, so a new size scales instead of cropping
  assert.equal(getAttr(parseSvg(framed('<svg width="1in" height="2in"/>', 10, 20)), 'viewBox'), '0 0 96 192');
});

test('toDataUrl round-trips the markup', () => {
  const s = svg('viewBox="0 0 1 1"').replace('<rect', '<text>#1 & 50% "a"</text><rect');
  const url = toDataUrl(s);
  assert.ok(url.startsWith('data:image/svg+xml;charset=utf-8,'));
  assert.doesNotMatch(url.slice(url.indexOf(',') + 1), /[#" <>]/);
  assert.equal(decodeURIComponent(url.slice(url.indexOf(',') + 1)), s);
});

test('the reader keeps what it does not understand as written', () => {
  const s = '<svg xmlns="http://www.w3.org/2000/svg"><text x=\'1\' data-q=\'say "hi"\'>a &amp; b &lt; c</text><style><![CDATA[a>b{}]]></style></svg>';
  assert.equal(serialize(parseSvg(s)), '<svg xmlns="http://www.w3.org/2000/svg"><text x="1" data-q="say &quot;hi&quot;">a &amp; b &lt; c</text><style><![CDATA[a>b{}]]></style></svg>');
  assert.equal(serialize(parseSvg('﻿<?xml version="1.0"?>\n<!-- c --><svg><!-- inner --><g/></svg>\n')), '<svg><g/></svg>');
});
