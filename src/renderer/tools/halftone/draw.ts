// The halftone on the GPU (lib/gpu), for the view and every raster export: each ink's dots, one
// instanced draw of the worker's cells, into a coverage mask of its own; then the masks combined on
// the paper the way separate.ts models the print (overprint multiplies, knockout clears below).
// The dots are shapes.ts's shapes, the ones the SVG writes, and every size keeps the print's tone.
import { rgb255, type Oklch } from '../../../shared/color/index.ts';
import { axes } from '../../../shared/halftone/screen.ts';
import type { Cells, CellShape } from '../../../shared/halftone/types.ts';
import { gpuScope, type Gpu, type Instances, type Program, type Texture, type Tile } from '../../lib/gpu/index.ts';
import { overlapOf, type HalftoneDoc } from './doc.ts';
import type { Screened } from './screening.ts';

const SHAPE: Record<CellShape, number> = { round: 0, ellipse: 1, square: 2, diamond: 3, line: 4, cross: 5 };
const MAX_INKS = 6;

// Cells under TONE_AT output px across can't show a dot: each spreads its ink over its own cell
// (a cubic B-spline the cell's size, which sums to exactly the tint). At TONE_AT the view switches to
// the shapes in one step: no blend while zooming (Luap's motion rule: nothing may dissolve).
const TONE_AT = 3;

const DOT_VERTEX = `in vec2 a_pos;
in vec2 a_ab;
in float a_cov;
uniform vec2 u_base;
uniform vec2 u_off;
uniform float u_k;
uniform int u_shape;
uniform vec2 u_cell;
flat out vec2 v_c;
flat out vec2 v_ab;
flat out float v_area;
void main() {
  vec2 ab = a_ab * u_k;
  vec2 cell = u_cell * u_k;
  // the farthest the shape reaches from its centre, in output px, then its filter round it
  float ext = u_shape == 2 ? ab.x * 1.4142136 : (u_shape >= 4 ? length(ab) : ab.x);
  float tone = 1.0 - step(${TONE_AT.toFixed(1)}, cell.y);
  float r = max(max(ext + 1.0, 2.5), tone > 0.0 ? 2.9 * max(max(cell.x, cell.y), 1.0) : 0.0) + 0.5;
  // from a page anchor, output px: an export anchors at the page's own corner, so a dot's centre is
  // the same number in every tile; the view at its region, so deep zoom stays exact
  v_c = (a_pos - u_base) * u_k;
  v_ab = ab;
  v_area = a_cov * cell.x * cell.y;
  gl_Position = a_ab.y > 0.0 ? toClip(v_c - u_off + a_corner * r) : vec4(2.0, 2.0, 2.0, 1.0);
}`;

