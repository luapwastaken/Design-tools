// The GPU engine (foundation spec §10.5), built with Halftone and shared by Dither and Post FX.
//
// One WebGL2 context for the whole app, on a canvas that is never shown (Chromium drops contexts
// past about 16). Tools show results on their own 2D or bitmaprenderer canvases through bitmap().
//
// ── API ──
//   const g = gpuScope('dither preview')   a handle for things released together; make one per lifetime
//   g.program(fragment, vertex?)           compiled once per source for the whole app; a shader that
//                                          fails throws GpuError with GL's log, mapped to your lines
//   g.texture(source, format, opts?)       source: ImageBitmap, ImageData, canvas, video, VideoFrame,
//                                          { width, height, data } or just { width, height } (empty);
//                                          format 'rgba8' | 'rgba16f' | 'r16f'; opts { filter, wrap }.
//                                          Any texture can be a pass's output. tex.upload(source) refills it
//   g.instances(floats, { a_pos: 2, a_r: 1 })  per-instance data, interleaved in layout order; .update()
//   g.pass(program, { output, inputs, uniforms, instances, blend, clear })
//                                          inputs: sampler2D uniforms by name; uniforms: every other
//                                          uniform the shader uses (a missing one throws, so nothing
//                                          leaks between passes); blend 'none' | 'over' | 'multiply' | 'add'
//   g.chain(w, h, format).pass(program, opts) → texture   ping-pong: writes the one it doesn't read
//   g.read(texture, rect?)                 Uint8Array (rgba8) or Float32Array, full resolution
//   g.renderTiled(w, h, format, draw, { tile }?)  → Promise of one buffer for an image of any size;
//                                          draw(tile) runs per tile: pass `tile` as the output
//   g.bitmap(texture)                      ImageBitmap for drawImage (null while lost); close it after
//   g.onRestore(fn)                        after a context loss: rebuild as when the tool is shown again
//   g.lost, g.maxSize                      texture sides are at most maxSize; outputs go beyond it tiled
//   g.release()                            frees every texture and buffer this scope made (hidden tools)
//
// ── Conventions ──
// - Px from the top left, y down, everywhere: texel row 0, output rows, read() rows, rects and
//   instance positions. Nothing flips except bitmap() (inventory: v1's SVG came out mirrored).
// - Values stay as given: no premultiplied alpha, no colour conversion, no clamping in half floats.
//   Colour maths belong to the caller, whose numbers come from shared/color. A shader's float
//   written into a half-float texture may round toward zero (ANGLE on D3D11 does), so it can land
//   one half-float step low; values that are exact in half precision stay exact.
// - Shaders are GLSL ES 3.00 without #version. Every program gets: uniform vec4 u_rect (the part
//   of the output this draw covers, px) and vec2 u_full (the whole output, px), set by the engine
//   (with u_flip, which only the helpers need). Vertex shaders get in vec2 a_corner (this quad's
//   corner, -1 to 1) and toClip(px). Fragment shaders get fragPixel() (this pixel's centre, px).
//   A program with no vertex shader draws one quad over the output and gives the fragment shader
//   in vec2 v_uv (0 to 1 over the whole output). Declare your own out vec4.
// - Output that must not depend on the tile size (exports) measures from fragPixel() against flat
//   inputs, as the dots example does, and reads a same-size input with texelFetch(u_src,
//   ivec2(fragPixel()), 0). Interpolated varyings shift in their last bits with each tile's offset,
//   enough to move anti-aliased edges by a level or two of 255; drawn this way, an 8000 px image
//   comes out byte for byte the same in any tiling.
// - A lost context (driver reset, or WEBGL_lose_context): pass() does nothing and bitmap() gives
//   null until it is back; read() and renderTiled() throw GpuLost. Every texture and buffer made
//   before the loss is gone (using one throws), programs compile again by themselves, then each
//   onRestore listener runs.
// - Exports use a scope of their own, so hiding the tool (which releases its preview scope) never
//   pulls a texture from under an export that is still running.
//
// ── Example: a pass, read back and shown ──
//   const g = gpuScope('example');
//   const invert = g.program(`
//     uniform sampler2D u_src;
//     uniform float u_amount;
//     in vec2 v_uv;
//     out vec4 o;
//     void main() {
//       vec4 c = texture(u_src, v_uv);
//       o = vec4(mix(c.rgb, 1.0 - c.rgb, u_amount), c.a);
//     }`);
//   const src = g.texture(bitmap, 'rgba16f');
//   const out = g.texture({ width: src.width, height: src.height }, 'rgba16f');
//   g.pass(invert, { output: out, inputs: { u_src: src }, uniforms: { u_amount: 1 } });
//   const floats = g.read(out);          // 4 floats a pixel, rows from the top
//   const shown = g.bitmap(out);         // ctx.drawImage(shown, 0, 0), then shown.close()
//
// ── Example: one quad per instance (anti-aliased dots, the same in any tile) ──
//   vertex:   in vec2 a_pos; in float a_r; flat out vec2 v_c; flat out float v_r;
//             void main() { v_c = a_pos; v_r = a_r; gl_Position = toClip(a_pos + a_corner * (a_r + 1.0)); }
//   fragment: flat in vec2 v_c; flat in float v_r; out vec4 o;
//             void main() { o = vec4(0.0, 0.0, 0.0, clamp(v_r + 0.5 - distance(fragPixel(), v_c), 0.0, 1.0)); }
//   const dots = g.instances(xyr, { a_pos: 2, a_r: 1 });       // x, y, r per dot, px
//   g.pass(g.program(fragment, vertex), { output, instances: dots, blend: 'over', clear: [1, 1, 1, 1] });
import { getEngine, isLost, onRestored } from './context.ts';
import { bitmap, Chain, pass } from './draw.ts';
import { program, type Program } from './program.ts';
import { read, renderTiled } from './read.ts';
import { Instances, Texture, type Format, type Owner, type Source, type TextureOptions } from './texture.ts';

export { GpuError, GpuLost } from './errors.ts';
export type { Blend, Chain, PassOptions, Tile } from './draw.ts';
export type { Program, UniformValue } from './program.ts';
export type { Format, Instances, PixelArray, RawPixels, Source, Texture, TextureOptions } from './texture.ts';
export type { Rect } from './tiles.ts';

export type Gpu = {
  program(fragment: string, vertex?: string): Program;
  texture<F extends Format>(source: Source, format: F, opts?: TextureOptions): Texture<F>;
  instances(data: Float32Array, layout: Record<string, number>): Instances;
  chain<F extends Format>(width: number, height: number, format: F): Chain<F>;
  pass: typeof pass;
  read: typeof read;
  renderTiled: typeof renderTiled;
  bitmap: typeof bitmap;
  onRestore(fn: () => void): () => void;
  readonly lost: boolean;
  readonly maxSize: number;
  release(): void;
};

/** A handle on the app's GPU for one owner. `label` names it in errors. */
export function gpuScope(label: string): Gpu {
  const owner: Owner = { label, owned: new Set() };
  return {
    program: (fragment, vertex) => program(fragment, vertex ?? null),
    texture: (source, format, opts) => new Texture(owner, source, format, opts),
    instances: (data, layout) => new Instances(owner, data, layout),
    chain: (width, height, format) => new Chain(owner, width, height, format),
    pass,
    read,
    renderTiled,
    bitmap,
    onRestore: onRestored,
    get lost() {
      return isLost();
    },
    get maxSize() {
      return getEngine().maxSize;
    },
    release() {
      for (const r of [...owner.owned]) r.release();
    },
  };
}
