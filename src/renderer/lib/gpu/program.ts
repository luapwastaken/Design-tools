// Programs (see index.ts): compiled once per source for the whole app and again after a context
// loss. A shader that fails throws with GL's log; nothing ever falls back to a pass-through.
import { getEngine, isLost, type Engine } from './context.ts';
import { GpuError, GpuLost } from './errors.ts';
import { ENGINE_UNIFORMS, FULL_VERTEX, assemble, explain, type Stage } from './shader.ts';

export type UniformValue = number | boolean | ArrayLike<number>;

type Uniform = { loc: WebGLUniformLocation; type: number; size: number };
export type Linked = {
  gen: number;
  program: WebGLProgram;
  /** by name, arrays without their [0] */
  uniforms: Map<string, Uniform>;
  /** the vertex shader's inputs besides a_corner: what instances must carry */
  attribs: Map<string, { loc: number; size: number }>;
};

const GL = WebGL2RenderingContext;
type Setter = (gl: WebGL2RenderingContext, loc: WebGLUniformLocation, v: number[]) => void;
/** components per element, and the call that sets it */
const SETTERS: Record<number, [number, Setter]> = {
  [GL.FLOAT]: [1, (gl, l, v) => gl.uniform1fv(l, v)],
  [GL.FLOAT_VEC2]: [2, (gl, l, v) => gl.uniform2fv(l, v)],
  [GL.FLOAT_VEC3]: [3, (gl, l, v) => gl.uniform3fv(l, v)],
  [GL.FLOAT_VEC4]: [4, (gl, l, v) => gl.uniform4fv(l, v)],
  [GL.INT]: [1, (gl, l, v) => gl.uniform1iv(l, v)],
  [GL.INT_VEC2]: [2, (gl, l, v) => gl.uniform2iv(l, v)],
  [GL.INT_VEC3]: [3, (gl, l, v) => gl.uniform3iv(l, v)],
  [GL.INT_VEC4]: [4, (gl, l, v) => gl.uniform4iv(l, v)],
  [GL.BOOL]: [1, (gl, l, v) => gl.uniform1iv(l, v)],
  [GL.BOOL_VEC2]: [2, (gl, l, v) => gl.uniform2iv(l, v)],
  [GL.BOOL_VEC3]: [3, (gl, l, v) => gl.uniform3iv(l, v)],
  [GL.BOOL_VEC4]: [4, (gl, l, v) => gl.uniform4iv(l, v)],
  [GL.UNSIGNED_INT]: [1, (gl, l, v) => gl.uniform1uiv(l, v)],
  [GL.UNSIGNED_INT_VEC2]: [2, (gl, l, v) => gl.uniform2uiv(l, v)],
  [GL.UNSIGNED_INT_VEC3]: [3, (gl, l, v) => gl.uniform3uiv(l, v)],
  [GL.UNSIGNED_INT_VEC4]: [4, (gl, l, v) => gl.uniform4uiv(l, v)],
  [GL.FLOAT_MAT2]: [4, (gl, l, v) => gl.uniformMatrix2fv(l, false, v)],
  [GL.FLOAT_MAT3]: [9, (gl, l, v) => gl.uniformMatrix3fv(l, false, v)],
  [GL.FLOAT_MAT4]: [16, (gl, l, v) => gl.uniformMatrix4fv(l, false, v)],
};
const ATTRIB_SIZE: Record<number, number> = { [GL.FLOAT]: 1, [GL.FLOAT_VEC2]: 2, [GL.FLOAT_VEC3]: 3, [GL.FLOAT_VEC4]: 4 };

export class Program {
  readonly fragment: string;
  /** the caller's vertex shader (instanced draws), or null for one quad over the output */
  readonly vertex: string | null;
  #linked: Linked | null = null;

  constructor(fragment: string, vertex: string | null) {
    this.fragment = fragment;
    this.vertex = vertex;
  }

