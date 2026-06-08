// ── Post-FX effect registry ─────────────────────────────────────────────────
//
// Each descriptor is pure data consumed by ../../lib/glPostFX.js. An effect's
// `glsl` defines `vec4 effect(vec2 uv)` and must return the FULLY processed pixel
// (not just a delta) — the engine then mixes that back over the incoming image
// using the layer's blend mode + opacity, so a "normal" blend at full opacity
// simply shows the processed result.
//
// Param schema drives both the uniforms and the UI:
//   { key, label, min, max, step, default, suffix }          → float slider
//   { key, label, type:'select', options:[{label,value}], default }  → int
//   { key, label, type:'bool', default }                     → int (0/1)
//   { key, label, type:'color', default:'#rrggbb' }          → vec3 (0..1)
// `key` IS the GLSL uniform name, so it must be a valid identifier and declared
// in `uniforms` with a matching type.
//
// Halftone is intentionally absent — the Dither & Halftone tool owns it.

export const CATEGORIES = [
  { id: 'color', label: 'Color & Tone', icon: 'tune' },
  { id: 'blur', label: 'Blur & Sharpen', icon: 'blur_on' },
  { id: 'lens', label: 'Lens & Camera', icon: 'camera' },
  { id: 'stylize', label: 'Stylize', icon: 'auto_awesome' },
  { id: 'film', label: 'Film & Retro', icon: 'tv' },
  { id: 'distort', label: 'Distort & Warp', icon: 'waves' },
  { id: 'light', label: 'Light & Atmosphere', icon: 'wb_sunny' },
]

