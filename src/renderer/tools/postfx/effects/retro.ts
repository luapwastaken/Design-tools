// Texture and retro: film grain, scanlines/CRT, VHS, glitch, pixel stretch. Nothing here flickers
// or strobes (spec §5 q3): no brightness pulses, no flashing static, and what moves is periodic in
// the loop, so it repeats with no jump.
import { fx } from './glsl.ts';
import { choice, num, tick, toggle } from './params.ts';
import type { Effect } from './types.ts';

const GRAIN = fx(`uniform float u_amount;
uniform float u_size;
uniform float u_shadows;
uniform int u_colour;
uniform int u_seed;
void main() {
  vec4 c = here();
  vec2 q = fragPixel() / u_size;
  int s = u_seed * 3;
  vec3 n = u_colour == 1 ? vec3(vnoise(q, s), vnoise(q, s + 1), vnoise(q, s + 2)) : vec3(vnoise(q, s));
  // grains finer than a pixel average out as they would in the full-size image seen this small
  float w = mix(1.0, 1.0 - clamp(luma(c.rgb), 0.0, 1.0), u_shadows) * min(1.0, u_size);
  o = vec4(c.rgb + (n - 0.5) * u_amount * w, c.a);
}`);

export const grain: Effect = {
  id: 'grain',
  label: 'Film grain',
  group: 'retro',
  about: 'Film grain that can boil, changing a set number of times a loop',
  moving: true,
  params: [
    num('amount', 'Amount', 0, 100, 1, 15, '%'),
    num('size', 'Size', 0.5, 8, 0.1, 1.5, 'px'),
    toggle('colour', 'Colour grain', false),
    num('shadows', 'In the shadows', 0, 100, 1, 0, '%'),
    num('boil', 'Boil', 0, 60, 1, 24, '/loop'),
  ],
  passes: (c) =>
    c.run(GRAIN, {
      u_amount: c.n('amount') / 100,
      u_size: Math.max(0.05, c.n('size') * c.scale),
      u_shadows: c.n('shadows') / 100,
      u_colour: c.on('colour') ? 1 : 0,
      u_seed: tick(c.t, c.n('boil')),
    }),
};

// Lines and the mask finer than this render can show are drawn as their average, so a small
// preview darkens as the full-size export does instead of beating into moiré.
const CRT = fx(`uniform float u_lines;
uniform float u_scan;
uniform float u_mask;
uniform float u_triad;
uniform float u_curve;
void main() {
  vec2 cc = fragPixel() / u_full * 2.0 - 1.0;
  cc *= 1.0 + u_curve * 0.25 * dot(cc, cc);
  vec2 uv = cc * 0.5 + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) {
    o = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec4 c = texture(u_src, uv);
  float lines = 0.5 + 0.5 * cos(TAU * uv.y * u_lines);
  float shows = 1.0 - smoothstep(0.25, 0.45, u_lines / u_full.y);
  float scan = 1.0 - u_scan * mix(0.5, 1.0 - lines, shows);
  vec3 phosphor = 0.5 + 0.5 * cos(TAU * (fragPixel().x / u_triad - vec3(0.0, 1.0, 2.0) / 3.0));
  vec3 mask = mix(vec3(1.0), phosphor * 1.6 + 0.2, u_mask * smoothstep(2.0, 3.0, u_triad));
  o = vec4(c.rgb * scan * mask, c.a);
}`);

export const crt: Effect = {
  id: 'crt',
  label: 'Scanlines / CRT',
  group: 'retro',
  about: 'Scanlines, a phosphor mask and a curved screen, without flicker',
  params: [
    num('lines', 'Lines', 50, 2000, 10, 480),
    num('scanlines', 'Scanlines', 0, 100, 1, 40, '%'),
    num('mask', 'Phosphor mask', 0, 100, 1, 25, '%'),
    num('triad', 'Mask size', 1, 12, 0.5, 3, 'px'),
    num('curve', 'Curvature', 0, 100, 1, 15, '%'),
  ],
  passes: (c) =>
    c.run(CRT, { u_lines: c.n('lines'), u_scan: c.n('scanlines') / 100, u_mask: c.n('mask') / 100, u_triad: c.n('triad') * c.scale, u_curve: c.n('curve') / 100 }),
};

