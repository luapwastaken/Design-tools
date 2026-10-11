import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import { rgbaPng, withDpi } from '../src/renderer/lib/png.ts';

const chunk = (type: string, data: Uint8Array) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

/** a 1×1 grey PNG, with an optional pHYs where encoders usually put it */
function png(ppm?: number): Blob {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  if (ppm) {
    const p = Buffer.alloc(9);
    p.writeUInt32BE(ppm, 0);
    p.writeUInt32BE(ppm, 4);
    p[8] = 1;
    parts.push(chunk('pHYs', p));
  }
  parts.push(chunk('IDAT', deflateSync(Buffer.from([0, 128]))), chunk('IEND', new Uint8Array()));
  return new Blob(parts, { type: 'image/png' });
}

async function chunks(blob: Blob) {
  const b = Buffer.from(await blob.arrayBuffer());
  const out: { type: string; data: Buffer; crcOk: boolean }[] = [];
  for (let at = 8; at < b.length; ) {
    const len = b.readUInt32BE(at);
    const data = b.subarray(at + 8, at + 8 + len);
    out.push({ type: b.toString('latin1', at + 4, at + 8), data, crcOk: b.readUInt32BE(at + 8 + len) === crc32(b.subarray(at + 4, at + 8 + len)) });
    at += 12 + len;
  }
  return out;
}

test('withDpi writes one pHYs right after IHDR, in pixels per metre, with a valid CRC', async () => {
  const out = await withDpi(png(), 300);
  assert.equal(out.type, 'image/png');
  const list = await chunks(out);
  assert.deepEqual(list.map((c) => c.type), ['IHDR', 'sRGB', 'pHYs', 'IDAT', 'IEND']);
  assert.ok(list.every((c) => c.crcOk));
  assert.deepEqual([...list[1].data], [0]);
  const phys = list[2].data;
  assert.equal(phys.readUInt32BE(0), 11811); // 300 / 0.0254
  assert.equal(phys.readUInt32BE(4), 11811);
  assert.equal(phys[8], 1);
});

test('withDpi replaces a pHYs the encoder wrote, and leaves the pixels alone', async () => {
  const src = png(2835); // 72 ppi
  const list = await chunks(await withDpi(src, 96));
  assert.deepEqual(list.map((c) => c.type), ['IHDR', 'sRGB', 'pHYs', 'IDAT', 'IEND']);
  assert.equal(list[2].data.readUInt32BE(0), 3780);
  const before = await chunks(src);
  assert.deepEqual(list[3].data, before.find((c) => c.type === 'IDAT')!.data);
});

test('withDpi refuses what is not a PNG, a cut-short PNG and a resolution of 0', async () => {
  await assert.rejects(withDpi(new Blob(['GIF89a']), 300), /not a PNG/);
  const whole = Buffer.from(await png().arrayBuffer());
  await assert.rejects(withDpi(new Blob([whole.subarray(0, whole.length - 6)]), 300), /cut short/);
  await assert.rejects(withDpi(png(), 0), /above 0/);
  await assert.rejects(withDpi(png(), Number.NaN), /above 0/);
});

test('withDpi without a resolution writes 72 ppi, and a PNG tagged twice keeps one sRGB', async () => {
  const once = await withDpi(png());
  const list = await chunks(await withDpi(once));
  assert.deepEqual(list.map((c) => c.type), ['IHDR', 'sRGB', 'pHYs', 'IDAT', 'IEND']);
  assert.equal(list[2].data.readUInt32BE(0), 2835);
});

test('rgbaPng writes sRGB and pHYs itself, at 72 ppi unless told otherwise', async () => {
  const px = new Uint8Array([10, 20, 30, 255]);
  const list = await chunks(await rgbaPng(px, 1, 1));
  assert.deepEqual(list.map((c) => c.type), ['IHDR', 'sRGB', 'pHYs', 'IDAT', 'IEND']);
  assert.ok(list.every((c) => c.crcOk));
  assert.equal(list[2].data.readUInt32BE(0), 2835);
  assert.equal((await chunks(await rgbaPng(px, 1, 1, 300)))[2].data.readUInt32BE(0), 11811);
});
