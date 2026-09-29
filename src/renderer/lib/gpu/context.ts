// The app's one WebGL2 context (foundation spec §10.5). Chromium drops contexts past about 16, so
// every tool shares this one, on a canvas that is never shown; results reach the screen as bitmaps.
import { GpuError } from './errors.ts';

export type Engine = {
  gl: WebGL2RenderingContext;
  canvas: OffscreenCanvas;
  /** bumps on every loss and every restore: anything made under an older one is gone */
  gen: number;
  /** the largest texture or tile side */
  maxSize: number;
  /** the corner quad every draw starts from: a_corner, location 0 */
  vao: WebGLVertexArrayObject;
  quad: WebGLBuffer;
};

const ATTRS: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
};

let engine: Engine | null = null;
const restoreListeners = new Set<() => void>();

/** The context, made on first use so a tool that never draws costs nothing. */
export function getEngine(): Engine {
  if (engine) return engine;
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext('webgl2', ATTRS);
  if (!gl) throw new GpuError("WebGL2 isn't available, so this can't be drawn. Restart the app; if it keeps happening, update the graphics driver.");
  const e: Engine = { gl, canvas, gen: 0, ...setup(gl) };
  canvas.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault(); // without this Chromium never restores the context
    e.gen++;
  });
  canvas.addEventListener('webglcontextrestored', () => {
    Object.assign(e, setup(gl));
    e.gen++;
    for (const fn of [...restoreListeners]) {
      try {
        fn();
      } catch (err) {
        reportError(err); // one owner failing to rebuild must not stop the others
      }
    }
  });
  engine = e;
  return e;
}

export const isLost = (): boolean => !!engine?.gl.isContextLost();

export function onRestored(fn: () => void): () => void {
  restoreListeners.add(fn);
  return () => void restoreListeners.delete(fn);
}

/** Points location 0 back at the corner quad (an instanced draw may have borrowed it). */
export function bindCorners(gl: WebGL2RenderingContext, quad: WebGLBuffer): void {
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(0, 0);
}

function setup(gl: WebGL2RenderingContext) {
  // drawing into half-float textures needs one of these in WebGL2; target() says so if neither is there
  if (!gl.getExtension('EXT_color_buffer_float')) gl.getExtension('EXT_color_buffer_half_float');
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
  // values as stored, as lib/load decodes them: no colour conversion, no premultiplying, no flip
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  const quad = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  bindCorners(gl, quad);
  const dims = (gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null) ?? [0, 0]; // null while lost
  const maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), dims[0], dims[1]);
  return { quad, vao, maxSize };
}
