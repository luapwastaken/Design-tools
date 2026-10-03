// The one composite every layer shares: the effect's result over the layer's input, by its blend
// mode and opacity. Screen, overlay and soft light are defined on 0 to 1, so they read their
// inputs clamped; normal, multiply and add keep half-float headroom.
import { fx } from './glsl.ts';
import type { Blend } from './types.ts';

export const BLENDS: readonly { id: Blend; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'multiply', label: 'Multiply' },
  { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' },
  { id: 'soft-light', label: 'Soft light' },
  { id: 'add', label: 'Add' },
];

export const blendIndex = (b: Blend): number => Math.max(0, BLENDS.findIndex((x) => x.id === b));

export const COMPOSITE = fx(`uniform sampler2D u_base;
uniform sampler2D u_fx;
uniform int u_mode;
uniform float u_opacity;
vec3 softLight(vec3 b, vec3 s) {
  vec3 d = mix(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25)));
  return mix(b + (2.0 * s - 1.0) * (d - b), b - (1.0 - 2.0 * s) * b * (1.0 - b), step(s, vec3(0.5)));
}
vec3 blended(vec3 b, vec3 s) {
  if (u_mode == 1) return b * s;
  if (u_mode == 5) return b + s;
  if (u_mode == 0) return s;
  b = clamp(b, 0.0, 1.0);
  s = clamp(s, 0.0, 1.0);
  if (u_mode == 2) return 1.0 - (1.0 - b) * (1.0 - s);
  if (u_mode == 3) return mix(1.0 - 2.0 * (1.0 - b) * (1.0 - s), 2.0 * b * s, step(b, vec3(0.5)));
  return softLight(b, s);
}
void main() {
  ivec2 p = ivec2(fragPixel());
  vec4 b = texelFetch(u_base, p, 0);
  vec4 f = texelFetch(u_fx, p, 0);
  // mixed as premultiplied colour, so where the effect changed alpha the colours still weigh right
  float a = mix(b.a, f.a, u_opacity);
  vec3 c = mix(b.rgb * b.a, blended(b.rgb, f.rgb) * f.a, u_opacity);
  o = a > 0.0 ? vec4(c / a, a) : vec4(0.0);
}`);
