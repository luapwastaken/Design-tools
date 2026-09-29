// Drawing (see index.ts): a pass runs a program into a texture or into one tile of a larger image,
// a chain ping-pongs between two textures, and bitmap() hands a texture to a canvas on screen.
import { bindCorners, getEngine, isLost, type Engine } from './context.ts';
import { GpuError } from './errors.ts';
import { applyUniforms, program, type Linked, type Program, type UniformValue } from './program.ts';
import { Instances, Texture, type Format, type Owner } from './texture.ts';
import type { Rect } from './tiles.ts';

/** how a pass lands on what's there: replace it, paint over it (straight alpha), multiply (overprint), add */
export type Blend = 'none' | 'over' | 'multiply' | 'add';

/** One tile of an image larger than any texture; renderTiled() hands these to its draw function. */
export type Tile = { readonly texture: Texture; readonly rect: Rect; readonly full: { width: number; height: number } };

export type PassOptions = {
  output: Texture | Tile;
  /** sampler2D uniforms by name */
  inputs?: Record<string, Texture>;
  /** every other uniform the shader uses, by name; arrays flat */
  uniforms?: Record<string, UniformValue>;
  /** draw the program's vertex shader once per instance (4 corners each) instead of one quad over the output */
  instances?: Instances;
  blend?: Blend;
  /** fill the output with this RGBA first */
  clear?: [number, number, number, number];
};

type Frame = { fbo: WebGLFramebuffer | null; rect: Rect; full: [number, number]; flip: number };

/** Runs `p` into `o.output`. A no-op while the context is lost: the owner draws again in onRestore(). */
export function pass(p: Program, o: PassOptions): void {
  if (isLost()) return;
  const e = getEngine();
  const tile = o.output instanceof Texture ? null : o.output;
  const target = tile?.texture ?? (o.output as Texture);
  if (Object.values(o.inputs ?? {}).includes(target)) throw new GpuError("A pass can't read the texture it draws into; use a chain.");
  const rect = tile?.rect ?? { x: 0, y: 0, w: target.width, h: target.height };
  const full: [number, number] = tile ? [tile.full.width, tile.full.height] : [target.width, target.height];
  draw(e, p, { fbo: target.glFramebuffer(e), rect, full, flip: 1 }, o);
}

/** Two textures that passes alternate between, so each one reads the last one's result. */
export class Chain<F extends Format = Format> {
  /** older, newer */
  #pair: [Texture<F>, Texture<F>];

  constructor(owner: Owner, width: number, height: number, format: F) {
    this.#pair = [new Texture(owner, { width, height }, format), new Texture(owner, { width, height }, format)];
  }

  /** Runs `p` into whichever of the two it doesn't read (the older when it reads neither) and returns that texture. */
  pass(p: Program, o: Omit<PassOptions, 'output'> = {}): Texture<F> {
    const reads = Object.values(o.inputs ?? {});
    const out = this.#pair.find((t) => !reads.includes(t));
    if (!out) throw new GpuError('This chain pass reads both of its textures, so there is nowhere to draw.');
    pass(p, { ...o, output: out });
    if (out === this.#pair[0]) this.#pair = [this.#pair[1], out];
    return out;
  }

  release(): void {
    this.#pair.forEach((t) => t.release());
  }
}

const COPY = `uniform sampler2D u_src;
in vec2 v_uv;
out vec4 o;
void main() { o = texture(u_src, v_uv); }`;

/**
 * The texture as a bitmap at its own size, the right way up, for a 2D canvas (drawImage) or a
 * bitmaprenderer canvas. Values as they are, clamped to 8 bits: convert to display first with a
 * pass of your own. Null while the context is lost. Close the bitmap when drawn.
 */
export function bitmap(tex: Texture): ImageBitmap | null {
  if (isLost()) return null;
  const e = getEngine();
  if (e.canvas.width !== tex.width) e.canvas.width = tex.width;
  if (e.canvas.height !== tex.height) e.canvas.height = tex.height;
  const rect = { x: 0, y: 0, w: tex.width, h: tex.height };
  draw(e, program(COPY), { fbo: null, rect, full: [tex.width, tex.height], flip: -1 }, { inputs: { u_src: tex } });
  return e.canvas.transferToImageBitmap();
}

const BLENDS: Record<Exclude<Blend, 'none'>, (gl: WebGL2RenderingContext) => void> = {
  over: (gl) => gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA),
  multiply: (gl) => gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE),
  add: (gl) => gl.blendFunc(gl.ONE, gl.ONE),
};

function draw(e: Engine, p: Program, f: Frame, o: Omit<PassOptions, 'output'>): void {
  const { gl } = e;
  const mode = o.blend ?? 'none';
  if (mode !== 'none' && !BLENDS[mode]) throw new GpuError(`${mode} isn't a blend; use none, over, multiply or add.`);
  const linked = p.linked(e);
  if (o.instances && !p.vertex) throw new GpuError('An instanced pass needs a vertex shader to place each instance.');
  if (!o.instances && linked.attribs.size) throw new GpuError(`The vertex shader's ${[...linked.attribs.keys()].join(', ')} need instances.`);
  const textures = Object.fromEntries(Object.entries(o.inputs ?? {}).map(([k, t]) => [k, t.glTexture(e)]));
  const buffer = o.instances ? instanceBuffer(e, linked, o.instances) : null;

  // everything above can throw; nothing below runs until it has all passed
  gl.useProgram(linked.program);
  applyUniforms(gl, linked, o.uniforms ?? {}, textures, { u_rect: [f.rect.x, f.rect.y, f.rect.w, f.rect.h], u_full: f.full, u_flip: [f.flip] });
  gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo);
  gl.viewport(0, 0, f.rect.w, f.rect.h);
  if (o.clear) {
    gl.clearColor(...o.clear);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  if (mode === 'none') gl.disable(gl.BLEND);
  else {
    gl.enable(gl.BLEND);
    BLENDS[mode](gl);
  }
  gl.bindVertexArray(e.vao);
  if (o.instances && buffer) drawInstances(e, linked, o.instances, buffer);
  else gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/** the buffer, once the instances are known to carry every input the vertex shader reads, at its size */
function instanceBuffer(e: Engine, linked: Linked, inst: Instances): WebGLBuffer {
  for (const [name, a] of linked.attribs) {
    const size = inst.layout[name];
    if (size === undefined) throw new GpuError(`The instances carry no ${name} for the vertex shader.`);
    if (size !== a.size) throw new GpuError(`The vertex shader's ${name} takes ${a.size} floats but the instances carry ${size}.`);
  }
  return inst.glBuffer(e);
}

function drawInstances(e: Engine, linked: Linked, inst: Instances, buffer: WebGLBuffer): void {
  const { gl } = e;
  const locs: number[] = [];
  let offset = 0;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [name, size] of Object.entries(inst.layout)) {
    const a = linked.attribs.get(name);
    if (a) {
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, size, gl.FLOAT, false, inst.stride * 4, offset * 4);
      gl.vertexAttribDivisor(a.loc, 1);
      locs.push(a.loc);
    }
    offset += size;
  }
  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, inst.count);
  for (const loc of locs) {
    gl.disableVertexAttribArray(loc);
    gl.vertexAttribDivisor(loc, 0);
  }
  if (locs.includes(0)) bindCorners(gl, e.quad); // a vertex shader without a_corner lets the linker hand location 0 out
}
