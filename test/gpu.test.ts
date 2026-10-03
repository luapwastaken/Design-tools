import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GpuError } from '../src/renderer/lib/gpu/errors.ts';
import { assemble, explain } from '../src/renderer/lib/gpu/shader.ts';
import { tiles } from '../src/renderer/lib/gpu/tiles.ts';
import { checkCopy, checkPass, type PassShape } from '../src/renderer/lib/gpu/validate.ts';

test('assemble puts the prelude first and refuses a #version of its own', () => {
  const src = assemble('fragment', 'out vec4 o;\nvoid main() { o = vec4(1.0); }');
  assert.ok(src.startsWith('#version 300 es\n'));
  assert.ok(src.endsWith('void main() { o = vec4(1.0); }'));
  assert.match(assemble('vertex', 'void main() {}'), /vec4 toClip\(vec2 px\)/);
  assert.throws(() => assemble('fragment', '  #version 300 es\nvoid main() {}'), GpuError);
});

test("explain moves GL's line numbers back onto the caller's source and quotes the line", () => {
  const body = 'out vec4 o;\nvoid main() {\n  o = vec4(x);\n}';
  const glLine = assemble('fragment', body).split('\n').indexOf('  o = vec4(x);') + 1;
  const log = `ERROR: 0:${glLine}: 'x' : undeclared identifier\nERROR: 1 compilation errors.  No code generated.\n\n\0`;
  assert.equal(
    explain('fragment', log, body),
    "fragment shader, line 3: 'x' : undeclared identifier\n  3 | o = vec4(x);\nERROR: 1 compilation errors.  No code generated.",
  );
  // an error inside the prelude says so rather than pointing at a line of the caller's
  assert.match(explain('vertex', "ERROR: 0:2: 'p' : oops", 'void main() {}'), /^vertex shader prelude, line 2: 'p' : oops$/);
});

test('tiles cover the image exactly, row by row, none larger than the tile size', () => {
  for (const [w, h, size] of [[5000, 3000, 2048], [1, 1, 4096], [4096, 4096, 4096], [4097, 3, 4096], [1000, 700, 256]]) {
    const t = tiles(w, h, size);
    const hits = new Uint8Array(w * h);
    for (const r of t) {
      assert.ok(r.w >= 1 && r.h >= 1 && r.w <= size && r.h <= size);
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) hits[y * w + x]++;
    }
    assert.ok(hits.every((n) => n === 1), `${w} × ${h} in ${size}`);
    assert.deepEqual(t[0], { x: 0, y: 0, w: Math.min(size, w), h: Math.min(size, h) });
  }
  assert.equal(tiles(8000, 8000, 4096).length, 4);
  assert.throws(() => tiles(0, 10, 256), RangeError);
  assert.throws(() => tiles(10.5, 10, 256), RangeError);
});

test('a pass with several outputs: one blend each or one for all, none of them an input, all one size', () => {
  const tex = (width = 64, height = 32) => ({ width, height });
  const [a, b, c] = [tex(), tex(), tex()];
  const shape = (o: Partial<PassShape>): PassShape => ({ outputs: [a, b], whole: true, inputs: [], drawBuffers: 8, indexedBlend: true, ...o });
  assert.deepEqual(checkPass(shape({})), ['none', 'none']);
  assert.deepEqual(checkPass(shape({ blend: 'max' })), ['max', 'max']);
  assert.deepEqual(checkPass(shape({ blend: ['max', 'constant'], blendConstant: 0.3 })), ['max', 'constant']);
  assert.throws(() => checkPass(shape({ blend: ['max'] })), /2 blends, not 1/);
  assert.throws(() => checkPass(shape({ blend: ['max', 'constant'] })), /blendConstant/);
  assert.throws(() => checkPass(shape({ blend: ['max', 'add'], indexedBlend: false })), /OES_draw_buffers_indexed/);
  assert.deepEqual(checkPass(shape({ blend: ['add', 'add'], indexedBlend: false })), ['add', 'add']);
  assert.throws(() => checkPass(shape({ blend: 'glow' as never })), /isn't a blend/);
  assert.throws(() => checkPass(shape({ inputs: [b] })), /can't read the texture it draws into/);
  assert.throws(() => checkPass(shape({ outputs: [a, tex(64, 16)] })), /same size/);
  assert.throws(() => checkPass(shape({ outputs: [a, a] })), /same output twice/);
  assert.throws(() => checkPass(shape({ outputs: [a, b, c], drawBuffers: 2 })), /at most 2/);
  assert.throws(() => checkPass(shape({ outputs: [] })), /at least one/);
});

test('a pass limited to a rect keeps it inside a whole output', () => {
  const t = { width: 64, height: 32 };
  const shape = (rect: PassShape['rect'], whole = true): PassShape => ({ outputs: [t], whole, inputs: [], drawBuffers: 4, indexedBlend: false, rect });
  assert.deepEqual(checkPass(shape({ x: 0, y: 0, w: 64, h: 32 })), ['none']);
  assert.deepEqual(checkPass(shape({ x: 10, y: 5, w: 1, h: 1 })), ['none']);
  for (const r of [{ x: -1, y: 0, w: 4, h: 4 }, { x: 60, y: 0, w: 5, h: 4 }, { x: 0, y: 30, w: 4, h: 3 }, { x: 0, y: 0, w: 0, h: 4 }, { x: 0.5, y: 0, w: 4, h: 4 }]) {
    assert.throws(() => checkPass(shape(r)), /isn't inside/, JSON.stringify(r));
  }
  assert.throws(() => checkPass(shape({ x: 0, y: 0, w: 4, h: 4 }, false)), /not a tile/);
});

test('a copy is between two textures of one format, inside both', () => {
  const a = { width: 64, height: 32, format: 'rgba16f' };
  const b = { width: 16, height: 16, format: 'rgba16f' };
  checkCopy(a, b, { x: 10, y: 10, w: 16, h: 16 }, { x: 0, y: 0 });
  checkCopy(b, a, { x: 0, y: 0, w: 16, h: 16 }, { x: 48, y: 16 });
  assert.throws(() => checkCopy(a, a, { x: 0, y: 0, w: 4, h: 4 }, { x: 8, y: 8 }), /same texture/);
  assert.throws(() => checkCopy(a, { ...b, format: 'rgba8' }, { x: 0, y: 0, w: 4, h: 4 }, { x: 0, y: 0 }), /one format/);
  assert.throws(() => checkCopy(a, b, { x: 0, y: 0, w: 17, h: 4 }, { x: 0, y: 0 }), /isn't inside the 16/);
  assert.throws(() => checkCopy(a, b, { x: 60, y: 0, w: 8, h: 4 }, { x: 0, y: 0 }), /isn't inside the 64/);
});
