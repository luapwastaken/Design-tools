// The live stroke's passes: the film's start, pickup per hair and step, the footprint's body, and
// the hairs themselves. Px from the top left, y down, as everywhere in lib/gpu.
import { PLAIN_S } from '../../../../../shared/paint/km15.ts';
import { HASH } from './common.ts';
import { glslFloat as f, KM } from './km.ts';

/** the film (K of 15 groups and S, in four textures) as its four outputs, from locations `at` up */
const filmOuts = (at: number) => [0, 1, 2, 3].map((i) => `layout(location = ${at + i}) out vec4 o_k${i};`).join('\n');
const writeFilm = `o_k0 = K.v0; o_k1 = K.v1; o_k2 = K.v2; o_k3 = vec4(K.v3.xyz, S);`;

/**
 * The stroke's paint before its first dab. Watercolour: the brush's paint. Gouache: that mixed with
 * the paint already there by how much there is (re-wetting). Smudge: the painting itself, as paint,
 * so the hairs push what they carry into it.
 */
export const INIT = `${KM}
uniform sampler2D u_base;
uniform float u_paint[16];
uniform float u_mode, u_rewet;
${filmOuts(0)}
void main() {
  vec4 base = texelFetch(u_base, ivec2(fragPixel()), 0);
  Spec K = Spec(vec4(u_paint[0], u_paint[1], u_paint[2], u_paint[3]), vec4(u_paint[4], u_paint[5], u_paint[6], u_paint[7]), vec4(u_paint[8], u_paint[9], u_paint[10], u_paint[11]), vec4(u_paint[12], u_paint[13], u_paint[14], 0.0));
  float S = u_paint[15];
  float t = u_mode > 1.5 ? 1.0 : clamp(base.a * u_rewet, 0.0, 1.0);
  if (u_mode > 0.5 && t > 0.0) {
    K = mixSpec(K, paintOf(reflectance(max(base.rgb, vec3(0.0))), ${f(PLAIN_S)}), t);
    S = mix(S, ${f(PLAIN_S)}, t);
  }
  ${writeFilm}
}`;

/**
 * Pickup, ahead of the deposit: texel (hair, step) is what that hair carries after that step of
 * this frame. It reads only the painting as it was before the stroke, which the stroke never
 * changes, so a brush never picks up its own trail and every step can be worked out first, with no
 * readback. How much a hair takes follows the paint's height, so staining paints (which sink in
 * and stand lower) resist it. Outputs: K in c0..c3, S in c3.w; c4 = dirt, carried, has.
 */
export const CARRY = (split: 'all' | 'paint' | 'state') => `${KM}
uniform sampler2D u_under, u_pos, u_prm, u_c0, u_c1, u_c2, u_c3, u_c4;
uniform float u_smudge, u_fullHeight, u_dirtMax, u_pushOut, u_prevRow, u_first;
${split === 'state' ? '' : filmOuts(0)}
${split === 'paint' ? '' : `layout(location = ${split === 'all' ? 4 : 0}) out vec4 o_state;`}
void main() {
  ivec2 me = ivec2(fragPixel());
  ivec2 pr = ivec2(me.x, int(u_prevRow));
  vec4 a = vec4(0.0), b = vec4(0.0), c = vec4(0.0), d = vec4(0.0), e = vec4(0.0);
  if (u_first < 0.5) { a = texelFetch(u_c0, pr, 0); b = texelFetch(u_c1, pr, 0); c = texelFetch(u_c2, pr, 0); d = texelFetch(u_c3, pr, 0); e = texelFetch(u_c4, pr, 0); }
  Spec K = specOf(a, b, c, d);
  float S = d.w, dirt = e.x, carried = e.y, has = e.z;
  // a loop whose end the compiler can't know: unrolled 64 times around reflectance() it takes the
  // D3D compiler most of a second to build
  for (int s = 0; s <= me.y; s++) {
    vec4 q = texelFetch(u_pos, ivec2(me.x, s), 0), r = texelFetch(u_prm, ivec2(me.x, s), 0);
    carried = max(0.0, carried - r.z);
    if (r.x > 0.5) {
      vec4 col = vec4(0.0);
      for (int k = -2; k <= 2; k++) col += texelFetch(u_under, clamp(ivec2(q.xy + q.zw * float(k)), ivec2(0), textureSize(u_under, 0) - 1), 0);
      col /= 5.0;
      // what stands on the paper can move: a thin wash gives a little, and a staining paint, sunk
      // in, less than one that sits on top
      float amount = clamp(col.a / u_fullHeight, 0.0, 1.0);
      if (amount >= 0.02) {
        float take = r.y * amount;
        // what's taken joins what's carried by amount, so a light first touch soon counts for little
        float t = take / max((u_smudge > 0.5 ? carried : dirt) + take, 1e-6);
        K = mixSpec(K, paintOf(reflectance(max(col.rgb, vec3(0.0))), ${f(PLAIN_S)}), t);
        S = mix(S, ${f(PLAIN_S)}, t);
        has = 1.0;
        if (u_smudge > 0.5) carried = max(carried, min(1.2 * amount, carried + take * 1.2));
        else dirt = min(u_dirtMax, dirt + take * (1.0 - dirt));
      }
    }
    // fresh paint from the belly of the brush pushes the picked-up paint out again, by distance
    if (u_smudge < 0.5) dirt *= exp(-r.w / u_pushOut);
  }
  ${split === 'state' ? '' : writeFilm}
  ${split === 'paint' ? '' : 'o_state = vec4(dirt, carried, has, 0.0);'}
}`;