// Each dot's ink in the pixel, clipped to its own cell: a flat tint's dots are built so the union
// inside a cell is that cell's dot, so the masks add up exactly where joined dots overlap. Boxes
// (square, line, cross) are filtered exactly a pixel wide along and across the screen, so a
// hairline stays a line; round, elliptical and diamond dots take shapes.ts's sdf, with dots under
// a pixel laid down by their area. Past 8 px a cell, the clip lets go so a big dot next to a small
// one reaches over as the SVG's does.
const DOT_FRAGMENT = `flat in vec2 v_c;
flat in vec2 v_ab;
flat in float v_area;
uniform vec2 u_axis;
uniform int u_shape;
uniform vec2 u_cell;
uniform float u_k;
uniform float u_reach;
uniform vec2 u_off;
out vec4 o;
float box(vec2 d) { return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float spline(float t) {
  t = abs(t);
  return t < 1.0 ? (4.0 - 6.0 * t * t + 3.0 * t * t * t) / 6.0 : t < 2.0 ? (2.0 - t) * (2.0 - t) * (2.0 - t) / 6.0 : 0.0;
}
// the share of the pixel's span [x - 0.5, x + 0.5] inside [-a, a]
float span(float x, float a) { return clamp(min(x + 0.5, a) - max(x - 0.5, -a), 0.0, 1.0); }
float sdf(vec2 q, vec2 ab) {
  if (u_shape == 0) return length(q) - ab.x;
  if (u_shape == 1) {
    float l = length(q / ab);
    return l > 1e-5 ? (l - 1.0) * l / length(q / (ab * ab)) : -ab.y;
  }
  float h = ab.x * 0.70710678;
  return box(vec2(q.x + q.y, abs(q.x - q.y)) * 0.70710678 - h);
}
float cover(vec2 p, vec2 hc) {
  vec2 q = abs(vec2(dot(p, u_axis), dot(p, vec2(-u_axis.y, u_axis.x))));
  float d = max(sdf(q, v_ab), box(q - hc));
  return clamp(0.5 - 2.0 * d, 0.0, 1.0);
}
void main() {
  // the pixel's centre from the same anchor (whole px added to a half px: exact in any tile)
  vec2 p = fragPixel() + u_off - v_c;
  vec2 uv = vec2(dot(p, u_axis), dot(p, vec2(-u_axis.y, u_axis.x)));
  vec2 cell = u_cell * u_k;
  vec2 hc = cell * 0.5;
  float ink;
  if (u_shape == 2 || u_shape == 4) {
    vec2 h = min(v_ab, hc);
    ink = span(uv.x, h.x) * span(uv.y, h.y);
  } else if (u_shape == 5) {
    float a = min(v_ab.x, hc.x);
    float b = min(v_ab.y, hc.x);
    ink = span(uv.x, a) * span(uv.y, b) + span(uv.x, b) * span(uv.y, a) - span(uv.x, b) * span(uv.y, b);
  } else {
    vec2 h = hc + u_reach * cell;
    float edge = 0.25 * (cover(p + vec2(-0.125, -0.375), h) + cover(p + vec2(0.375, -0.125), h) + cover(p + vec2(0.125, 0.375), h) + cover(p + vec2(-0.375, 0.125), h));
    float small = v_area * spline(p.x) * spline(p.y);
    ink = mix(small, edge, smoothstep(0.3, 0.7, min(v_ab.x, v_ab.y)));
  }
  vec2 s = max(cell, vec2(1.0));
  float tone = v_area * spline(uv.x / s.x) * spline(uv.y / s.y) / (s.x * s.y);
  o = vec4(mix(tone, ink, step(${TONE_AT.toFixed(1)}, cell.y)), 0.0, 0.0, 1.0);
}`;

// an FM plate (print pixels, one ink a channel) averaged over each output pixel's footprint; the
// plate comes in tiles no larger than a texture may be, each pass adding the samples in its own
const FM_FRAGMENT = `uniform sampler2D u_fm;
uniform int u_ch;
uniform vec2 u_origin;
uniform float u_k;
uniform vec2 u_page;
uniform vec4 u_tile;
out vec4 o;
void main() {
  vec2 p = fragPixel() - u_rect.xy;
  float span = 1.0 / u_k;
  int n = int(clamp(ceil(span), 1.0, 8.0));
  vec2 q0 = (u_origin + p - 0.5) * span;
  float sum = 0.0;
  for (int j = 0; j < 8; j++) {
    if (j >= n) break;
    for (int i = 0; i < 8; i++) {
      if (i >= n) break;
      vec2 q = clamp(floor(q0 + (vec2(float(i), float(j)) + 0.5) * span / float(n)), vec2(0.0), u_page - 1.0) - u_tile.xy;
      if (q.x >= 0.0 && q.y >= 0.0 && q.x < u_tile.z && q.y < u_tile.w) sum += texelFetch(u_fm, ivec2(q), 0)[u_ch];
    }
  }
  o = vec4(sum / float(n * n), 0.0, 0.0, 1.0);
}`;

