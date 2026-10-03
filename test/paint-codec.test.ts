import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { rgbaPng } from '../src/renderer/lib/png.ts';
import { isBlank, isV1, word } from '../src/renderer/tools/illustration/paint/codec.ts';

/** a PNG's chunks and its pixels, unfiltered (None and Up, the filters rgbaPng writes) */
function readPng(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset);
  const chunks: { type: string; data: Uint8Array }[] = [];
  for (let at = 8; at < buf.length; ) {
    const n = v.getUint32(at);
    chunks.push({ type: String.fromCharCode(...buf.subarray(at + 4, at + 8)), data: buf.subarray(at + 8, at + 8 + n) });
    at += 12 + n;
  }
  const head = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
  const [w, h] = [head.getUint32(0), head.getUint32(4)];
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w * 4 + 1)];
    for (let i = 0; i < w * 4; i++) px[y * w * 4 + i] = raw[y * (w * 4 + 1) + 1 + i] + (f === 2 && y ? px[(y - 1) * w * 4 + i] : 0);
  }
  return { chunks: chunks.map((c) => c.type), w, h, depth: chunks[0].data[8], colour: chunks[0].data[9], px };
}

test('rgbaPng round-trips byte for byte, straight alpha included', async () => {
  const w = 37;
  const h = 23;
  const bytes = new Uint8Array(w * h * 4);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 97 + (i >> 5) * 13) & 255;
  // colour under zero and near-zero alpha: a canvas would premultiply it away
  bytes.set([241, 240, 234, 0, 90, 140, 200, 1], 0);
  const png = readPng(new Uint8Array(await (await rgbaPng(bytes, w, h)).arrayBuffer()));
  assert.deepEqual(png.chunks, ['IHDR', 'IDAT', 'IEND']);
  assert.deepEqual([png.w, png.h, png.depth, png.colour], [w, h, 8, 6]);
  assert.deepEqual(png.px, bytes);
  await assert.rejects(rgbaPng(bytes, w + 1, h));
});

test('a 1024 × 640 painting is v1', () => {
  assert.ok(isV1(1024, 640));
  assert.ok(!isV1(2048, 1280) && !isV1(640, 1024));
});

test('blank is every pixel exactly the paper at height 0', () => {
  const paper = [241, 240, 234, 0];
  const cpu = new Uint8Array(64 * 4);
  for (let i = 0; i < 64; i++) cpu.set(paper, i * 4);
  assert.ok(isBlank(cpu, word(paper)));
  cpu[37 * 4 + 3] = 1;
  assert.ok(!isBlank(cpu, word(paper)));
  cpu[37 * 4 + 3] = 0;
  cpu[5 * 4] = 240;
  assert.ok(!isBlank(cpu, word(paper)));
});
