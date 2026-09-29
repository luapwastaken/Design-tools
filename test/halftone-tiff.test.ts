import { test } from 'node:test';
import assert from 'node:assert/strict';
import UTIF from 'utif2';
import { stochastic, writeTiff } from '../src/shared/halftone/index.ts';

const read = (file: Uint8Array) => {
  const buf = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  const [ifd, ...more] = UTIF.decode(buf);
  UTIF.decodeImage(buf, ifd);
  return { ifd, more, rgba: UTIF.toRGBA8(ifd) };
};
const tag = (ifd: Record<string, unknown>, n: number) => (ifd[`t${n}`] as number[])[0];
/** utif2 gives rationals as [numerator, denominator] pairs */
const rational = (ifd: Record<string, unknown>, n: number) => {
  const [[num, den]] = ifd[`t${n}`] as [number, number][];
  return num / den;
};

test('an 8-bit plate reads back with its size, resolution and every grey', () => {
  const [w, h] = [37, 23];
  const grey = Uint8Array.from({ length: w * h }, (_, i) => (i * 7) % 256);
  const { ifd, more, rgba } = read(writeTiff(grey, w, h, 300, 8));
  assert.equal(more.length, 0);
  assert.equal(ifd.width, w);
  assert.equal(ifd.height, h);
  assert.equal(tag(ifd, 258), 8);
  assert.equal(tag(ifd, 259), 1, 'uncompressed');
  assert.equal(tag(ifd, 262), 1, 'black is zero');
  assert.equal(rational(ifd, 282), 300);
  assert.equal(rational(ifd, 283), 300);
  assert.equal(tag(ifd, 296), 2, 'per inch');
  for (let p = 0; p < w * h; p++) assert.deepEqual([...rgba.subarray(p * 4, p * 4 + 4)], [grey[p], grey[p], grey[p], 255]);
});

test('a 1-bit plate packs its rows and prints black below 128', () => {
  const [w, h] = [13, 5]; // rows that end mid-byte
  const grey = Uint8Array.from({ length: w * h }, (_, i) => ((i * 31) % 7 < 3 ? 0 : 255));
  grey[3] = 127;
  grey[4] = 128;
  const { ifd, rgba } = read(writeTiff(grey, w, h, 600, 1));
  assert.equal(tag(ifd, 258), 1);
  assert.equal(rational(ifd, 282), 600);
  for (let p = 0; p < w * h; p++) assert.equal(rgba[p * 4], grey[p] < 128 ? 0 : 255, `pixel ${p}`);
});

test('a fractional DPI survives as a rational', () => {
  const { ifd } = read(writeTiff(new Uint8Array(4), 2, 2, 254.5, 8));
  assert.equal(rational(ifd, 282), 254.5);
});

test('a stochastic plate goes straight into a bilevel TIFF', () => {
  const [w, h] = [120, 80];
  const plate = new Float32Array(w * h).fill(0.25);
  const screened = stochastic(plate, w, h, 5);
  const { rgba } = read(writeTiff(screened, w, h, 1200, 1));
  let ink = 0;
  for (let p = 0; p < w * h; p++) ink += rgba[p * 4] === 0 ? 1 : 0;
  assert.ok(Math.abs(ink / (w * h) - 0.25) < 0.01);
});
