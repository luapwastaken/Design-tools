// GLSL shared by the passes: integer hashing (the same on any GPU), value noise, and the paper,
// which paper.ts mirrors in TypeScript for the tests.
import { LEVEL, SCALES } from '../paper.ts';
import { glslFloat as f } from './km.ts';

export const HASH = `
uint hash(uint x) { x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16; return x; }
float rnd(ivec2 p, uint s) { return float(hash(uint(p.x) * 0x8da6b343u ^ hash(uint(p.y) * 0xd8163841u ^ s)) >> 8) / 16777216.0; }
float vnoise(vec2 x, uint s) {
  ivec2 i = ivec2(floor(x));
  vec2 t = fract(x);
  t = t * t * (3.0 - 2.0 * t);
  return mix(mix(rnd(i, s), rnd(i + ivec2(1, 0), s), t.x), mix(rnd(i + ivec2(0, 1), s), rnd(i + ivec2(1, 1), s), t.x), t.y);
}
`;

/** r: height, g: mottle, b: fibre */
export const PAPER = `${HASH}
out vec4 o;
float nodules(vec2 x, uint s) {
  ivec2 i = ivec2(floor(x));
  vec2 t = x - floor(x);
  float d = 9.0;
  for (int y = -1; y <= 1; y++) for (int k = -1; k <= 1; k++) {
    ivec2 c = i + ivec2(k, y);
    vec2 r = vec2(k, y) + vec2(rnd(c, s), rnd(c, s + 7u)) - t;
    d = min(d, dot(r, r));
  }
  return sqrt(max(0.0, 1.0 - d / 0.55));
}
float fbm(vec2 x, uint s) {
  float a = 0.5, t = 0.0;
  for (int k = 0; k < 4; k++) {
    t += a * vnoise(x, s + uint(k) * 101u);
    x = vec2(1.6 * x.x - 1.2 * x.y, 1.2 * x.x + 1.6 * x.y);
    a *= 0.5;
  }
  return t / 0.9375;
}
void main() {
  vec2 p = fragPixel();
  float n = 0.66 * nodules(p / ${f(SCALES.nodules)}, 1u) + 0.34 * nodules(p / ${f(SCALES.fine)} + 17.0, 2u);
  float swell = fbm(p / ${f(SCALES.swell)}, 3u);
  float ang = fbm(p / ${f(SCALES.turn)}, 4u) * 6.283;
  vec2 q = vec2(cos(ang) * p.x - sin(ang) * p.y, sin(ang) * p.x + cos(ang) * p.y);
  float fibre = vnoise(vec2(q.x / ${f(SCALES.fibre[0])}, q.y / ${f(SCALES.fibre[1])}), 5u);
  float h = clamp((0.55 * n + 0.28 * swell + 0.17 * fibre - ${f(LEVEL.centre)}) * ${f(LEVEL.contrast)} + 0.5, 0.0, 1.0);
  o = vec4(h, fbm(p / ${f(SCALES.mottle)}, 6u), fibre, 1.0);
}
`;
