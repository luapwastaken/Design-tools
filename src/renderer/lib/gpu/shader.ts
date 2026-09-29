// Shader text for the GPU engine (index.ts): the prelude every program gets, and GL's compile log
// mapped back onto the caller's own lines. Pure, so it is unit tested (test/gpu.test.ts).
import { GpuError } from './errors.ts';

export type Stage = 'vertex' | 'fragment';

/** set by the engine on every draw; a pass never gives them */
export const ENGINE_UNIFORMS = new Set(['u_rect', 'u_full', 'u_flip']);

// Rows run top down everywhere: texel row 0, framebuffer row 0 and read() row 0 are the image's top.
// Only the screen canvas runs bottom up, so drawing there flips (u_flip), and nothing else ever does
// (inventory: v1's SVG came out mirrored against its GPU preview).
const COMMON = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec4 u_rect;
uniform vec2 u_full;
uniform float u_flip;
`;

const VERTEX_HEAD = `${COMMON}in vec2 a_corner;
vec4 toClip(vec2 px) {
  vec2 c = (px - u_rect.xy) / u_rect.zw * 2.0 - 1.0;
  return vec4(c.x, c.y * u_flip, 0.0, 1.0);
}
`;

const FRAGMENT_HEAD = `${COMMON}vec2 fragPixel() {
  vec2 f = gl_FragCoord.xy;
  if (u_flip < 0.0) f.y = u_rect.w - f.y;
  return u_rect.xy + f;
}
`;

/** the vertex shader of a program given only a fragment shader: one quad over the output */
export const FULL_VERTEX = `out vec2 v_uv;
void main() {
  v_uv = (u_rect.xy + (a_corner * 0.5 + 0.5) * u_rect.zw) / u_full;
  gl_Position = vec4(a_corner.x, a_corner.y * u_flip, 0.0, 1.0);
}`;

const head = (stage: Stage) => (stage === 'vertex' ? VERTEX_HEAD : FRAGMENT_HEAD);

/** The source GL compiles: the prelude, then `body` as written. */
export function assemble(stage: Stage, body: string): string {
  if (/^\s*#\s*version\b/m.test(body)) throw new GpuError(`Leave #version out of the ${stage} shader; the engine adds it.`);
  return head(stage) + body;
}

/**
 * GL's log with its line numbers moved back onto `body`, each error followed by that line:
 *   fragment shader, line 3: 'x' : undeclared identifier
 *     3 | o = vec4(x);
 */
export function explain(stage: Stage, log: string, body: string): string {
  const skip = head(stage).split('\n').length - 1;
  const lines = body.split('\n');
  return log
    .replaceAll('\0', '') // ANGLE ends its logs with a NUL
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(?:ERROR|WARNING): \d+:(\d+): (.*)$/.exec(l);
      if (!m) return l;
      const n = Number(m[1]) - skip;
      if (n < 1) return `${stage} shader prelude, line ${m[1]}: ${m[2]}`;
      const src = lines[n - 1];
      return `${stage} shader, line ${n}: ${m[2]}${src === undefined ? '' : `\n  ${n} | ${src.trim()}`}`;
    })
    .join('\n');
}
