// Stylise: posterize, edges, Kuwahara paint.
import { fx } from './glsl.ts';
import { colour, num } from './params.ts';
import type { Ctx, Effect } from './types.ts';

const POSTERIZE = fx(`uniform float u_levels;
uniform float u_dither;
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
void main() {
  vec4 c = here();
  ivec2 q = ivec2(fragPixel()) & 3;
  float b = (BAYER[q.y * 4 + q.x] + 0.5) / 16.0 - 0.5;
  float n = u_levels - 1.0;
  o = vec4(clamp(floor(clamp(c.rgb, 0.0, 1.0) * n + 0.5 + b * u_dither) / n, 0.0, 1.0), c.a);
}`);

export const posterize: Effect = {
  id: 'posterize',
  label: 'Posterize',
  group: 'stylise',
  about: 'Fewer tone levels in each channel, with an ordered dither if wanted',
  params: [num('levels', 'Levels', 2, 32, 1, 6), num('dither', 'Dither', 0, 100, 1, 0, '%')],
  passes: (c) => c.run(POSTERIZE, { u_levels: c.n('levels'), u_dither: c.n('dither') / 100 }),
};

// Sobel on brightness and on alpha, so a logo on a clear ground gets its outline too
const EDGE = fx(`uniform float u_strength;
uniform float u_threshold;
uniform float u_width;
uniform vec3 u_line;
uniform vec3 u_fill;
uniform float u_keep;
vec2 la(vec2 p) {
  vec4 c = at(p);
  return vec2(luma(c.rgb) * c.a, c.a);
}
void main() {
  vec2 p = fragPixel();
  float t = u_width;
  vec2 a = la(p + vec2(-t, -t)), b = la(p + vec2(0.0, -t)), c = la(p + vec2(t, -t));
  vec2 d = la(p + vec2(-t, 0.0)), f = la(p + vec2(t, 0.0));
  vec2 g = la(p + vec2(-t, t)), h = la(p + vec2(0.0, t)), i = la(p + vec2(t, t));
  vec2 gx = (c + 2.0 * f + i) - (a + 2.0 * d + g);
  vec2 gy = (g + 2.0 * h + i) - (a + 2.0 * b + c);
  float m = max(length(vec2(gx.x, gy.x)), length(vec2(gx.y, gy.y))) / 4.0;
  float e = smoothstep(u_threshold, u_threshold + 0.2, m) * u_strength;
  vec4 s = here();
  o = vec4(mix(mix(u_fill, s.rgb, u_keep), u_line, e), max(s.a, e));
}`);

export const edge: Effect = {
  id: 'edge',
  label: 'Edges',
  group: 'stylise',
  about: 'Outlines where the brightness changes, over the image or a fill',
  params: [
    num('strength', 'Strength', 0, 100, 1, 100, '%'),
    num('threshold', 'Threshold', 0, 100, 1, 15, '%'),
    num('width', 'Thickness', 0.5, 8, 0.1, 1, 'px'),
    colour('line', 'Line', [0, 0, 0], 0),
    colour('fill', 'Fill', [1, 0, 0], 1),
    num('keep', 'Keep image', 0, 100, 1, 100, '%'),
  ],
  passes: (c) =>
    c.run(EDGE, {
      u_strength: c.n('strength') / 100,
      u_threshold: c.n('threshold') / 100,
      u_width: Math.max(0.5, c.n('width') * c.scale),
      u_line: c.rgb('line'),
      u_fill: c.rgb('fill'),
      u_keep: c.n('keep') / 100,
    }),
};

// The classic four-quadrant filter: each pixel takes the mean of whichever quadrant around it
// varies least. The quadrant means and spreads come from box filters run across then down, so a big
// brush costs a few dozen reads, not a few hundred: one of colour weighted by alpha (so clear pixels
// never darken an edge), one of brightness squared.
const BOX_TAPS = 24;
const BOX = fx(`uniform vec2 u_dir;
uniform float u_r;
uniform int u_load;
vec4 load(vec2 p) {
  vec4 c = at(p);
  float l = luma(c.rgb) * c.a;
  if (u_load == 1) return vec4(c.rgb * c.a, c.a);
  if (u_load == 2) return vec4(l * l, 0.0, 0.0, 1.0);
  return c;
}
void main() {
  vec2 p = fragPixel();
  // whole taps spread evenly over the box, however wide it is at this scale
  float n = min(ceil(u_r) + 1.0, ${BOX_TAPS}.0);
  vec4 s = vec4(0.0);
  for (int i = 0; i < ${BOX_TAPS}; i++) {
    if (float(i) >= n) break;
    s += load(p + u_dir * (-0.5 * u_r + float(i) * u_r / (n - 1.0)));
  }
  o = s / n;
}`);
const KUWAHARA = fx(`uniform sampler2D u_colour;
uniform sampler2D u_spread;
uniform float u_r;
void main() {
  vec2 p = fragPixel();
  vec4 c = here();
  float h = u_r * 0.5;
  vec3 best = c.rgb;
  float least = 1e9;
  for (int i = 0; i < 4; i++) {
    vec2 q = (p + vec2(i % 2 == 0 ? -h : h, i < 2 ? -h : h)) / u_full;
    vec4 s = texture(u_colour, q);
    if (s.a < 1e-3) continue;
    float m = luma(s.rgb);
    float spread = texture(u_spread, q).r - m * m;
    if (spread < least) {
      least = spread;
      best = s.rgb / s.a;
    }
  }
  o = vec4(best, c.a);
}`);

/** the box mean of what `load` reads (1 colour by alpha, 2 brightness squared), across then down */
function box(c: Ctx, r: number, load: number) {
  const across = c.run(BOX, { u_dir: [1, 0], u_r: r, u_load: load });
  const down = c.run(BOX, { u_dir: [0, 1], u_r: r, u_load: 0 }, { inputs: { u_src: across } });
  c.drop(across);
  return down;
}

export const kuwahara: Effect = {
  id: 'kuwahara',
  label: 'Kuwahara paint',
  group: 'stylise',
  about: 'Flat painted strokes that keep the edges crisp',
  params: [num('size', 'Brush size', 1, 24, 1, 5, 'px')],
  passes(c) {
    const r = c.n('size') * c.scale;
    if (r < 0.5) return c.input;
    return c.run(KUWAHARA, { u_r: r }, { inputs: { u_colour: box(c, r, 1), u_spread: box(c, r, 2) } });
  },
};
