// Distort: wave, twirl, kaleidoscope. Each moves where a pixel reads from; nothing changes brightness.
import { fx } from './glsl.ts';
import { choice, num, toggle, turn } from './params.ts';
import type { Effect } from './types.ts';

const WAVE = fx(`uniform int u_ripple;
uniform float u_amp;
uniform float u_length;
uniform vec2 u_along;
uniform float u_phase;
uniform vec2 u_centre;
void main() {
  vec2 p = fragPixel();
  vec2 q;
  if (u_ripple == 1) {
    vec2 d = p - u_centre * u_full;
    float r = length(d);
    q = p + (r > 1e-3 ? d / r : vec2(0.0)) * u_amp * sin(TAU * r / u_length - u_phase);
  } else {
    q = p + vec2(-u_along.y, u_along.x) * u_amp * sin(TAU * dot(p, u_along) / u_length - u_phase);
  }
  o = at(q);
}`);

export const wave: Effect = {
  id: 'wave',
  label: 'Wave',
  group: 'distort',
  about: 'Waves or ripples that bend the image, travelling whole wavelengths a loop',
  moving: true,
  params: [
    choice('mode', 'Mode', ['Waves', 'Ripples']),
    num('amplitude', 'Amplitude', 0, 200, 0.5, 12, 'px'),
    num('wavelength', 'Wavelength', 4, 2000, 1, 160, 'px'),
    num('direction', 'Direction', 0, 360, 1, 90, '°'),
    num('phase', 'Phase', 0, 360, 1, 0, '°'),
    num('cycles', 'Cycles', 0, 8, 1, 1, '/loop'),
    num('x', 'Centre X', 0, 100, 1, 50, '%'),
    num('y', 'Centre Y', 0, 100, 1, 50, '%'),
  ],
  passes(c) {
    const a = (c.n('direction') * Math.PI) / 180;
    return c.run(WAVE, {
      u_ripple: c.n('mode'),
      u_amp: c.n('amplitude') * c.scale,
      u_length: c.n('wavelength') * c.scale,
      u_along: [Math.cos(a), Math.sin(a)],
      u_phase: (c.n('phase') * Math.PI) / 180 + turn(c.t, c.n('cycles')),
      u_centre: [c.n('x') / 100, c.n('y') / 100],
    });
  },
};

const TWIRL = fx(`uniform float u_angle;
uniform float u_radius;
uniform vec2 u_centre;
void main() {
  vec2 c = u_centre * u_full;
  vec2 d = fragPixel() - c;
  float k = 1.0 - smoothstep(0.0, u_radius, length(d));
  float a = u_angle * k * k;
  float s = sin(a);
  float co = cos(a);
  o = at(c + vec2(d.x * co - d.y * s, d.x * s + d.y * co));
}`);

export const twirl: Effect = {
  id: 'twirl',
  label: 'Twirl',
  group: 'distort',
  about: 'Twists the image around a centre',
  params: [
    num('angle', 'Angle', -720, 720, 1, 180, '°', 0),
    num('radius', 'Radius', 1, 150, 1, 50, '%'),
    num('x', 'Centre X', 0, 100, 1, 50, '%'),
    num('y', 'Centre Y', 0, 100, 1, 50, '%'),
  ],
  passes: (c) =>
    c.run(TWIRL, {
      u_angle: (c.n('angle') * Math.PI) / 180,
      u_radius: Math.max(1, (c.n('radius') / 100) * Math.min(c.w, c.h)),
      u_centre: [c.n('x') / 100, c.n('y') / 100],
    }),
};

const KALEIDOSCOPE = fx(`uniform float u_segments;
uniform float u_rotate;
uniform float u_zoom;
uniform vec2 u_centre;
uniform int u_mirror;
void main() {
  vec2 c = u_centre * u_full;
  vec2 d = (fragPixel() - c) / u_zoom;
  float r = length(d);
  vec2 q = c;
  if (r > 1e-4) {
    float wedge = TAU / u_segments;
    float a = mod(atan(d.y, d.x) + u_rotate, wedge);
    if (u_mirror == 1) a = abs(a - wedge * 0.5);
    q = c + vec2(cos(a), sin(a)) * r;
  }
  // past the image's edge it reflects back in, so every wedge is full
  vec2 uv = 1.0 - abs(1.0 - mod(q / u_full, 2.0));
  o = texture(u_src, uv);
}`);

export const kaleidoscope: Effect = {
  id: 'kaleidoscope',
  label: 'Kaleidoscope',
  group: 'distort',
  about: 'Mirrored wedges around a centre',
  params: [
    num('segments', 'Segments', 2, 24, 1, 6),
    num('rotation', 'Rotation', 0, 360, 1, 0, '°'),
    num('zoom', 'Zoom', 20, 300, 1, 100, '%'),
    toggle('mirror', 'Mirror each wedge', true),
    num('x', 'Centre X', 0, 100, 1, 50, '%'),
    num('y', 'Centre Y', 0, 100, 1, 50, '%'),
  ],
  passes: (c) =>
    c.run(KALEIDOSCOPE, {
      u_segments: c.n('segments'),
      u_rotate: (c.n('rotation') * Math.PI) / 180,
      u_zoom: c.n('zoom') / 100,
      u_centre: [c.n('x') / 100, c.n('y') / 100],
      u_mirror: c.on('mirror') ? 1 : 0,
    }),
};