const LIST = [
  // ─────────────────────────── COLOR & TONE ───────────────────────────
  {
    type: 'brightcontrast', label: 'Brightness / Contrast', category: 'color', icon: 'brightness_6',
    params: [
      { key: 'uBright', label: 'Brightness', min: -1, max: 1, step: 0.01, default: 0 },
      { key: 'uContrast', label: 'Contrast', min: -1, max: 1, step: 0.01, default: 0 },
    ],
    uniforms: 'uniform float uBright, uContrast;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      c += uBright;
      c = (c - 0.5) * (1.0 + uContrast) + 0.5;
      return vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
  },
  {
    type: 'saturation', label: 'Saturation / Vibrance', category: 'color', icon: 'palette',
    params: [
      { key: 'uSat', label: 'Saturation', min: -1, max: 2, step: 0.01, default: 0 },
      { key: 'uVib', label: 'Vibrance', min: -1, max: 2, step: 0.01, default: 0 },
    ],
    uniforms: 'uniform float uSat, uVib;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      float l = luma(c);
      c = mix(vec3(l), c, 1.0 + uSat);                 // overall saturation
      float sat = max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
      c = mix(vec3(l), c, 1.0 + uVib * (1.0 - sat));    // vibrance: spare already-saturated
      return vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
  },
  {
    type: 'hue', label: 'Hue Rotate', category: 'color', icon: 'colorize',
    params: [{ key: 'uHue', label: 'Hue', min: -180, max: 180, step: 1, default: 0, suffix: '°' }],
    uniforms: 'uniform float uHue;',
    glsl: `vec4 effect(vec2 uv){
      vec3 h = rgb2hsv(src(uv));
      h.x = fract(h.x + uHue / 360.0);
      return vec4(hsv2rgb(h), 1.0);
    }`,
  },
  {
    type: 'levels', label: 'Levels', category: 'color', icon: 'bar_chart',
    params: [
      { key: 'uInLo', label: 'In black', min: 0, max: 1, step: 0.01, default: 0 },
      { key: 'uInHi', label: 'In white', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 'uGamma', label: 'Gamma', min: 0.1, max: 4, step: 0.01, default: 1 },
      { key: 'uOutLo', label: 'Out black', min: 0, max: 1, step: 0.01, default: 0 },
      { key: 'uOutHi', label: 'Out white', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    uniforms: 'uniform float uInLo, uInHi, uGamma, uOutLo, uOutHi;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      c = clamp((c - uInLo) / max(uInHi - uInLo, 0.001), 0.0, 1.0);
      c = pow(c, vec3(1.0 / max(uGamma, 0.001)));
      c = uOutLo + c * (uOutHi - uOutLo);
      return vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
  },
  {
    type: 'tone', label: 'Tone (Lift / Gamma / Gain)', category: 'color', icon: 'gradient',
    params: [
      { key: 'uLift', label: 'Lift (shadows)', min: -0.5, max: 0.5, step: 0.01, default: 0 },
      { key: 'uGam', label: 'Gamma (mids)', min: 0.2, max: 3, step: 0.01, default: 1 },
      { key: 'uGain', label: 'Gain (highlights)', min: 0.2, max: 2.5, step: 0.01, default: 1 },
    ],
    uniforms: 'uniform float uLift, uGam, uGain;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      c = c * uGain + uLift * (1.0 - c);
      c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / max(uGam, 0.001)));
      return vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
  },
  {
    type: 'gradientmap', label: 'Gradient Map', category: 'color', icon: 'gradient',
    params: [
      { key: 'uLo', label: 'Shadow color', type: 'color', default: '#1a1030' },
      { key: 'uMid', label: 'Mid color', type: 'color', default: '#b03a6e' },
      { key: 'uHi', label: 'Highlight color', type: 'color', default: '#ffd9a0' },
      { key: 'uMix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    uniforms: 'uniform vec3 uLo, uMid, uHi; uniform float uMix;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      float l = luma(c);
      vec3 g = l < 0.5 ? mix(uLo, uMid, l * 2.0) : mix(uMid, uHi, (l - 0.5) * 2.0);
      return vec4(mix(c, g, uMix), 1.0);
    }`,
  },
  {
    type: 'splittone', label: 'Split Tone', category: 'color', icon: 'contrast',
    params: [
      { key: 'uShad', label: 'Shadow tint', type: 'color', default: '#1e4a6e' },
      { key: 'uHigh', label: 'Highlight tint', type: 'color', default: '#f0b86e' },
      { key: 'uBal', label: 'Balance', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'uAmt', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    uniforms: 'uniform vec3 uShad, uHigh; uniform float uBal, uAmt;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      float l = luma(c);
      float t = smoothstep(0.0, 1.0, (l - uBal) * 0.5 + 0.5);
      vec3 tint = mix(uShad, uHigh, t);
      vec3 graded = blendModes(c, tint, 2);   // screen the tint in
      return vec4(mix(c, graded, uAmt), 1.0);
    }`,
  },

  // ─────────────────────────── BLUR & SHARPEN ───────────────────────────
  {
    type: 'gaussian', label: 'Gaussian Blur', category: 'blur', icon: 'blur_on',
    params: [{ key: 'uRadius', label: 'Radius', min: 0, max: 40, step: 0.5, default: 4, suffix: 'px' }],
    uniforms: 'uniform float uRadius;',
    glsl: `vec4 effect(vec2 uv){
      if (uRadius < 0.25) return vec4(src(uv), 1.0);
      // Fixed 25×25 sample grid scaled to the requested radius; gaussian-weighted
      // by grid position so the falloff is constant regardless of radius.
      vec3 sum = vec3(0.0); float wsum = 0.0;
      for (int i = -12; i <= 12; i++){
        for (int j = -12; j <= 12; j++){
          vec2 o = vec2(float(i), float(j));
          if (dot(o, o) > 144.0) continue;
          float w = exp(-dot(o, o) / 72.0);
          vec2 off = o * (uRadius / 12.0) * uTexel;
          sum += src(uv + off) * w; wsum += w;
        }
      }
      return vec4(sum / wsum, 1.0);
    }`,
  },
  {
    type: 'motionblur', label: 'Motion Blur', category: 'blur', icon: 'motion_blur',
    params: [
      { key: 'uAngle', label: 'Angle', min: 0, max: 360, step: 1, default: 0, suffix: '°' },
      { key: 'uDist', label: 'Distance', min: 0, max: 60, step: 0.5, default: 12, suffix: 'px' },
    ],
    uniforms: 'uniform float uAngle, uDist;',
    glsl: `vec4 effect(vec2 uv){
      float a = uAngle * PI / 180.0;
      vec2 dir = vec2(cos(a), sin(a)) * uTexel * uDist;
      vec3 sum = vec3(0.0);
      const int N = 24;
      for (int i = 0; i < N; i++){
        float t = float(i) / float(N - 1) - 0.5;
        sum += src(uv + dir * t);
      }
      return vec4(sum / float(N), 1.0);
    }`,
  },
  {
    type: 'radialblur', label: 'Radial / Zoom Blur', category: 'blur', icon: 'blur_circular',
    params: [
      { key: 'uAmt', label: 'Amount', min: 0, max: 0.5, step: 0.005, default: 0.1 },
      { key: 'uCx', label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'uCy', label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    uniforms: 'uniform float uAmt, uCx, uCy;',
    glsl: `vec4 effect(vec2 uv){
      vec2 c = vec2(uCx, 1.0 - uCy);
      vec2 dir = uv - c;
      vec3 sum = vec3(0.0);
      const int N = 24;
      for (int i = 0; i < N; i++){
        float t = 1.0 - uAmt * (float(i) / float(N - 1));
        sum += src(c + dir * t);
      }
      return vec4(sum / float(N), 1.0);
    }`,
  },
  {
    type: 'sharpen', label: 'Sharpen', category: 'blur', icon: 'deblur',
    params: [{ key: 'uAmt', label: 'Amount', min: 0, max: 3, step: 0.02, default: 0.6 }],
    uniforms: 'uniform float uAmt;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      vec3 blur = (src(uv + vec2(uTexel.x, 0.0)) + src(uv - vec2(uTexel.x, 0.0))
                 + src(uv + vec2(0.0, uTexel.y)) + src(uv - vec2(0.0, uTexel.y))) * 0.25;
      return vec4(clamp(c + (c - blur) * uAmt * 2.0, 0.0, 1.0), 1.0);
    }`,
  },

  // ─────────────────────────── LENS & CAMERA ───────────────────────────
  {
    type: 'vignette', label: 'Vignette', category: 'lens', icon: 'vignette',
    params: [
      { key: 'uAmt', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'uSize', label: 'Size', min: 0.1, max: 1.2, step: 0.01, default: 0.7 },
      { key: 'uSoft', label: 'Softness', min: 0.01, max: 1, step: 0.01, default: 0.4 },
      { key: 'uRound', label: 'Roundness', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 'uColor', label: 'Color', type: 'color', default: '#000000' },
    ],
    uniforms: 'uniform float uAmt, uSize, uSoft, uRound; uniform vec3 uColor;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      vec2 p = (uv - 0.5) * 2.0;
      p.x *= mix(uRes.x / uRes.y, 1.0, uRound);
      float d = length(p);
      float v = smoothstep(uSize, uSize - uSoft, d);
      return vec4(mix(uColor, c, mix(1.0, v, uAmt)), 1.0);
    }`,
  },
  {
    type: 'chromatic', label: 'Chromatic Aberration', category: 'lens', icon: 'lens',
    params: [
      { key: 'uAmt', label: 'Amount', min: 0, max: 0.05, step: 0.0005, default: 0.006 },
      { key: 'uRadial', label: 'Radial', type: 'bool', default: 1 },
    ],
    uniforms: 'uniform float uAmt; uniform int uRadial;',
    glsl: `vec4 effect(vec2 uv){
      vec2 d = uRadial == 1 ? (uv - 0.5) * uAmt : vec2(uAmt, 0.0);
      float r = src(uv + d).r;
      float g = src(uv).g;
      float b = src(uv - d).b;
      return vec4(r, g, b, 1.0);
    }`,
  },
  {
    type: 'distortion', label: 'Lens Distortion', category: 'lens', icon: 'panorama_photosphere',
    params: [
      { key: 'uAmt', label: 'Amount', min: -0.8, max: 0.8, step: 0.01, default: 0.2 },
      { key: 'uZoom', label: 'Zoom', min: 0.5, max: 1.5, step: 0.01, default: 1 },
    ],
    uniforms: 'uniform float uAmt, uZoom;',
    glsl: `vec4 effect(vec2 uv){
      vec2 p = (uv - 0.5) / uZoom;
      float r2 = dot(p, p);
      p *= 1.0 + uAmt * r2;
      vec2 suv = p + 0.5;
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
      return vec4(src(suv), 1.0);
    }`,
  },

  // ─────────────────────────── STYLIZE ───────────────────────────
  {
    type: 'bloom', label: 'Bloom / Glow', category: 'stylize', icon: 'flare',
    params: [
      { key: 'uThresh', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.6 },
      { key: 'uIntensity', label: 'Intensity', min: 0, max: 3, step: 0.02, default: 0.8 },
      { key: 'uRadius', label: 'Radius', min: 1, max: 30, step: 0.5, default: 8, suffix: 'px' },
      { key: 'uTint', label: 'Tint', type: 'color', default: '#ffffff' },
    ],
    uniforms: 'uniform float uThresh, uIntensity, uRadius; uniform vec3 uTint;',
    glsl: `vec4 effect(vec2 uv){
      vec3 base = src(uv);
      vec3 glow = vec3(0.0); float wsum = 0.0;
      const int N = 24;
      for (int i = 0; i < N; i++){
        float a = float(i) / float(N) * TAU * 3.0;
        float rad = (float(i) / float(N)) * uRadius;
        vec2 o = vec2(cos(a), sin(a)) * rad * uTexel;
        vec3 s = src(uv + o);
        float l = luma(s);
        float w = 1.0 / (rad + 1.0);
        glow += max(s - uThresh, 0.0) * w; wsum += w;
      }
      glow = glow / wsum * uIntensity * uTint;
      vec3 outc = 1.0 - (1.0 - base) * (1.0 - clamp(glow, 0.0, 1.0));
      return vec4(outc, 1.0);
    }`,
  },
  {
    type: 'pixelate', label: 'Pixelate', category: 'stylize', icon: 'grid_on',
    params: [{ key: 'uSize', label: 'Cell size', min: 1, max: 64, step: 1, default: 8, suffix: 'px' }],
    uniforms: 'uniform float uSize;',
    glsl: `vec4 effect(vec2 uv){
      vec2 cells = uRes / max(uSize, 1.0);
      vec2 quv = (floor(uv * cells) + 0.5) / cells;
      return vec4(src(quv), 1.0);
    }`,
  },
  {
    type: 'posterize', label: 'Posterize', category: 'stylize', icon: 'layers',
    params: [{ key: 'uLevels', label: 'Levels', min: 2, max: 32, step: 1, default: 6 }],
    uniforms: 'uniform float uLevels;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      float n = max(uLevels - 1.0, 1.0);
      return vec4(floor(c * n + 0.5) / n, 1.0);
    }`,
  },
  {
    type: 'edge', label: 'Edge Detect / Outline', category: 'stylize', icon: 'border_style',
    params: [
      { key: 'uAmt', label: 'Strength', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 'uThresh', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.15 },
      { key: 'uThick', label: 'Thickness', min: 0.5, max: 4, step: 0.1, default: 1 },
      { key: 'uColor', label: 'Line color', type: 'color', default: '#000000' },
      { key: 'uBg', label: 'Keep image', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    uniforms: 'uniform float uAmt, uThresh, uThick, uBg; uniform vec3 uColor;',
    glsl: `vec4 effect(vec2 uv){
      vec2 t = uTexel * uThick;
      float l00=luma(src(uv+t*vec2(-1,-1))), l10=luma(src(uv+t*vec2(0,-1))), l20=luma(src(uv+t*vec2(1,-1)));
      float l01=luma(src(uv+t*vec2(-1,0))),                                  l21=luma(src(uv+t*vec2(1,0)));
      float l02=luma(src(uv+t*vec2(-1,1))), l12=luma(src(uv+t*vec2(0,1))),  l22=luma(src(uv+t*vec2(1,1)));
      float sx = (l20 + 2.0*l21 + l22) - (l00 + 2.0*l01 + l02);
      float sy = (l02 + 2.0*l12 + l22) - (l00 + 2.0*l10 + l20);
      float e = smoothstep(uThresh, uThresh + 0.25, sqrt(sx*sx + sy*sy)) * uAmt;
      vec3 bg = mix(vec3(1.0), src(uv), uBg);
      return vec4(mix(bg, uColor, e), 1.0);
    }`,
  },
  {
    type: 'duotone', label: 'Duotone / Threshold', category: 'stylize', icon: 'tonality',
    params: [
      { key: 'uDark', label: 'Dark color', type: 'color', default: '#10243f' },
      { key: 'uLight', label: 'Light color', type: 'color', default: '#f4e9c1' },
      { key: 'uContrast', label: 'Contrast', min: 0, max: 1, step: 0.01, default: 0 },
      { key: 'uMix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 1 },
    ],
    uniforms: 'uniform vec3 uDark, uLight; uniform float uContrast, uMix;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      float l = luma(c);
      l = clamp((l - 0.5) * (1.0 + uContrast * 6.0) + 0.5, 0.0, 1.0);
      vec3 duo = mix(uDark, uLight, l);
      return vec4(mix(c, duo, uMix), 1.0);
    }`,
  },

  // ─────────────────────────── FILM & RETRO ───────────────────────────
  {
    type: 'grain', label: 'Film Grain', category: 'film', icon: 'grain',
    params: [
      { key: 'uAmt', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.15 },
      { key: 'uSize', label: 'Size', min: 1, max: 8, step: 0.5, default: 1.5, suffix: 'px' },
      { key: 'uMono', label: 'Monochrome', type: 'bool', default: 1 },
    ],
    uniforms: 'uniform float uAmt, uSize; uniform int uMono;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      vec2 gp = floor(uv * uRes / max(uSize, 1.0)) + vec2(uTime * 57.0, uTime * 31.0);
      if (uMono == 1){ float n = hash21(gp) - 0.5; c += n * uAmt; }
      else { c += (vec3(hash21(gp), hash21(gp + 9.1), hash21(gp + 17.7)) - 0.5) * uAmt; }
      return vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
  },
  {
    type: 'noise', label: 'Static / Noise', category: 'film', icon: 'blur_linear',
    params: [
      { key: 'uAmt', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: 'uColor', label: 'Color noise', type: 'bool', default: 0 },
    ],
    uniforms: 'uniform float uAmt; uniform int uColor;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      vec2 p = gl_FragCoord.xy + vec2(uTime * 113.0, uTime * 71.0);
      vec3 n = uColor == 1 ? vec3(hash21(p), hash21(p + 5.0), hash21(p + 11.0)) : vec3(hash21(p));
      return vec4(mix(c, n, uAmt), 1.0);
    }`,
  },
  {
    type: 'scanlines', label: 'Scanlines / CRT', category: 'film', icon: 'tv',
    params: [
      { key: 'uAmt', label: 'Scanline', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'uCount', label: 'Line count', min: 50, max: 1200, step: 10, default: 400 },
      { key: 'uMask', label: 'RGB mask', min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: 'uCurve', label: 'Curvature', min: 0, max: 1, step: 0.01, default: 0.15 },
    ],
    uniforms: 'uniform float uAmt, uCount, uMask, uCurve;',
    glsl: `vec4 effect(vec2 uv){
      vec2 p = uv;
      if (uCurve > 0.0){
        vec2 cc = uv * 2.0 - 1.0;
        cc *= 1.0 + uCurve * 0.15 * dot(cc, cc);
        p = cc * 0.5 + 0.5;
        if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
      }
      vec3 c = src(p);
      float sl = 0.5 + 0.5 * sin(p.y * uCount * PI);
      c *= 1.0 - uAmt * (1.0 - sl);
      if (uMask > 0.0){
        int m = int(mod(gl_FragCoord.x, 3.0));
        vec3 mc = m == 0 ? vec3(1.1, 0.6, 0.6) : m == 1 ? vec3(0.6, 1.1, 0.6) : vec3(0.6, 0.6, 1.1);
        c *= mix(vec3(1.0), mc, uMask);
      }
      return vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
  },
  {
    type: 'glitch', label: 'Glitch / RGB Shift', category: 'film', icon: 'broken_image',
    params: [
      { key: 'uAmt', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.4 },
      { key: 'uSpeed', label: 'Speed', min: 0, max: 20, step: 0.5, default: 8 },
      { key: 'uShift', label: 'RGB shift', min: 0, max: 0.05, step: 0.001, default: 0.008 },
    ],
    uniforms: 'uniform float uAmt, uSpeed, uShift;',
    glsl: `vec4 effect(vec2 uv){
      float tp = floor(uTime * uSpeed);
      float row = floor(uv.y * 48.0);
      float on = step(1.0 - uAmt * 0.6, hash21(vec2(row, 11.0 + tp)));
      float gx = on * (hash21(vec2(row, 3.0 + tp)) - 0.5) * uAmt * 0.2;
      vec2 d = vec2(uShift, 0.0);
      float r = src(uv + d + vec2(gx, 0.0)).r;
      float g = src(uv + vec2(gx, 0.0)).g;
      float b = src(uv - d + vec2(gx, 0.0)).b;
      return vec4(r, g, b, 1.0);
    }`,
  },
  {
    type: 'vhs', label: 'VHS Tape', category: 'film', icon: 'videocam',
    params: [{ key: 'uAmt', label: 'Amount', min: 0, max: 1, step: 0.01, default: 0.5 }],
    uniforms: 'uniform float uAmt;',
    glsl: `vec4 effect(vec2 uv){
      float wob = (hash21(vec2(floor(uv.y * 240.0), floor(uTime * 20.0))) - 0.5) * 0.004;
      float tearZone = smoothstep(0.0, 0.1, 0.1 - uv.y);
      float tearOn = step(0.6, hash21(vec2(floor(uTime * 8.0), 5.0)));
      float tear = tearZone * tearOn * (hash21(vec2(floor(uTime * 8.0), 9.0)) - 0.5) * 0.1;
      float gx = uAmt * (wob + tear);
      float ca = uAmt * 0.012;
      vec3 c;
      c.r = src(uv + vec2(gx + ca, 0.0)).r;
      c.g = src(uv + vec2(gx, 0.0)).g;
      c.b = src(uv + vec2(gx - ca, 0.0)).b;
      float snow = hash21(floor(gl_FragCoord.xy * 0.5) + vec2(uTime * 120.0, uTime * 7.0));
      c += vec3(step(1.0 - uAmt * 0.06, snow)) * 0.7;
      float sl = 0.5 + 0.5 * sin(uv.y * uRes.y * 1.2);
      c *= 1.0 - uAmt * 0.25 * (1.0 - sl);
      return vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
  },

  // ─────────────────────────── DISTORT & WARP ───────────────────────────
  {
    type: 'wave', label: 'Wave / Ripple', category: 'distort', icon: 'waves',
    params: [
      { key: 'uAmp', label: 'Amplitude', min: 0, max: 0.1, step: 0.001, default: 0.02 },
      { key: 'uFreq', label: 'Frequency', min: 1, max: 60, step: 0.5, default: 12 },
      { key: 'uAxis', label: 'Axis', type: 'select', default: 0, options: [{ label: 'Horizontal', value: 0 }, { label: 'Vertical', value: 1 }, { label: 'Both', value: 2 }] },
      { key: 'uSpeed', label: 'Speed', min: 0, max: 6, step: 0.1, default: 0 },
    ],
    uniforms: 'uniform float uAmp, uFreq, uSpeed; uniform int uAxis;',
    glsl: `vec4 effect(vec2 uv){
      vec2 p = uv;
      if (uAxis != 1) p.x += sin(uv.y * uFreq + uTime * uSpeed) * uAmp;
      if (uAxis != 0) p.y += sin(uv.x * uFreq + uTime * uSpeed) * uAmp;
      return vec4(src(p), 1.0);
    }`,
  },
  {
    type: 'twirl', label: 'Twirl / Swirl', category: 'distort', icon: 'rotate_right',
    params: [
      { key: 'uAngle', label: 'Angle', min: -720, max: 720, step: 5, default: 180, suffix: '°' },
      { key: 'uRadius', label: 'Radius', min: 0.05, max: 1, step: 0.01, default: 0.5 },
      { key: 'uCx', label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'uCy', label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    uniforms: 'uniform float uAngle, uRadius, uCx, uCy;',
    glsl: `vec4 effect(vec2 uv){
      vec2 c = vec2(uCx, 1.0 - uCy);
      vec2 d = uv - c;
      float ar = uRes.x / uRes.y;
      d.x *= ar;
      float r = length(d);
      float frac = 1.0 - smoothstep(0.0, uRadius, r);
      float a = uAngle * PI / 180.0 * frac;
      float s = sin(a), co = cos(a);
      d = vec2(d.x * co - d.y * s, d.x * s + d.y * co);
      d.x /= ar;
      return vec4(src(c + d), 1.0);
    }`,
  },
  {
    type: 'bulge', label: 'Bulge / Pinch', category: 'distort', icon: 'lens_blur',
    params: [
      { key: 'uAmt', label: 'Amount', min: -1, max: 1, step: 0.01, default: 0.5 },
      { key: 'uRadius', label: 'Radius', min: 0.05, max: 1, step: 0.01, default: 0.5 },
      { key: 'uCx', label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'uCy', label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    uniforms: 'uniform float uAmt, uRadius, uCx, uCy;',
    glsl: `vec4 effect(vec2 uv){
      vec2 c = vec2(uCx, 1.0 - uCy);
      vec2 d = uv - c;
      float ar = uRes.x / uRes.y;
      d.x *= ar;
      float r = length(d);
      if (r < uRadius){
        float frac = r / uRadius;
        float scale = mix(1.0, mix(1.0 - uAmt, 1.0, frac), 1.0 - frac);
        d *= scale;
      }
      d.x /= ar;
      return vec4(src(c + d), 1.0);
    }`,
  },
  {
    type: 'kaleidoscope', label: 'Kaleidoscope / Mirror', category: 'distort', icon: 'auto_awesome_mosaic',
    params: [
      { key: 'uSeg', label: 'Segments', min: 1, max: 24, step: 1, default: 6 },
      { key: 'uAngle', label: 'Rotation', min: 0, max: 360, step: 1, default: 0, suffix: '°' },
      { key: 'uCx', label: 'Center X', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'uCy', label: 'Center Y', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    uniforms: 'uniform float uSeg, uAngle, uCx, uCy;',
    glsl: `vec4 effect(vec2 uv){
      vec2 c = vec2(uCx, 1.0 - uCy);
      vec2 d = uv - c;
      float ar = uRes.x / uRes.y;
      d.x *= ar;
      float r = length(d);
      float a = atan(d.y, d.x) + uAngle * PI / 180.0;
      float seg = TAU / max(uSeg, 1.0);
      a = mod(a, seg);
      a = abs(a - seg * 0.5);
      vec2 p = vec2(cos(a), sin(a)) * r;
      p.x /= ar;
      return vec4(src(c + p), 1.0);
    }`,
  },

  // ─────────────────────────── LIGHT & ATMOSPHERE ───────────────────────────
  {
    type: 'lightleak', label: 'Light Leak / Gradient', category: 'light', icon: 'wb_iridescent',
    params: [
      { key: 'uColor', label: 'Color', type: 'color', default: '#ff8a3d' },
      { key: 'uAngle', label: 'Angle', min: 0, max: 360, step: 1, default: 45, suffix: '°' },
      { key: 'uPos', label: 'Position', min: 0, max: 1, step: 0.01, default: 0.8 },
      { key: 'uSoft', label: 'Softness', min: 0.05, max: 1, step: 0.01, default: 0.5 },
      { key: 'uAmt', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.6 },
    ],
    uniforms: 'uniform vec3 uColor; uniform float uAngle, uPos, uSoft, uAmt;',
    glsl: `vec4 effect(vec2 uv){
      vec3 c = src(uv);
      float a = uAngle * PI / 180.0;
      vec2 dir = vec2(cos(a), sin(a));
      float t = dot(uv - 0.5, dir) + 0.5;
      float g = smoothstep(uPos - uSoft, uPos, t);
      vec3 leak = uColor * g * uAmt;
      return vec4(1.0 - (1.0 - c) * (1.0 - leak), 1.0);
    }`,
  },
  {
    type: 'godrays', label: 'God Rays', category: 'light', icon: 'wb_sunny',
    params: [
      { key: 'uAmt', label: 'Intensity', min: 0, max: 2, step: 0.02, default: 0.6 },
      { key: 'uThresh', label: 'Threshold', min: 0, max: 1, step: 0.01, default: 0.7 },
      { key: 'uDecay', label: 'Decay', min: 0.8, max: 1, step: 0.005, default: 0.96 },
      { key: 'uCx', label: 'Source X', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'uCy', label: 'Source Y', min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
    uniforms: 'uniform float uAmt, uThresh, uDecay, uCx, uCy;',
    glsl: `vec4 effect(vec2 uv){
      vec3 base = src(uv);
      vec2 c = vec2(uCx, 1.0 - uCy);
      vec2 delta = (uv - c) / 48.0;
      vec2 pos = uv;
      float decay = 1.0;
      vec3 ray = vec3(0.0);
      for (int i = 0; i < 48; i++){
        pos -= delta;
        vec3 s = src(pos);
        ray += max(s - uThresh, 0.0) * decay;
        decay *= uDecay;
      }
      ray = ray / 48.0 * uAmt * 6.0;
      return vec4(1.0 - (1.0 - base) * (1.0 - clamp(ray, 0.0, 1.0)), 1.0);
    }`,
  },
]

export const EFFECTS = LIST.reduce((m, e) => { m[e.type] = e; return m }, {})
export const EFFECT_LIST = LIST

// Default layer for a given effect type, with params seeded from the schema.
export function defaultLayer(type) {
  const e = EFFECTS[type]
  const params = {}
  for (const p of e.params || []) params[p.key] = p.default
  return { id: Math.random().toString(36).slice(2, 9), type, enabled: true, opacity: 1, blend: 0, params }
}

export const BLEND_MODES = [
  { label: 'Normal', value: 0 }, { label: 'Multiply', value: 1 }, { label: 'Screen', value: 2 },
  { label: 'Overlay', value: 3 }, { label: 'Add', value: 4 }, { label: 'Subtract', value: 5 },
  { label: 'Difference', value: 6 }, { label: 'Lighten', value: 7 }, { label: 'Darken', value: 8 },
  { label: 'Dodge', value: 9 },
]
