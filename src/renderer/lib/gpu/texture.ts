// Textures and instance buffers (see index.ts). Each belongs to a scope, whose release() frees them
// all; a context loss ends them too, and the owner makes them again in onRestore().
import { getEngine, isLost, type Engine } from './context.ts';
import { GpuError } from './errors.ts';

export type Format = 'rgba8' | 'rgba16f' | 'r16f';
/** what read() gives for a format: bytes for rgba8, floats for the half-float ones */
export type PixelArray<F extends Format> = F extends 'rgba8' ? Uint8Array : Float32Array;
/** pixels in memory, rows from the top: 4 values a pixel for rgba formats, 1 for r16f */
export type RawPixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray | Float32Array };
/** an image, pixels in memory, or just a size (an empty texture to draw into) */
export type Source = ImageBitmap | ImageData | HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement | VideoFrame | RawPixels | { width: number; height: number };
export type TextureOptions = { filter?: 'linear' | 'nearest'; wrap?: 'clamp' | 'repeat' | 'mirror' };

const GL = WebGL2RenderingContext;
export const FORMATS = {
  rgba8: { internal: GL.RGBA8, format: GL.RGBA, type: GL.UNSIGNED_BYTE, channels: 4, float: false },
  rgba16f: { internal: GL.RGBA16F, format: GL.RGBA, type: GL.HALF_FLOAT, channels: 4, float: true },
  r16f: { internal: GL.R16F, format: GL.RED, type: GL.HALF_FLOAT, channels: 1, float: true },
} as const;

/** a scope's list of what it made, for release() */
export type Owner = { label: string; owned: Set<{ release(): void }> };

class Resource {
  readonly #owner: Owner | null;
  readonly #kind: string;
  readonly #gen: number;
  #released = false;

  constructor(owner: Owner | null, kind: string) {
    this.#owner = owner;
    this.#kind = kind;
    this.#gen = getEngine().gen;
    owner?.owned.add(this);
  }

