// Drawing (see index.ts): a pass runs a program into a texture, several at once, or one tile of a
// larger image; a chain ping-pongs between two textures; copy() and clear() work on rects; and
// bitmap() hands a texture to a canvas on screen.
import { bindCorners, getEngine, isLost, type Engine } from './context.ts';
import { GpuError } from './errors.ts';
import { applyUniforms, program, type Linked, type Program, type UniformValue } from './program.ts';
import { Instances, mrtFramebuffer, Texture, type Format, type Owner } from './texture.ts';
import type { Rect } from './tiles.ts';
import { checkCopy, checkPass, rectInside, rectText, type Blend } from './validate.ts';

export type { Blend };

/** One tile of an image larger than any texture; renderTiled() hands these to its draw function. */
export type Tile = { readonly texture: Texture; readonly rect: Rect; readonly full: { width: number; height: number } };

export type PassOptions = {
  /** a texture, several of the same size (the shader's layout(location = i) out goes to output i), or a tile */
  output: Texture | Tile | readonly Texture[];
  /** sampler2D uniforms by name */
  inputs?: Record<string, Texture>;
  /** every other uniform the shader uses, by name; arrays flat */
  uniforms?: Record<string, UniformValue>;
  /** draw the program's vertex shader once per instance (4 corners each) instead of one quad over the output */
  instances?: Instances;
  /** one for every output, or one per output (different ones need caps.indexedBlend) */
  blend?: Blend | readonly Blend[];
  /** the alpha a 'constant' blend moves toward the shader's value by */
  blendConstant?: number;
  /** draw only inside this part of the output (a whole texture's px) */
  rect?: Rect;
  /** fill the output (inside rect, when given) with this RGBA first */
  clear?: [number, number, number, number];
};

type Frame = { fbo: WebGLFramebuffer | null; rect: Rect; full: [number, number]; flip: number; blends: Blend[] };

/** Runs `p` into `o.output`. A no-op while the context is lost: the owner draws again in onRestore(). */
export function pass(p: Program, o: PassOptions): void {
  if (isLost()) return;
  const e = getEngine();
  const list = Array.isArray(o.output) ? (o.output as readonly Texture[]) : null;
  const tile = list || o.output instanceof Texture ? null : (o.output as Tile);
  const outputs = list ?? [tile?.texture ?? (o.output as Texture)];
  const blends = checkPass({ ...o, outputs, whole: !tile, inputs: Object.values(o.inputs ?? {}), drawBuffers: e.caps.drawBuffers, indexedBlend: e.caps.indexedBlend });
  const [target] = outputs;
  const rect = tile?.rect ?? { x: 0, y: 0, w: target.width, h: target.height };
  const full: [number, number] = tile ? [tile.full.width, tile.full.height] : [target.width, target.height];
  draw(e, p, { fbo: mrtFramebuffer(e, outputs), rect, full, flip: 1, blends }, o);
}

/** Copies `from` of `src` into `dst` with its top left at `to` (the same place by default). Both of one format. */
export function copy(src: Texture, dst: Texture, from: Rect, to: { x: number; y: number } = from): void {
  checkCopy(src, dst, from, to);
  if (isLost()) return;
  const e = getEngine();
  const { gl } = e;
  // both made first: making one binds it to both targets
  const read = src.glFramebuffer(e);
  const drawTo = dst.glFramebuffer(e);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, read);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawTo);
  gl.blitFramebuffer(from.x, from.y, from.x + from.w, from.y + from.h, to.x, to.y, to.x + from.w, to.y + from.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

/**
 * Makes the framebuffer a pass into `output` draws into, now. Making one asks GL whether it can be
 * drawn into, which waits for every command queued before it: made ahead, before any drawing, the
 * first pass never stalls behind the GPU compiling shaders.
 */
export function prepare(output: Texture | readonly Texture[]): void {
  if (isLost()) return;
  const e = getEngine();
  const list = Array.isArray(output) ? (output as readonly Texture[]) : [output as Texture];
  mrtFramebuffer(e, list);
}

/** Fills each texture (inside `rect`, when given) with `rgba`, as floats (0 to 1 for rgba8). */
export function clear(outputs: Texture | readonly Texture[], rgba: [number, number, number, number], rect?: Rect): void {
  if (isLost()) return;
  const e = getEngine();
  const { gl } = e;
  for (const t of Array.isArray(outputs) ? (outputs as readonly Texture[]) : [outputs as Texture]) {
    if (rect && !rectInside(rect, t.width, t.height)) throw new GpuError(rectText(rect, t.width, t.height));
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.glFramebuffer(e));
    if (rect) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(rect.x, rect.y, rect.w, rect.h);
    }
    gl.clearBufferfv(gl.COLOR, 0, rgba);
    gl.disable(gl.SCISSOR_TEST);
  }
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
  draw(e, program(COPY), { fbo: null, rect, full: [tex.width, tex.height], flip: -1, blends: ['none'] }, { inputs: { u_src: tex } });
  return e.canvas.transferToImageBitmap();
}

const GL = WebGL2RenderingContext;
/** equation, then source and destination factors for colour and for alpha */
const FACTORS: Record<Exclude<Blend, 'none'>, [number, number, number, number, number]> = {
  over: [GL.FUNC_ADD, GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA, GL.ONE, GL.ONE_MINUS_SRC_ALPHA],
  multiply: [GL.FUNC_ADD, GL.DST_COLOR, GL.ZERO, GL.ZERO, GL.ONE],
  add: [GL.FUNC_ADD, GL.ONE, GL.ONE, GL.ONE, GL.ONE],
  max: [GL.MAX, GL.ONE, GL.ONE, GL.ONE, GL.ONE],
  constant: [GL.FUNC_ADD, GL.CONSTANT_ALPHA, GL.ONE_MINUS_CONSTANT_ALPHA, GL.CONSTANT_ALPHA, GL.ONE_MINUS_CONSTANT_ALPHA],
};

function applyBlends(e: Engine, blends: Blend[], k: number): void {
  const { gl } = e;
  if (blends.includes('constant')) gl.blendColor(0, 0, 0, k);
  if (new Set(blends).size === 1) {
    if (blends[0] === 'none') return gl.disable(gl.BLEND);
    const [eq, src, dst, srcA, dstA] = FACTORS[blends[0]];
    gl.enable(gl.BLEND);
    gl.blendEquation(eq);
    gl.blendFuncSeparate(src, dst, srcA, dstA);
    return;
  }
  const dbi = e.ext.dbi!; // checkPass made sure
  blends.forEach((b, i) => {
    if (b === 'none') return dbi.disableiOES(gl.BLEND, i);
    const [eq, src, dst, srcA, dstA] = FACTORS[b];
    dbi.enableiOES(gl.BLEND, i);
    dbi.blendEquationiOES(i, eq);
    dbi.blendFuncSeparateiOES(i, src, dst, srcA, dstA);
  });
}

function draw(e: Engine, p: Program, f: Frame, o: Omit<PassOptions, 'output'>): void {
  const { gl } = e;
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
  if (o.rect) {
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(o.rect.x, o.rect.y, o.rect.w, o.rect.h);
  }
  if (o.clear) for (let i = 0; i < f.blends.length; i++) gl.clearBufferfv(gl.COLOR, i, o.clear);
  applyBlends(e, f.blends, o.blendConstant ?? 1);
  gl.bindVertexArray(e.vao);
  if (o.instances && buffer) drawInstances(e, linked, o.instances, buffer);
  else gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.disable(gl.SCISSOR_TEST);
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
