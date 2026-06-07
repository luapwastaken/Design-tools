// ── WebGL2 dither / post-processing engine ──────────────────────────────────────
//
// Renders the whole pipeline on the GPU, straight into a visible canvas (no
// per-frame base64 encoding), in multiple fragment-shader passes:
//
//   1. dither    colour-adjust → ordered-dither bias → quantise to palette
//   2. shape     upscale to output res, masking each cell as square/round/diamond
//   3. post      glow/bloom (bright-pass + separable blur + screen), chromatic
//                aberration, CRT scanlines + curvature + vignette
//
// Error-diffusion screens are inherently sequential, so those are dithered on the
// CPU and fed in as a "precomputed" texture that still gets shape + post on GPU.
// Halftone composites likewise enter as precomputed and receive post only.
//
// The engine degrades gracefully: if WebGL2 is unavailable, `create()` returns
// null and the caller falls back to the canvas-2D path.

import { orderedMatrix, isMatrixOrdered } from './dither.js'
import { hexToRgb } from '../tools/DitherTool/palettes.js'

const QUAD_VS = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`

const COLOR_GLSL = `
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
vec3 adjust(vec3 c, float bright, float contrast, float hue, float sat, float invert){
  c *= bright;
  c = (c - 0.5) * contrast + 0.5;
  if (invert > 0.5) c = 1.0 - c;
  c = clamp(c, 0.0, 1.0);
  vec3 h = rgb2hsv(c);
  h.x = fract(h.x + hue);
  h.y = clamp(h.y * sat, 0.0, 1.0);
  return clamp(hsv2rgb(h), 0.0, 1.0);
}`

const DITHER_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc;
uniform sampler2D uThresh;
uniform float uThreshSize;
uniform int uAlgo;        // 0 threshold, 1 matrix, 2 random, 3 ign
uniform int uMode;        // 0 palette(mono/tonal/indexed), 3 rgb
uniform int uPalN;
uniform vec3 uPal[64];
uniform float uPalPos[64];
uniform float uPalSpread[64];
uniform float uPalIntensity[64];
uniform float uLevels;
uniform float uSpread;
uniform vec2 uRes;
uniform float uBright, uContrast, uHue, uSat, uInvert;
uniform float uJitter;     // 0..1 ordered-screen threshold jitter
uniform vec2  uPhase;      // screen-phase offset (px) for shimmer animation
uniform int   uMaskOn;     // 1 = limit effect to a luma band, original elsewhere
uniform int   uMaskMode;   // 0 luma band, 1 subject (distance from background luma)
uniform int   uMaskRaw;    // 1 = composite against the raw original texture
uniform float uBgLuma;     // background luma estimate (subject mode)
uniform float uMaskLo, uMaskHi, uMaskFeather, uMaskInvert;
uniform sampler2D uOrig;   // raw (un-adjusted) source for mask compositing
${COLOR_GLSL}
float dHash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float dtoneMask(float t, float pos, float spread){ if(spread>=0.999) return 1.0; float w=spread*0.5; return 1.0 - smoothstep(w, w+w*0.5+0.03, abs(t-pos)); }
float biasAt(vec2 px){
  vec2 q = px + uPhase;
  if (uAlgo == 1){ vec2 t = mod(q, uThreshSize) / uThreshSize; return texture(uThresh, t).r - 0.5; }
  if (uAlgo == 2){ return fract(sin(dot(q, vec2(12.9898, 78.233))) * 43758.5453) - 0.5; }
  if (uAlgo == 3){ float v = 52.9829189 * fract(0.06711056 * q.x + 0.00583715 * q.y); return fract(v) - 0.5; }
  return 0.0;
}
// Membership for the subject/region mask: either a soft luma band, or distance of
// the pixel's luma from the background estimate (rough subject isolation).
float maskWeight(float lt){
  float m;
  if (uMaskMode == 1){
    m = smoothstep(uMaskLo, uMaskLo + uMaskFeather + 0.001, abs(lt - uBgLuma));
  } else {
    m = smoothstep(uMaskLo - uMaskFeather, uMaskLo + uMaskFeather, lt)
      * (1.0 - smoothstep(uMaskHi - uMaskFeather, uMaskHi + uMaskFeather, lt));
  }
  return uMaskInvert > 0.5 ? 1.0 - m : m;
}
vec3 nearestPal(vec3 c){
  float lt = dot(c, vec3(0.299,0.587,0.114));
  float bd = 1e9; vec3 best = c;
  for (int i = 0; i < 64; i++){ if (i >= uPalN) break;
    vec3 p = uPal[i] / 255.0; vec3 d = c - p; float dd = dot(d, d);
    float w = uPalIntensity[i] * (0.25 + 0.75 * dtoneMask(lt, uPalPos[i], uPalSpread[i]));
    dd /= max(0.05, w);
    if (dd < bd){ bd = dd; best = p; } }
  return best;
}
void main(){
  vec3 c0 = adjust(texture(uSrc, vUv).rgb, uBright, uContrast, uHue, uSat, uInvert);
  vec2 px = floor(vUv * uRes);
  float bias = biasAt(px) * uSpread;
  if (uJitter > 0.0) bias += (dHash(px + uPhase * 0.37) - 0.5) * uJitter;
  vec3 c = clamp(c0 + bias, 0.0, 1.0);
  vec3 o;
  if (uMode == 3){ float lv = max(uLevels - 1.0, 1.0); o = floor(c * lv + 0.5) / lv; }
  else o = nearestPal(c);
  if (uMaskOn == 1){
    vec3 keep = uMaskRaw == 1 ? texture(uOrig, vUv).rgb : c0;
    o = mix(keep, o, maskWeight(dot(keep, vec3(0.299, 0.587, 0.114))));
  }
  fragColor = vec4(o, 1.0);
}`

