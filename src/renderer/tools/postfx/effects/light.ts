// Light and lens: bloom, vignette, chromatic aberration, light leak, lens distortion.
import { blurShader } from './blur.ts';
import { fx } from './glsl.ts';
import { choice, colour, num, perLoop, turn } from './params.ts';
import type { Effect } from './types.ts';

// what's above the threshold, as light, blurred across; then down, then added back
const BRIGHT_ACROSS = blurShader({
  from: 'image',
  to: 'light',
  head: 'uniform float u_threshold;\nuniform float u_knee;',
  load: 'vec4 c = at(p);\n  float k = smoothstep(u_threshold, u_threshold + u_knee, luma(c.rgb)) * c.a;\n  return vec4(toLinear(c.rgb) * k, k);',
});
const GLOW_DOWN = blurShader({ from: 'light', to: 'light' });
const BLOOM = fx(`uniform sampler2D u_glow;
uniform float u_gain;
uniform vec3 u_tint;
void main() {
  vec4 g = texelFetch(u_glow, ivec2(fragPixel()), 0);
  o = addLight(here(), g.rgb * u_gain * toLinear(u_tint));
}`);

export const bloom: Effect = {
  id: 'bloom',
  label: 'Bloom',
  group: 'light',
  about: 'Bright areas glow, added as light',
  params: [
    num('threshold', 'Threshold', 0, 100, 1, 70, '%'),
    num('knee', 'Softness', 0, 50, 1, 10, '%'),
    num('intensity', 'Intensity', 0, 300, 1, 80, '%'),
    num('radius', 'Radius', 1, 200, 0.5, 24, 'px'),
    colour('tint', 'Tint', [1, 0, 0]),
  ],
  passes(c) {
    const sigma = Math.max(0.3, c.n('radius') * c.scale);
    const across = c.run(BRIGHT_ACROSS, { u_dir: [1, 0], u_sigma: sigma, u_threshold: c.n('threshold') / 100, u_knee: Math.max(1e-3, c.n('knee') / 100) });
    const glow = c.run(GLOW_DOWN, { u_dir: [0, 1], u_sigma: sigma }, { inputs: { u_src: across } });
    c.drop(across);
    const out = c.run(BLOOM, { u_gain: c.n('intensity') / 100, u_tint: c.rgb('tint') }, { inputs: { u_glow: glow } });
    c.drop(glow);
    return out;
  },
};

const VIGNETTE = fx(`uniform float u_amount;
uniform float u_size;
uniform float u_soft;
uniform float u_round;
uniform vec2 u_centre;
uniform vec3 u_colour;
void main() {
  vec4 c = here();
  vec2 halfSize = u_full * 0.5;
  // round: a circle; 0: an oval with the frame's proportions. Either way the corners sit at 1.41
  vec2 r = mix(halfSize, vec2(length(halfSize) * 0.70710678), u_round);
  float d = length((fragPixel() - u_centre * u_full) / r);
  float v = 1.0 - smoothstep(max(u_size - u_soft, 0.0), u_size, d);
  o = vec4(mix(u_colour, c.rgb, mix(1.0, v, u_amount)), c.a);
}`);

export const vignette: Effect = {
  id: 'vignette',
  label: 'Vignette',
  group: 'light',
  about: 'Darkens toward the edges',
  params: [
    num('amount', 'Amount', 0, 100, 1, 40, '%'),
    num('size', 'Size', 10, 200, 1, 110, '%'),
    num('softness', 'Softness', 1, 100, 1, 70, '%'),
    num('roundness', 'Roundness', 0, 100, 1, 100, '%'),
    num('x', 'Centre X', 0, 100, 1, 50, '%'),
    num('y', 'Centre Y', 0, 100, 1, 50, '%'),
    colour('colour', 'Colour', [0, 0, 0], 0),
  ],
  passes: (c) =>
    c.run(VIGNETTE, {
      u_amount: c.n('amount') / 100,
      u_size: c.n('size') / 100,
      u_soft: c.n('softness') / 100,
      u_round: c.n('roundness') / 100,
      u_centre: [c.n('x') / 100, c.n('y') / 100],
      u_colour: c.rgb('colour'),
    }),
};

const CHROMATIC = fx(`uniform float u_amount;
uniform int u_radial;
uniform vec2 u_along;
uniform float u_falloff;
void main() {
  vec2 p = fragPixel();
  vec2 d = u_along * u_amount;
  if (u_radial == 1) {
    // grows toward the corners, where it reaches u_amount
    vec2 q = (p - u_full * 0.5) / length(u_full * 0.5);
    d = q * pow(max(length(q), 1e-4), u_falloff - 1.0) * u_amount;
  }
  vec4 r = at(p + d);
  vec4 g = here();
  vec4 b = at(p - d);
  o = vec4(r.r, g.g, b.b, max(g.a, max(r.a, b.a)));
}`);

