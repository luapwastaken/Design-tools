import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, deflateSync } from 'node:zlib';
import { toHex } from '../src/shared/color/index.ts';
import { faviconFiles, faviconSvg, webmanifest, writeIco } from '../src/shared/logo/favicon.ts';
import { getAttr, isEl, parseSvg } from '../src/shared/svg/xml.ts';
import { doc, ICON_BOX, part, ICON_SVG } from './logo-fixtures.ts';

/** a real, blank, square RGBA PNG */
function png(size: number, height = size): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    out.set(data, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = deflateSync(Buffer.alloc(height * (1 + size * 4)));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]));
}

test('ICO: a valid directory of PNG entries, each where its entry says, 256 written as 0', () => {
  const images = [16, 32, 48, 256].map((size) => ({ size, data: png(size) }));
  const ico = writeIco(images);
  const v = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
  assert.deepEqual([v.getUint16(0, true), v.getUint16(2, true), v.getUint16(4, true)], [0, 1, 4]);
  let end = 6 + 16 * images.length;
  images.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    assert.deepEqual([ico[e], ico[e + 1], ico[e + 2], ico[e + 3]], [size % 256, size % 256, 0, 0], `${size}: width, height, palette, reserved`);
    assert.deepEqual([v.getUint16(e + 4, true), v.getUint16(e + 6, true)], [1, 32], `${size}: planes, bits`);
    const [bytes, at] = [v.getUint32(e + 8, true), v.getUint32(e + 12, true)];
    assert.equal(bytes, data.length);
    assert.equal(at, end, 'entries follow one another after the directory');
    assert.deepEqual(ico.subarray(at, at + bytes), data, `${size}: the PNG as it was`);
    end += bytes;
  });
  assert.equal(ico.length, end);
});

test('ICO: refuses what would make a lying directory', () => {
  assert.throws(() => writeIco([]), /at least one/);
  assert.throws(() => writeIco([{ size: 32, data: png(16) }]), /isn't a 32 × 32 PNG/);
  assert.throws(() => writeIco([{ size: 32, data: png(32, 16) }]), /isn't a 32 × 32 PNG/);
  assert.throws(() => writeIco([{ size: 32, data: new TextEncoder().encode('not a png at all, really') }]), /PNG/);
  assert.throws(() => writeIco([{ size: 512, data: png(512) }]), /1 to 256/);
});

test('the favicon is the icon centred in a square, filling it on its long side', () => {
  const wide = part('icon', ICON_SVG, { x: 10, y: 30, w: 80, h: 40 });
  const root = parseSvg(faviconSvg(doc({ icon: wide })));
  assert.deepEqual([getAttr(root, 'width'), getAttr(root, 'height'), getAttr(root, 'viewBox')], ['512px', '512px', '0 0 512 512']);
  const g = root.children.filter(isEl)[0];
  const [tx, ty, k] = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(getAttr(g, 'transform')!)!.slice(1).map(Number);
  // the 80 × 40 artwork at 10 30 spans the width, centred top to bottom
  assert.deepEqual([tx + k * 10, tx + k * 90, ty + k * 30, ty + k * 70].map((v) => +v.toFixed(3)), [0, 512, 128, 384]);
  // an inset keeps a share of the side clear; a ground fills the square behind
  const touch = parseSvg(faviconSvg(doc(), 'original', { inset: 0.125, background: '#ffffff' }));
  const [bg, art] = touch.children.filter(isEl);
  assert.deepEqual([bg.name, getAttr(bg, 'fill'), getAttr(bg, 'width')], ['rect', '#ffffff', '512']);
  const [x, y, s] = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(getAttr(art, 'transform')!)!.slice(1).map(Number);
  assert.deepEqual([x + s * ICON_BOX.x, y + s * ICON_BOX.y, s * ICON_BOX.w].map((v) => +v.toFixed(3)), [64, 64, 384]);
  assert.throws(() => faviconSvg(doc({ icon: null })), /Add an icon first/);
});

test('the bundle: ICO 16/32/48, the PNG sizes, an opaque touch icon, the SVG and a manifest naming the Android icons', () => {
  const d = doc();
  const files = faviconFiles(d, 'original', 'Test mark');
  assert.deepEqual(files.map((f) => f.name), [
    'favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'favicon-48x48.png', 'apple-touch-icon.png',
    'android-chrome-192x192.png', 'android-chrome-512x512.png', 'icon.svg', 'site.webmanifest',
  ]);
  const ico = files[0];
  assert.ok(ico.kind === 'ico' && ico.sizes.join() === '16,32,48');
  for (const f of files) if (f.kind === 'png') assert.ok(f.name.includes(String(f.size)) || f.name === 'apple-touch-icon.png');
  const touch = files.find((f) => f.name === 'apple-touch-icon.png')!;
  assert.ok(touch.kind === 'png' && touch.size === 180);
  assert.equal(getAttr(parseSvg(touch.svg).children.filter(isEl)[0], 'fill'), '#ffffff');
  // a white logo's touch icon goes on black; the knockout's is its own field
  assert.equal(getAttr(parseSvg((faviconFiles(d, 'white')[4] as { svg: string }).svg).children.filter(isEl)[0], 'fill'), '#000000');
  assert.equal(getAttr(parseSvg((faviconFiles(d, 'knockout')[4] as { svg: string }).svg).children.filter(isEl)[0], 'fill'), toHex(d.colour));
  // the browser icons are transparent
  assert.equal(parseSvg((files[1] as { svg: string }).svg).children.filter(isEl)[0].name, 'g');
  const manifest = JSON.parse((files[8] as { text: string }).text);
  assert.equal(manifest.name, 'Test mark');
  const names = new Set(files.map((f) => f.name));
  for (const i of manifest.icons) assert.ok(names.has(i.src), `${i.src} is in the bundle`);
  assert.equal(JSON.parse(webmanifest('A "quoted" name')).name, 'A "quoted" name');
  // an installed app: standalone, its splash the touch icon's ground, a short name a launcher can show
  assert.deepEqual([manifest.display, manifest.background_color, manifest.short_name], ['standalone', '#ffffff', 'Test mark']);
  assert.equal(JSON.parse(webmanifest('Northwind Trading Company')).short_name, 'Northwind');
  assert.equal(JSON.parse(webmanifest('Supercalifragilistic')).short_name.length, 12);
});
