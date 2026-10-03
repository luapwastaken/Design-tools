// The engine's GPU checks for the smoke pass (plan §6): KM on the GPU through the engine's own
// rgba16f film against km.ts, glazes through the painting's rgba16f colour against the float64
// spectral stack, the paper against its TypeScript reference, and the stroke sheet (twice, for
// determinism, then with the split-draw fallback forced). The sheet's PNG goes to the exports folder.
// Then the brush chip's wash against painted watercolour strokes (wash-checks.ts).
import { deltaE, toOklch, type Oklch } from '../../../../shared/color/index.ts';
import { mix, paintOf } from '../../../../shared/paint/km.ts';
import { layer15, linear15, paint15, reflectance15 } from '../../../../shared/paint/km15.ts';
import { PIGMENTS } from '../../../../shared/paint/pigments.ts';
import { saveFile } from '../../../lib/export.ts';
import { gpuScope, type Gpu } from '../../../lib/gpu/index.ts';
import { KM } from './glsl/km.ts';
import { glazeCases, mixCases } from './km-cases.ts';
import { internals, PaintEngine } from './engine.ts';
import { paperAt, PAPER_RGB } from './paper.ts';
import { renderSheet } from './sheet.ts';
import { washChecks } from './wash-checks.ts';

type Check = (name: string, ok: unknown, detail?: unknown) => boolean;

const WRITE = `uniform float u_paint[16];
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
void main() {
  o0 = vec4(u_paint[0], u_paint[1], u_paint[2], u_paint[3]);
  o1 = vec4(u_paint[4], u_paint[5], u_paint[6], u_paint[7]);
  o2 = vec4(u_paint[8], u_paint[9], u_paint[10], u_paint[11]);
  o3 = vec4(u_paint[12], u_paint[13], u_paint[14], u_paint[15]);
}`;

const SHOW = `${KM}
uniform sampler2D u_k0, u_k1, u_k2, u_k3;
out vec4 o;
void main() {
  ivec2 p = ivec2(fragPixel());
  vec4 a = texelFetch(u_k0, p, 0), b = texelFetch(u_k1, p, 0), c = texelFetch(u_k2, p, 0), d = texelFetch(u_k3, p, 0);
  o = vec4(integrate(colourOf(specOf(a, b, c, d), max(d.w, 1e-9))), 1.0);
}`;

/** one glaze per pixel over the colour in u_under (or bare paper), as the composite lays a wash */
const GLAZE = `${KM}
uniform sampler2D u_paints, u_cases, u_under;
uniform float u_layer;
uniform vec3 u_paper;
out vec4 o;
void main() {
  ivec2 p = ivec2(fragPixel());
  vec4 g = texelFetch(u_cases, p, 0);
  int i = int(u_layer < 0.5 ? g.x : g.z);
  float x = u_layer < 0.5 ? g.y : g.w;
  vec4 a = texelFetch(u_paints, ivec2(0, i), 0), b = texelFetch(u_paints, ivec2(1, i), 0), c = texelFetch(u_paints, ivec2(2, i), 0), d = texelFetch(u_paints, ivec2(3, i), 0);
  Spec K = specOf(a, b, c, d);
  vec3 base = u_layer < 0.5 ? u_paper : texelFetch(u_under, p, 0).rgb;
  Spec under = reflectance(max(base, vec3(0.0)));
  o = vec4(layerOnColour(base, under, K, d.w, x), 1.0);
}`;

const lin = (c: ArrayLike<number>, i: number): Oklch => toOklch({ mode: 'lrgb', r: c[i * 4], g: c[i * 4 + 1], b: c[i * 4 + 2] });
const stats = (d: number[]) => {
  const s = [...d].sort((a, b) => a - b);
  return { mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3), p95: +s[Math.floor(0.95 * s.length)].toFixed(3), max: +s.at(-1)!.toFixed(3) };
};
const uniform = (i: number) => {
  const p = paint15(paintOf(PIGMENTS[i]));
  return [...p.K, p.S];
};

/** the 520 mixes, blended part by part into rgba16f as the film blends them (constant alpha) */
function gpuMixes(g: Gpu): number[] {
  const cases = mixCases();
  const size = { width: cases.length, height: 1 };
  const film = [0, 1, 2, 3].map(() => g.texture(size, 'rgba16f', { filter: 'nearest' }));
  const out = g.texture(size, 'rgba32f');
  const write = g.program(WRITE);
  cases.forEach((parts, x) => {
    let total = 0;
    parts.forEach(([i, n], j) => {
      total += n;
      g.pass(write, { output: film, rect: { x, y: 0, w: 1, h: 1 }, uniforms: { u_paint: uniform(i) }, blend: j ? 'constant' : 'none', blendConstant: n / total });
    });
  });
  g.pass(g.program(SHOW), { output: out, inputs: { u_k0: film[0], u_k1: film[1], u_k2: film[2], u_k3: film[3] } });
  const got = g.read(out);
  return cases.map((parts, x) => deltaE(lin(got, x), mix(parts.map(([i, n]) => ({ pigment: PIGMENTS[i], parts: n })))));
}