const SHAPE_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uDith;
uniform vec2 uWork;
uniform int uShape;       // 0 square, 1 round, 2 diamond
uniform vec3 uGap;
void main(){
  vec2 cellIdx = floor(vUv * uWork);
  vec2 uvCell = (cellIdx + 0.5) / uWork;
  vec3 col = texture(uDith, uvCell).rgb;
  float m = 1.0;
  if (uShape != 0){
    vec2 local = (fract(vUv * uWork) - 0.5) * 2.0;
    float r = uShape == 2 ? (abs(local.x) + abs(local.y)) : length(local);
    m = r <= 1.0 ? 1.0 : 0.0;
  }
  fragColor = vec4(mix(uGap, col, m), 1.0);
}`

const COPY_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uTex;
void main(){ fragColor = texture(uTex, vUv); }`

const BRIGHT_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uTex; uniform float uThreshold;
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  fragColor = vec4(l > uThreshold ? c : vec3(0.0), 1.0);
}`

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uTex; uniform vec2 uDir; uniform vec2 uTexel;
void main(){
  float w[5];
  w[0]=0.227027; w[1]=0.1945946; w[2]=0.1216216; w[3]=0.054054; w[4]=0.016216;
  vec3 sum = texture(uTex, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++){
    vec2 off = uDir * uTexel * float(i) * 1.4;
    sum += texture(uTex, vUv + off).rgb * w[i];
    sum += texture(uTex, vUv - off).rgb * w[i];
  }
  fragColor = vec4(sum, 1.0);
}`

const POST_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uBase;
uniform sampler2D uGlow;
uniform float uGlowAmt;
uniform vec3  uGlowTint;    // colours the bloom (halation)
uniform float uChroma;
uniform float uScan;        // 0..1 scanline strength
uniform float uScanCount;
uniform float uCurv;
uniform float uVig;
uniform float uMask;        // 0 none, 1 aperture grille, 2 shadow mask
uniform float uMaskAmt;
uniform float uMaskScale;   // output upscale → keep mask cells working-res sized
uniform float uGlitch;      // 0..1 horizontal slice displacement
uniform float uGrain;       // 0..1 film grain
uniform float uGrainSize;
uniform float uTemp;        // -1..1 warm/cool
uniform float uTint;        // -1..1 green/magenta
uniform float uTime;        // seconds — animates glitch/grain/warp/VHS (0 = frozen)
uniform float uWave;        // displacement warp amplitude (uv units)
uniform float uWaveFreq;
uniform float uWaveAxis;    // 0 horizontal, 1 vertical, 2 both
uniform sampler2D uStreak;  // anamorphic horizontal bloom streaks
uniform float uStreakAmt;
uniform float uEdge;        // ink-outline opacity
uniform float uEdgeThresh;
uniform vec3  uEdgeColor;
uniform vec2  uTexel;       // 1/output size — for Sobel sampling
uniform float uVhs;         // analog tape composite amount

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

