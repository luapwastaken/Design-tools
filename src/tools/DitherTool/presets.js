// ── Built-in presets ────────────────────────────────────────────────────────────
// Each preset is a named look: a bundle of settings plus an optional inline
// palette (saved into the library on first apply). Presets start from NEUTRAL so
// switching between them never leaves a stray toggle from the previous look.
//
// `group` buckets presets in the picker dropdown (mirrors the algorithm picker).
//
// Halftone presets drive the modern screen controls:
//   halftone   — master toggle
//   inkMode    — 'mono' | 'cmyk' | 'palette'
//   htAlgo     — dot shape: circle square diamond triangle hexagon star cross
//                ellipse ring line stochastic
//   htDpi      — dots across the long edge (lower = coarser / chunkier)
//   htGamma    — tone curve for dot growth (lower = darker mids)
//   htDotSize  — dot size multiplier (1.0 → solid at full tone)
//   htAngle    — screen angle (mono)
// For mono the darkest palette colour is the ink and `paperColor` is the paper.
// For palette mode every palette colour is its own ink and `paperColor` is paper.
// For cmyk the inks are fixed process colours on `paperColor`.

const NEUTRAL = {
  // dither
  algorithm: 'floyd-steinberg', mode: 'mono', levels: 4, spread: 1, strength: 1, serpentine: true,
  // adjustments
  invert: false, brightness: 0, contrast: 0, hue: 0, saturation: 0,
  blur: 0, sharpen: 0, denoise: 0, resolution: 320,
  sizeMode: 'detail', pixelSize: 4, gradMap: false, gradStops: null, jitter: 0, phaseAnim: false,
  maskOn: false, maskMode: 'luma', maskRaw: false, maskLo: 0, maskHi: 1, maskFeather: 0.1, maskInvert: false,
  levelsLow: 0, levelsHigh: 1, levelsGamma: 1, posterize: 0,
  // output cells
  edgeShape: 'square', gapColor: '#000000', resample: 'nearest',
  // halftone
  halftone: false, inkMode: 'mono', cell: 6, htDpi: 120, htAlgo: 'circle',
  htGamma: 1, htDotSize: 1, htAngle: 45, htShape: 'round', htScale: 4, dpi: 150, lpi: 30,
  htReg: 0, htDotGain: 0, htPaperGrain: 0, htFreqVary: 0,
  paperColor: '#ffffff', paperTransparent: false, inkCtl: {},
  paletteId: 'bw',
  // post fx
  post: false, glow: true, glowAmt: 0.8, glowThreshold: 0.6, glowTint: '#ffffff',
  crt: false, scan: 0.4, scanCount: 240, curve: 0, vignette: 0.3, crtMask: 'none', crtMaskAmt: 0.5,
  chroma: false, chromaAmt: 1,
  glitch: false, glitchAmt: 0.4, grain: false, grainAmt: 0.3, grainSize: 1.5,
  grade: false, temp: 0, tint: 0,
  streak: false, streakAmt: 0.8, edge: false, edgeAmt: 0.8, edgeThresh: 0.2, edgeColor: '#000000',
  wave: false, waveAmt: 0.3, waveFreq: 10, waveAxis: 'h', vhs: false, vhsAmt: 0.5,
  animate: false, animSpeed: 1,
}

const mk = (over) => ({ ...NEUTRAL, ...over })

