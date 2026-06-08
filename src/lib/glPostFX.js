// ── WebGL2 Post-FX stack engine ─────────────────────────────────────────────
//
// A generic, data-driven effect-stack renderer. The user builds an ordered list
// of effects (see effects.js); this engine runs each enabled effect as one
// fragment-shader pass, ping-ponging between two framebuffers so the output of
// one effect becomes the input of the next.
//
// Each effect descriptor supplies a GLSL snippet that defines:
//     vec4 effect(vec2 uv){ ... }
// The engine wraps it in shared boilerplate that provides common helpers
// (luma, hsv, hash, noise), the per-effect uniforms, and a final composite that
// applies the effect's blend mode + opacity against the incoming image. Adding a
// new effect is therefore pure data — no engine changes.
//
// Multi-tap effects (blur, bloom) sample a kernel inside their single pass; this
// keeps the engine uniform at the cost of some efficiency on very large radii,
// which is fine for interactive preview resolutions.
//
// Degrades gracefully: if WebGL2 is unavailable, create() returns null and the
// caller falls back to showing the un-processed source.

const QUAD_VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`

// Shared helper library injected into every effect program.
const COMMON_GLSL = `
const float PI = 3.14159265359;
const float TAU = 6.28318530718;
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hash11(float p){ return fract(sin(p * 127.1) * 43758.5453); }
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2  hash22(vec2 p){ return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 rgb2hsv(vec3 c){
  vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
// Sample the incoming image (clamped) — effects use this instead of texture(uTex,…).
vec3 src(vec2 uv){ return texture(uTex, clamp(uv, 0.0, 1.0)).rgb; }
vec3 blendModes(vec3 b, vec3 s, int mode){
  if (mode == 1) return b * s;                                  // multiply
  if (mode == 2) return 1.0 - (1.0 - b) * (1.0 - s);            // screen
  if (mode == 3) return mix(2.0*b*s, 1.0-2.0*(1.0-b)*(1.0-s), step(0.5, b)); // overlay
  if (mode == 4) return min(b + s, 1.0);                        // add
  if (mode == 5) return max(b - s, 0.0);                        // subtract
  if (mode == 6) return abs(b - s);                             // difference
  if (mode == 7) return max(b, s);                              // lighten
  if (mode == 8) return min(b, s);                              // darken
  if (mode == 9) return mix(1.0-(1.0-b)/max(s, vec3(0.001)), b, step(s, vec3(0.999))); // dodge-ish
  return s;                                                     // 0 = normal
}`

function buildFragment(effect) {
  return `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uTex;
uniform vec2 uRes;        // pixel size of the working image
uniform vec2 uTexel;      // 1.0 / uRes
uniform float uTime;      // seconds (for animated effects)
uniform float uOpacity;   // 0..1 effect mix
uniform int  uBlend;      // blend mode id
${effect.uniforms || ''}
${COMMON_GLSL}
${effect.glsl}
void main(){
  vec3 base = src(vUv);
  vec4 fx = effect(vUv);
  vec3 mixed = mix(base, blendModes(base, fx.rgb, uBlend), uOpacity * fx.a);
  fragColor = vec4(clamp(mixed, 0.0, 1.0), 1.0);
}`
}

export function create(canvas) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true })
  if (!gl) return null
  try { return new PostFXEngine(gl, canvas) } catch (e) { console.warn('PostFX GL init failed', e); return null }
}

class PostFXEngine {
  constructor(gl, canvas) {
    this.gl = gl
    this.canvas = canvas
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096
    this.quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    this.copyProg = this._compile(`#version 300 es
precision highp float; in vec2 vUv; out vec4 fragColor; uniform sampler2D uTex;
void main(){ fragColor = texture(uTex, vUv); }`)
    this.srcTex = this._tex()
    this.programs = new Map()   // effect.type -> compiled program
    this.fbos = {}              // 'a' | 'b' ping-pong pool
    this.w = 0; this.h = 0
    this.hasSource = false
  }

  // ── compile / cache ────────────────────────────────────────────────────────
  _compile(fs) {
    const gl = this.gl
    const v = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(v, QUAD_VS); gl.compileShader(v)
    if (!gl.getShaderParameter(v, gl.COMPILE_STATUS)) throw new Error('VS: ' + gl.getShaderInfoLog(v))
    const f = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(f, fs); gl.compileShader(f)
    if (!gl.getShaderParameter(f, gl.COMPILE_STATUS)) throw new Error('FS: ' + gl.getShaderInfoLog(f) + '\n' + fs)
    const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p))
    gl.deleteShader(v); gl.deleteShader(f)
    return p
  }

  _progFor(effect) {
    let p = this.programs.get(effect.type)
    if (!p) {
      try { p = this._compile(buildFragment(effect)) }
      catch (e) { console.warn('Effect compile failed:', effect.type, e); p = this.copyProg }
      this.programs.set(effect.type, p)
    }
    return p
  }

  _tex() {
    const gl = this.gl, t = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    return t
  }

  _fbo(key, w, h) {
    const gl = this.gl
    let f = this.fbos[key]
    if (!f) f = this.fbos[key] = { fb: gl.createFramebuffer(), tex: this._tex(), w: 0, h: 0 }
    if (f.w !== w || f.h !== h) {
      gl.bindTexture(gl.TEXTURE_2D, f.tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.bindFramebuffer(gl.FRAMEBUFFER, f.fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.tex, 0)
      f.w = w; f.h = h
    }
    return f
  }

  _bindQuad(prog) {
    const gl = this.gl
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    const loc = gl.getAttribLocation(prog, 'aPos')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  }

  // ── source upload ───────────────────────────────────────────────────────────
  setSource(srcCanvas) {
    const gl = this.gl
    this.w = srcCanvas.width; this.h = srcCanvas.height
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    this.hasSource = true
  }

  // ── render the whole stack ──────────────────────────────────────────────────
  // stack: ordered [{ type, enabled, opacity, blend, params{} }]
  // EFFECTS: the descriptor map keyed by type (passed in to avoid a circular import).
  render(stack, EFFECTS, time = 0) {
    if (!this.hasSource) return
    const gl = this.gl
    const w = this.w, h = this.h
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h }

    const active = stack.filter(l => l.enabled && EFFECTS[l.type])
    // No effects → just blit the source to the screen.
    if (active.length === 0) { this._blit(this.srcTex); return }

    let read = this.srcTex
    for (let i = 0; i < active.length; i++) {
      const layer = active[i]
      const effect = EFFECTS[layer.type]
      const prog = this._progFor(effect)
      const last = i === active.length - 1
      const target = last ? null : this._fbo(i % 2 === 0 ? 'a' : 'b', w, h)

      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null)
      gl.viewport(0, 0, w, h)
      this._bindQuad(prog)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, read)
      gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0)
      gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), w, h)
      gl.uniform2f(gl.getUniformLocation(prog, 'uTexel'), 1 / w, 1 / h)
      gl.uniform1f(gl.getUniformLocation(prog, 'uTime'), time)
      gl.uniform1f(gl.getUniformLocation(prog, 'uOpacity'), layer.opacity ?? 1)
      gl.uniform1i(gl.getUniformLocation(prog, 'uBlend'), layer.blend ?? 0)
      this._setParams(prog, effect, layer.params || {})
      gl.drawArrays(gl.TRIANGLES, 0, 3)

      if (target) read = target.tex
    }
  }

  // Set per-effect uniforms from the descriptor's param schema.
  _setParams(prog, effect, params) {
    const gl = this.gl
    for (const pdef of effect.params || []) {
      const loc = gl.getUniformLocation(prog, pdef.key)
      if (loc == null) continue
      let v = params[pdef.key]
      if (v === undefined) v = pdef.default
      if (pdef.type === 'color') {
        const rgb = Array.isArray(v) ? v : hexToRgb01(v)
        gl.uniform3f(loc, rgb[0], rgb[1], rgb[2])
      } else if (pdef.type === 'select' || pdef.type === 'bool') {
        gl.uniform1i(loc, pdef.type === 'bool' ? (v ? 1 : 0) : (v | 0))
      } else {
        gl.uniform1f(loc, v)
      }
    }
  }

  _blit(tex) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    this._bindQuad(this.copyProg)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(gl.getUniformLocation(this.copyProg, 'uTex'), 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  // Read the visible canvas back into a 2D canvas (export / clipboard).
  readToCanvas() {
    const gl = this.gl, w = this.canvas.width, h = this.canvas.height
    const px = new Uint8Array(w * h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const out = document.createElement('canvas'); out.width = w; out.height = h
    const ctx = out.getContext('2d')
    const img = ctx.createImageData(w, h)
    for (let y = 0; y < h; y++) {          // readPixels is bottom-up → flip
      const s = (h - 1 - y) * w * 4, d = y * w * 4
      img.data.set(px.subarray(s, s + w * 4), d)
    }
    ctx.putImageData(img, 0, 0)
    return out
  }
}

export function hexToRgb01(hex) {
  const h = (hex || '#000000').replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