void main(){
  vec2 uv = vUv;
  // barrel curvature
  if (uCurv > 0.0){
    vec2 cc = uv * 2.0 - 1.0;
    cc *= 1.0 + uCurv * 0.12 * dot(cc, cc);
    uv = cc * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0){ fragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  }
  // wave / displacement warp
  if (uWave > 0.0){
    if (uWaveAxis < 1.5) uv.x += sin(uv.y * uWaveFreq + uTime * 3.0) * uWave;
    if (uWaveAxis > 0.5) uv.y += sin(uv.x * uWaveFreq + uTime * 3.0) * uWave;
  }
  // glitch — per-row horizontal slice offset (re-rolls over time when animated)
  float gx = 0.0;
  if (uGlitch > 0.0){
    float row = floor(uv.y * 48.0);
    float tp = floor(uTime * 12.0);
    float sliceOn = step(1.0 - uGlitch * 0.6, hash(vec2(row, 11.0 + tp)));
    gx = sliceOn * (hash(vec2(row, 3.0 + tp)) - 0.5) * uGlitch * 0.15;
  }
  // VHS — per-line wobble + bottom head-switch tear, feeds the same offset path
  float vchroma = 0.0;
  if (uVhs > 0.0){
    float wob = (hash(vec2(floor(uv.y * 240.0), floor(uTime * 20.0))) - 0.5) * 0.004;
    float tearZone = smoothstep(0.0, 0.10, 0.10 - uv.y);
    float tearOn = step(0.6, hash(vec2(floor(uTime * 8.0), 5.0)));
    float tear = tearZone * tearOn * (hash(vec2(floor(uTime * 8.0), 9.0)) - 0.5) * 0.10;
    gx += uVhs * (wob + tear);
    vchroma = uVhs * 0.012;
  }
  // base sample with chromatic aberration + glitch/VHS channel split
  vec3 col;
  float caTotal = uChroma * 0.02 + vchroma;
  if (caTotal > 0.0 || gx != 0.0){
    vec2 d = (uv - 0.5) * caTotal + vec2(vchroma, 0.0);
    col.r = texture(uBase, uv + d + vec2(gx, 0.0)).r;
    col.g = texture(uBase, uv + vec2(gx * 0.5, 0.0)).g;
    col.b = texture(uBase, uv - d + vec2(gx * 1.4, 0.0)).b;
  } else col = texture(uBase, uv).rgb;
  // VHS tape snow — sparse bright specks scrolling over time
  if (uVhs > 0.0){
    float snow = hash(floor(gl_FragCoord.xy * 0.5) + vec2(uTime * 120.0, uTime * 7.0));
    col += vec3(step(1.0 - uVhs * 0.06, snow)) * 0.7;
  }
  // ink outline (Sobel on the base luma)
  if (uEdge > 0.0){
    float l00 = luma(texture(uBase, uv + uTexel * vec2(-1.0, -1.0)).rgb);
    float l10 = luma(texture(uBase, uv + uTexel * vec2( 0.0, -1.0)).rgb);
    float l20 = luma(texture(uBase, uv + uTexel * vec2( 1.0, -1.0)).rgb);
    float l01 = luma(texture(uBase, uv + uTexel * vec2(-1.0,  0.0)).rgb);
    float l21 = luma(texture(uBase, uv + uTexel * vec2( 1.0,  0.0)).rgb);
    float l02 = luma(texture(uBase, uv + uTexel * vec2(-1.0,  1.0)).rgb);
    float l12 = luma(texture(uBase, uv + uTexel * vec2( 0.0,  1.0)).rgb);
    float l22 = luma(texture(uBase, uv + uTexel * vec2( 1.0,  1.0)).rgb);
    float sx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float sy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    float e = smoothstep(uEdgeThresh, uEdgeThresh + 0.25, sqrt(sx * sx + sy * sy));
    col = mix(col, uEdgeColor, e * uEdge);
  }
  // bloom (tinted screen blend)
  vec3 g = texture(uGlow, uv).rgb * uGlowAmt * uGlowTint;
  col = 1.0 - (1.0 - col) * (1.0 - g);
  // anamorphic streaks (wide horizontal bloom)
  if (uStreakAmt > 0.0){
    vec3 st = texture(uStreak, uv).rgb * uStreakAmt * uGlowTint;
    col = 1.0 - (1.0 - col) * (1.0 - st);
  }
  // colour grade — temperature & tint
  if (uTemp != 0.0 || uTint != 0.0){
    col.r += uTemp * 0.12; col.b -= uTemp * 0.12; col.g += uTint * 0.12;
    col = clamp(col, 0.0, 1.0);
  }
  // scanlines
  if (uScan > 0.0){
    float sl = 0.5 + 0.5 * sin(uv.y * uScanCount * 6.28318);
    col *= 1.0 - uScan * 0.6 * (1.0 - sl);
  }
  // phosphor mask
  if (uMaskAmt > 0.0 && uMask > 0.5){
    float sc = max(uMaskScale, 1.0);
    float px = gl_FragCoord.x / sc, py = gl_FragCoord.y / sc;
    float idx = uMask < 1.5 ? floor(px) : floor(px * 0.5) + mod(floor(py * 0.5), 2.0) * 1.5;
    int c = int(mod(idx, 3.0));
    vec3 m = c == 0 ? vec3(1.15, 0.55, 0.55) : c == 1 ? vec3(0.55, 1.15, 0.55) : vec3(0.55, 0.55, 1.15);
    col *= mix(vec3(1.0), m, uMaskAmt);
  }
  // vignette
  if (uVig > 0.0){
    float d = distance(uv, vec2(0.5));
    col *= 1.0 - uVig * smoothstep(0.35, 0.85, d);
  }
  // film grain (shimmers per frame when animated)
  if (uGrain > 0.0){
    float n = hash(floor(gl_FragCoord.xy / max(uGrainSize, 1.0)) + vec2(uTime * 57.0, uTime * 31.0));
    col += (n - 0.5) * uGrain;
  }
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`

// ── Screen-space AM halftone ──────────────────────────────────────────────────
// For every output fragment we find its screen cell (per ink, rotated), sample
// the underlying ink density at the cell centre (gamma-mapped), and draw an
// anti-aliased dot whose size tracks that density. Because the grid is analytic
// and the tone is sampled per cell, the result is a perfectly regular rosette —
// never the blobby overlap of size-varying stamped dots.
const HALFTONE_FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uRes;          // source working resolution (px)
uniform int uInkMode;       // 0 cmyk, 1 spot, 2 mono
uniform int uInkCount;
uniform vec3 uInkCol[16];
uniform float uInkAngle[16];
uniform float uCell;        // grid spacing in source px
uniform int uShape;         // 0 circle,1 square,2 diamond,3 triangle,4 hexagon,5 ring,6 line,7 stochastic
uniform float uGamma;
uniform float uDotSize;     // dot size multiplier (1.0 → solid at full tone)
uniform vec3 uPaper;
uniform float uPaperA;      // paper alpha (0 = transparent gaps)
uniform int uOnlyInk;       // -1 = composite, else single layer
uniform float uBright, uContrast, uHue, uSat, uInvert;
uniform float uLod;        // mip level ≈ log2(cell) → samples the cell's average tone
uniform float uInkPos[16];       // each ink's tonal position 0..1 (shadows→highlights)
uniform float uInkSpread[16];    // tonal window width (1 = full range)
uniform float uInkIntensity[16]; // strength multiplier
uniform float uReg;        // 0..1 registration misalignment between ink layers
uniform float uDotGain;    // 0..1 ink spread — enlarges every dot
uniform float uFreqVary;   // 0..1 per-ink cell-size variation
uniform float uPaperGrain; // 0..1 paper-texture noise over the composite
uniform int   uMaskOn;     // 1 = composite over the original photo via a luma band
uniform int   uMaskMode;   // 0 luma band, 1 subject
uniform int   uMaskRaw;    // 1 = composite against the raw original texture
uniform float uBgLuma;     // background luma estimate (subject mode)
uniform float uMaskLo, uMaskHi, uMaskFeather, uMaskInvert;
uniform sampler2D uOrig;   // raw (un-adjusted) source for mask compositing
${COLOR_GLSL}
float gAA = 1.0;   // anti-alias half-width (source px / output px), set once in main()
float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
float hHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
// Per-ink screen offset (px) — shifts each separation's grid for a misregistered look.
vec2 inkReg(int i){ if(uReg<=0.0) return vec2(0.0); float fi=float(i); return uReg * uCell * 0.5 * (vec2(hHash(vec2(fi,1.7)), hHash(vec2(fi,4.3))) - 0.5); }
// Per-ink cell spacing — small variation between inks reduces moiré.
float inkCell(int i){ return uCell * (1.0 + uFreqVary * (hHash(vec2(float(i), 9.1)) - 0.5) * 0.6); }
float hMaskWeight(float lt){
  float m;
  if (uMaskMode == 1){
    m = smoothstep(uMaskLo, uMaskLo + uMaskFeather + 0.001, abs(lt - uBgLuma));
  } else {
    m = smoothstep(uMaskLo - uMaskFeather, uMaskLo + uMaskFeather, lt)
      * (1.0 - smoothstep(uMaskHi - uMaskFeather, uMaskHi + uMaskFeather, lt));
  }
  return uMaskInvert > 0.5 ? 1.0 - m : m;
}
vec4 rgb2cmyk(vec3 c){ float k=1.0-max(max(c.r,c.g),c.b); if(k>=0.999) return vec4(0.0,0.0,0.0,1.0); return vec4((1.0-c.r-k)/(1.0-k),(1.0-c.g-k)/(1.0-k),(1.0-c.b-k)/(1.0-k),k); }
vec3 sampleSrc(vec2 px){ vec3 c = textureLod(uSrc, clamp(px/uRes,0.0,1.0), uLod).rgb; return adjust(c,uBright,uContrast,uHue,uSat,uInvert); }
// Tonal window: 1 across the whole range at spread=1; otherwise a soft band
// centred on the ink's tonal position, so a colour only appears near that tone.
float toneMask(float t, float pos, float spread){
  if (spread >= 0.999) return 1.0;
  float w = spread * 0.5;
  float fade = w * 0.5 + 0.03;
  return 1.0 - smoothstep(w, w + fade, abs(t - pos));
}
float density(int i, vec3 c){
  float d = 0.0;
  if (uInkMode==0){ vec4 cm=rgb2cmyk(c); d = i==0?cm.x:i==1?cm.y:i==2?cm.z:cm.w; }
  else if (uInkMode==2){ d = 1.0 - lum(c); }
  else {
    float d1=1e9,d2=1e9; int i1=-1,i2=-1;
    for(int j=0;j<16;j++){ if(j>=uInkCount) break; vec3 ic=uInkCol[j]; vec3 dv=c-ic; float dd=dot(dv,dv);
      if(dd<d1){ d2=d1; i2=i1; d1=dd; i1=j; } else if(dd<d2){ d2=dd; i2=j; } }
    float A = clamp(distance(c,uPaper)/0.9, 0.0, 1.0);
    float t = d1/(d1+d2+1e-4);
    d = (i==i1)? A*(1.0-t) : (i==i2)? A*t : 0.0;
  }
  d = pow(clamp(d, 0.0, 1.0), uGamma);
  d *= uInkIntensity[i] * toneMask(lum(c), uInkPos[i], uInkSpread[i]);   // strength + tonal spread
  return clamp(d, 0.0, 1.0);
}
// ── Shape signed-distance functions (centred at origin; r = outer radius). ──
// Negative inside, positive outside. Add a new shape by adding one case below.
float sdCircle(vec2 p, float r){ return length(p) - r; }
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d,0.0)) + min(max(d.x,d.y),0.0); }
float sdDiamond(vec2 p, float r){ return (abs(p.x) + abs(p.y)) - r; }
float sdTriangle(vec2 p, float r){
  const float k = 1.7320508;
  p.x = abs(p.x) - r; p.y = p.y + r/k;
  if (p.x + k*p.y > 0.0) p = vec2(p.x - k*p.y, -k*p.x - p.y) / 2.0;
  p.x -= clamp(p.x, -2.0*r, 0.0);
  return -length(p) * sign(p.y);
}
float sdHexagon(vec2 p, float r){
  const vec3 k = vec3(-0.8660254, 0.5, 0.5773503);
  p = abs(p);
  p -= 2.0 * min(dot(k.xy, p), 0.0) * k.xy;
  p -= vec2(clamp(p.x, -k.z*r, k.z*r), r);
  return length(p) * sign(p.y);
}
float sdRing(vec2 p, float r){ return abs(length(p) - r*0.78) - r*0.30; }
float sdStar5(vec2 p, float r){
  const vec2 k1 = vec2(0.809016994, -0.587785252);
  const vec2 k2 = vec2(-k1.x, k1.y);
  p.x = abs(p.x);
  p -= 2.0*max(dot(k1,p),0.0)*k1;
  p -= 2.0*max(dot(k2,p),0.0)*k2;
  p.x = abs(p.x); p.y -= r;
  vec2 ba = 0.45*vec2(-k1.y, k1.x) - vec2(0.0, 1.0);
  float h = clamp(dot(p,ba)/dot(ba,ba), 0.0, r);
  return length(p-ba*h) * sign(p.y*ba.x - p.x*ba.y);
}
float sdCross(vec2 p, float r){ return min(sdBox(p, vec2(r, r*0.34)), sdBox(p, vec2(r*0.34, r))); }
float shapeSDF(int s, vec2 p, float r){
  if (s==1) return sdBox(p, vec2(r*0.886));   // area-matched to circle
  if (s==2) return sdDiamond(p, r*1.114);
  if (s==3) return sdTriangle(p, r*1.21);
  if (s==4) return sdHexagon(p, r*0.952);
  if (s==5) return sdRing(p, r);
  if (s==6) return abs(p.y) - r*0.5;          // line / stripe (thickness)
  if (s==8) return sdStar5(p, r*1.35);
  if (s==9) return sdCross(p, r*1.15);
  if (s==10) return length(p*vec2(1.0,1.55)) - r*1.1;   // ellipse (squashed circle)
  return sdCircle(p, r);
}
// Stamp coverage of ONE cell's dot at fragment q.
float dotAt(int i, vec2 q, vec2 center, float ca, float sa, float maxR){
  vec2 csrc = vec2(ca*center.x + sa*center.y, -sa*center.x + ca*center.y);
  float d = density(i, sampleSrc(csrc));
  if (d <= 0.001) return 0.0;
  float r = maxR * sqrt(d);                    // area ∝ tone, scaled by dot size
  float sd = shapeSDF(uShape, q - center, r);
  return smoothstep(gAA, -gAA, sd);            // exact SDF → uniform clean AA for any shape
}
float dotMask(int i, vec2 p){
  p += inkReg(i);                       // per-ink registration shift
  float cell = inkCell(i);              // per-ink screen frequency
  float ang = uInkAngle[i];
  float ca=cos(ang), sa=sin(ang);
  vec2 q = vec2(ca*p.x - sa*p.y, sa*p.x + ca*p.y);
  vec2 base = floor(q/cell);
  // r reaches the cell's corner distance (0.707·cell) at full tone → solid shadows.
  // Dot gain enlarges every dot for a printed, ink-spread look.
  float maxR = cell * 0.7071 * uDotSize * (1.0 + uDotGain * 0.5);
  if (uShape==7){   // stochastic / FM — fixed micro-dots, density varies
    vec2 center = (base + 0.5) * cell;
    vec2 csrc = vec2(ca*center.x + sa*center.y, -sa*center.x + ca*center.y);
    float d = density(i, sampleSrc(csrc));
    float n = fract(sin(dot(floor(p),vec2(12.9898,78.233)))*43758.5453);
    return d>n?1.0:0.0;
  }
  // Union over the 3×3 neighbourhood so dots overflow cleanly into neighbours
  // (no cell-boundary clipping).
  float m = 0.0;
  for (int oy=-1; oy<=1; oy++){
    for (int ox=-1; ox<=1; ox++){
      vec2 center = (base + vec2(float(ox), float(oy)) + 0.5) * cell;
      m = max(m, dotAt(i, q, center, ca, sa, maxR));
    }
  }
  return m;
}
void main(){
  vec2 p = vUv * uRes;
  gAA = max(fwidth(p.x), fwidth(p.y)) * 1.0;   // SDF edge AA (uniform flow → defined)
  if (uOnlyInk>=0){ float m = dotMask(uOnlyInk, p); fragColor = vec4(uInkCol[uOnlyInk], m); return; }
  vec3 col = uPaper; float cover = 0.0;
  for(int i=0;i<16;i++){ if(i>=uInkCount) break; float m = dotMask(i,p); col *= mix(vec3(1.0), uInkCol[i], m); cover = max(cover, m); }
  // Composite over the original photo within the selected luma band.
  if (uMaskOn == 1){
    vec3 orig = uMaskRaw == 1 ? texture(uOrig, clamp(p / uRes, 0.0, 1.0)).rgb : sampleSrc(p);
    float w = hMaskWeight(lum(orig));
    col = mix(orig, col, w);
    cover = mix(1.0, cover, w);
  }
  // Paper-texture grain — subtle tonal noise across the sheet.
  if (uPaperGrain > 0.0){
    float n = hHash(floor(gl_FragCoord.xy * 0.5)) - 0.5;
    col = clamp(col + n * uPaperGrain * 0.18, 0.0, 1.0);
  }
  fragColor = vec4(col, mix(uPaperA, 1.0, cover));
}`

export function create(canvas) {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true })
  if (!gl) return null
  try { return new GLEngine(gl, canvas) } catch (e) { console.warn('GL engine init failed', e); return null }
}

