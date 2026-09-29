import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bilevel } from '../src/shared/halftone/bilevel.ts';
import { cells, inkedCoverage, pagePx, splitOf, type CellShape, type Screen, type Size } from '../src/shared/halftone/index.ts';

const SHAPES: CellShape[] = ['round', 'ellipse', 'square', 'line', 'diamond', 'cross'];
const size: Size = { w: 30, h: 20, unit: 'mm', dpi: 300 };

/** a flat tint's 1-bit plate at 60 lpi (a 5 px cell: the default, where a 50% threshold lost the light tones) */
function plateOf(shape: CellShape, c: number, angle: number) {
  const page = pagePx(size);
  const [W, H] = [Math.round(page.w), Math.round(page.h)];
  const screen: Screen = { shape, lpi: 60, minDot: 0, gain: 0 };
  const cl = cells(new Float32Array(4).fill(c), size, 60, angle, 2, 2, splitOf(shape));
  const cov = Float32Array.from(cl.coverage, (v) => inkedCoverage(screen, v));
  const out = bilevel(cl, cov, shape, W, H, page);
  let ink = 0;
  for (const v of out) if (v === 0) ink++;
  return { out, ink: ink / (W * H) };
}

test('1-bit plates print every tone at its own coverage, light ones too, at any angle', () => {
  for (const shape of SHAPES) {
    for (const angle of [0, 15, 45, 75]) {
      for (const c of [0.03, 0.1, 0.2, 0.3, 0.5, 0.8, 0.97]) {
        const { ink } = plateOf(shape, c, angle);
        assert.ok(Math.abs(ink - c) < 0.004, `${shape} at ${angle}°, ${c}: ${ink.toFixed(4)}`);
      }
    }
  }
});

test('and hold only ink or paper, all paper at 0 and all ink at 1', () => {
  const { out } = plateOf('round', 0.4, 15);
  assert.ok(out.every((v) => v === 0 || v === 255));
  assert.equal(plateOf('round', 0, 15).ink, 0);
  assert.equal(plateOf('diamond', 1, 45).ink, 1);
});

test('a dot grows from its cell centre: at 10% the inked pixels sit round the cell centres', () => {
  const page = pagePx(size);
  const W = Math.round(page.w);
  const { out } = plateOf('round', 0.1, 0);
  const cl = cells(new Float32Array(4).fill(0.1), size, 60, 0, 2, 2);
  let far = 0;
  let inked = 0;
  for (let p = 0; p < out.length; p++) {
    if (out[p]) continue;
    inked++;
    const [x, y] = [(p % W) + 0.5, Math.floor(p / W) + 0.5];
    // the nearest cell centre is within a dot's reach (10% of a 5 px cell is a 1 px radius)
    let best = Infinity;
    for (let k = 0; k < cl.n; k++) best = Math.min(best, Math.hypot(cl.x[k] - x, cl.y[k] - y));
    if (best > 1.6) far++;
  }
  assert.ok(inked > 0 && far === 0, `${far} of ${inked} inked pixels away from their dot`);
});