export const BUILTIN_PRESETS = [
  // ── Basic ───────────────────────────────────────────────────────────────────
  {
    id: 'p-classic-1bit', name: 'Classic 1-bit', group: 'Basic',
    settings: mk({ algorithm: 'floyd-steinberg', mode: 'mono', contrast: 8 }),
  },
  {
    id: 'p-atkinson', name: 'Atkinson (Mac)', group: 'Basic',
    settings: mk({ algorithm: 'atkinson', mode: 'mono', contrast: 6, brightness: 4 }),
  },
  {
    id: 'p-bayer', name: 'Ordered Bayer', group: 'Basic',
    settings: mk({ algorithm: 'bayer-8', mode: 'mono', spread: 1, contrast: 6 }),
  },
  {
    id: 'p-bluenoise', name: 'Blue Noise', group: 'Basic',
    settings: mk({ algorithm: 'bluenoise-64', mode: 'mono', contrast: 4 }),
  },
  {
    id: 'p-threshold', name: 'Hard Threshold', group: 'Basic',
    settings: mk({ algorithm: 'threshold', mode: 'mono', contrast: 30 }),
  },
  {
    id: 'p-jarvis', name: 'Jarvis Soft', group: 'Basic',
    settings: mk({ algorithm: 'jarvis', mode: 'mono', contrast: 2, blur: 0.4 }),
  },
  {
    id: 'p-gray4', name: 'Grayscale Tones', group: 'Basic',
    settings: mk({ algorithm: 'floyd-steinberg', mode: 'tonal', levels: 4, contrast: 6 }),
  },
  {
    id: 'p-duotone-bw', name: 'Crisp Duotone', group: 'Basic',
    palette: ['#14110a', '#f5f1e3'],
    settings: mk({ algorithm: 'sierra', mode: 'mono', contrast: 12 }),
  },

  // ── Halftone ─────────────────────────────────────────────────────────────────
  {
    id: 'p-newsprint', name: 'Vintage Newsprint', group: 'Halftone',
    palette: ['#1a140d', '#efe6d2'],
    settings: mk({ halftone: true, inkMode: 'mono', htAlgo: 'circle', htDpi: 90, htGamma: 0.85, htDotSize: 1.02, htAngle: 45, resolution: 480, contrast: 16, paperColor: '#efe6d2' }),
  },
  {
    id: 'p-manga', name: 'Comic / Manga', group: 'Halftone',
    palette: ['#0d0d0d', '#ffffff'],
    settings: mk({ halftone: true, inkMode: 'mono', htAlgo: 'circle', htDpi: 135, htGamma: 1.1, htDotSize: 1, htAngle: 45, resolution: 560, contrast: 30, paperColor: '#ffffff' }),
  },
  {
    id: 'p-stipple', name: 'Fine Stipple', group: 'Halftone',
    palette: ['#141414', '#ffffff'],
    settings: mk({ halftone: true, inkMode: 'mono', htAlgo: 'circle', htDpi: 200, htGamma: 1.3, htDotSize: 0.9, htAngle: 45, resolution: 640, contrast: 8, paperColor: '#ffffff' }),
  },
  {
    id: 'p-engrave', name: 'Engraved Lines', group: 'Halftone',
    palette: ['#0a0a0a', '#f4f1e8'],
    settings: mk({ halftone: true, inkMode: 'mono', htAlgo: 'line', htDpi: 120, htGamma: 0.95, htDotSize: 1, htAngle: 45, resolution: 560, contrast: 22, paperColor: '#f4f1e8' }),
  },
  {
    id: 'p-crosshatch', name: 'Crosshatch Etch', group: 'Halftone',
    palette: ['#0a0a0a', '#f2ead8'],
    settings: mk({ halftone: true, inkMode: 'mono', htAlgo: 'cross', htDpi: 110, htGamma: 0.9, htDotSize: 1.05, htAngle: 45, resolution: 560, contrast: 26, paperColor: '#f2ead8' }),
  },
  {
    id: 'p-square-screen', name: 'Square Screen', group: 'Halftone',
    palette: ['#101010', '#ffffff'],
    settings: mk({ halftone: true, inkMode: 'mono', htAlgo: 'square', htDpi: 80, htGamma: 1, htDotSize: 1, htAngle: 0, resolution: 480, contrast: 14 }),
  },
  {
    id: 'p-diamond-screen', name: 'Diamond Screen', group: 'Halftone',
    palette: ['#101010', '#ffffff'],
    settings: mk({ halftone: true, inkMode: 'mono', htAlgo: 'diamond', htDpi: 95, htGamma: 1, htDotSize: 1, htAngle: 45, resolution: 520, contrast: 14 }),
  },
  {
    id: 'p-hex-screen', name: 'Hex Mosaic', group: 'Halftone',
    palette: ['#11131a', '#eef1f7'],
    settings: mk({ halftone: true, inkMode: 'mono', htAlgo: 'hexagon', htDpi: 70, htGamma: 1, htDotSize: 1.05, htAngle: 0, resolution: 460, contrast: 10 }),
  },
  {
    id: 'p-stochastic', name: 'Stochastic FM', group: 'Halftone',
    palette: ['#121212', '#ffffff'],
    settings: mk({ halftone: true, inkMode: 'mono', htAlgo: 'stochastic', htDpi: 150, htGamma: 1, htDotSize: 1, resolution: 600, contrast: 6 }),
  },
  {
    id: 'p-starscreen', name: 'Star Screen', group: 'Halftone',
    palette: ['#0c0c0c', '#fff7ea'],
    settings: mk({ halftone: true, inkMode: 'mono', htAlgo: 'star', htDpi: 65, htGamma: 0.95, htDotSize: 1.1, resolution: 460, contrast: 18, paperColor: '#fff7ea' }),
  },

  // ── Print & Riso ──────────────────────────────────────────────────────────────
  {
    id: 'p-cmyk', name: 'CMYK Process', group: 'Print & Riso',
    settings: mk({ halftone: true, inkMode: 'cmyk', htAlgo: 'circle', htDpi: 120, htGamma: 1, htDotSize: 1, resolution: 600, contrast: 8, saturation: 10, paperColor: '#ffffff' }),
  },
  {
    id: 'p-popart', name: 'Pop Art', group: 'Print & Riso',
    settings: mk({ halftone: true, inkMode: 'cmyk', htAlgo: 'circle', htDpi: 55, htGamma: 0.95, htDotSize: 1.05, resolution: 460, contrast: 16, saturation: 28, paperColor: '#fffdf5' }),
  },
  {
    id: 'p-riso-duo', name: 'Risograph Duo', group: 'Print & Riso',
    palette: ['#0078bf', '#ff48b0'],
    settings: mk({ halftone: true, inkMode: 'palette', htAlgo: 'circle', htDpi: 95, htGamma: 0.9, htDotSize: 1.04, resolution: 520, contrast: 10, paperColor: '#f4f0d8' }),
  },
  {
    id: 'p-riso-trio', name: 'Risograph Trio', group: 'Print & Riso',
    palette: ['#0c4da2', '#f15060', '#ffe800'],
    settings: mk({ halftone: true, inkMode: 'palette', htAlgo: 'circle', htDpi: 90, htGamma: 0.9, htDotSize: 1.04, resolution: 520, contrast: 8, paperColor: '#f6f2e0' }),
  },
  {
    id: 'p-riso-fluoro', name: 'Riso Fluoro', group: 'Print & Riso',
    palette: ['#ff48b0', '#ffae00'],
    settings: mk({ halftone: true, inkMode: 'palette', htAlgo: 'circle', htDpi: 80, htGamma: 0.85, htDotSize: 1.06, resolution: 500, saturation: 12, paperColor: '#1a1a1a' }),
  },
  {
    id: 'p-silkscreen', name: 'Silkscreen Poster', group: 'Print & Riso',
    palette: ['#e63946', '#1d3557', '#f1faee'],
    settings: mk({ halftone: true, inkMode: 'palette', htAlgo: 'square', htDpi: 55, htGamma: 0.9, htDotSize: 1.08, resolution: 440, contrast: 14, paperColor: '#f7f3e8' }),
  },
  {
    id: 'p-blueprint', name: 'Blueprint', group: 'Print & Riso',
    palette: ['#0b3d91', '#dce6ff'],
    settings: mk({ algorithm: 'floyd-steinberg', mode: 'mono', invert: true, contrast: 22, paperColor: '#0b3d91' }),
  },
  {
    id: 'p-letterpress', name: 'Letterpress', group: 'Print & Riso',
    palette: ['#1c1208', '#e9dcc3'],
    settings: mk({ halftone: true, inkMode: 'mono', htAlgo: 'circle', htDpi: 60, htGamma: 0.8, htDotSize: 1.1, htAngle: 30, resolution: 440, contrast: 20, paperColor: '#e9dcc3' }),
  },

  // ── Retro hardware ─────────────────────────────────────────────────────────────
  {
    id: 'p-gameboy', name: 'Game Boy', group: 'Retro Hardware',
    settings: mk({ algorithm: 'floyd-steinberg', mode: 'indexed', paletteId: 'gameboy', resolution: 240, contrast: 8 }),
  },
  {
    id: 'p-gbpocket', name: 'Game Boy Pocket', group: 'Retro Hardware',
    settings: mk({ algorithm: 'bayer-4', mode: 'indexed', paletteId: 'grayscale4', resolution: 240, contrast: 6 }),
  },
  {
    id: 'p-c64', name: 'Commodore 64', group: 'Retro Hardware',
    settings: mk({ algorithm: 'floyd-steinberg', mode: 'indexed', paletteId: 'c64', resolution: 280 }),
  },
  {
    id: 'p-cga', name: 'CGA', group: 'Retro Hardware',
    settings: mk({ algorithm: 'bayer-4', mode: 'indexed', paletteId: 'cga0', resolution: 240, contrast: 10, saturation: 10 }),
  },
  {
    id: 'p-pico8', name: 'PICO-8', group: 'Retro Hardware',
    settings: mk({ algorithm: 'bayer-8', mode: 'indexed', paletteId: 'pico8', resolution: 256, contrast: 6, saturation: 12 }),
  },
  {
    id: 'p-mac1bit', name: 'Macintosh 1-bit', group: 'Retro Hardware',
    settings: mk({ algorithm: 'atkinson', mode: 'mono', resolution: 360, contrast: 10 }),
  },
  {
    id: 'p-teletext', name: 'Teletext', group: 'Retro Hardware',
    palette: ['#000000', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'],
    settings: mk({ algorithm: 'bayer-2', mode: 'indexed', resolution: 180, contrast: 18, saturation: 30 }),
  },
  {
    id: 'p-handheld', name: 'LCD Handheld', group: 'Retro Hardware',
    settings: mk({ algorithm: 'bayer-4', mode: 'indexed', paletteId: 'handheld', resolution: 240, contrast: 8 }),
  },

  // ── Aesthetic ────────────────────────────────────────────────────────────────
  {
    id: 'p-cyberpunk', name: 'Cyberpunk Neon', group: 'Aesthetic',
    palette: ['#0d0221', '#ff2a6d', '#05d9e8', '#d300c5', '#fdfdfd'],
    settings: mk({ algorithm: 'bayer-8', mode: 'indexed', contrast: 12, saturation: 35, post: true, glow: true, glowAmt: 1, glowThreshold: 0.5, chroma: true, chromaAmt: 1.4 }),
  },
  {
    id: 'p-vapor', name: 'Vaporwave', group: 'Aesthetic',
    palette: ['#1a0033', '#ff71ce', '#01cdfe', '#05ffa1', '#b967ff', '#fffb96'],
    settings: mk({ algorithm: 'bayer-8', mode: 'indexed', post: true, glow: true, glowAmt: 0.9, chroma: true, chromaAmt: 1, saturation: 25 }),
  },
  {
    id: 'p-synthwave', name: 'Synthwave Sunset', group: 'Aesthetic',
    palette: ['#1b1033', '#5f0f40', '#9a031e', '#fb8b24', '#ffd23f', '#fff4e0'],
    settings: mk({ algorithm: 'bayer-8', mode: 'indexed', contrast: 10, saturation: 22, post: true, glow: true, glowAmt: 0.8, glowThreshold: 0.55 }),
  },
  {
    id: 'p-y2k', name: 'Y2K Chrome', group: 'Aesthetic',
    palette: ['#0a0a23', '#3a4cc0', '#4cc9f0', '#b5179e', '#f1f1f1'],
    settings: mk({ algorithm: 'bluenoise-32', mode: 'indexed', post: true, glow: true, glowAmt: 0.9, glowThreshold: 0.55, saturation: 15 }),
  },
  {
    id: 'p-bubblegum', name: 'Bubblegum', group: 'Aesthetic',
    palette: ['#2d132c', '#801336', '#ee4540', '#ffb5a7', '#fcd5ce', '#fff0f3'],
    settings: mk({ algorithm: 'bayer-8', mode: 'indexed', contrast: 6, saturation: 24, brightness: 6 }),
  },
  {
    id: 'p-sepia', name: 'Sepia Dream', group: 'Aesthetic',
    settings: mk({ algorithm: 'floyd-steinberg', mode: 'indexed', paletteId: 'sepia', contrast: 8, blur: 0.4 }),
  },
  {
    id: 'p-thermal', name: 'Thermal Cam', group: 'Aesthetic',
    palette: ['#000004', '#3b0f70', '#8c2981', '#de4968', '#fe9f6d', '#fcfdbf'],
    settings: mk({ algorithm: 'bluenoise-32', mode: 'indexed', saturation: 10, contrast: 12 }),
  },
  {
    id: 'p-nightvision', name: 'Night Vision', group: 'Aesthetic',
    palette: ['#001a00', '#0a5c0a', '#33cc33', '#b6ffb6'],
    settings: mk({ algorithm: 'bluenoise-32', mode: 'indexed', contrast: 16, brightness: 8, post: true, glow: true, glowAmt: 0.7, glowThreshold: 0.4, vignette: 0.5 }),
  },
  {
    id: 'p-goldfoil', name: 'Gold Foil', group: 'Aesthetic',
    palette: ['#1a1206', '#5c4316', '#b8860b', '#ffd700', '#fff3b0'],
    settings: mk({ algorithm: 'bayer-8', mode: 'indexed', contrast: 14, saturation: 18, post: true, glow: true, glowAmt: 0.6, glowThreshold: 0.6 }),
  },

  // ── Experimental ───────────────────────────────────────────────────────────────
  {
    id: 'p-crt', name: 'CRT Terminal', group: 'Experimental',
    palette: ['#001100', '#33ff66'],
    settings: mk({ algorithm: 'bayer-4', mode: 'mono', post: true, crt: true, scan: 0.55, scanCount: 240, curve: 0.4, vignette: 0.4, glow: true, glowAmt: 0.7, glowThreshold: 0.3 }),
  },
  {
    id: 'p-amber-crt', name: 'Amber CRT', group: 'Experimental',
    palette: ['#1a0d00', '#ffb000'],
    settings: mk({ algorithm: 'bayer-4', mode: 'mono', post: true, crt: true, scan: 0.5, scanCount: 200, curve: 0.5, vignette: 0.45, glow: true, glowAmt: 0.8, glowThreshold: 0.3 }),
  },
  {
    id: 'p-glitch', name: 'Chroma Glitch', group: 'Experimental',
    palette: ['#000000', '#ff0040', '#00ffff', '#ffffff'],
    settings: mk({ algorithm: 'random', mode: 'indexed', post: true, chroma: true, chromaAmt: 2.2, glow: true, glowAmt: 0.6, contrast: 14, saturation: 20 }),
  },
  {
    id: 'p-oilslick', name: 'Oil Slick', group: 'Experimental',
    settings: mk({ algorithm: 'bayer-16', mode: 'rgb', levels: 3, saturation: 30, contrast: 8, post: true, chroma: true, chromaAmt: 0.8 }),
  },
  {
    id: 'p-xray', name: 'X-Ray', group: 'Experimental',
    palette: ['#0a0f1a', '#1b3a5b', '#5b86b0', '#cfe3f7'],
    settings: mk({ algorithm: 'jarvis', mode: 'indexed', invert: true, contrast: 20, levelsGamma: 1.4 }),
  },
  {
    id: 'p-solarize', name: 'Solarized', group: 'Experimental',
    palette: ['#002b36', '#268bd2', '#2aa198', '#b58900', '#cb4b16', '#fdf6e3'],
    settings: mk({ algorithm: 'bayer-8', mode: 'indexed', posterize: 5, contrast: 10, saturation: 16 }),
  },
  {
    id: 'p-acid', name: 'Acid Wash', group: 'Experimental',
    palette: ['#03071e', '#06ff00', '#ff006e', '#ffbe0b', '#3a86ff'],
    settings: mk({ algorithm: 'bayer-16', mode: 'indexed', posterize: 4, saturation: 45, contrast: 14, post: true, chroma: true, chromaAmt: 1.2 }),
  },
  {
    id: 'p-woodcut', name: 'Woodcut', group: 'Experimental',
    palette: ['#000000', '#f2ead8'],
    settings: mk({ algorithm: 'line-d-8', mode: 'mono', contrast: 42, spread: 1, paperColor: '#f2ead8' }),
  },
  {
    id: 'p-ascii-grid', name: 'Pixel Grid', group: 'Experimental',
    palette: ['#000000', '#ffffff'],
    settings: mk({ algorithm: 'bayer-2', mode: 'mono', resolution: 120, edgeShape: 'round', gapColor: '#101010', contrast: 16 }),
  },
  {
    id: 'p-dreamy', name: 'Dreamy Glow', group: 'Experimental',
    palette: ['#0a0a12', '#ffd6e0', '#c1f7dc', '#a7c7e7', '#d7b9f7'],
    settings: mk({ algorithm: 'floyd-steinberg', mode: 'indexed', edgeShape: 'round', gapColor: '#0a0a12', blur: 0.6, post: true, glow: true, glowAmt: 1.2, glowThreshold: 0.4 }),
  },

  // ── New looks ─────────────────────────────────────────────────────────────────
  {
    id: 'p-hilbert-grain', name: 'Hilbert Grain', group: 'New looks',
    palette: ['#11100c', '#f3efe3'],
    settings: mk({ algorithm: 'riemersma', mode: 'mono', contrast: 10, resolution: 360 }),
  },
  {
    id: 'p-gradient-duotone', name: 'Gradient Duotone', group: 'New looks',
    palette: ['#10193a', '#3a4cc0', '#e86a5c', '#ffe9c7'],
    settings: mk({ algorithm: 'bayer-8', mode: 'indexed', gradMap: true, contrast: 6, resolution: 360 }),
  },
  {
    id: 'p-jitter-screen', name: 'Gritty Screen', group: 'New looks',
    palette: ['#0d0d0d', '#ffffff'],
    settings: mk({ algorithm: 'bayer-4', mode: 'mono', spread: 1, jitter: 0.45, contrast: 10 }),
  },
  {
    id: 'p-misprint-cmyk', name: 'Misprint CMYK', group: 'New looks',
    settings: mk({ halftone: true, inkMode: 'cmyk', htAlgo: 'circle', htDpi: 80, htGamma: 0.95, htDotSize: 1.04, resolution: 520, contrast: 10, saturation: 14, htReg: 0.6, htDotGain: 0.45, htPaperGrain: 0.3, htFreqVary: 0.25, paperColor: '#f7f3e8' }),
  },
  {
    id: 'p-riso-misreg', name: 'Riso Misregister', group: 'New looks',
    palette: ['#0078bf', '#ff48b0', '#ffd400'],
    settings: mk({ halftone: true, inkMode: 'palette', htAlgo: 'circle', htDpi: 85, htGamma: 0.9, htDotSize: 1.05, resolution: 500, htReg: 0.8, htPaperGrain: 0.35, htDotGain: 0.3, paperColor: '#f4f0d8' }),
  },
  {
    id: 'p-spotlight', name: 'Subject Spotlight', group: 'New looks',
    palette: ['#000000', '#ffffff'],
    settings: mk({ algorithm: 'bayer-8', mode: 'mono', contrast: 12, maskOn: true, maskMode: 'subject', maskLo: 0.12, maskFeather: 0.12, maskRaw: true }),
  },
]