  /** linked in the current context, compiling again after a loss */
  linked(e: Engine): Linked {
    if (this.#linked?.gen !== e.gen) this.#linked = link(e, this.fragment, this.vertex ?? FULL_VERTEX);
    return this.#linked;
  }
}

const cache = new Map<string, Program>();

/** The app's program for this source, compiled now so a broken shader throws where it is written. */
export function program(fragment: string, vertex: string | null = null): Program {
  const key = `${vertex?.length ?? -1}:${vertex ?? ''}${fragment}`;
  let p = cache.get(key);
  if (p) return p;
  p = new Program(fragment, vertex);
  const e = getEngine();
  if (!isLost()) p.linked(e); // while lost it compiles on first use after the restore
  cache.set(key, p);
  return p;
}

function compile(gl: WebGL2RenderingContext, stage: Stage, body: string): WebGLShader {
  const sh = gl.createShader(stage === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER)!;
  gl.shaderSource(sh, assemble(stage, body));
  gl.compileShader(sh);
  if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;
  const log = gl.getShaderInfoLog(sh) ?? '';
  gl.deleteShader(sh);
  if (gl.isContextLost()) throw new GpuLost();
  throw new GpuError(`The ${stage} shader didn't compile.\n${explain(stage, log, body)}`, log);
}

function link(e: Engine, fragment: string, vertex: string): Linked {
  const { gl } = e;
  const vs = compile(gl, 'vertex', vertex);
  let fs: WebGLShader;
  try {
    fs = compile(gl, 'fragment', fragment);
  } catch (err) {
    gl.deleteShader(vs);
    throw err;
  }
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'a_corner');
  gl.linkProgram(program);
  gl.deleteShader(vs); // only flagged: they go with the program
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? '';
    gl.deleteProgram(program);
    if (gl.isContextLost()) throw new GpuLost();
    throw new GpuError(`The shaders didn't link.\n${log.replaceAll('\0', '').trim()}`, log);
  }
  const uniforms = new Map<string, Uniform>();
  for (let i = 0, n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i < n; i++) {
    const { name, type, size } = gl.getActiveUniform(program, i)!;
    const loc = gl.getUniformLocation(program, name);
    if (!loc) continue; // a uniform block member
    if (type !== gl.SAMPLER_2D && !SETTERS[type]) throw new GpuError(`${name} is a kind of uniform the engine can't set; use floats, ints, vectors, matrices or sampler2D.`);
    if (type === gl.SAMPLER_2D && size > 1) throw new GpuError(`${name} is an array of samplers; give each texture its own sampler2D.`);
    uniforms.set(name.replace(/\[0\]$/, ''), { loc, type, size });
  }
  const attribs = new Map<string, { loc: number; size: number }>();
  for (let i = 0, n = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES); i < n; i++) {
    const { name, type, size } = gl.getActiveAttrib(program, i)!;
    if (name === 'a_corner' || name.startsWith('gl_')) continue;
    if (!ATTRIB_SIZE[type] || size !== 1) throw new GpuError(`The vertex shader's ${name} must be a float or a vec2 to vec4: instances carry floats.`);
    attribs.set(name, { loc: gl.getAttribLocation(program, name), size: ATTRIB_SIZE[type] });
  }
  return { gen: e.gen, program, uniforms, attribs };
}

/**
 * Sets every active uniform: the engine's own from `frame`, samplers from `textures` (one unit each),
 * the rest from `values`. A pass must give every uniform its shader uses, so no value leaks in from
 * whoever drew with this program last; extras are fine (the compiler drops unused ones).
 */
export function applyUniforms(
  gl: WebGL2RenderingContext,
  p: Linked,
  values: Record<string, UniformValue>,
  textures: Record<string, WebGLTexture>,
  frame: Record<string, number[]>,
): void {
  let unit = 0;
  for (const [name, u] of p.uniforms) {
    if (u.type === gl.SAMPLER_2D) {
      const tex = textures[name];
      if (!tex) throw new GpuError(`The pass gives no texture for ${name}.`);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u.loc, unit++);
      continue;
    }
    const v = ENGINE_UNIFORMS.has(name) ? frame[name] : values[name];
    if (v === undefined) throw new GpuError(`The pass gives no value for ${name}.`);
    const list = typeof v === 'number' ? [v] : typeof v === 'boolean' ? [+v] : Array.from(v);
    const [n, set] = SETTERS[u.type];
    if (!list.length || list.length % n || list.length > n * u.size) {
      throw new GpuError(`${name} takes ${u.size > 1 ? `up to ${u.size} × ${n} numbers` : n > 1 ? `${n} numbers` : 'one number'}, not ${list.length}.`);
    }
    set(gl, u.loc, list);
  }
}