  /** throws unless this can be used in the context as it is now */
  protected live(e: Engine): void {
    const who = this.#owner ? `${this.#owner.label}: ` : '';
    if (this.#released) throw new GpuError(`${who}a ${this.#kind} was used after release().`);
    if (this.#gen !== e.gen) throw new GpuError(`${who}a ${this.#kind} was lost with the graphics context. Make it again in onRestore().`);
  }

  release(): void {
    if (this.#released) return;
    this.#released = true;
    this.#owner?.owned.delete(this);
    const e = getEngine();
    if (this.#gen === e.gen && !isLost()) this.free(e.gl);
  }

  protected free(_gl: WebGL2RenderingContext): void {}
}

const isImage = (s: Source): s is TexImageSource =>
  s instanceof ImageBitmap ||
  s instanceof ImageData ||
  s instanceof HTMLCanvasElement ||
  s instanceof OffscreenCanvas ||
  s instanceof HTMLVideoElement ||
  (typeof VideoFrame !== 'undefined' && s instanceof VideoFrame);

function sizeOf(s: Source): [number, number] {
  if (s instanceof HTMLVideoElement) return [s.videoWidth, s.videoHeight];
  if (typeof VideoFrame !== 'undefined' && s instanceof VideoFrame) return [s.displayWidth, s.displayHeight];
  return [(s as { width: number }).width, (s as { height: number }).height];
}

export class Texture<F extends Format = Format> extends Resource {
  readonly format: F;
  #width = 0;
  #height = 0;
  #tex: WebGLTexture | null;
  #fbo: WebGLFramebuffer | null = null;

  constructor(owner: Owner | null, source: Source, format: F, opts: TextureOptions = {}) {
    super(owner, 'texture');
    this.format = format;
    const { gl } = getEngine();
    this.#tex = gl.createTexture(); // null while the context is lost
    try {
      if (!FORMATS[format]) throw new GpuError(`${String(format)} isn't a texture format; use rgba8, rgba16f or r16f.`);
      const wrap = { clamp: gl.CLAMP_TO_EDGE, repeat: gl.REPEAT, mirror: gl.MIRRORED_REPEAT }[opts.wrap ?? 'clamp'];
      if (!wrap) throw new GpuError(`${opts.wrap} isn't a wrap; use clamp, repeat or mirror.`);
      const filter = opts.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
      gl.bindTexture(gl.TEXTURE_2D, this.#tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      this.upload(source);
    } catch (err) {
      this.release(); // the owner never got it, so it mustn't stay in the scope
      throw err;
    }
  }

  get width(): number {
    return this.#width;
  }
  get height(): number {
    return this.#height;
  }

  /** New contents, at the source's size (a video frame, the next GIF frame). */
  upload(source: Source): void {
    const e = getEngine();
    const f = FORMATS[this.format];
    const [w, h] = sizeOf(source);
    if (!(Number.isInteger(w) && Number.isInteger(h) && w >= 1 && h >= 1)) throw new GpuError(`A texture needs a whole size of at least 1 × 1 px, not ${w} × ${h}.`);
    if (e.maxSize && Math.max(w, h) > e.maxSize) {
      throw new GpuError(`A ${w} × ${h} px texture is larger than this graphics card allows (${e.maxSize} px a side). Draw large outputs with renderTiled().`);
    }
    const data = !isImage(source) && 'data' in source ? source.data : null;
    if (data) {
      if ((data instanceof Float32Array) !== f.float) throw new GpuError(`${this.format} pixels come as a ${f.float ? 'Float32Array' : 'Uint8Array'}.`);
      if (data.length !== w * h * f.channels) throw new GpuError(`${w} × ${h} px of ${this.format} is ${w * h * f.channels} values, not ${data.length}.`);
    }
    if (!isLost()) {
      this.live(e);
      const { gl } = e;
      gl.bindTexture(gl.TEXTURE_2D, this.#tex);
      if (data) gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, data instanceof Float32Array ? gl.FLOAT : gl.UNSIGNED_BYTE, data);
      else if (isImage(source)) gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, f.format, f.type, source);
      else gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, f.format, f.type, null);
      const err = gl.getError();
      if (err === gl.OUT_OF_MEMORY) throw new GpuError(`The graphics card ran out of memory for a ${w} × ${h} px texture.`);
      if (err && !gl.isContextLost()) throw new GpuError(`The graphics card refused a ${w} × ${h} px ${this.format} texture (GL error 0x${err.toString(16)}).`);
    }
    this.#width = w;
    this.#height = h;
  }

  /** @internal the engine's handle, for sampling */
  glTexture(e: Engine): WebGLTexture {
    this.live(e);
    return this.#tex!;
  }

  /** @internal a framebuffer drawing into this texture, made on first use */
  glFramebuffer(e: Engine): WebGLFramebuffer {
    this.live(e);
    const { gl } = e;
    if (this.#fbo) return this.#fbo;
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.#tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
      gl.deleteFramebuffer(fbo);
      throw new GpuError(`This graphics card can't draw into ${this.format} textures.`);
    }
    return (this.#fbo = fbo);
  }

  protected free(gl: WebGL2RenderingContext): void {
    gl.deleteFramebuffer(this.#fbo);
    gl.deleteTexture(this.#tex);
  }
}

/** Per-instance floats, interleaved in `layout` order: { a_pos: 2, a_radius: 1 } is x, y, r, x, y, r… */
export class Instances extends Resource {
  readonly layout: Readonly<Record<string, number>>;
  /** floats per instance */
  readonly stride: number;
  #count = 0;
  #buf: WebGLBuffer | null;

  constructor(owner: Owner | null, data: Float32Array, layout: Record<string, number>) {
    super(owner, 'instance buffer');
    const sizes = Object.values(layout);
    this.layout = { ...layout };
    this.stride = sizes.reduce((a, b) => a + b, 0);
    this.#buf = getEngine().gl.createBuffer();
    try {
      if (!sizes.length || !sizes.every((n) => Number.isInteger(n) && n >= 1 && n <= 4)) throw new GpuError('An instance layout gives each attribute 1 to 4 floats.');
      this.update(data);
    } catch (err) {
      this.release();
      throw err;
    }
  }

  get count(): number {
    return this.#count;
  }

  update(data: Float32Array): void {
    if (!(data instanceof Float32Array) || data.length % this.stride) throw new GpuError(`Instance data is a Float32Array of whole instances (${this.stride} floats each).`);
    this.#count = data.length / this.stride;
    if (isLost()) return;
    const e = getEngine();
    this.live(e);
    e.gl.bindBuffer(e.gl.ARRAY_BUFFER, this.#buf);
    e.gl.bufferData(e.gl.ARRAY_BUFFER, data, e.gl.DYNAMIC_DRAW);
  }

  /** @internal */
  glBuffer(e: Engine): WebGLBuffer {
    this.live(e);
    return this.#buf!;
  }

  protected free(gl: WebGL2RenderingContext): void {
    gl.deleteBuffer(this.#buf);
  }
}
