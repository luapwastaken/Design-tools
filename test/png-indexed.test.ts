import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, inflateSync } from 'node:zlib';
import { encodeIndexedPng, type Rgba8 } from '../src/renderer/lib/png-indexed.ts';
import { budget } from './perf.ts';

async function chunks(blob: Blob) {
  const b = Buffer.from(await blob.arrayBuffer());
  assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const out: { type: string; data: Buffer; crcOk: boolean }[] = [];
  for (let at = 8; at < b.length; ) {
    const len = b.readUInt32BE(at);
    const data = b.subarray(at + 8, at + 8 + len);
    out.push({ type: b.toString('latin1', at + 4, at + 8), data, crcOk: b.readUInt32BE(at + 8 + len) === crc32(b.subarray(at + 4, at + 8 + len)) });
    at += 12 + len;
  }
  return out;
}

/** the indices back out of IDAT: inflate, check each row's filter byte is 0, unpack */
function pixels(list: Awaited<ReturnType<typeof chunks>>): { w: number; h: number; depth: number; px: number[] } {
  const ihdr = list.find((c) => c.type === 'IHDR')!.data;
  const [w, h, depth] = [ihdr.readUInt32BE(0), ihdr.readUInt32BE(4), ihdr[8]];
  assert.equal(ihdr[9], 3, 'colour type 3: palette');
  const raw = inflateSync(Buffer.concat(list.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = 1 + Math.ceil((w * depth) / 8);
  assert.equal(raw.length, stride * h);
  const px: number[] = [];
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * stride], 0);
    for (let x = 0; x < w; x++) {
      const bit = x * depth;
      px.push((raw[y * stride + 1 + (bit >> 3)] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1));
    }
  }
  return { w, h, depth, px };
}

const palette = (n: number): Rgba8[] => Array.from({ length: n }, (_, i) => [i, (i * 7) & 255, 255 - i] as const);
const random = (n: number, len: number, seed = 1) => Uint8Array.from({ length: len }, () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 16) % n);

test('an opaque palette gives IHDR, PLTE, IDAT, IEND with valid CRCs and PLTE holding the palette', async () => {
  const pal = palette(5);
  const list = await chunks(await encodeIndexedPng(random(5, 12), 4, 3, pal));
  assert.deepEqual(list.map((c) => c.type), ['IHDR', 'PLTE', 'IDAT', 'IEND']);
  assert.ok(list.every((c) => c.crcOk));
  assert.deepEqual([...list[1].data], pal.flatMap((c) => [c[0], c[1], c[2]]));
});

test('the smallest bit depth the palette allows, every pixel back as written, at widths that end mid-byte', async () => {
  for (const [n, depth] of [[1, 1], [2, 1], [3, 2], [4, 2], [5, 4], [16, 4], [17, 8], [256, 8]]) {
    for (const w of [1, 7, 13, 64]) {
      const h = 3;
      const indices = random(n, w * h, n * w);
      const got = pixels(await chunks(await encodeIndexedPng(indices, w, h, palette(n))));
      assert.equal(got.depth, depth, `${n} colours`);
      assert.deepEqual(got.px, [...indices], `${n} colours, ${w} px wide`);
    }
  }
});

test('scale makes every pixel an exact block: pixel size 8 is 8 px in the file', async () => {
  const [w, h, s] = [5, 3, 8];
  const indices = random(3, w * h);
  const got = pixels(await chunks(await encodeIndexedPng(indices, w, h, palette(3), { scale: s })));
  assert.deepEqual([got.w, got.h], [w * s, h * s]);
  for (let y = 0; y < h * s; y++) for (let x = 0; x < w * s; x++) assert.equal(got.px[y * w * s + x], indices[Math.floor(y / s) * w + Math.floor(x / s)]);
});

test('tRNS appears only when a colour is clear, and stops at the last entry that is not opaque', async () => {
  const pal: Rgba8[] = [[1, 1, 1], [2, 2, 2, 0], [3, 3, 3, 255], [4, 4, 4, 128], [5, 5, 5], [6, 6, 6, 255]];
  const list = await chunks(await encodeIndexedPng(random(6, 6), 3, 2, pal));
  assert.deepEqual(list.map((c) => c.type), ['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);
  assert.deepEqual([...list[2].data], [255, 0, 255, 128]);
  const opaque = await chunks(await encodeIndexedPng(random(2, 4), 2, 2, [[0, 0, 0, 255], [9, 9, 9, 255]]));
  assert.ok(!opaque.some((c) => c.type === 'tRNS'));
});

test('dpi is written as pHYs in pixels per metre, before PLTE and IDAT', async () => {
  const list = await chunks(await encodeIndexedPng(random(2, 4), 2, 2, palette(2), { dpi: 300 }));
  assert.deepEqual(list.map((c) => c.type), ['IHDR', 'pHYs', 'PLTE', 'IDAT', 'IEND']);
  assert.ok(list.every((c) => c.crcOk));
  assert.equal(list[1].data.readUInt32BE(0), 11811);
  assert.equal(list[1].data.readUInt32BE(4), 11811);
  assert.equal(list[1].data[8], 1);
});

test('what would make a broken PNG is refused with a reason', async () => {
  await assert.rejects(encodeIndexedPng(new Uint8Array(4), 2, 2, []), /1 to 256 colours, not 0/);
  await assert.rejects(encodeIndexedPng(new Uint8Array(4), 2, 2, palette(257)), /not 257/);
  await assert.rejects(encodeIndexedPng(Uint8Array.of(0, 1, 0, 3), 2, 2, palette(3)), /Pixel 1, 1 uses colour 4, but the palette has 3/);
  await assert.rejects(encodeIndexedPng(new Uint8Array(5), 2, 2, palette(2)), /can't be a 2 × 2 px image/);
  await assert.rejects(encodeIndexedPng(new Uint8Array(4), 2, 2, palette(2), { scale: 1.5 }), /whole number/);
  await assert.rejects(encodeIndexedPng(new Uint8Array(4), 2, 2, palette(2), { scale: 20_000 }), /more than an indexed PNG here can hold/);
});

test('a 1920 × 1080 working image at pixel size 2 (3840 × 2160, 16 colours) encodes in under 150 ms', async () => {
  const [w, h] = [1920, 1080];
  const indices = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) indices[y * w + x] = ((x * 15) / w + ((x ^ y) & 3) / 4) | 0;
  await encodeIndexedPng(indices.subarray(0, 64 * 64), 64, 64, palette(16)); // warm up
  const t = performance.now();
  const png = await encodeIndexedPng(indices, w, h, palette(16), { scale: 2 });
  const ms = performance.now() - t;
  assert.ok(png.size > 0);
  assert.ok(ms < budget(150), `${ms.toFixed(0)} ms`);
});
