import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unsupportedImage } from '../src/renderer/lib/load.ts';

test('a PSD or HEIC says so even when Explorer hands it over with no type at all', () => {
  assert.equal(unsupportedImage('', 'layers.psd'), "PSD files aren't supported. Export a PNG or TIFF.");
  assert.equal(unsupportedImage('', 'LAYERS.PSD'), "PSD files aren't supported. Export a PNG or TIFF.");
  assert.equal(unsupportedImage('image/vnd.adobe.photoshop', 'layers'), "PSD files aren't supported. Export a PNG or TIFF.");
  assert.match(unsupportedImage('', 'iphone.heic')!, /^HEIC photos aren't supported/);
  assert.match(unsupportedImage('', 'shot.heif')!, /^HEIC photos aren't supported/);
  assert.match(unsupportedImage('image/heic', 'shot')!, /^HEIC photos aren't supported/);
});

test('what the decoder reads, and a file with no type and no telling name, goes through', () => {
  for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif', 'image/tiff', 'image/svg+xml']) assert.equal(unsupportedImage(type, 'x'), null, type);
  assert.equal(unsupportedImage('', 'render.png'), null, 'no type: the decoder decides');
  assert.equal(unsupportedImage('', ''), null);
  // a typed PNG is believed over its name
  assert.equal(unsupportedImage('image/png', 'layers.psd'), null);
  assert.match(unsupportedImage('image/x-exr', 'pass.exr')!, /^EXR files aren't an image this tool can open/);
});
