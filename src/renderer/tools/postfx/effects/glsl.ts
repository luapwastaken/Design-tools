// Shader text every effect pass starts with (after lib/gpu's own prelude). Values are straight alpha
// and sRGB-encoded, as the screen shows them; the passes that mix light (blurs, bloom, leaks) go
// through linear light and back. Hashes are integer maths, so noise is the same on every GPU, and
// loopNoise repeats in time, so a moving effect's last frame runs into its first with no jump.
export const PRELUDE = `uniform sampler2D u_src;
out vec4 o;
const float PI = 3.14159265359;
const float TAU = 6.28318530718;

vec4 here() { return texelFetch(u_src, ivec2(fragPixel()), 0); }
vec4 at(vec2 p) { return texture(u_src, p / vec2(textureSize(u_src, 0))); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float maxOf(vec3 c) { return max(c.r, max(c.g, c.b)); }

// the sRGB curve, mirrored below 0 so half-float headroom either side survives the round trip
vec3 toLinear(vec3 c) {
  vec3 a = abs(c);
  return sign(c) * mix(a / 12.92, pow((a + 0.055) / 1.055, vec3(2.4)), step(0.04045, a));
}
vec3 toEncoded(vec3 l) {
  vec3 a = abs(l);
  return sign(l) * mix(a * 12.92, 1.055 * pow(a, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, a));
}

// light added to a pixel: where it was clear, the light brings its own alpha
vec4 addLight(vec4 c, vec3 light) {
  vec3 sum = toLinear(c.rgb) * c.a + light;
  float a = max(c.a, clamp(maxOf(light), 0.0, 1.0));
  return a > 0.0 ? vec4(toEncoded(sum / a), a) : vec4(0.0);
}

uint bits(uint v) {
  v ^= v >> 16u;
  v *= 0x7feb352du;
  v ^= v >> 15u;
  v *= 0x846ca68bu;
  v ^= v >> 16u;
  return v;
}
float hash(ivec3 p) {
  uvec3 q = uvec3(p);
  return float(bits(q.x ^ bits(q.y ^ bits(q.z + 0x9e3779b9u))) >> 8u) / 16777215.0;
}
float smoothed(float f) { return f * f * (3.0 - 2.0 * f); }
float vnoise(vec2 p, int seed) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  f = vec2(smoothed(f.x), smoothed(f.y));
  float a = hash(ivec3(i, seed));
  float b = hash(ivec3(i + ivec2(1, 0), seed));
  float c = hash(ivec3(i + ivec2(0, 1), seed));
  float d = hash(ivec3(i + ivec2(1, 1), seed));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// value noise in p and z whose lattice wraps every whole period of z: z = t * period loops with t
float loopNoise(vec2 p, float z, int period) {
  float zf = floor(z);
  int z0 = int(mod(zf, float(period)));
  int z1 = (z0 + 1) % period;
  return mix(vnoise(p, z0 * 7919), vnoise(p, z1 * 7919), smoothed(z - zf));
}
`;

/** a pass's fragment shader: the prelude, then `body` (declare its uniforms, write main() into o) */
export const fx = (body: string): string => PRELUDE + body;
