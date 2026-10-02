// Video only: datamosh. Each new frame's motion, found block by block as a codec would, drags the
// last moshed picture along instead of showing the new one, which bleeds in only by Refresh.
//
// Its state is its own (inventory: v1 fed back the whole stack's output, so every re-render and
// every export advanced the smear): the layer's input and output at the last frame and the one
// before. The next frame advances it; the same frame again redraws from the one before, so a
// setting changed while paused never smears further; any other frame (a seek) starts clean. An
// export from frame 0 is therefore the same every time.
import { fx } from './glsl.ts';
import { num } from './params.ts';
import type { Ctx, Effect } from './types.ts';

// one texel per block: where in the last frame its content was, tried on a 7 × 7 grid out to the reach
const MOTION = fx(`uniform sampler2D u_prev;
uniform sampler2D u_cur;
uniform float u_block;
uniform float u_reach;
void main() {
  vec2 corner = floor(fragPixel()) * u_block;
  vec2 size = vec2(textureSize(u_cur, 0));
  float best = 1e9;
  vec2 moved = vec2(0.0);
  for (int j = -3; j <= 3; j++) {
    for (int i = -3; i <= 3; i++) {
      // whole px, so a picture dragged frame after frame never softens
      vec2 d = floor(vec2(float(i), float(j)) * u_reach / 3.0 + 0.5);
      float sad = length(d) * 1e-3;
      for (int y = 0; y < 4; y++) {
        for (int x = 0; x < 4; x++) {
          vec2 s = corner + (vec2(float(x), float(y)) + 0.5) * u_block / 4.0;
          sad += dot(abs(texture(u_cur, s / size) - texture(u_prev, (s + d) / size)), vec4(1.0));
        }
      }
      if (sad < best) {
        best = sad;
        moved = d;
      }
    }
  }
  o = vec4(moved, 0.0, 1.0);
}`);
const MOSH = fx(`uniform sampler2D u_motion;
uniform sampler2D u_last;
uniform float u_block;
uniform float u_refresh;
void main() {
  vec2 p = fragPixel();
  vec2 d = texelFetch(u_motion, ivec2(floor(p / u_block)), 0).xy;
  o = mix(texture(u_last, (p + d) / u_full), here(), u_refresh);
}`);
const COPY = fx(`void main() { o = here(); }`);

/** the next picture into `into`, from the last frame's input and output */
function mosh(c: Ctx, lastIn: string, lastOut: string, into: string): void {
  const block = Math.max(2, Math.round(c.n('block') * c.scale));
  const motion = c.run(
    MOTION,
    { u_block: block, u_reach: Math.max(1, c.n('reach') * c.scale) },
    { inputs: { u_prev: c.keep(lastIn), u_cur: c.input }, size: { w: Math.ceil(c.w / block), h: Math.ceil(c.h / block) } },
  );
  c.run(MOSH, { u_block: block, u_refresh: c.n('refresh') / 100 }, { inputs: { u_motion: motion, u_last: c.keep(lastOut) }, into: c.keep(into) });
}

export const datamosh: Effect = {
  id: 'datamosh',
  label: 'Datamosh',
  group: 'video',
  about: 'Smears the picture along the motion between frames. Video only',
  videoOnly: true,
  params: [
    num('block', 'Block size', 4, 64, 1, 16, 'px'),
    num('reach', 'Reach', 2, 64, 1, 16, 'px'),
    num('refresh', 'Refresh', 0, 100, 1, 4, '%'),
  ],
  passes(c) {
    const f = c.frame ?? 0;
    const m = c.mem;
    // slot `m.at` holds frame m.f, the other slot the frame before it (when m.back is 1)
    const at = m.at ?? 0;
    const other = 1 - at;
    if (m.f === f && m.back === 1) {
      mosh(c, `in${other}`, `out${other}`, `out${at}`);
      c.run(COPY, {}, { into: c.keep(`in${at}`) });
    } else if (m.f === f - 1) {
      mosh(c, `in${at}`, `out${at}`, `out${other}`);
      c.run(COPY, {}, { into: c.keep(`in${other}`) });
      m.at = other;
      m.back = 1;
    } else {
      c.run(COPY, {}, { into: c.keep(`in${at}`) });
      c.run(COPY, {}, { into: c.keep(`out${at}`) });
      m.at = at;
      m.back = 0;
    }
    m.f = f;
    return c.keep(`out${m.at}`);
  },
};