class GLEngine {
  constructor(gl, canvas) {
    this.gl = gl; this.canvas = canvas
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096
    this.quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    this.progs = {
      dither: this._prog(DITHER_FS), shape: this._prog(SHAPE_FS), copy: this._prog(COPY_FS),
      bright: this._prog(BRIGHT_FS), blur: this._prog(BLUR_FS), post: this._prog(POST_FS),
      halftone: this._prog(HALFTONE_FS),
    }
    this.srcTex = this._tex()
    this.origTex = this._tex()    // raw (un-adjusted) source for mask compositing
    this.threshTex = this._tex()
    this.threshId = null
    this.fbos = {}     // pooled framebuffer+texture by key
  }

  _prog(fs) {
    const gl = this.gl
    const v = gl.createShader(gl.VERTEX_SHADER); gl.shaderSource(v, QUAD_VS); gl.compileShader(v)
    if (!gl.getShaderParameter(v, gl.COMPILE_STATUS)) throw new Error('VS: ' + gl.getShaderInfoLog(v))
    const f = gl.createShader(gl.FRAGMENT_SHADER); gl.shaderSource(f, fs); gl.compileShader(f)
    if (!gl.getShaderParameter(f, gl.COMPILE_STATUS)) throw new Error('FS: ' + gl.getShaderInfoLog(f))
    const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p))
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
    if (!f) { f = this.fbos[key] = { fb: gl.createFramebuffer(), tex: this._tex(), w: 0, h: 0 } }
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

  // Bind program + target + quad + viewport. Caller sets uniforms then draws.
  _draw(prog, target, w, h) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null)
    gl.viewport(0, 0, w, h)
    this._bindQuad(prog)
  }

  _setLinear(tex) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  }

  _setNearest(tex) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  }

  _uploadSource(srcCanvas) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    // Mipmaps let the halftone sample each cell's *average* tone (via textureLod)
    // instead of a single noisy point — key to a clean, alias-free screen.
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  }

  // Upload a raw-original canvas (no mipmaps) for mask compositing.
  _uploadOrig(canvas) {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, this.origTex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  }

  _uploadThresh(algo) {
    if (!isMatrixOrdered(algo)) return
    if (this.threshId === algo) return
    const gl = this.gl
    const { size, data } = orderedMatrix(algo)
    const px = new Uint8Array(size * size * 4)
    for (let i = 0; i < size * size; i++) { const v = Math.round(data[i] * 255); px[i * 4] = v; px[i * 4 + 1] = v; px[i * 4 + 2] = v; px[i * 4 + 3] = 255 }
    gl.bindTexture(gl.TEXTURE_2D, this.threshTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, px)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    this.threshSize = size
    this.threshId = algo
  }

  // ── Main render. p describes the whole pipeline. Draws to the visible canvas;
  // if `outTarget` (an FBO) is given, draws there instead (used for export). ───
  render(srcCanvas, p, outW, outH) {
    const gl = this.gl
    const workW = srcCanvas.width, workH = srcCanvas.height
    this._uploadSource(srcCanvas)

    // Pass 1 — dither (or passthrough for precomputed/diffusion/halftone input)
    let baseTex
    if (p.applyDither) {
      this._uploadThresh(p.algorithm)
      const d = this._fbo('dith', workW, workH)
      const pr = this.progs.dither
      this._draw(pr, d, workW, workH)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
      gl.uniform1i(gl.getUniformLocation(pr, 'uSrc'), 0)
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.threshTex)
      gl.uniform1i(gl.getUniformLocation(pr, 'uThresh'), 1)
      this._setUni(pr, {
        uThreshSize: this.threshSize || 8,
        uAlgo: p.algoKind, uMode: p.mode === 'rgb' ? 3 : 0, uPalN: p.palette.length,
        uLevels: p.levels, uSpread: p.spread, uRes: [workW, workH],
        uBright: p.bright, uContrast: p.contrast, uHue: p.hue, uSat: p.sat, uInvert: p.invert ? 1 : 0,
        uJitter: p.jitter || 0, uPhase: p.phase || [0, 0],
        uMaskLo: p.maskLo ?? 0, uMaskHi: p.maskHi ?? 1, uMaskFeather: p.maskFeather ?? 0.1, uMaskInvert: p.maskInvert ? 1 : 0,
        uBgLuma: p.bgLuma ?? 0,
      })
      gl.uniform1i(gl.getUniformLocation(pr, 'uMaskOn'), p.maskOn ? 1 : 0)
      gl.uniform1i(gl.getUniformLocation(pr, 'uMaskMode'), p.maskMode === 'subject' ? 1 : 0)
      gl.uniform1i(gl.getUniformLocation(pr, 'uMaskRaw'), p.maskOn && p.maskRaw && p.origCanvas ? 1 : 0)
      if (p.maskOn && p.maskRaw && p.origCanvas) {
        // Select unit 2 *before* uploading so origTex doesn't clobber uSrc/uThresh.
        gl.activeTexture(gl.TEXTURE2)
        this._uploadOrig(p.origCanvas)
        gl.uniform1i(gl.getUniformLocation(pr, 'uOrig'), 2)
      }
      const flat = new Float32Array(64 * 3)
      const pPos = new Float32Array(64).fill(0.5), pSpr = new Float32Array(64).fill(1), pInt = new Float32Array(64).fill(1)
      for (let i = 0; i < p.palette.length && i < 64; i++) {
        flat[i * 3] = p.palette[i][0]; flat[i * 3 + 1] = p.palette[i][1]; flat[i * 3 + 2] = p.palette[i][2]
        if (p.palCtl && p.palCtl[i]) { pPos[i] = p.palCtl[i].pos; pSpr[i] = p.palCtl[i].spread; pInt[i] = p.palCtl[i].intensity }
      }
      gl.uniform3fv(gl.getUniformLocation(pr, 'uPal'), flat)
      gl.uniform1fv(gl.getUniformLocation(pr, 'uPalPos'), pPos)
      gl.uniform1fv(gl.getUniformLocation(pr, 'uPalSpread'), pSpr)
      gl.uniform1fv(gl.getUniformLocation(pr, 'uPalIntensity'), pInt)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      baseTex = d.tex
    } else {
      baseTex = this.srcTex
    }

    // Pass 2 — shape (also performs the upscale to output res)
    const wW = p.applyShape ? workW : outW
    const wH = p.applyShape ? workH : outH
    this._setNearest(baseTex)
    const shaped = this._fbo('shape', outW, outH)
    const sp = this.progs.shape
    this._draw(sp, shaped, outW, outH)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, baseTex)
    gl.uniform1i(gl.getUniformLocation(sp, 'uDith'), 0)
    this._setUni(sp, { uWork: [wW, wH], uShape: p.applyShape ? p.shape : 0, uGap: p.gap })
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    return this._finish(shaped.tex, outW, outH, p)
  }

  // ── Halftone (screen-space) with 2× supersampling → box-downsample for clean,
  // consistently smooth dot edges (the robust alternative to thin per-fragment AA).
  renderHalftone(srcCanvas, p, outW, outH) {
    this._uploadSource(srcCanvas)
    const ss = (outW * 2 <= this.maxTex && outH * 2 <= this.maxTex) ? 2 : 1
    if (ss === 1) {
      const ht = this._fbo('ht', outW, outH)
      this._halftonePass(ht, srcCanvas, p, outW, outH, -1)
      return this._finish(ht.tex, outW, outH, p)
    }
    const hi = this._fbo('htHi', outW * ss, outH * ss)
    this._halftonePass(hi, srcCanvas, p, outW * ss, outH * ss, -1)
    this._setLinear(hi.tex)
    const ht = this._fbo('ht', outW, outH)
    this._drawTex(this.progs.copy, ht, hi.tex, outW, outH)   // 2×2 box average
    return this._finish(ht.tex, outW, outH, p)
  }

  // Render a single ink layer (transparent gaps) and read it back to a 2D canvas.
  renderHalftoneLayer(srcCanvas, p, inkIndex, outW, outH) {
    this._uploadSource(srcCanvas)
    const ht = this._fbo('htL', outW, outH)
    this._halftonePass(ht, srcCanvas, p, outW, outH, inkIndex)
    return this._readFbo(ht, outW, outH)
  }

  _halftonePass(target, srcCanvas, p, outW, outH, onlyInk) {
    const gl = this.gl
    const pr = this.progs.halftone
    this._draw(pr, target, outW, outH)
    const L = n => gl.getUniformLocation(pr, n)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.srcTex)
    gl.uniform1i(L('uSrc'), 0)
    const cols = new Float32Array(16 * 3), angs = new Float32Array(16)
    const pos = new Float32Array(16), spr = new Float32Array(16).fill(1), inten = new Float32Array(16).fill(1)
    for (let i = 0; i < p.inks.length && i < 16; i++) {
      const ink = p.inks[i]
      cols[i * 3] = ink.color[0]; cols[i * 3 + 1] = ink.color[1]; cols[i * 3 + 2] = ink.color[2]
      angs[i] = ink.angle * Math.PI / 180
      pos[i] = ink.pos ?? 0.5; spr[i] = ink.spread ?? 1; inten[i] = ink.intensity ?? 1
    }
    gl.uniform3fv(L('uInkCol'), cols)
    gl.uniform1fv(L('uInkAngle'), angs)
    gl.uniform1fv(L('uInkPos'), pos)
    gl.uniform1fv(L('uInkSpread'), spr)
    gl.uniform1fv(L('uInkIntensity'), inten)
    gl.uniform2f(L('uRes'), srcCanvas.width, srcCanvas.height)
    gl.uniform1i(L('uInkMode'), p.inkModeId)
    gl.uniform1i(L('uInkCount'), p.inks.length)
    gl.uniform1i(L('uShape'), p.htShapeId)
    gl.uniform1i(L('uOnlyInk'), onlyInk)
    gl.uniform1f(L('uCell'), p.cell)
    gl.uniform1f(L('uLod'), Math.max(0, Math.log2(p.cell) - 0.4))
    gl.uniform1f(L('uGamma'), p.gamma)
    gl.uniform1f(L('uDotSize'), p.dotSize)
    gl.uniform3f(L('uPaper'), p.paper[0], p.paper[1], p.paper[2])
    gl.uniform1f(L('uPaperA'), p.paperAlpha)
    gl.uniform1f(L('uBright'), p.bright); gl.uniform1f(L('uContrast'), p.contrast)
    gl.uniform1f(L('uHue'), p.hue); gl.uniform1f(L('uSat'), p.sat); gl.uniform1f(L('uInvert'), p.invert ? 1 : 0)
    gl.uniform1f(L('uReg'), p.reg || 0)
    gl.uniform1f(L('uDotGain'), p.dotGain || 0)
    gl.uniform1f(L('uFreqVary'), p.freqVary || 0)
    gl.uniform1f(L('uPaperGrain'), p.paperGrain || 0)
    gl.uniform1i(L('uMaskOn'), p.maskOn ? 1 : 0)
    gl.uniform1i(L('uMaskMode'), p.maskMode === 'subject' ? 1 : 0)
    gl.uniform1f(L('uBgLuma'), p.bgLuma ?? 0)
    gl.uniform1f(L('uMaskLo'), p.maskLo ?? 0); gl.uniform1f(L('uMaskHi'), p.maskHi ?? 1)
    gl.uniform1f(L('uMaskFeather'), p.maskFeather ?? 0.1); gl.uniform1f(L('uMaskInvert'), p.maskInvert ? 1 : 0)
    const useOrig = p.maskOn && p.maskRaw && p.origCanvas
    gl.uniform1i(L('uMaskRaw'), useOrig ? 1 : 0)
    if (useOrig) {
      // Select unit 1 *before* uploading so origTex doesn't clobber uSrc (unit 0).
      gl.activeTexture(gl.TEXTURE1)
      this._uploadOrig(p.origCanvas)
      gl.uniform1i(L('uOrig'), 1)
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  // ── Shared post stack + present ─────────────────────────────────────────────
  // Re-run only the post stack on the last rendered base (cheap — no re-dither).
  // Used by the animation loop so glitch/grain can advance without reprocessing.
  repost(p) {
    if (!this._lastBase) return null
    return this._finish(this._lastBase.tex, this._lastBase.outW, this._lastBase.outH, p)
  }

  _finish(baseTex, outW, outH, p) {
    const gl = this.gl
    this._lastBase = { tex: baseTex, outW, outH }
    let finalTex = baseTex
    if (p.post) {
      const texel = [1 / outW, 1 / outH]
      const br = this._fbo('bright', outW, outH)
      this._drawTex(this.progs.bright, br, finalTex, outW, outH, pr2 => this._setUni(pr2, { uThreshold: p.glowThreshold }))
      let blurSrc = br.tex
      const bA = this._fbo('blurA', outW, outH), bB = this._fbo('blurB', outW, outH)
      for (let i = 0; i < 2; i++) {
        this._drawTex(this.progs.blur, bA, blurSrc, outW, outH, pr2 => this._setUni(pr2, { uDir: [1, 0], uTexel: texel.map(t => t * (1 + i)) }))
        this._drawTex(this.progs.blur, bB, bA.tex, outW, outH, pr2 => this._setUni(pr2, { uDir: [0, 1], uTexel: texel.map(t => t * (1 + i)) }))
        blurSrc = bB.tex
      }
      // Anamorphic streaks: repeatedly widen the bright pass horizontally only.
      let streakSrc = blurSrc
      if (p.streak > 0) {
        const sA = this._fbo('streakA', outW, outH), sB = this._fbo('streakB', outW, outH)
        let src = br.tex
        for (let i = 0; i < 4; i++) {
          const tgt = i % 2 === 0 ? sA : sB
          this._drawTex(this.progs.blur, tgt, src, outW, outH, pr2 => this._setUni(pr2, { uDir: [1, 0], uTexel: [texel[0] * (4 << i), 0] }))
          src = tgt.tex
        }
        streakSrc = src
      }
      const out = this._fbo('post', outW, outH)
      const pp = this.progs.post
      this._draw(pp, out, outW, outH)
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, finalTex); gl.uniform1i(gl.getUniformLocation(pp, 'uBase'), 0)
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blurSrc); gl.uniform1i(gl.getUniformLocation(pp, 'uGlow'), 1)
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, streakSrc); gl.uniform1i(gl.getUniformLocation(pp, 'uStreak'), 2)
      this._setUni(pp, {
        uGlowAmt: p.glow ? p.glowAmt : 0, uGlowTint: p.glowTint || [1, 1, 1],
        uChroma: p.chroma, uScan: p.scan, uScanCount: p.scanCount, uCurv: p.curve, uVig: p.vignette,
        uMask: p.mask || 0, uMaskAmt: p.maskAmt || 0, uMaskScale: p.maskScale || 1,
        uGlitch: p.glitch || 0, uGrain: p.grain || 0, uGrainSize: p.grainSize || 1.5,
        uTemp: p.temp || 0, uTint: p.tint || 0, uTime: p.time || 0,
        uWave: p.wave || 0, uWaveFreq: p.waveFreq || 10, uWaveAxis: p.waveAxis || 0,
        uStreakAmt: p.streak || 0, uVhs: p.vhs || 0,
        uEdge: p.edge || 0, uEdgeThresh: p.edgeThresh || 0.2, uEdgeColor: p.edgeColor || [0, 0, 0], uTexel: texel,
      })
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      finalTex = out.tex
    }
    if (outW !== this.canvas.width || outH !== this.canvas.height) { this.canvas.width = outW; this.canvas.height = outH }
    this._drawTex(this.progs.copy, null, finalTex, outW, outH)
    return finalTex
  }

  _readFbo(fbo, w, h) {
    const gl = this.gl
    const px = new Uint8Array(w * h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const out = document.createElement('canvas'); out.width = w; out.height = h
    const img = out.getContext('2d').createImageData(w, h)
    for (let y = 0; y < h; y++) { const src = (h - 1 - y) * w * 4, dst = y * w * 4; img.data.set(px.subarray(src, src + w * 4), dst) }
    out.getContext('2d').putImageData(img, 0, 0)
    return out
  }

  _drawTex(prog, target, tex, w, h, extra) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null)
    gl.viewport(0, 0, w, h)
    this._bindQuad(prog)
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0)
    if (extra) extra(prog)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  _setUni(prog, map) {
    const gl = this.gl
    for (const k in map) {
      const loc = gl.getUniformLocation(prog, k)
      if (loc == null) continue
      const v = map[k]
      if (Array.isArray(v)) { v.length === 2 ? gl.uniform2f(loc, v[0], v[1]) : gl.uniform3f(loc, v[0], v[1], v[2]) }
      else if (typeof v === 'number') {
        if (Number.isInteger(v) && (k === 'uAlgo' || k === 'uMode' || k === 'uPalN' || k === 'uShape')) gl.uniform1i(loc, v)
        else gl.uniform1f(loc, v)
      }
    }
  }

  // Read the current canvas back into a 2D canvas (for export / clipboard).
  readToCanvas() {
    const gl = this.gl, w = this.canvas.width, h = this.canvas.height
    const px = new Uint8Array(w * h * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px)
    const out = document.createElement('canvas'); out.width = w; out.height = h
    const ctx = out.getContext('2d')
    const img = ctx.createImageData(w, h)
    // readPixels is bottom-up → flip rows
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4, dst = y * w * 4
      img.data.set(px.subarray(src, src + w * 4), dst)
    }
    ctx.putImageData(img, 0, 0)
    return out
  }
}

// Map an algorithm id to the shader's uAlgo kind.
export function algoKind(id) {
  if (id === 'threshold') return 0
  if (id === 'random') return 2
  if (id === 'ign') return 3
  if (isMatrixOrdered(id)) return 1
  return 0
}

export { hexToRgb }
