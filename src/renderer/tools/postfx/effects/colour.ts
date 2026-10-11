// Colour: grade (lift, gamma, gain), gradient map, duotone. Values may leave 0 to 1 between passes
// (half floats), so a grade that pushes past white and one that pulls back lose nothing.
import { fx } from './glsl.ts';
import { colour, num } from './params.ts';
import type { Effect } from './types.ts';

const GRADE = fx(`uniform float u_lift;
uniform float u_gamma;
uniform float u_gain;
uniform float u_sat;
void main() {
  vec4 c = here();
  vec3 x = c.rgb * u_gain + u_lift * (1.0 - c.rgb);
  x = sign(x) * pow(abs(x), vec3(1.0 / u_gamma));
  o = vec4(mix(vec3(luma(x)), x, u_sat), c.a);
}`);

export const grade: Effect = {
  id: 'grade',
  label: 'Grade',
  group: 'colour',
  about: 'Lift, gamma and gain for the shadows, midtones and highlights, and saturation',
  params: [
    num('lift', 'Lift', -50, 50, 1, 0, '%', 0),
    num('gamma', 'Gamma', 0.2, 5, 0.01, 1, undefined, 1),
    num('gain', 'Gain', 0, 400, 1, 100, '%'),
    num('saturation', 'Saturation', 0, 200, 1, 100, '%'),
  ],
  passes: (c) => c.run(GRADE, { u_lift: c.n('lift') / 100, u_gamma: c.n('gamma'), u_gain: c.n('gain') / 100, u_sat: c.n('saturation') / 100 }),
};

const INVERT = fx(`void main() {
  vec4 c = here();
  o = vec4(1.0 - c.rgb, c.a);
}`);

export const invert: Effect = {
  id: 'invert',
  label: 'Invert',
  group: 'colour',
  about: 'The negative: every colour swapped for its opposite',
  params: [],
  passes: (c) => c.run(INVERT),
};

const GRADIENT_MAP = fx(`uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform float u_mid;
void main() {
  vec4 c = here();
  float l = clamp(luma(c.rgb), 0.0, 1.0);
  vec3 g = l < u_mid ? mix(u_c0, u_c1, l / u_mid) : mix(u_c1, u_c2, (l - u_mid) / (1.0 - u_mid));
  o = vec4(g, c.a);
}`);

export const gradientMap: Effect = {
  id: 'gradient-map',
  label: 'Gradient map',
  group: 'colour',
  about: 'Maps the image from dark to light onto three colours',
  params: [
    colour('shadows', 'Shadows', [0.24, 0.09, 290], 0),
    colour('midtones', 'Midtones', [0.56, 0.16, 5], 0.5),
    colour('highlights', 'Highlights', [0.94, 0.06, 85], 1),
    num('midpoint', 'Midpoint', 5, 95, 1, 50, '%'),
  ],
  passes: (c) => c.run(GRADIENT_MAP, { u_c0: c.rgb('shadows'), u_c1: c.rgb('midtones'), u_c2: c.rgb('highlights'), u_mid: c.n('midpoint') / 100 }),
};

const DUOTONE = fx(`uniform vec3 u_dark;
uniform vec3 u_light;
uniform float u_contrast;
void main() {
  vec4 c = here();
  float l = clamp((luma(c.rgb) - 0.5) * (1.0 + u_contrast * 4.0) + 0.5, 0.0, 1.0);
  o = vec4(mix(u_dark, u_light, l), c.a);
}`);

export const duotone: Effect = {
  id: 'duotone',
  label: 'Duotone',
  group: 'colour',
  about: 'Two colours, one for the shadows and one for the highlights',
  params: [
    colour('dark', 'Dark', [0.26, 0.08, 255], 0),
    colour('light', 'Light', [0.93, 0.05, 90], 1),
    num('contrast', 'Contrast', 0, 100, 1, 0, '%'),
  ],
  passes: (c) => c.run(DUOTONE, { u_dark: c.rgb('dark'), u_light: c.rgb('light'), u_contrast: c.n('contrast') / 100 }),
};
