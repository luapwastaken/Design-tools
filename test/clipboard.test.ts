// src/shared/clipboard.ts: the formats each kind of Copy writes, what it refuses, and the fall back
// to the plain set when the clipboard won't take the full one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyWith, entriesFor, PNG_FORMAT, SVG_FORMAT, type Entries } from '../src/shared/clipboard.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="4" height="8"/></svg>';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

test('an SVG goes on as its markup (text) and as the registered image/svg+xml format, then as text alone', () => {
  const [full, plain] = entriesFor({ kind: 'svg', data: SVG });
  assert.deepEqual(Object.keys(full).sort(), ['text/plain', SVG_FORMAT].sort());
  assert.equal(full['text/plain'], SVG);
  assert.equal(full[SVG_FORMAT], SVG);
  assert.deepEqual(plain, { 'text/plain': SVG });
});

test('the raw SVG key names the registered format the way Electron reads it', () => {
  assert.equal(SVG_FORMAT, 'electron application/osclipboard;format="image/svg+xml"');
  assert.equal(PNG_FORMAT, 'electron application/osclipboard;format="PNG"');
});

test('a PNG goes on as the registered PNG format and as a bitmap, the same bytes, then as the bitmap alone', () => {
  const [full, plain] = entriesFor({ kind: 'png', data: PNG.buffer });
  assert.deepEqual(Object.keys(full).sort(), ['image/png', PNG_FORMAT].sort());
  assert.deepEqual(full[PNG_FORMAT], PNG);
  assert.deepEqual(full['image/png'], PNG);
  assert.deepEqual(Object.keys(plain), ['image/png']);
});

test('what is not an SVG or a PNG is refused before anything is written', () => {
  for (const data of ['', 'hello', '<svgx/>', '<html></html>']) assert.throws(() => entriesFor({ kind: 'svg', data }), /not SVG/);
  assert.throws(() => entriesFor({ kind: 'png', data: new ArrayBuffer(0) }), /not a PNG/);
  assert.throws(() => entriesFor({ kind: 'png', data: new TextEncoder().encode('<svg></svg>').buffer }), /not a PNG/);
});

test('markup with a prolog, a comment or a different case still counts as SVG', () => {
  assert.doesNotThrow(() => entriesFor({ kind: 'svg', data: `<?xml version="1.0"?><!-- made by --><SVG viewBox="0 0 1 1"></SVG>` }));
});

test('the full set is written once, and nothing else when it is taken', async () => {
  const written: Entries[] = [];
  await copyWith(async (e) => void written.push(e), { kind: 'svg', data: SVG });
  assert.equal(written.length, 1);
  assert.ok(SVG_FORMAT in written[0]);
});

test('a refused full set falls back to the plain one, and the refusal is reported', async () => {
  const written: Entries[] = [];
  const refused: unknown[] = [];
  const write = async (e: Entries) => {
    if (PNG_FORMAT in e) throw new Error('no such format');
    written.push(e);
  };
  await copyWith(write, { kind: 'png', data: PNG.buffer }, (e) => refused.push(e));
  assert.deepEqual(written.map((e) => Object.keys(e)), [['image/png']]);
  assert.equal(refused.length, 1);
});

test('when every set is refused it says so in plain words', async () => {
  let tries = 0;
  await assert.rejects(
    copyWith(async () => { tries++; throw new Error('busy'); }, { kind: 'svg', data: SVG }),
    /wouldn't take it/,
  );
  assert.equal(tries, 2);
});
