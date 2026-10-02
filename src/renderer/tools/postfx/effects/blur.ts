// Blur: gaussian and tilt-shift, and the separable blur bloom shares. Blurs average light, not
// encoded values (inventory: v1 blurred in gamma space), and weight colour by alpha, so a clear
// edge doesn't darken what it touches.
import { fx } from './glsl.ts';
import { num } from './params.ts';
import type { Ctx, Effect } from './types.ts';

/** taps either side of the centre: past this a blur samples every few px, still far finer than its spread */
const MAX_TAPS = 48;

type Blur = {
  /** 'image': the layer's pixels (straight, encoded); 'light': a first pass's premultiplied linear light */
  from: 'image' | 'light';
  to: 'image' | 'light';
  /** GLSL for the spread in px at p (default the uniform u_sigma) */
  sigma?: string;
  /** declarations the sigma or the load needs */
  head?: string;
  /** GLSL body of vec4 load(vec2 p) for an 'image' pass, returning premultiplied linear light */
  load?: string;
};

/** one direction (u_dir, a unit step) of a gaussian blur, as a fragment shader */
export function blurShader(b: Blur): string {
  const load = b.from === 'light' ? 'return at(p);' : (b.load ?? 'vec4 c = at(p);\n  return vec4(toLinear(c.rgb) * c.a, c.a);');
  const store = b.to === 'light' ? 'o = s;' : 'o = s.a > 0.0 ? vec4(toEncoded(s.rgb / s.a), s.a) : vec4(0.0);';
  return fx(`uniform vec2 u_dir;
${b.sigma ? '' : 'uniform float u_sigma;'}
${b.head ?? ''}
vec4 load(vec2 p) {
  ${load}
}
void main() {
  vec2 p = fragPixel();
  float sigma = ${b.sigma ?? 'u_sigma'};
  vec4 s = load(p);
  if (sigma >= 0.3) {
    float reach = 3.0 * sigma;
    float n = min(ceil(reach), ${MAX_TAPS}.0);
    float gap = reach / n;
    float total = 1.0;
    for (int i = 1; i <= ${MAX_TAPS}; i++) {
      if (float(i) > n) break;
      float x = float(i) * gap;
      float w = exp(-0.5 * x * x / (sigma * sigma));
      s += (load(p + u_dir * x) + load(p - u_dir * x)) * w;
      total += 2.0 * w;
    }
    s /= total;
  }
  ${store}
}`);
}

const TO_LIGHT = blurShader({ from: 'image', to: 'light' });
const TO_IMAGE = blurShader({ from: 'light', to: 'image' });

/** the input blurred by `sigma` px (render px), both ways */
export function gaussianOf(c: Ctx, sigma: number) {
  const across = c.run(TO_LIGHT, { u_dir: [1, 0], u_sigma: sigma });
  const out = c.run(TO_IMAGE, { u_dir: [0, 1], u_sigma: sigma }, { inputs: { u_src: across } });
  c.drop(across);
  return out;
}

export const gaussian: Effect = {
  id: 'gaussian',
  label: 'Gaussian blur',
  group: 'blur',
  about: 'A smooth blur, mixed as light',
  params: [num('radius', 'Radius', 0, 200, 0.5, 8, 'px')],
  passes: (c) => (c.n('radius') * c.scale < 0.3 ? c.input : gaussianOf(c, c.n('radius') * c.scale)),
};

// the blur grows with distance from the band's centre line, which the focus moves across the frame
const TILT_HEAD = `uniform float u_offset;
uniform float u_band;
uniform float u_soft;
uniform float u_most;
uniform vec2 u_normal;`;
const TILT_SIGMA = 'u_most * smoothstep(u_band, u_band + u_soft, abs(dot(p - u_full * 0.5, u_normal) - u_offset))';
const TILT_ACROSS = blurShader({ from: 'image', to: 'light', sigma: TILT_SIGMA, head: TILT_HEAD });
const TILT_DOWN = blurShader({ from: 'light', to: 'image', sigma: TILT_SIGMA, head: TILT_HEAD });

export const tiltShift: Effect = {
  id: 'tilt-shift',
  label: 'Tilt-shift',
  group: 'blur',
  about: 'A sharp band with blur either side, like a miniature',
  params: [
    num('focus', 'Focus position', 0, 100, 1, 55, '%'),
    num('width', 'Focus width', 0, 100, 1, 20, '%'),
    num('falloff', 'Falloff', 1, 100, 1, 30, '%'),
    num('blur', 'Blur', 0, 100, 0.5, 16, 'px'),
    num('angle', 'Angle', -90, 90, 1, 0, '°', 0),
  ],
  passes(c) {
    const most = c.n('blur') * c.scale;
    if (most < 0.3) return c.input;
    const a = (c.n('angle') * Math.PI) / 180;
    const normal = [-Math.sin(a), Math.cos(a)];
    // the frame's size across the band, so the focus reaches edge to edge at any angle
    const across = Math.abs(normal[0]) * c.w + Math.abs(normal[1]) * c.h;
    const u = {
      u_offset: (c.n('focus') / 100 - 0.5) * across,
      u_band: (c.n('width') / 200) * across,
      u_soft: (c.n('falloff') / 100) * across,
      u_most: most,
      u_normal: normal,
    };
    const first = c.run(TILT_ACROSS, { ...u, u_dir: [1, 0] });
    const out = c.run(TILT_DOWN, { ...u, u_dir: [0, 1] }, { inputs: { u_src: first } });
    c.drop(first);
    return out;
  },
};
