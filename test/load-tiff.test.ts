import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zlibSync } from 'fflate';
import { tiffKind } from '../src/renderer/lib/load.ts';
import { readTiff, TiffUnsupported } from '../src/renderer/lib/tiff.ts';

type Page = {
  w: number;
  h: number;
  bits: 8 | 16;
  spp: number;
  photometric: number;
  /** samples, interleaved */
  data: number[];
  extra?: number;
  deflate?: boolean;
  predictor?: boolean;
  planar?: boolean;
  colormap?: number[];
};

/** a minimal TIFF writer: one strip per page, the tags readTiff looks at */
function tiff(pages: Page[], le = true): ArrayBuffer {
  const b: number[] = [];
  const u16 = (v: number) => (le ? [v & 255, (v >> 8) & 255] : [(v >> 8) & 255, v & 255]);
  const u32 = (v: number) => (le ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  b.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), 0, 0, 0, 0);
  let link = 4;
  for (const p of pages) {
    const max = p.bits === 8 ? 255 : 65535;
    const s = p.data.map((v, i) => (p.predictor && i % (p.w * p.spp) >= p.spp ? (v - p.data[i - p.spp]) & max : v));
    let px = new Uint8Array(s.flatMap((v) => (p.bits === 8 ? [v] : u16(v))));
    if (p.deflate) px = zlibSync(px);
    const strip = b.length;
    b.push(...px);
    if (b.length % 2) b.push(0);
    const tags: [number, 3 | 4, number[]][] = [
      [256, 4, [p.w]],
      [257, 4, [p.h]],
      [258, 3, Array(p.spp).fill(p.bits)],
      [259, 3, [p.deflate ? 8 : 1]],
      [262, 3, [p.photometric]],
      [273, 4, [strip]],
      [277, 3, [p.spp]],
      [278, 4, [p.h]],
      [279, 4, [px.length]],
    ];
    if (p.planar) tags.push([284, 3, [2]]);
    if (p.predictor) tags.push([317, 3, [2]]);
    if (p.colormap) tags.push([320, 3, p.colormap]);
    if (p.extra !== undefined) tags.push([338, 3, [p.extra]]);
    const bytes = (t: 3 | 4, v: number[]) => v.flatMap((x) => (t === 3 ? u16(x) : u32(x)));
    // values longer than an entry's 4 bytes go ahead of the IFD
    const far = new Map(tags.filter(([, t, v]) => bytes(t, v).length > 4).map(([n, t, v]) => [n, (b.push(...bytes(t, v)), b.length - bytes(t, v).length)]));
    b.splice(link, 4, ...u32(b.length));
    b.push(...u16(tags.length));
    for (const [n, t, v] of tags) {
      const at = far.get(n);
      b.push(...u16(n), ...u16(t), ...u32(v.length), ...(at === undefined ? [...bytes(t, v), 0, 0, 0, 0].slice(0, 4) : u32(at)));
    }
    link = b.length;
    b.push(0, 0, 0, 0);
  }
  return new Uint8Array(b).buffer;
}

const px = (r: ReturnType<typeof readTiff>, i: number) => [...r.data.subarray(4 * i, 4 * i + 4)];

test('8-bit RGB reads as stored, opaque, at full size', () => {
  const r = readTiff(tiff([{ w: 2, h: 2, bits: 8, spp: 3, photometric: 2, data: [255, 0, 0, 0, 255, 0, 0, 0, 255, 10, 20, 30] }]));
  assert.deepEqual([r.width, r.height], [2, 2]);
  assert.deepEqual([0, 1, 2, 3].map((i) => px(r, i)), [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [10, 20, 30, 255]]);
});

test('16-bit RGBA, big-endian, deflated with a predictor, rounds each sample to 8 bits', () => {
  const data = [65535, 0, 32896, 65535, 257, 514, 771, 32768, 0, 65535, 128, 0];
  for (const le of [true, false]) {
    const r = readTiff(tiff([{ w: 3, h: 1, bits: 16, spp: 4, photometric: 2, extra: 2, deflate: true, predictor: true, data }], le));
    assert.deepEqual([0, 1, 2].map((i) => px(r, i)), [[255, 0, 128, 255], [1, 2, 3, 128], [0, 255, 0, 0]], le ? 'little-endian' : 'big-endian');
  }
});

test('grey keeps its alpha, and WhiteIsZero grey is turned the right way round', () => {
  const ga = readTiff(tiff([{ w: 2, h: 1, bits: 8, spp: 2, photometric: 1, extra: 2, data: [200, 50, 30, 255] }]));
  assert.deepEqual([px(ga, 0), px(ga, 1)], [[200, 200, 200, 50], [30, 30, 30, 255]]);
  const wz = readTiff(tiff([{ w: 2, h: 1, bits: 16, spp: 1, photometric: 0, data: [0, 65535] }]));
  assert.deepEqual([px(wz, 0), px(wz, 1)], [[255, 255, 255, 255], [0, 0, 0, 255]]);
});

test('premultiplied alpha comes out straight; an unspecified extra channel is not transparency', () => {
  const pre = readTiff(tiff([{ w: 1, h: 1, bits: 8, spp: 4, photometric: 2, extra: 1, data: [100, 50, 0, 128] }]));
  assert.deepEqual(px(pre, 0), [199, 100, 0, 128]);
  const mask = readTiff(tiff([{ w: 1, h: 1, bits: 8, spp: 4, photometric: 2, extra: 0, data: [100, 50, 0, 0] }]));
  assert.deepEqual(px(mask, 0), [100, 50, 0, 255]);
  const untagged = readTiff(tiff([{ w: 1, h: 1, bits: 8, spp: 4, photometric: 2, data: [100, 50, 0, 7] }]));
  assert.equal(px(untagged, 0)[3], 7);
});

test('the largest page wins over a thumbnail ahead of it', () => {
  const thumb: Page = { w: 1, h: 1, bits: 8, spp: 1, photometric: 1, data: [0] };
  const full: Page = { w: 3, h: 2, bits: 8, spp: 1, photometric: 1, data: [9, 9, 9, 9, 9, 9] };
  const r = readTiff(tiff([thumb, full]));
  assert.deepEqual([r.width, r.height, r.data[0]], [3, 2, 9]);
});

test('palette images go through utif2; per-channel files and BigTIFFs are named, not misread', () => {
  const colormap = Array.from({ length: 3 * 256 }, (_, i) => (i === 1 ? 65535 : i === 256 + 1 ? 32768 : 0));
  const pal = readTiff(tiff([{ w: 2, h: 1, bits: 8, spp: 1, photometric: 3, colormap, data: [0, 1] }]));
  assert.deepEqual([px(pal, 0), px(pal, 1)], [[0, 0, 0, 255], [255, 128, 0, 255]]);
  assert.throws(() => readTiff(tiff([{ w: 1, h: 1, bits: 8, spp: 3, photometric: 2, planar: true, data: [1, 2, 3] }])), TiffUnsupported);
  const head = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  assert.deepEqual(['II*\0', 'MM\0*', 'II+\0', 'MM\0+', '\x89PNG', 'MM*\0'].map((h) => tiffKind(head(h))), ['tiff', 'tiff', 'big', 'big', null, null]);
});