/** 156 two-glaze stacks: each glaze's colour kept in rgba16f between them, as the painting keeps it */
export function gpuGlazes(g: Gpu): number[] {
  const cases = glazeCases();
  const paints = g.texture({ width: 4, height: PIGMENTS.length, data: Float32Array.from(PIGMENTS.flatMap((_, i) => uniform(i))) }, 'rgba32f');
  const list = g.texture({ width: cases.length, height: 1, data: Float32Array.from(cases.flatMap(([[a, xa], [b, xb]]) => [a, xa, b, xb])) }, 'rgba32f');
  const first = g.texture({ width: cases.length, height: 1 }, 'rgba16f', { filter: 'nearest' });
  const second = g.texture({ width: cases.length, height: 1 }, 'rgba32f');
  const glaze = g.program(GLAZE);
  g.pass(glaze, { output: first, inputs: { u_paints: paints, u_cases: list, u_under: second }, uniforms: { u_layer: 0, u_paper: PAPER_RGB } });
  g.pass(glaze, { output: second, inputs: { u_paints: paints, u_cases: list, u_under: first }, uniforms: { u_layer: 1, u_paper: PAPER_RGB } });
  const got = g.read(second);
  const paper = reflectance15([...PAPER_RGB]);
  return cases.map(([[a, xa], [b, xb]], k) => {
    const [pa, pb] = [paint15(paintOf(PIGMENTS[a])), paint15(paintOf(PIGMENTS[b]))];
    const R = Array.from(paper, (r, n) => layer15(pb.K[n], pb.S, xb, layer15(pa.K[n], pa.S, xa, r)));
    const [r, gr, bl] = linear15(R);
    return deltaE(lin(got, k), toOklch({ mode: 'lrgb', r, g: gr, b: bl }));
  });
}

/** CPU copies of two renders: ΔE00 over a spread of painted pixels */
function sheetDelta(a: Uint8Array, b: Uint8Array): { mean: number; p95: number; max: number } {
  const d: number[] = [];
  const srgb = (c: Uint8Array, i: number): Oklch => toOklch({ mode: 'rgb', r: c[i] / 255, g: c[i + 1] / 255, b: c[i + 2] / 255 });
  for (let i = 0; i < a.length; i += 4 * 211) if (a[i + 3] || b[i + 3]) d.push(deltaE(srgb(a, i), srgb(b, i)));
  return stats(d.length ? d : [0]);
}

export async function paintEngineChecks(check: Check): Promise<void> {
  const g = gpuScope('paint checks');
  try {
    const m = stats(gpuMixes(g));
    check(`paint engine: 520 KM mixes through the rgba16f film match km.ts (ΔE00 mean ${m.mean}, max ${m.max})`, m.mean <= 0.05 && m.max <= 0.5, m);
    const gl = stats(gpuGlazes(g));
    check(`paint engine: 156 two-glaze stacks match the spectral stack (ΔE00 mean ${gl.mean}, p95 ${gl.p95}, max ${gl.max})`, gl.mean <= 0.2 && gl.p95 <= 0.6 && gl.max <= 2, gl);
  } catch (e) {
    check('paint engine: the KM checks ran', false, e instanceof Error ? e.message : String(e));
  } finally {
    g.release();
  }

  try {
    const e = await PaintEngine.create();
    const i = internals.get(e)!;
    const px = i.g.read(i.surfaces.paper);
    let worst = 0;
    for (let k = 0; k < 64; k++) {
      const x = (k * 797 + 13) % 2048;
      const y = (k * 331 + 7) % 1280;
      paperAt(x, y).forEach((v, c) => (worst = Math.max(worst, Math.abs(px[(y * 2048 + x) * 4 + c] - v * 255))));
    }
    e.release();
    check(`paint engine: 64 paper texels match the TypeScript paper (worst ${worst.toFixed(2)} of 255)`, worst <= 1, worst);
  } catch (e) {
    check('paint engine: the paper check ran', false, e instanceof Error ? e.message : String(e));
  }

  try {
    const one = await renderSheet();
    for (const c of one.report.checks) check(`paint sheet: ${c.name} ${JSON.stringify(c.value).slice(0, 160)}`, c.ok, c.value);
    check(`paint sheet: renders in 5 s or less (${one.report.ms} ms)`, one.report.ms <= 5000, one.report.ms);
    const two = await renderSheet();
    check('paint sheet: a second render gives identical bytes', two.report.hash === one.report.hash, [one.report.hash, two.report.hash]);
    const split = await renderSheet({ split: true });
    const d = sheetDelta(one.bytes, split.bytes);
    check(`paint sheet: the split-draw fallback matches (ΔE00 mean ${d.mean}, max ${d.max})`, d.max <= 1, d);
    const saved = await saveFile({ tool: 'illustration', suggestedName: 'paint-sheet', ext: 'png', filterName: 'PNG image', data: await one.png.arrayBuffer() });
    check('paint sheet: the PNG is in the exports folder', !!saved?.endsWith('paint-sheet.png'), saved);
  } catch (e) {
    check('paint engine: the sheet ran', false, e instanceof Error ? (e.stack ?? e.message) : String(e));
  }

  await washChecks(check);
}
