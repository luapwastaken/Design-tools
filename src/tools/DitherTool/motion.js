// ── Motion: LFO modulation for seamless dither loops ──────────────────────────
//
// Modulators (LFOs) animate any registered numeric setting around its current
// value. Loop phase t runs 0→1 over the loop length and every wave completes an
// integer number of cycles per loop, so any export of exactly one loop is
// seamless by construction — including the "noise" wave, which is built from
// integer-frequency harmonics, and "spin", which wraps cyclic parameters
// through their full period.

// Animatable parameters. min/max mirror the panel slider ranges; cyclic marks
// parameters where the range is a full period (wrapping is invisible), which
// unlocks the Spin wave. Size-changing settings (resolution, DPI) are excluded
// on purpose — they'd resize the output canvas mid-loop.
export const MOTION_PARAMS = [
  // colour
  { key: 'hue', label: 'Hue', min: -180, max: 180, group: 'Colour', cyclic: true },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, group: 'Colour' },
  { key: 'brightness', label: 'Brightness', min: -100, max: 100, group: 'Colour' },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100, group: 'Colour' },
  // tone / source
  { key: 'blur', label: 'Blur', min: 0, max: 8, group: 'Source' },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 1, group: 'Source' },
  { key: 'levelsGamma', label: 'Gamma', min: 0.2, max: 3, group: 'Source' },
  // dither
  { key: 'spread', label: 'Dither spread', min: 0, max: 1, group: 'Dither' },
  { key: 'strength', label: 'Diffusion strength', min: 0, max: 1, group: 'Dither' },
  { key: 'jitter', label: 'Screen jitter', min: 0, max: 1, group: 'Dither' },
  // halftone
  { key: 'htAngle', label: 'Screen angle (mono)', min: 0, max: 90, group: 'Halftone', cyclic: true },
  { key: 'htGamma', label: 'Tone gamma', min: 0.3, max: 2.5, group: 'Halftone' },
  { key: 'htDotSize', label: 'Dot size', min: 0.3, max: 1.3, group: 'Halftone' },
  { key: 'htDotGain', label: 'Dot gain', min: 0, max: 1, group: 'Halftone' },
  { key: 'htReg', label: 'Misregistration', min: 0, max: 1, group: 'Halftone' },
  { key: 'htFreqVary', label: 'Frequency vary', min: 0, max: 1, group: 'Halftone' },
  { key: 'htPaperGrain', label: 'Paper grain', min: 0, max: 1, group: 'Halftone' },
  // mask
  { key: 'maskLo', label: 'Mask low edge', min: 0, max: 1, group: 'Mask' },
  { key: 'maskHi', label: 'Mask high edge', min: 0, max: 1, group: 'Mask' },
  { key: 'maskFeather', label: 'Mask feather', min: 0, max: 0.5, group: 'Mask' },
  // post fx (need Post + the matching effect enabled)
  { key: 'glowAmt', label: 'Glow intensity', min: 0, max: 2, group: 'Post FX' },
  { key: 'glowThreshold', label: 'Glow threshold', min: 0, max: 1, group: 'Post FX' },
  { key: 'chromaAmt', label: 'Chromatic aberration', min: 0, max: 4, group: 'Post FX' },
  { key: 'scan', label: 'Scanlines', min: 0, max: 1, group: 'Post FX' },
  { key: 'curve', label: 'CRT curve', min: 0, max: 1, group: 'Post FX' },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, group: 'Post FX' },
  { key: 'glitchAmt', label: 'Glitch', min: 0, max: 1, group: 'Post FX' },
  { key: 'grainAmt', label: 'Grain', min: 0, max: 1, group: 'Post FX' },
  { key: 'streakAmt', label: 'Streaks', min: 0, max: 2, group: 'Post FX' },
  { key: 'vhsAmt', label: 'VHS', min: 0, max: 1, group: 'Post FX' },
  { key: 'waveAmt', label: 'Wave amount', min: 0, max: 1, group: 'Post FX' },
  { key: 'waveFreq', label: 'Wave frequency', min: 1, max: 40, group: 'Post FX' },
  { key: 'edgeAmt', label: 'Ink outline', min: 0, max: 1, group: 'Post FX' },
  { key: 'temp', label: 'Temperature', min: -100, max: 100, group: 'Post FX' },
  { key: 'tint', label: 'Tint', min: -100, max: 100, group: 'Post FX' },
]

export const PARAM_BY_KEY = Object.fromEntries(MOTION_PARAMS.map(p => [p.key, p]))

export const WAVES = [
  ['sine', 'Sine'], ['tri', 'Triangle'], ['square', 'Square'],
  ['saw', 'Saw'], ['noise', 'Noise'], ['spin', 'Spin'],
]

export function mkLfo(param = 'hue') {
  return {
    id: Math.random().toString(36).slice(2, 9),
    on: true, param, wave: 'sine',
    cycles: 1,            // integer cycles per loop — keeps the loop seamless
    depth: 40,            // % of the parameter's range, peak-to-centre
    phase: 0,             // degrees
    seed: (Math.random() * 0xffffff) | 0,
  }
}

const frac = x => x - Math.floor(x)

// Periodic pseudo-noise: three seeded integer-frequency harmonics. Smooth,
// random-feeling, and exactly periodic over the loop.
function noiseWave(u, seed) {
  let v = 0
  for (let k = 0; k < 3; k++) {
    const fr = 1 + ((seed >> (k * 5)) & 7) % 5
    const ph = ((seed >> (k * 5 + 3)) & 255) / 255
    v += Math.sin(2 * Math.PI * (u * fr + ph)) / (k + 1)
  }
  return v / 1.84
}

// Wave sample in -1..1 (spin returns the raw 0..1 ramp, handled by computeMods).
export function lfoValue(lfo, t) {
  const u = frac(t * Math.max(1, Math.round(lfo.cycles)) + (lfo.phase || 0) / 360)
  switch (lfo.wave) {
    case 'tri': return 1 - 4 * Math.abs(u - 0.5)
    case 'square': return u < 0.5 ? 1 : -1
    case 'saw': return 2 * u - 1
    case 'noise': return noiseWave(u, lfo.seed || 0x9e3779)
    case 'spin': return u
    default: return Math.sin(2 * Math.PI * u)
  }
}

// All active modulations at loop phase t (0..1), as { key: value } overrides on
// top of the base settings. Multiple LFOs on the same key stack.
export function computeMods(lfos, t, base) {
  const out = {}
  for (const lfo of lfos) {
    if (!lfo.on) continue
    const def = PARAM_BY_KEY[lfo.param]
    if (!def) continue
    const range = def.max - def.min
    const baseV = out[lfo.param] ?? (typeof base[lfo.param] === 'number' ? base[lfo.param] : def.min)
    let v
    if (lfo.wave === 'spin') {
      // sweep the full period and wrap — only offered for cyclic params
      v = def.min + frac((baseV - def.min) / range + lfoValue(lfo, t)) * range
    } else {
      v = baseV + lfoValue(lfo, t) * (lfo.depth / 100) * range / 2
      v = Math.min(def.max, Math.max(def.min, v))
    }
    out[lfo.param] = v
  }
  return out
}
