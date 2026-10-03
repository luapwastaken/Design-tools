// The painting as seen, and in and out of 8 bits:
//   LIT: the paper's relief lit from the top left, thick paint filling the tooth and showing its
//        ridges. Display only: never saved, never picked.
//   SCREEN: LIT resampled to the canvas's device px (a box filter when shrinking) and sRGB-encoded.
//   ENCODE: the painting as sRGB bytes with its height in alpha (the CPU copy and the saved PNG).
//   DECODE: those bytes back into the painting; or a v1 painting (1024 × 640, opaque, on white),
//           upscaled 2x, its white as bare paper and its paint laid over the paper's colour.
const SRGB = `
vec3 enc(vec3 c) { c = clamp(c, 0.0, 1.0); return mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 dec(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
`;

export const LIT = `
uniform sampler2D u_shown, u_paper;
uniform float u_relief, u_fill, u_stand, u_wash, u_mottle;
out vec4 o;
float H(ivec2 p) {
  p = clamp(p, ivec2(0), textureSize(u_shown, 0) - 1);
  float a = clamp((texelFetch(u_shown, p, 0).a - u_wash) / (1.0 - u_wash), 0.0, 1.0);
  return texelFetch(u_paper, p, 0).r * (1.0 - u_fill * a) + u_stand * a;
}
void main() {
  ivec2 p = ivec2(fragPixel());
  vec4 s = texelFetch(u_shown, p, 0);
  float a = clamp((s.a - u_wash) / (1.0 - u_wash), 0.0, 1.0);
  // the sheet's pulp, a slow mottle a little lighter and darker (thick paint hides it)
  float pulp = 1.0 + u_mottle * (texelFetch(u_paper, p, 0).g - 0.5) * (1.0 - a);
  float slope = H(p + ivec2(1, 0)) - H(p - ivec2(1, 0)) + H(p + ivec2(0, 1)) - H(p - ivec2(0, 1));
  o = vec4(s.rgb * pulp * (1.0 + u_relief * 0.5 * slope), 1.0);
}`;

export const SCREEN = `${SRGB}
uniform sampler2D u_lit;
/** painting px per screen px */
uniform vec2 u_scale;
out vec4 o;
void main() {
  vec2 sp = fragPixel();
  vec2 size = vec2(textureSize(u_lit, 0));
  vec3 c = vec3(0.0);
  if (u_scale.x > 1.0 || u_scale.y > 1.0) {
    // every painting px under this screen px, weighted by how much of it is under
    vec2 a = (sp - 0.5) * u_scale, b = (sp + 0.5) * u_scale;
    ivec2 lo = ivec2(floor(a)), hi = ivec2(ceil(b));
    float wsum = 0.0;
    for (int j = 0; j < 12; j++) {
      int y = lo.y + j;
      if (y >= hi.y) break;
      float wy = min(b.y, float(y + 1)) - max(a.y, float(y));
      for (int i = 0; i < 12; i++) {
        int x = lo.x + i;
        if (x >= hi.x) break;
        float w = wy * (min(b.x, float(x + 1)) - max(a.x, float(x)));
        c += w * texelFetch(u_lit, clamp(ivec2(x, y), ivec2(0), ivec2(size) - 1), 0).rgb;
        wsum += w;
      }
    }
    c /= wsum;
  } else {
    c = texture(u_lit, sp * u_scale / size).rgb;
  }
  o = vec4(enc(c), 1.0);
}`;

export const ENCODE = `${SRGB}
uniform sampler2D u_base;
out vec4 o;
void main() {
  vec4 c = texelFetch(u_base, ivec2(fragPixel()), 0);
  o = vec4(enc(c.rgb), clamp(c.a, 0.0, 1.0));
}`;

export const DECODE = `${SRGB}
uniform sampler2D u_src;
uniform float u_v1;
uniform vec3 u_paperRgb;
layout(location = 0) out vec4 o_base;
layout(location = 1) out vec4 o_shown;
vec4 v1(ivec2 p) {
  vec4 c = texelFetch(u_src, clamp(p, ivec2(0), textureSize(u_src, 0) - 1), 0);
  if (all(greaterThanEqual(c.rgb, vec3(253.5 / 255.0)))) return vec4(u_paperRgb, 0.0);
  return vec4(dec(c.rgb) * u_paperRgb, 0.25);
}
void main() {
  vec2 p = fragPixel();
  vec2 size = vec2(textureSize(u_src, 0));
  vec4 r;
  if (u_v1 > 0.5) {
    // bilinear, after telling paper from paint, so edges stay soft
    vec2 q = p * size / u_full - 0.5;
    ivec2 i = ivec2(floor(q));
    vec2 t = q - floor(q);
    r = mix(mix(v1(i), v1(i + ivec2(1, 0)), t.x), mix(v1(i + ivec2(0, 1)), v1(i + ivec2(1, 1)), t.x), t.y);
  } else if (size == u_full) {
    vec4 c = texelFetch(u_src, ivec2(p), 0);
    r = vec4(dec(c.rgb), c.a);
  } else {
    vec4 c = texture(u_src, p / u_full);
    r = vec4(dec(c.rgb), c.a);
  }
  o_base = r;
  o_shown = r;
}`;