// the print model of separate.ts on sRGB-encoded values, with the print feel on top
const COMPOSITE = `uniform sampler2D u_m0;
uniform sampler2D u_m1;
uniform sampler2D u_m2;
uniform sampler2D u_m3;
uniform sampler2D u_m4;
uniform sampler2D u_m5;
uniform int u_n;
uniform vec3 u_ink[6];
uniform vec3 u_paper;
uniform int u_knockout;
uniform int u_clear;
uniform float u_grain;
uniform vec2 u_mm0;
uniform float u_mmPerPx;
out vec4 o;
float mask(int i, vec2 p) {
  ivec2 q = ivec2(floor(p));
  if (i == 0) return texelFetch(u_m0, clamp(q, ivec2(0), textureSize(u_m0, 0) - 1), 0).r;
  if (i == 1) return texelFetch(u_m1, clamp(q, ivec2(0), textureSize(u_m1, 0) - 1), 0).r;
  if (i == 2) return texelFetch(u_m2, clamp(q, ivec2(0), textureSize(u_m2, 0) - 1), 0).r;
  if (i == 3) return texelFetch(u_m3, clamp(q, ivec2(0), textureSize(u_m3, 0) - 1), 0).r;
  if (i == 4) return texelFetch(u_m4, clamp(q, ivec2(0), textureSize(u_m4, 0) - 1), 0).r;
  return texelFetch(u_m5, clamp(q, ivec2(0), textureSize(u_m5, 0) - 1), 0).r;
}
float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(floor(p)) + 65536);
  uint h = (q.x * 1597334677u) ^ (q.y * 3812015801u);
  h = (h ^ (h >> 16)) * 2246822519u;
  return float(h >> 8) / 16777215.0;
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = fragPixel() - u_rect.xy;
  vec3 paper = u_clear == 1 ? vec3(1.0) : u_paper;
  float starve = 0.0;
  if (u_grain > 0.0) {
    vec2 mm = u_mm0 + p * u_mmPerPx;
    float fibre = noise(mm * vec2(11.0, 7.0)) * 0.6 + noise(mm * 2.3) * 0.4;
    paper *= 1.0 - u_grain * 0.08 * fibre;
    starve = u_grain * 0.55 * smoothstep(0.45, 0.95, noise(mm * vec2(23.0, 17.0) + 31.0));
  }
  vec3 c = vec3(1.0);
  float open = 1.0;
  vec3 seen = vec3(0.0);
  for (int i = 0; i < 6; i++) {
    if (i >= u_n) break;
    float m = clamp(mask(i, p), 0.0, 1.0) * (1.0 - starve);
    c *= 1.0 - m * (1.0 - u_ink[i]);
    open *= 1.0 - m;
  }
  if (u_knockout == 1) {
    // from the top ink down: each shows its own colour where it prints and nothing above it does;
    // the paper shows only where no ink prints (the SVG's stacked fills)
    float free = 1.0;
    for (int i = 5; i >= 0; i--) {
      if (i >= u_n) continue;
      float m = clamp(mask(i, p), 0.0, 1.0) * (1.0 - starve);
      seen += m * free * u_ink[i];
      free *= 1.0 - m;
    }
    c = seen + free * paper;
  } else {
    c *= paper;
  }
  if (u_clear == 1) {
    float a = 1.0 - open;
    o = a > 1e-5 ? vec4(clamp((c - (1.0 - a)) / a, 0.0, 1.0), a) : vec4(0.0);
  } else {
    o = vec4(c, 1.0);
  }
}`;

/** How the inks look: those that show, in printing order, on which paper. `shift` is in page px. */
export type Look = {
  inks: { index: number; colour: [number, number, number]; shift: [number, number] }[];
  paper: [number, number, number];
  knockout: boolean;
  /** leave the paper out: clear where no ink prints */
  clear: boolean;
  grain: number;
};

const encoded = (o: Oklch): [number, number, number] => rgb255(o).map((v) => v / 255) as [number, number, number];

// each plate's own direction off register, and how far of the whole it goes; the first stays put
const DRIFT = [
  [0, 0.25],
  [2.3, 1],
  [4.2, 0.8],
  [0.5, 0.65],
  [3.3, 0.9],
  [5.4, 0.7],
];

/** The document's look: print feel on for the view (and a PNG that bakes it), off for everything else. */
export function lookOf(d: HalftoneDoc, feel: boolean, clear = false): Look {
  const mis = feel ? (d.feel.misregister * d.size.dpi) / 25.4 : 0;
  return {
    inks: d.inks
      .map((ink, index) => ({ ink, index }))
      .filter((x) => x.ink.visible)
      .map(({ ink, index }) => {
        const [angle, r] = DRIFT[index % DRIFT.length];
        return { index, colour: encoded(ink.colour), shift: [Math.cos(angle) * r * mis, Math.sin(angle) * r * mis] as [number, number] };
      }),
    paper: encoded(d.paper.colour),
    knockout: overlapOf(d) === 'knockout',
    clear,
    grain: feel ? d.feel.texture : 0,
  };
}

/**
 * One plate as film, black ink on white (the separations view and the TIFF plates). Knocked out,
 * the inks that print after it and show clear it where they print, as the press needs: otherwise
 * every lower ink would print under the top one.
 */
export function filmOf(d: HalftoneDoc, index: number): Look {
  const above = overlapOf(d) === 'knockout' ? d.inks.flatMap((ink, i) => (i > index && ink.visible ? [i] : [])) : [];
  return {
    inks: [index, ...above].map((i, n) => ({ index: i, colour: n ? [1, 1, 1] : [0, 0, 0], shift: [0, 0] })),
    paper: [1, 1, 1],
    knockout: above.length > 0,
    clear: false,
    grain: 0,
  };
}

