import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GpuError } from '../src/renderer/lib/gpu/errors.ts';
import { assemble, explain } from '../src/renderer/lib/gpu/shader.ts';
import { tiles } from '../src/renderer/lib/gpu/tiles.ts';

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