// A VHS line is 2 px of the full-size image. The tracking band rolls down and wraps round, so the
// light it adds is always all in the frame; the brightness under it never pulses.
const VHS = fx(`uniform float u_wobble;
uniform float u_bleed;
uniform float u_noise;
uniform float u_track;
uniform float u_band;
uniform float u_z;
uniform int u_period;
uniform int u_seed;
uniform float u_line;
void main() {
  vec2 p = fragPixel();
  vec2 uv = p / u_full;
  float line = floor(p.y / u_line);
  int li = int(line);
  float band = (1.0 - smoothstep(0.0, 0.07, abs(fract(uv.y - u_band + 0.5) - 0.5))) * u_track;
  float x = (loopNoise(vec2(line * 0.08, 0.5), u_z, u_period) - 0.5) * 2.0 * u_wobble;
  x += band * (hash(ivec3(li, u_seed, 7)) - 0.5) * 24.0 * u_line;
  x += smoothstep(0.965, 1.0, uv.y) * (loopNoise(vec2(line * 0.4, 9.5), u_z, u_period) - 0.2) * 16.0 * u_line;
  vec2 q = p + vec2(x, 0.0);
  vec4 c = at(q);
  if (u_bleed >= 0.5) {
    // the colour trails off to the right while the brightness stays sharp
    vec3 sum = c.rgb;
    float total = 1.0;
    for (int i = 1; i <= 12; i++) {
      float w = 1.0 - float(i) / 13.0;
      sum += at(q - vec2(float(i) * u_bleed / 12.0, 0.0)).rgb * w;
      total += w;
    }
    sum /= total;
    c.rgb = sum + (luma(c.rgb) - luma(sum));
  }
  float n = (vnoise(p / u_line, u_seed) - 0.5) * u_noise * 0.3 * min(1.0, u_line);
  float streak = band * step(0.7, hash(ivec3(li, u_seed, 3))) * vnoise(vec2(p.x / (10.0 * u_line), line), u_seed + 11) * 0.35;
  o = vec4(c.rgb + n + streak, c.a);
}`);

export const vhs: Effect = {
  id: 'vhs',
  label: 'VHS',
  group: 'retro',
  about: 'Tape wobble, colour bleed and a rolling tracking band',
  moving: true,
  params: [
    num('wobble', 'Wobble', 0, 40, 0.5, 3, 'px'),
    num('bleed', 'Colour bleed', 0, 60, 1, 12, 'px'),
    num('noise', 'Noise', 0, 100, 1, 30, '%'),
    num('tracking', 'Tracking', 0, 100, 1, 30, '%'),
    num('speed', 'Speed', 0, 8, 1, 1, '/loop'),
  ],
  passes(c) {
    const speed = c.n('speed');
    const period = Math.max(1, speed * 8);
    return c.run(VHS, {
      u_wobble: c.n('wobble') * c.scale,
      u_bleed: c.n('bleed') * c.scale,
      u_noise: c.n('noise') / 100,
      u_track: c.n('tracking') / 100,
      u_band: 0.3 + ((c.t * speed) % 1),
      u_z: speed ? c.t * period : 0,
      u_period: period,
      u_seed: tick(c.t, speed * 24),
      u_line: Math.max(0.25, 2 * c.scale),
    });
  },
};

const GLITCH = fx(`uniform float u_amount;
uniform float u_bands;
uniform float u_split;
uniform int u_seed;
void main() {
  vec2 uv = fragPixel() / u_full;
  int row = int(floor(uv.y * u_bands));
  int fine = int(floor(uv.y * u_bands * 4.0));
  float shift = 0.0;
  if (hash(ivec3(row, u_seed, 1)) < u_amount * 0.5) shift += (hash(ivec3(row, u_seed, 2)) - 0.5) * u_amount * 0.3;
  if (hash(ivec3(fine, u_seed, 3)) < u_amount * 0.15) shift += (hash(ivec3(fine, u_seed, 4)) - 0.5) * u_amount * 0.1;
  float s = u_split / u_full.x * (shift != 0.0 ? 1.0 : 0.35);
  float x = uv.x + shift;
  vec4 r = texture(u_src, vec2(fract(x + s), uv.y));
  vec4 g = texture(u_src, vec2(fract(x), uv.y));
  vec4 b = texture(u_src, vec2(fract(x - s), uv.y));
  o = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`);

