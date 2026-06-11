// ── Built-in Post-FX presets ──────────────────────────────────────────────────
//
// Each preset is a named effect stack. Layers are built with L(type, overrides):
// every param starts at the effect's schema default, then the overrides below
// change only what makes the look. Stack order matters — earlier layers are
// applied first, so base grades sit at the top and finishing passes (vignette,
// grain, scanlines) at the bottom.

import { EFFECTS } from './effects.js'

function L(type, params = {}, opts = {}) {
  const e = EFFECTS[type]
  const full = {}
  for (const p of e.params || []) full[p.key] = p.default
  return { type, enabled: true, opacity: opts.opacity ?? 1, blend: opts.blend ?? 0, params: { ...full, ...params } }
}

const RAW = [
  // ─────────────────────────── CINEMATIC ───────────────────────────
  { name: 'Teal & Orange', group: 'Cinematic', stack: [
    L('splittone', { uShad: '#10384a', uHigh: '#f2a45a', uShadAmt: 0.5, uHighAmt: 0.45 }),
    L('brightcontrast', { uContrast: 0.12 }),
    L('vignette', { uAmt: 0.35, uSize: 0.85, uSoft: 0.5 }),
  ] },
  { name: 'Blockbuster', group: 'Cinematic', stack: [
    L('filmstock', { uStock: 0, uHalation: 0.4, uGrain: 0.1, uMix: 0.7 }),
    L('splittone', { uShad: '#123a48', uHigh: '#e8995a', uShadAmt: 0.35, uHighAmt: 0.35 }),
    L('bloom', { uIntensity: 0.35, uThresh: 0.72 }),
    L('vignette', { uAmt: 0.35 }),
  ] },
  { name: 'Bleach Bypass', group: 'Cinematic', stack: [
    L('saturation', { uSat: -0.55 }),
    L('brightcontrast', { uContrast: 0.4, uExposure: 0.1 }),
    L('grain', { uAmt: 0.12 }),
  ] },
  { name: 'Moody Blue', group: 'Cinematic', stack: [
    L('splittone', { uShad: '#16314f', uHigh: '#8fb6d6', uShadAmt: 0.6, uHighAmt: 0.3 }),
    L('brightcontrast', { uContrast: 0.1, uBright: -0.04 }),
    L('bloom', { uIntensity: 0.4, uThresh: 0.7, uRadius: 10 }),
    L('vignette', { uAmt: 0.4 }),
  ] },
  { name: 'Golden Hour', group: 'Cinematic', stack: [
    L('saturation', { uWarmth: 0.5, uVib: 0.2 }),
    L('tone', { uGain: 1.1, uLift: 0.03 }),
    L('lightleak', { uColor: '#ffae57', uAngle: 30, uAmt: 0.5, uPos: 0.78 }),
    L('bloom', { uIntensity: 0.5, uTint: '#ffd9a0' }),
  ] },
  { name: 'Film Noir', group: 'Cinematic', stack: [
    L('filmstock', { uStock: 3, uContrast: 0.25, uGrain: 0.35 }),
    L('vignette', { uAmt: 0.55, uSize: 0.8 }),
  ] },
  { name: 'Faded Memory', group: 'Cinematic', stack: [
    L('tone', { uLift: 0.08, uGain: 0.92, uGam: 1.05 }),
    L('saturation', { uSat: -0.25, uWarmth: 0.2 }),
    L('grain', { uAmt: 0.12 }),
    L('vignette', { uAmt: 0.25 }),
  ] },

  // ─────────────────────────── RETRO & ANALOG ───────────────────────────
  { name: 'VHS Rewind', group: 'Retro & Analog', stack: [
    L('vhs', { uAmt: 0.6, uBleed: 0.6, uSnow: 0.4, uScan: 0.3 }),
    L('chromatic', { uAmt: 0.008 }),
    L('scanlines', { uAmt: 0.25, uCount: 360, uMask: 0.2 }),
  ] },
  { name: 'CRT Monitor', group: 'Retro & Analog', stack: [
    L('scanlines', { uAmt: 0.45, uCount: 500, uMask: 0.4, uCurve: 0.3 }),
    L('bloom', { uIntensity: 0.5, uThresh: 0.55 }),
    L('chromatic', { uAmt: 0.004 }),
  ] },
  { name: '80s Synthwave', group: 'Retro & Analog', stack: [
    L('gradientmap', { uLo: '#1a0a3a', uMid: '#d6249f', uHi: '#26d0ce', uMix: 0.85 }),
    L('bloom', { uIntensity: 0.8, uTint: '#ff5ed2' }),
    L('scanlines', { uAmt: 0.15, uCount: 300 }),
  ] },
  { name: 'Super 8', group: 'Retro & Analog', stack: [
    L('filmstock', { uStock: 0, uGrain: 0.3, uHalation: 0.35 }),
    L('analog', { uWeave: 0.5, uFlicker: 0.35, uScratch: 0.25, uDust: 0.3, uBurn: 0.4 }),
    L('lightleak', { uColor: '#ff7a3d', uAmt: 0.4, uPos: 0.85 }),
  ] },
  { name: 'Old Projector', group: 'Retro & Analog', stack: [
    L('filmstock', { uStock: 3, uGrain: 0.3, uContrast: 0.15 }),
    L('analog', { uWeave: 0.6, uFlicker: 0.5, uScratch: 0.4, uDust: 0.4, uBurn: 0.5, uJump: 0.2 }),
    L('vignette', { uAmt: 0.5 }),
  ] },
  { name: 'Damaged Tape', group: 'Retro & Analog', stack: [
    L('vhs', { uAmt: 0.8, uBleed: 0.7, uSnow: 0.6 }),
    L('glitch', { uAmt: 0.5, uShift: 0.012 }),
    L('analog', { uScratch: 0.4, uDust: 0.4 }),
  ] },
  { name: 'Cross Processed', group: 'Retro & Analog', stack: [
    L('filmstock', { uStock: 5, uContrast: 0.1, uGrain: 0.2 }),
    L('vignette', { uAmt: 0.35 }),
  ] },
  { name: 'Glitch Art', group: 'Retro & Analog', stack: [
    L('glitch', { uAmt: 0.6, uBlocks: 60, uShift: 0.014, uVert: 0.3 }),
    L('chromatic', { uAmt: 0.012 }),
    L('noise', { uAmt: 0.15, uColor: 1 }),
  ] },

  // ─────────────────────────── STYLIZED ───────────────────────────
  { name: 'Comic Ink', group: 'Stylized', stack: [
    L('posterize', { uLevels: 6 }),
    L('saturation', { uSat: 0.3 }),
    L('edge', { uAmt: 1, uThresh: 0.12, uColor: '#101010', uBg: 1 }),
  ] },
  { name: 'Risograph', group: 'Stylized', stack: [
    L('duotone', { uDark: '#15235f', uLight: '#ff4f6e', uContrast: 0.2 }),
    L('grain', { uAmt: 0.15 }),
  ] },
  { name: 'Posterized Pop', group: 'Stylized', stack: [
    L('posterize', { uLevels: 5, uGamma: 1.1 }),
    L('saturation', { uSat: 0.5, uVib: 0.3 }),
    L('edge', { uAmt: 0.5, uThresh: 0.2, uBg: 1 }),
  ] },
  { name: 'Duotone Pop', group: 'Stylized', stack: [
    L('duotone', { uDark: '#0b1a4a', uMid: '#7a2f8f', uLight: '#16e0d8', uTri: 1, uContrast: 0.15 }),
  ] },
  { name: 'Dreamy Haze', group: 'Stylized', stack: [
    L('bloom', { uIntensity: 1, uThresh: 0.5, uRadius: 16, uSat: 1.2 }),
    L('brightcontrast', { uContrast: -0.08, uBright: 0.04 }),
    L('saturation', { uWarmth: 0.15 }),
  ] },
  { name: 'Thermal Vision', group: 'Stylized', stack: [
    L('gradientmap', { uLo: '#000428', uMid: '#ff3d00', uHi: '#fff275', uMidPos: 0.55, uContrast: 0.2 }),
    L('posterize', { uLevels: 10 }),
  ] },
  { name: 'Infrared', group: 'Stylized', stack: [
    L('hue', { uHue: 120, uSatMul: 0.3 }),
    L('saturation', { uVib: 0.4 }),
  ] },
  { name: 'Pencil Sketch', group: 'Stylized', stack: [
    L('saturation', { uSat: -1 }),
    L('edge', { uAmt: 1, uThresh: 0.08, uThick: 1, uColor: '#222222', uBgColor: '#ffffff', uBg: 0 }),
  ] },
  { name: 'Blueprint', group: 'Stylized', stack: [
    L('edge', { uAmt: 1, uThresh: 0.1, uColor: '#cfe0ff', uBgColor: '#0d2a6b', uBg: 0 }),
  ] },
  { name: 'Vaporwave', group: 'Stylized', stack: [
    L('gradientmap', { uLo: '#2b0a3d', uMid: '#ff6ad5', uHi: '#8ce6ff', uMix: 0.8 }),
    L('chromatic', { uAmt: 0.006 }),
    L('scanlines', { uAmt: 0.2, uCount: 280 }),
    L('glitch', { uAmt: 0.2 }),
  ] },

  // ─────────────────────────── LENS & FX ───────────────────────────
  { name: 'Lomo', group: 'Lens & FX', stack: [
    L('saturation', { uSat: 0.4, uVib: 0.3 }),
    L('brightcontrast', { uContrast: 0.15 }),
    L('chromatic', { uAmt: 0.004 }),
    L('vignette', { uAmt: 0.7, uSize: 0.75, uSoft: 0.4 }),
  ] },
  { name: 'Sun Flare', group: 'Lens & FX', stack: [
    L('godrays', { uAmt: 0.8, uThresh: 0.65, uCx: 0.5, uCy: 0.3 }),
    L('bloom', { uIntensity: 0.6 }),
    L('lightleak', { uColor: '#ffd089', uAmt: 0.4 }),
  ] },
  { name: 'Fish Eye', group: 'Lens & FX', stack: [
    L('distortion', { uAmt: 0.45, uZoom: 1.05 }),
    L('vignette', { uAmt: 0.4 }),
  ] },
  { name: 'Kaleidoscope', group: 'Lens & FX', stack: [
    L('kaleidoscope', { uSeg: 6, uMirror: 1 }),
    L('bloom', { uIntensity: 0.5 }),
    L('hue', { uSatMul: 0.3 }),
  ] },
  { name: 'Underwater', group: 'Lens & FX', stack: [
    L('wave', { uMode: 1, uAmp: 0.015, uFreq: 14, uSpeed: 1 }),
    L('saturation', { uWarmth: -0.4, uSat: 0.1 }),
    L('lightleak', { uType: 1, uColor: '#2aa7c8', uAmt: 0.3, uCx: 0.5, uCy: 0.2 }),
    L('bloom', { uIntensity: 0.4 }),
  ] },
  { name: 'Psychedelic', group: 'Lens & FX', stack: [
    L('kaleidoscope', { uSeg: 8, uMirror: 1, uZoom: 1.2 }),
    L('hue', { uHue: 60, uSatMul: 0.5 }),
    L('wave', { uMode: 0, uAmp: 0.02, uFreq: 10, uAxis: 2, uSpeed: 1.5 }),
  ] },
]

export const BUILTIN_FX_PRESETS = RAW.map((p, i) => ({ id: `builtin-${i}`, ...p }))