/** the brush's whole footprint between two steps: how deep inside the wash a pixel is (the rim), and the water */
export const BODY_VS = `in vec4 a_seg;
in vec4 a_prm;
out vec2 v_local;
flat out float v_len;
flat out vec4 v_prm;
void main() {
  vec2 d = a_seg.zw - a_seg.xy;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float ext = a_prm.x + 2.0;
  float along = mix(-ext, len + ext, a_corner.x * 0.5 + 0.5);
  float across = a_corner.y * ext;
  v_local = vec2(along, across);
  v_len = len;
  v_prm = a_prm;
  gl_Position = toClip(a_seg.xy + dir * along + nrm * across);
}`;

export const BODY_FS = `in vec2 v_local;
flat in float v_len;
flat in vec4 v_prm;
out vec4 o_mask;
void main() {
  float d = length(vec2(v_local.x - clamp(v_local.x, 0.0, v_len), v_local.y));
  float inside = v_prm.x - d + 1.0;
  if (inside <= 0.0) discard;
  float t = v_len > 0.0 ? clamp(v_local.x / v_len, 0.0, 1.0) : 0.0;
  o_mask = vec4(0.0, inside, mix(v_prm.y, v_prm.z, t), 0.0);
}`;

/** one hair's trail between two steps: a capsule, soft across; its paint is the brush's, dirtied by what the hair carries */
export const BRISTLE_VS = `in vec4 a_seg;
in vec4 a_prm;
in vec4 a_prm2;
in float a_step;
in vec3 a_meta;
out vec2 v_local;
flat out vec4 v_prm;
flat out vec4 v_prm2;
flat out float v_len;
flat out vec3 v_meta;
flat out vec4 v_k0;
flat out vec4 v_k1;
flat out vec4 v_k2;
flat out vec4 v_k3;
uniform float u_paint[16];
uniform sampler2D u_c0, u_c1, u_c2, u_c3, u_c4;
uniform float u_useCarry, u_smudge;
void main() {
  vec2 d = a_seg.zw - a_seg.xy;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float ext = a_prm.x + 1.5;
  float along = mix(-ext, len + ext, a_corner.x * 0.5 + 0.5);
  float across = a_corner.y * ext;
  v_local = vec2(along, across);
  v_len = len;
  v_prm = a_prm;
  v_prm2 = a_prm2;
  v_meta = a_meta;
  v_k0 = vec4(u_paint[0], u_paint[1], u_paint[2], u_paint[3]);
  v_k1 = vec4(u_paint[4], u_paint[5], u_paint[6], u_paint[7]);
  v_k2 = vec4(u_paint[8], u_paint[9], u_paint[10], u_paint[11]);
  v_k3 = vec4(u_paint[12], u_paint[13], u_paint[14], u_paint[15]);
  if (u_useCarry > 0.5) {
    ivec2 id = ivec2(int(a_prm.w), int(a_step));
    vec4 e = texelFetch(u_c4, id, 0);
    vec4 c0 = texelFetch(u_c0, id, 0), c1 = texelFetch(u_c1, id, 0), c2 = texelFetch(u_c2, id, 0), c3 = texelFetch(u_c3, id, 0);
    if (u_smudge > 0.5) {
      // a smudge lays only what it carries
      float f = e.z > 0.5 ? min(1.0, e.y) * 0.9 : 0.0;
      v_prm.y *= f;
      v_prm.z *= f;
      v_k0 = c0; v_k1 = c1; v_k2 = c2; v_k3 = c3;
    } else if (e.z > 0.5 && e.x > 0.0) {
      v_k0 = mix(v_k0, c0, e.x); v_k1 = mix(v_k1, c1, e.x); v_k2 = mix(v_k2, c2, e.x); v_k3 = mix(v_k3, c3, e.x);
    }
  }
  gl_Position = toClip(a_seg.xy + dir * along + nrm * across);
}`;