export const chromatic: Effect = {
  id: 'chromatic',
  label: 'Chromatic aberration',
  group: 'light',
  about: 'Colour fringes where red and blue split apart',
  params: [
    num('amount', 'Amount', 0, 100, 0.5, 6, 'px'),
    choice('mode', 'Mode', ['Radial', 'Linear']),
    num('angle', 'Angle', 0, 360, 1, 0, '°'),
    num('falloff', 'Falloff', 0.5, 4, 0.1, 1.5),
  ],
  passes(c) {
    const a = (c.n('angle') * Math.PI) / 180;
    return c.run(CHROMATIC, { u_amount: c.n('amount') * c.scale, u_radial: c.n('mode') === 0 ? 1 : 0, u_along: [Math.cos(a), Math.sin(a)], u_falloff: c.n('falloff') });
  },
};

const LEAK = fx(`uniform vec3 u_first;
uniform vec3 u_second;
uniform float u_amount;
uniform vec2 u_p1;
uniform vec2 u_p2;
uniform float u_r1;
uniform float u_r2;
void main() {
  vec2 p = fragPixel();
  vec2 d1 = p - u_p1;
  vec2 d2 = p - u_p2;
  float g1 = exp(-dot(d1, d1) / (2.0 * u_r1 * u_r1));
  float g2 = exp(-dot(d2, d2) / (2.0 * u_r2 * u_r2));
  o = addLight(here(), (toLinear(u_first) * g1 + toLinear(u_second) * g2) * u_amount);
}`);

export const lightLeak: Effect = {
  id: 'light-leak',
  label: 'Light leak',
  group: 'light',
  about: 'Warm light washing in from one side, drifting as it plays',
  moving: true,
  params: [
    colour('first', 'Colour', [0.78, 0.16, 55]),
    colour('second', 'Second colour', [0.66, 0.2, 15]),
    num('intensity', 'Intensity', 0, 150, 1, 60, '%'),
    num('size', 'Size', 10, 150, 1, 60, '%'),
    num('from', 'From', 0, 360, 1, 315, '°'),
    num('drift', 'Drift', 0, 100, 1, 80, '%'),
    num('cycles', 'Speed', 0, 1, 0.25, 0.5, '/s'),
  ],
  passes(c) {
    // two glows off one side of the frame, each going round its own small closed path once a cycle
    const D = Math.hypot(c.w, c.h) / 2;
    const side = (c.n('from') * Math.PI) / 180;
    const cycles = perLoop(c.n('cycles'), c.seconds);
    const a = turn(c.t, cycles);
    // Light brought in and out of the frame is what changes a frame's brightness, so how fast it
    // travels is held to a cycle every 2 s at full drift: a loop too short for that wanders less
    const wander = (c.n('drift') / 100) * 0.09 * D * Math.min(1, (0.5 * c.seconds) / Math.max(1, cycles));
    const at = (angle: number, dist: number, dx: number, dy: number) => [
      c.w / 2 + Math.cos(angle) * dist * D + dx * wander,
      c.h / 2 + Math.sin(angle) * dist * D + dy * wander,
    ];
    const size = c.n('size') / 100;
    return c.run(LEAK, {
      u_first: c.rgb('first'),
      u_second: c.rgb('second'),
      u_amount: c.n('intensity') / 100,
      u_p1: at(side, 0.75, Math.cos(a), Math.sin(2 * a) * 0.5),
      u_p2: at(side + 0.6, 0.85, Math.cos(a + 2.1), Math.sin(a + 2.1)),
      u_r1: size * 0.45 * D,
      u_r2: size * 0.3 * D,
    });
  },
};

const LENS = fx(`uniform float u_k;
uniform float u_zoom;
uniform int u_edge;
void main() {
  vec2 mid = u_full * 0.5;
  float D = length(mid);
  vec2 q = (fragPixel() - mid) / D / u_zoom;
  q *= 1.0 + u_k * dot(q, q);
  vec2 uv = (q * D + mid) / u_full;
  bool outside = any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)));
  if (u_edge == 0 && outside) {
    o = vec4(0.0);
    return;
  }
  if (u_edge == 2) uv = 1.0 - abs(1.0 - mod(uv, 2.0));
  o = texture(u_src, uv);
}`);

export const lens: Effect = {
  id: 'lens',
  label: 'Lens distortion',
  group: 'light',
  about: 'Barrel or pincushion distortion, as a wide or long lens bends straight lines',
  params: [
    num('amount', 'Amount', -100, 100, 1, 20, '%', 0),
    num('zoom', 'Zoom', 50, 200, 1, 100, '%'),
    choice('edge', 'Edges', ['Clear', 'Stretch', 'Mirror'], 1),
  ],
  passes: (c) => c.run(LENS, { u_k: (c.n('amount') / 100) * 0.6, u_zoom: c.n('zoom') / 100, u_edge: c.n('edge') }),
};
