// The stroke sheet (plan §4.7): every brush in both media, replayed through the public API as a pen
// or a mouse would feed it (60 fps batches, flushed), into one painting. The PNG shows it as the
// screen does, relief included; the report holds the measured values against the plan's thresholds.
import { rgbaPng } from '../../../lib/png.ts';
import { internals, PaintEngine } from './engine.ts';
import { screen } from './passes.ts';
import { density, measureSheet, type Aux, type Check } from './sheet-checks.ts';
import { framesOf, line, optionsOf, samplesOf, SHEET, type SheetStroke } from './sheet-strokes.ts';
import { HEIGHT, WIDTH, type Rect } from './types.ts';

export type SheetReport = { ms: number; checks: Check[]; hash: string };

/** one stroke through the public API; returns the painting px its samples could have touched */
export function paintStroke(e: PaintEngine, s: SheetStroke, k: number): Rect {
  const list = samplesOf(s, k);
  const { first, frames, last } = framesOf(list);
  e.begin(optionsOf(s, k), first);
  for (const batch of frames) {
    e.move(batch);
    e.flush();
  }
  e.end(last);
  const pad = s.size * 1.2 + 8;
  const xs = list.map((p) => p.x);
  const ys = list.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - pad));
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - pad));
  return { x: x0, y: y0, w: Math.min(WIDTH, Math.ceil(Math.max(...xs) + pad)) - x0, h: Math.min(HEIGHT, Math.ceil(Math.max(...ys) + pad)) - y0 };
}

/** the painting as the screen shows it, at full size */
function displayPixels(e: PaintEngine): Uint8Array {
  const i = internals.get(e)!;
  const out = i.g.texture({ width: WIDTH, height: HEIGHT }, 'rgba8', { filter: 'nearest' });
  try {
    screen(i.g, i.programs, i.surfaces, out);
    return i.g.read(out);
  } finally {
    out.release();
  }
}

/** FNV-1a of the CPU copy, to compare renders */
export function hashOf(bytes: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 16777619) >>> 0;
  return h.toString(16);
}

/** long smudges out of a Cadmium Red and a Phthalo Blue band, painted apart from the sheet */
async function smudgeTrails(o: { split?: boolean }): Promise<Aux> {
  const e = await PaintEngine.create(o);
  try {
    const band = (name: string, pigment: string, y: number): SheetStroke => ({ name, cell: [0, 0], tool: 'paint', medium: 'dry', brush: 'flat', size: 110, load: 0.9, pigment, path: line(100, y, 400, y), ms: 700, pointer: 'pen', pressure: () => 1 });
    const drag = (y: number): SheetStroke => ({ name: 'drag', cell: [0, 0], tool: 'smudge', medium: 'dry', brush: 'flat', size: 80, load: 0.8, pigment: null, path: line(250, y, 1300, y), ms: 1200, pointer: 'pen', pressure: () => 1 });
    const rows = [
      { name: 'cadred', y: 300 },
      { name: 'phthaloB', y: 800 },
    ];
    rows.forEach((r, k) => paintStroke(e, band(r.name, r.name, r.y), 40 + k));
    const ends = rows.map((r) => {
      const d = e.probe.read('base', { x: 0, y: r.y, w: WIDTH, h: 1 });
      let x = 400;
      while (x < WIDTH && density([d[x * 4], d[x * 4 + 1], d[x * 4 + 2]]) > 0.05) x++;
      return x;
    });
    rows.forEach((r, k) => paintStroke(e, drag(r.y), 50 + k));
    return {
      smudge: rows.map((r, k) => {
        const d = e.probe.read('base', { x: 0, y: r.y - 20, w: WIDTH, h: 41 });
        const at = (x: number) => {
          let sum = 0;
          for (let j = 0; j < 41; j++) sum += density([d[(j * WIDTH + x) * 4], d[(j * WIDTH + x) * 4 + 1], d[(j * WIDTH + x) * 4 + 2]]);
          return +(sum / 41).toFixed(3);
        };
        return { name: r.name, band: at(180), at50: at(ends[k] + 50), at300: at(ends[k] + 300) };
      }),
    };
  } finally {
    e.release();
  }
}

/** the sheet: its PNG as seen, the report, and the painting's CPU copy (sRGB bytes, height in alpha) */
export async function renderSheet(o: { split?: boolean } = {}): Promise<{ png: Blob; report: SheetReport; bytes: Uint8Array }> {
  const t0 = performance.now();
  const e = await PaintEngine.create(o);
  try {
    const paper = Array.from(e.probe.read('base', { x: 0, y: 0, w: 1, h: 1 }));
    const lifted: boolean[] = [];
    for (const [k, s] of SHEET.entries()) {
      const r = paintStroke(e, s, k);
      const a = e.probe.read('base', r);
      const b = e.probe.read('shown', r);
      lifted.push(a.every((v, j) => Object.is(v, b[j])));
    }
    const i = internals.get(e)!;
    await i.settled();
    const checks = measureSheet(e.probe.read('base'), e.probe.read('shown'), lifted, paper, await smudgeTrails(o));
    const png = await rgbaPng(displayPixels(e), WIDTH, HEIGHT);
    return { png, report: { ms: Math.round(performance.now() - t0), checks, hash: hashOf(i.cpu) }, bytes: i.cpu.slice() };
  } finally {
    e.release();
  }
}