/** mask (MAX) and film (constant blend) at once, or one of them when the GPU can't blend them differently in one draw */
export const BRISTLE_FS = (split: 'all' | 'mask' | 'film') => `${HASH}
uniform sampler2D u_paper;
uniform float u_hard, u_streakLen, u_streak, u_edgeStreak, u_seed;
in vec2 v_local;
flat in vec4 v_prm;
flat in vec4 v_prm2;
flat in float v_len;
flat in vec3 v_meta;
flat in vec4 v_k0;
flat in vec4 v_k1;
flat in vec4 v_k2;
flat in vec4 v_k3;
${split === 'film' ? '' : 'layout(location = 0) out vec4 o_mask;'}
${split === 'mask' ? '' : [0, 1, 2, 3].map((i) => `layout(location = ${(split === 'all' ? 1 : 0) + i}) out vec4 o_k${i};`).join('\n')}
void main() {
  // each capsule owns only the stretch between its two contacts (the caps belong to its neighbours),
  // except a hair's first contact, whose round start is its own: drawn twice, the joints would blend
  // the film twice and stripe the stroke at the step spacing
  if (v_meta.x < 0.5 && (v_local.x < 0.0 || v_local.x >= v_len)) discard;
  float hw = v_prm.x;
  float t = v_len > 0.0 ? clamp(v_local.x / v_len, 0.0, 1.0) : 0.0;
  float d = length(vec2(v_local.x - clamp(v_local.x, 0.0, v_len), v_local.y));
  float prof = 1.0 - smoothstep(hw * u_hard, hw + 0.75, d);
  if (prof <= 0.0) discard;
  // grain in stroke space, at (arc length, hair): overlapping steps agree, so streaks stay continuous
  float s = mix(v_prm2.x, v_prm2.y, t);
  uint id = uint(v_prm.w) + uint(u_seed) * 977u;
  uint clump = uint(v_meta.y) + uint(u_seed) * 613u;
  // hairs of a clump streak together, each a little on its own; edge hairs break up more
  float n = mix(vnoise(vec2(s / u_streakLen, 0.5), 31u + clump * 7u), vnoise(vec2(s / u_streakLen, 0.5), 11u + id), 0.35);
  float fine = vnoise(vec2(s / 2.5, 0.5), 23u + id);
  float amt = mix(v_prm.y, v_prm.z, t) * prof * max(0.0, 1.0 - u_streak * (1.0 + u_edgeStreak * v_meta.z) * (1.0 - n));
  float gate = v_prm2.z;
  if (gate > 0.0) {
    // low on paint, the hair touches only the paper's peaks
    float h = texelFetch(u_paper, ivec2(fragPixel()), 0).r;
    amt *= smoothstep(gate - 0.06, gate + 0.06, h + (fine - 0.5) * 0.22);
  }
  if (amt < 0.004) discard;
  ${split === 'film' ? '' : 'o_mask = vec4(amt, 0.0, 0.0, 0.0);'}
  // watercolour: the paint at the hair's strength (K and S together, so its colour holds)
  ${split === 'mask' ? '' : 'float c = v_prm2.w; o_k0 = v_k0 * c; o_k1 = v_k1 * c; o_k2 = v_k2 * c; o_k3 = v_k3 * c;'}
}`;