/** the instance buffer, made only to upload: each cell's centre, then its dot (a, b, inked coverage) */
function interleave(c: Cells, dots: Float32Array): Float32Array {
  const out = new Float32Array(c.n * 5);
  for (let k = 0, o = 0, q = 0; k < c.n; k++, o += 5, q += 3) {
    out[o] = c.x[k];
    out[o + 1] = c.y[k];
    out[o + 2] = dots[q];
    out[o + 3] = dots[q + 1];
    out[o + 4] = dots[q + 2];
  }
  return out;
}

/** how far past its cell a round, elliptical or diamond dot may reach, in cells, at `px` output px a cell */
const reachAt = (px: number) => Math.min(1, Math.max(0, (px - 8) / 8)) * 0.55;

type Fm = { tex: Texture; x: number; y: number; w: number; h: number };

/** A screen's dots and plates on the GPU, drawn into regions of the page at any scale. */
export class Painter {
  readonly g: Gpu;
  #key = '';
  #dots: (Instances | null)[] = [];
  /** per group of four inks, the FM plates' tiles */
  #fm: Fm[][] = [];
  #masks: Texture[] = [];
  #empty: Texture | null = null;
  #nothing: Instances | null = null;
  #target: Texture | null = null;
  #programs: { dot: Program; fm: Program; composite: Program };

  constructor(label: string) {
    this.g = gpuScope(label);
    this.#programs = { dot: this.g.program(DOT_FRAGMENT, DOT_VERTEX), fm: this.g.program(FM_FRAGMENT), composite: this.g.program(COMPOSITE) };
  }

  /** the screen's instances and FM plates, uploaded once per screen */
  load(s: Screened): void {
    if (this.#key === s.key) return;
    this.#free();
    this.#dots = s.inks.map((ink) => (ink.cells && ink.dots && ink.cells.n ? this.g.instances(interleave(ink.cells, ink.dots), { a_pos: 2, a_ab: 2, a_cov: 1 }) : null));
    const fm = s.inks.map((ink) => ink.fm);
    if (fm.some(Boolean)) {
      const [w, h] = [Math.round(s.page.w), Math.round(s.page.h)];
      // a page may be longer than a texture may be: it goes up in tiles
      const T = Math.min(4096, this.g.maxSize);
      for (let t = 0; t < fm.length; t += 4) {
        const tiles: Fm[] = [];
        for (let y = 0; y < h; y += T) {
          for (let x = 0; x < w; x += T) {
            const [tw, th] = [Math.min(T, w - x), Math.min(T, h - y)];
            // four inks to a texture, one a channel: 1 where it prints
            const data = new Uint8Array(tw * th * 4);
            for (let c = 0; c < 4 && t + c < fm.length; c++) {
              const plate = fm[t + c]!;
              for (let row = 0; row < th; row++) {
                const [from, to] = [(y + row) * w + x, row * tw];
                for (let i = 0; i < tw; i++) data[(to + i) * 4 + c] = 255 - plate[from + i];
              }
            }
            tiles.push({ tex: this.g.texture({ width: tw, height: th, data }, 'rgba8', { filter: 'nearest' }), x, y, w: tw, h: th });
          }
        }
        this.#fm.push(tiles);
      }
    }
    this.#key = s.key;
  }

  /** forget what was uploaded, which a context loss took with it */
  reset(): void {
    this.#key = '';
    this.#dots = [];
    this.#fm = [];
    this.#masks = [];
    this.#empty = null;
    this.#nothing = null;
    this.#target = null;
  }

  #free(): void {
    this.#dots.forEach((d) => d?.release());
    this.#fm.flat().forEach((t) => t.tex.release());
    this.#dots = [];
    this.#fm = [];
  }

  #mask(i: number, w: number, h: number): Texture {
    const m = this.#masks[i];
    if (m && m.width === w && m.height === h) return m;
    m?.release();
    return (this.#masks[i] = this.g.texture({ width: w, height: h }, 'r16f', { filter: 'nearest' }));
  }

