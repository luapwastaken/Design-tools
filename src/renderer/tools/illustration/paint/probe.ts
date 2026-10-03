// window.dtPaint: the live engine (live.ts) and the stroke sheet (the PNG as base64) for CDP probes.
// Loaded by useEngine in smoke folders only (a dynamic import), so none of it ships to the user.
import { internals, PaintEngine } from './engine.ts';
import { liveEngine } from './live.ts';
import { paintStroke, renderSheet } from './sheet.ts';
import { gpuGlazes, paintEngineChecks } from './smoke-checks.ts';
import { gpuScope } from '../../../lib/gpu/index.ts';
import { glazeCases } from './km-cases.ts';
import { loadedOf, SHEET } from './sheet-strokes.ts';
import { measureWashes, rampPaint, tubePaint } from './wash-checks.ts';

async function base64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

if (typeof window !== 'undefined' && window.api?.smoke) {
  const dt = {
    engine: liveEngine.get(),
    PaintEngine,
    SHEET,
    loadedOf,
    internals: (e: PaintEngine) => internals.get(e),
    paintStroke,
    wash: { measureWashes, rampPaint, tubePaint },
    base64,
    sheet: async (split = false) => {
      const { png, report } = await renderSheet({ split });
      return { report, png: await base64(png) };
    },
    glazes: () => {
      const g = gpuScope('probe');
      const d = gpuGlazes(g);
      g.release();
      return glazeCases().map((c, i) => ({ c, d: +d[i].toFixed(2) })).sort((a, b) => b.d - a.d).slice(0, 12);
    },
    checks: async () => {
      const out: { name: string; ok: boolean; detail: unknown }[] = [];
      await paintEngineChecks((name, ok, detail) => (out.push({ name, ok: !!ok, detail }), !!ok));
      return out;
    },
  };
  liveEngine.subscribe(() => (dt.engine = liveEngine.get()));
  (window as unknown as { dtPaint: typeof dt }).dtPaint = dt;
}
