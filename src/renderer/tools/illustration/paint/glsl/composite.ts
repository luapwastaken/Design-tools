// The stroke as it lands on the painting, per medium, every frame inside that frame's rect:
//   watercolour: a KM glaze of the film over the painting, its thickness from the water and the
//   hairs, with a crisp wandering edge, a darker rim, a paler middle, pooling and granulation;
//   gouache: a thick KM layer, covering;
//   smudge: the painting's own paint with the carried paint pushed in, as its own colour at full cover,
//   laid by how much was carried (an alpha, so a trail only thins and never shifts hue).
// Untouched pixels come back bit for bit: the spectral round trip isn't an identity on a GPU.
import { HASH } from './common.ts';
import { KM } from './km.ts';

export const COMPOSITE = `${KM}
${HASH}
uniform sampler2D u_base, u_mask, u_k0, u_k1, u_k2, u_k3, u_paper;
uniform float u_mode, u_thick, u_rimK, u_rimW, u_edgeAmp, u_gran, u_hollow, u_wash, u_hairsOnly, u_seed, u_stain, u_wetHeight, u_poolAmount, u_smudgeAlpha, u_dryBoost, u_head, u_headAmount;
uniform vec2 u_pool;
out vec4 o;
void main() {
  ivec2 p = ivec2(fragPixel());
  vec4 base = texelFetch(u_base, p, 0);
  vec4 m = texelFetch(u_mask, p, 0);
  if (m.r <= 0.0 && m.g <= 0.0) { o = base; return; }
  vec4 pap = texelFetch(u_paper, p, 0);
  float x, height, lay = 1.0;
  if (u_mode < 0.5) {
    uint sd = uint(u_seed) * 7919u;
    vec2 q = fragPixel();
    // each wash pools in its own way, fixed on the paper once laid
    float pool = 0.6 * vnoise(q / u_pool.x, sd) + 0.4 * vnoise(q / u_pool.y, sd + 1u);
    float cov;
    if (u_hairsOnly > 0.5) {
      // the dry brush: only its hair marks, crisp, with no wash around them
      cov = smoothstep(0.0, 0.06, m.r);
      x = m.r * u_dryBoost;
    } else {
      float wobble = -vnoise(q / 21.0, sd + 2u);
      // a crisp edge that wanders slowly, catching a little on the tooth
      float e = m.g - 1.0 + wobble * u_edgeAmp - pap.r * 0.9;
      cov = smoothstep(-0.9, 1.1, e);
      // where the water has gone and no hair has yet (a wash's leading edge), the hairs' share is the
      // body's typical one, and the film still holds the stroke's first strength (u_head: what it is now)
      float lead = 1.0 - smoothstep(0.0, 0.3, m.r);
      // the water carries pigment across the whole wash; the hairs add their streaks
      x = (u_wash * m.b + (1.0 - u_wash) * max(m.r, u_headAmount * lead)) * cov * mix(1.0, u_head, lead);
      // pigment runs to the wash's edge as it dries: a darker rim, a paler middle
      x *= 1.0 - u_hollow + u_rimK * exp(-max(e, 0.0) / u_rimW) * (0.6 + 0.4 * m.b);
    }
    x *= 1.0 - 0.5 * u_poolAmount + u_poolAmount * pool;
    // granulating pigments settle into the tooth's hollows, in fine clumps
    float speck = vnoise(q / 1.6, sd + 5u) + 0.5 * vnoise(q / 3.1, sd + 6u) - 0.75;
    x *= max(0.0, 1.0 + u_gran * ((0.5 - pap.r) * 0.8 + speck * (1.0 + (0.5 - pap.r))));
    height = max(base.a, u_wetHeight * cov * (1.0 - u_stain));
    x *= u_thick;
  } else if (u_mode < 1.5) {
    x = m.r * u_thick;
    float amount = min(1.0, m.r);
    height = max(base.a * (1.0 - amount), amount * (1.0 - u_stain));
  } else {
    x = u_thick;
    lay = clamp(m.r * u_smudgeAlpha, 0.0, 1.0);
    height = base.a;
  }
  if (x <= 0.0 || lay <= 0.0) { o = base; return; }
  vec4 a = texelFetch(u_k0, p, 0), b = texelFetch(u_k1, p, 0), c = texelFetch(u_k2, p, 0), d = texelFetch(u_k3, p, 0);
  Spec K = specOf(a, b, c, d);
  float S = max(d.w, 1e-4);
  Spec under = reflectance(max(base.rgb, vec3(0.0)));
  vec3 laid = max(layerOnColour(base.rgb, under, K, S, x), vec3(0.0));
  o = vec4(u_mode > 1.5 ? mix(base.rgb, laid, lay) : laid, height);
}`;