  /**
   * The page at `k` output px per page px into `output` (a texture, or one tile of a larger image),
   * `size` output px from `at`: the page point at `at` / k, in output px. An export passes whole
   * numbers and `whole`, so each tile draws its part as a single image would.
   */
  paint(s: Screened, look: Look, at: [number, number], k: number, output: Texture | Tile, size: { w: number; h: number }, whole = false): void {
    this.load(s);
    const base = whole ? [0, 0] : [at[0] / k, at[1] / k];
    const { dot, fm, composite } = this.#programs;
    const inputs: Record<string, Texture> = {};
    const colours: number[] = [];
    const shape = s.doc.screen.shape as CellShape;
    look.inks.slice(0, MAX_INKS).forEach((x, j) => {
      const out = this.#mask(j, size.w, size.h);
      const ink = s.inks[x.index];
      const inst = this.#dots[x.index];
      // each ink's own mask, its region moved by its misregistration, so none outgrows the view
      const origin = [at[0] - x.shift[0] * k, at[1] - x.shift[1] * k];
      if (ink.fm) this.#fmPass(fm, out, x.index, origin, k, s, size);
      else if (inst && ink.cells) {
        const { ux, uy } = axes(ink.cells.angle);
        const cell = [ink.cells.step, ink.cells.pitch];
        this.g.pass(dot, {
          output: out,
          instances: inst,
          blend: 'add',
          clear: [0, 0, 0, 0],
          uniforms: { u_base: base, u_off: [origin[0] - base[0] * k, origin[1] - base[1] * k], u_k: k, u_shape: SHAPE[shape], u_cell: cell, u_axis: [ux, uy], u_reach: reachAt(ink.cells.pitch * k) },
        });
      } else this.#blank(out);
      inputs[`u_m${j}`] = out;
      colours.push(...x.colour);
    });
    for (let j = look.inks.length; j < MAX_INKS; j++) {
      inputs[`u_m${j}`] = (this.#empty ??= this.g.texture({ width: 1, height: 1 }, 'r16f'));
      colours.push(1, 1, 1);
    }
    const mmPerPx = 25.4 / s.doc.size.dpi / k;
    this.g.pass(composite, {
      output,
      inputs,
      uniforms: {
        u_n: Math.min(MAX_INKS, look.inks.length),
        u_ink: colours,
        u_paper: look.paper,
        u_knockout: look.knockout ? 1 : 0,
        u_clear: look.clear ? 1 : 0,
        u_grain: look.grain,
        u_mm0: [at[0] * mmPerPx, at[1] * mmPerPx],
        u_mmPerPx: mmPerPx,
      },
    });
  }

  /** an FM ink's mask: each tile of its plate under the region adds its share */
  #fmPass(fm: Program, out: Texture, index: number, origin: number[], k: number, s: Screened, size: { w: number; h: number }): void {
    const [x0, y0] = [origin[0] / k - 1, origin[1] / k - 1];
    const [x1, y1] = [(origin[0] + size.w) / k + 1, (origin[1] + size.h) / k + 1];
    let first = true;
    for (const t of this.#fm[index >> 2] ?? []) {
      if (t.x > x1 || t.y > y1 || t.x + t.w < x0 || t.y + t.h < y0) continue;
      this.g.pass(fm, {
        output: out,
        inputs: { u_fm: t.tex },
        blend: 'add',
        clear: first ? [0, 0, 0, 0] : undefined,
        uniforms: { u_ch: index & 3, u_origin: origin, u_k: k, u_page: [Math.round(s.page.w), Math.round(s.page.h)], u_tile: [t.x, t.y, t.w, t.h] },
      });
      first = false;
    }
    if (first) this.#blank(out);
  }

  /** a mask with nothing on it still needs its clear */
  #blank(out: Texture): void {
    this.#nothing ??= this.g.instances(new Float32Array(5), { a_pos: 2, a_ab: 2, a_cov: 1 });
    this.g.pass(this.#programs.dot, { output: out, clear: [0, 0, 0, 0], instances: this.#nothing, uniforms: { u_base: [0, 0], u_off: [0, 0], u_k: 1, u_shape: 0, u_cell: [1, 1], u_axis: [1, 0], u_reach: 0 } });
  }

  /** the region as a bitmap for a canvas (null while the GPU is lost) */
  bitmap(s: Screened, look: Look, at: [number, number], k: number, w: number, h: number): ImageBitmap | null {
    if (this.g.lost) return null;
    const out = this.#out(w, h);
    this.paint(s, look, at, k, out, { w, h });
    return this.g.bitmap(out);
  }

  #out(w: number, h: number): Texture {
    if (this.#target && this.#target.width === w && this.#target.height === h) return this.#target;
    this.#target?.release();
    return (this.#target = this.g.texture({ width: w, height: h }, 'rgba8'));
  }

  /** frees every texture and buffer (a hidden tool) */
  release(): void {
    this.g.release();
    this.reset();
  }
}