export const glitch: Effect = {
  id: 'glitch',
  label: 'Glitch',
  group: 'retro',
  about: 'Bands knocked sideways and colour channels split apart',
  moving: true,
  params: [
    num('amount', 'Amount', 0, 100, 1, 40, '%'),
    num('bands', 'Bands', 4, 200, 1, 32),
    num('split', 'RGB split', 0, 50, 0.5, 6, 'px'),
    num('changes', 'Changes', 0, 48, 1, 8, '/loop'),
    num('seed', 'Pattern', 0, 999, 1, 1),
  ],
  passes: (c) =>
    c.run(GLITCH, {
      u_amount: c.n('amount') / 100,
      u_bands: c.n('bands'),
      u_split: c.n('split') * c.scale,
      u_seed: c.n('seed') * 1000 + tick(c.t, c.n('changes')),
    }),
};

// Each pixel finds the nearest trigger pixel behind it (up to the length) by jump flooding: a pass
// per power of two, each looking that far back, so a 2000 px streak costs 12 passes, not 2000 reads.
const FAR = 60000;
const STRETCH_SEED = fx(`uniform float u_threshold;
uniform int u_dark;
void main() {
  vec4 c = here();
  float l = luma(c.rgb);
  bool hit = (u_dark == 1 ? 1.0 - l : l) > u_threshold && c.a > 0.0;
  o = vec4(hit ? 0.0 : ${FAR}.0, 0.0, 0.0, 1.0);
}`);
const STRETCH_JUMP = fx(`uniform sampler2D u_dist;
uniform vec2 u_back;
uniform float u_jump;
void main() {
  ivec2 p = ivec2(fragPixel());
  float d = texelFetch(u_dist, p, 0).r;
  ivec2 q = p + ivec2(u_back * u_jump);
  if (all(greaterThanEqual(q, ivec2(0))) && all(lessThan(q, textureSize(u_dist, 0)))) d = min(d, texelFetch(u_dist, q, 0).r + u_jump);
  o = vec4(d, 0.0, 0.0, 1.0);
}`);
const STRETCH = fx(`uniform sampler2D u_dist;
uniform vec2 u_back;
uniform float u_length;
void main() {
  ivec2 p = ivec2(fragPixel());
  float d = texelFetch(u_dist, p, 0).r;
  o = texelFetch(u_src, d <= u_length ? p + ivec2(u_back * d) : p, 0);
}`);

/** px to look back along, per direction: the streak runs right, left, down or up */
const BACK = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export const pixelStretch: Effect = {
  id: 'pixel-stretch',
  label: 'Pixel stretch',
  group: 'retro',
  about: 'Pixels past a brightness threshold smear into long streaks',
  params: [
    num('threshold', 'Threshold', 0, 100, 1, 60, '%'),
    num('length', 'Length', 0, 2000, 1, 240, 'px'),
    choice('direction', 'Direction', ['Right', 'Left', 'Down', 'Up']),
    choice('trigger', 'Trigger', ['Bright', 'Dark']),
  ],
  passes(c) {
    const length = Math.round(c.n('length') * c.scale);
    if (length < 1) return c.input;
    const back = BACK[c.n('direction')];
    let dist = c.run(STRETCH_SEED, { u_threshold: c.n('threshold') / 100, u_dark: c.n('trigger') });
    for (let jump = 2 ** Math.floor(Math.log2(length)); jump >= 1; jump /= 2) {
      const next = c.run(STRETCH_JUMP, { u_back: back, u_jump: jump }, { inputs: { u_dist: dist } });
      c.drop(dist);
      dist = next;
    }
    return c.run(STRETCH, { u_back: back, u_length: length }, { inputs: { u_dist: dist } });
  },
};
