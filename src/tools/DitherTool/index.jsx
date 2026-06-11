import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { NumberSlider, EditableNumber } from '../../components/NumberField.jsx'
import Icon from '../../components/Icon.jsx'
import { processImage, sharpen, denoise, addNoise, applyLevels, extractPalette, buildPalette, gradientMap, ALGORITHMS, isMatrixOrdered } from '../../lib/dither.js'
import { renderHalftone, renderHalftoneSvg } from '../../lib/halftone.js'
import { ditherToSvg } from '../../lib/ditherSvg.js'
import { create as createGL, algoKind } from '../../lib/glDither.js'
import { hexToRgb, sortByLuma } from './palettes.js'
import { BUILTIN_PRESETS } from './presets.js'
import {
  useDither, setState, getState, allPalettes, getPalette,
  savePalette, removeSavedPalette, updateSavedPalette,
  getIncomingColors, clearIncomingColors,
  undo, redo, canUndo, canRedo, resetState,
  applyPreset, saveCurrentPreset, removeSavedPreset, setInkCtl,
} from './store.js'
import { sendImageToPostFX } from '../PostFX/store.js'
import { MOTION_PARAMS, PARAM_BY_KEY, WAVES, mkLfo, computeMods } from './motion.js'
import { processFile } from '../../lib/file.js'
import { decodeGif, fileToCanvas, encodeGif, framesToZip, gifDecodeSupported } from '../../lib/gif.js'
import { markSaved } from '../../lib/unsavedChanges.js'

const C = {
  bg: '#0b0b0d', sidebar: '#0e0e11', panel: '#111114', ctrl: '#18181c',
  border: '#1e1e24', accent: '#f472b6', accentLo: '#3a1029',
  text: '#f0ede7', muted: '#5a5a64', mutedHi: '#8a8a96',
}
const ACC = C.accent
const SHAPE_IDX = { square: 0, round: 1, diamond: 2 }
const HT_SHAPE_ID = { circle: 0, square: 1, diamond: 2, triangle: 3, hexagon: 4, ring: 5, line: 6, stochastic: 7, star: 8, cross: 9, ellipse: 10 }
const HT_ALGOS = ['circle', 'square', 'diamond', 'triangle', 'hexagon', 'star', 'cross', 'ellipse', 'ring', 'line', 'stochastic']
const HT_ANGLES = [15, 75, 0, 45, 22.5, 52.5, 67.5, 7.5, 37.5, 82.5, 30, 60, 12, 48, 68, 3]

const ALGO_GROUPS = ALGORITHMS.reduce((m, a) => { (m[a.group] ||= []).push(a); return m }, {})

export default function DitherTool() {
  const sBase = useDither()
  const modRef = useRef(null)   // { key: value } LFO overrides during motion playback/export
  // During motion playback every `s.param` read sees the LFO-modulated value via
  // this proxy — the render pipeline animates with zero store churn per frame.
  const s = useMemo(() => new Proxy(sBase, {
    get: (t, k) => (modRef.current && k in modRef.current) ? modRef.current[k] : t[k],
  }), [sBase])
  const fileRef = useRef(null)
  const lastRef = useRef(null)        // { type, layers, cpuCanvas }
  const htSourceRef = useRef(null)
  const canvasRef = useRef(null)      // visible WebGL (or 2D fallback) canvas
  const glRef = useRef(null)
  const glReady = useRef(false)

  const [src, setSrc] = useState(null)
  const [layersMeta, setLayersMeta] = useState([])   // [{key,name,colorCss,angle}]
  const [layerUrls, setLayerUrls] = useState({})     // key -> dataURL (built lazily)
  const [view, setView] = useState('result')
  const [dragOver, setDragOver] = useState(false)
  const [incoming, setIncoming] = useState([])
  const [exportScale, setExportScale] = useState(4)
  const [extractN, setExtractN] = useState(8)
  const [menu, setMenu] = useState(null)             // { x, y }
  // sequence / gif
  const [seq, setSeq] = useState(null)               // { frames:[{canvas,delay}], name }
  const [frameIdx, setFrameIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [exporting, setExporting] = useState(null)   // 'gif' | 'frames' | null

  // pan / zoom
  const viewportRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [space, setSpace] = useState(false)
  const panRef = useRef(null)
  const [resultDims, setResultDims] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)   // mipmapped crisp display once settled
  const [settled, setSettled] = useState(false)
  const urlTimer = useRef(null)
  const fittedKey = useRef('')
  const orientKey = useRef('')
  const lastOutScale = useRef(1)      // upscale of the last GL render (for animation)
  const animatingRef = useRef(false)  // true while the glitch/grain loop is running
  const phaseRef = useRef(0)          // advancing ordered-screen phase (px) for shimmer

  const palettes = allPalettes()
  const palette = getPalette(s.paletteId)
  const disabledSet = new Set(s.htDisabled)

  // ── Init WebGL engine once ──────────────────────────────────────────────────
  useEffect(() => {
    if (canvasRef.current && !glReady.current) {
      glReady.current = true
      glRef.current = createGL(canvasRef.current)
      if (!glRef.current) console.warn('Dither: WebGL2 unavailable, using CPU fallback')
    }
  }, [])

  // ── Incoming colours ────────────────────────────────────────────────────────
  useEffect(() => { const c = getIncomingColors(); if (c.length) setIncoming(c) }, [])

  // ── Keyboard: space pan, undo/redo ──────────────────────────────────────────
  useEffect(() => {
    const isField = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
    function down(e) {
      if (e.code === 'Space' && !isField()) { e.preventDefault(); setSpace(true); return }
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); undo() }
      else if (ctrl && (e.key === 'y' || e.key === 'Z' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
    }
    function up(e) { if (e.code === 'Space') setSpace(false) }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // ── Image input (single / gif / multi-file sequence) ────────────────────────
  const loadFiles = useCallback(async fileList => {
    const files = [...fileList].filter(f => f.type.startsWith('image/') || /\.gif$/i.test(f.name))
    if (!files.length) return
    fittedKey.current = ''
    if (files.length === 1) {
      const file = files[0]
      if ((file.type === 'image/gif' || /\.gif$/i.test(file.name)) && gifDecodeSupported()) {
        try {
          const { frames } = await decodeGif(file)
          if (frames.length > 1) { setPlaying(false); setFrameIdx(0); setSeq({ frames, name: file.name }); return }
          setSeq(null); const c = frames[0].canvas; setSrc({ img: c, w: c.width, h: c.height, name: file.name }); return
        } catch (e) { console.warn('gif decode failed', e) }
      }
      setSeq(null)
      const r = await processFile(file)
      if (!r || r.type !== 'raster') return
      const img = new Image()
      img.onload = () => setSrc({ img, w: img.naturalWidth, h: img.naturalHeight, name: r.name })
      img.src = r.dataUrl
      return
    }
    // multiple stills → frame sequence
    const canvases = await Promise.all(files.map(fileToCanvas))
    const frames = canvases.map(c => ({ canvas: c, delay: 100 }))
    setPlaying(false); setFrameIdx(0); setSeq({ frames, name: files[0].name.replace(/\.\w+$/, '') + '-seq' })
  }, [])

  const loadFile = useCallback(file => loadFiles([file]), [loadFiles])

  // Synthetic debug pattern — makes halftone tone-response, banding, dot-edge and
  // halo artifacts easy to spot.
  function loadDebug() {
    const W = 512, H = 512
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const x = c.getContext('2d')
    // smooth horizontal gradient background (full tonal sweep)
    const g = x.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff')
    x.fillStyle = g; x.fillRect(0, 0, W, H * 0.45)
    // discrete step wedge (flat-tone dot uniformity)
    const steps = 11
    for (let i = 0; i < steps; i++) { const v = Math.round(i / (steps - 1) * 255); x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(Math.round(i * W / steps), Math.round(H * 0.45), Math.ceil(W / steps), Math.round(H * 0.18)) }
    // solid flat patches (check edge halos against pure tones)
    const patches = [0, 64, 128, 192, 255]
    patches.forEach((v, i) => { x.fillStyle = `rgb(${v},${v},${v})`; x.fillRect(Math.round(i * W / 5) + 8, Math.round(H * 0.66), Math.round(W / 5) - 16, Math.round(H * 0.14)) })
    // radial gradient (smooth dot growth in all directions) + a pure-black disc on white
    const rg = x.createRadialGradient(130, H - 90, 4, 130, H - 90, 90); rg.addColorStop(0, '#fff'); rg.addColorStop(1, '#000')
    x.fillStyle = rg; x.fillRect(0, Math.round(H * 0.82), W, Math.round(H * 0.18))
    x.fillStyle = '#fff'; x.fillRect(Math.round(W * 0.55), Math.round(H * 0.82), Math.round(W * 0.45), Math.round(H * 0.18))
    x.fillStyle = '#000'; x.beginPath(); x.arc(Math.round(W * 0.78), H - 45, 36, 0, 7); x.fill()
    fittedKey.current = ''; setSeq(null); setSrc({ img: c, w: W, h: H, name: 'debug-pattern' })
  }

  // Derive the active source from the current sequence frame.
  useEffect(() => {
    if (!seq) return
    const f = seq.frames[frameIdx]
    if (f) setSrc({ img: f.canvas, w: f.canvas.width, h: f.canvas.height, name: seq.name })
  }, [seq, frameIdx])

  // Playback.
  useEffect(() => {
    if (!playing || !seq || seq.frames.length < 2 || exporting) return
    const d = seq.frames[frameIdx]?.delay || 100
    const t = setTimeout(() => setFrameIdx(i => (i + 1) % seq.frames.length), Math.max(40, d))
    return () => clearTimeout(t)
  }, [playing, seq, frameIdx, exporting])

  useEffect(() => {
    function onPaste(e) {
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))
      if (item) loadFile(item.getAsFile())
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loadFile])

  // ── Processing pipeline (debounced) ─────────────────────────────────────────
  const deps = JSON.stringify({ ...s, _: src ? src.name + src.w + src.h : null })
  useEffect(() => {
    if (!src) return
    let cancelled = false
    const t = setTimeout(() => { if (!cancelled) renderFrame(src.img, src.w, src.h) }, 70)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps])

  // ── Glitch / grain / motion animation loop ──────────────────────────────────
  // Post-only animation re-runs just the GPU post stack each frame; phase shimmer
  // and LFO motion re-run the full (cheap, GPU) pipeline with modulated settings.
  useEffect(() => {
    const postActive = s.post && s.animate && (s.glitch || s.grain || s.vhs || s.wave)
    const phaseActive = s.phaseAnim && !s.halftone && isOrdered(s.algorithm)
    const motionActive = sBase.motionPlay && sBase.lfos.some(l => l.on)
    const active = (postActive || phaseActive || motionActive) && src && glRef.current && !exporting
    if (!active) { animatingRef.current = false; modRef.current = null; return }
    animatingRef.current = true
    setSettled(false)
    let raf, start = performance.now()
    const tick = (now) => {
      const t = (now - start) / 1000 * (s.animSpeed || 1)
      if (phaseActive) phaseRef.current = t * 24
      if (motionActive) {
        // loop phase 0..1 — integer LFO cycles make every loop seamless
        const dur = Math.max(0.25, sBase.motionDur)
        modRef.current = computeMods(sBase.lfos, ((now - start) / 1000 % dur) / dur, sBase)
        renderFrame(src.img, src.w, src.h, { quiet: true, time: t })
      } else if (phaseActive) {
        // Drift the ordered screen's origin → shimmering dither. Re-runs the (cheap)
        // GPU dither each frame; quiet skips React churn, canvas still updates.
        renderFrame(src.img, src.w, src.h, { quiet: true, time: t })
      } else {
        glRef.current.repost(postP(lastOutScale.current, t))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { animatingRef.current = false; modRef.current = null; cancelAnimationFrame(raf) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps, exporting])

  // Auto-orient: when a new image is loaded in Halftone, set Invert so the
  // subject (not the background) gets the ink. Runs once per image.
  useEffect(() => {
    if (!src || !s.halftone) return
    const key = `${src.name}|${src.w}x${src.h}`
    if (orientKey.current === key) return
    orientKey.current = key
    const inv = shouldInvert(src.img)
    if (inv !== s.invert) setState({ invert: inv })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, s.halftone])

  // Render a single halftone ink layer on demand (GPU) — kept off the live path.
  function getHtLayerCanvas(i) {
    const g = lastRef.current?.glHt
    if (!g || !glRef.current) return null
    return glRef.current.renderHalftoneLayer(g.srcCv, { ...g.ht, ...colorP(false) }, i, g.outW, g.outH)
  }

  // Build layer preview URLs only when viewing separations.
  useEffect(() => {
    if (view !== 'separations') return
    const lr = lastRef.current
    const urls = {}
    if (lr?.layers) for (const l of lr.layers) urls[l.key] = l.canvas.toDataURL('image/png')   // CPU fallback
    else if (lr?.inks) lr.inks.forEach((ink, i) => { const cv = getHtLayerCanvas(i); if (cv) urls[ink.key] = cv.toDataURL('image/png') })
    setLayerUrls(urls)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, layersMeta])

  // Dither working size — driven by the Detail/res slider.
  function workingSize(w, h) {
    const long = Math.max(w, h)
    // 'pixel' mode derives the working long-edge from an intuitive block size, so a
    // higher pixel size = chunkier output; 'detail' uses the resolution px directly.
    const target = s.sizeMode === 'pixel' ? Math.max(8, Math.round(long / Math.max(1, s.pixelSize))) : s.resolution
    const scale = Math.min(1, target / long)
    return { W: Math.max(1, Math.round(w * scale)), H: Math.max(1, Math.round(h * scale)) }
  }

  // Halftone working size — derived from the single DPI control: enough resolution
  // for ~6 source px per dot, never upscaling beyond native, capped for perf.
  function htWorkingSize(w, h) {
    const nativeLong = Math.max(w, h)
    const targetLong = Math.min(nativeLong, 1600, Math.max(96, Math.round(s.htDpi * 6)))
    const scale = targetLong / nativeLong
    return { W: Math.max(1, Math.round(w * scale)), H: Math.max(1, Math.round(h * scale)) }
  }

  // Spatial-only prep (blur/sharpen/denoise) — colour handled by the GPU shader.
  function prepSpatial(drawable, W, H, smooth = false) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = smooth || s.resample === 'bilinear'
    ctx.imageSmoothingQuality = 'high'
    ctx.filter = `blur(${s.blur}px)`
    ctx.drawImage(drawable, 0, 0, W, H)
    ctx.filter = 'none'
    let img = ctx.getImageData(0, 0, W, H)
    img = applyEffects(img)
    ctx.putImageData(img, 0, 0)
    return cv
  }

  // Sharpen / denoise-or-noise / levels — shared by both prep paths.
  function applyEffects(img) {
    if (s.sharpen > 0) img = sharpen(img, s.sharpen)
    if (s.denoise > 0) img = denoise(img, s.denoise)
    else if (s.denoise < 0) img = addNoise(img, -s.denoise)
    img = applyLevels(img, s.levelsLow, s.levelsHigh, s.levelsGamma, s.posterize)
    // Gradient map: remap luminance onto the palette ramp before quantising/screening,
    // so the output resolves a clean duotone/multitone gradient. Baked into the source
    // here, so it flows through every path identically — dither (any mode) and halftone.
    if (s.gradMap) {
      const cols = sortByLuma(palette.colors).map(hexToRgb)
      if (cols.length >= 2) {
        const pos = Array.isArray(s.gradStops) && s.gradStops.length === cols.length ? s.gradStops : null
        img = gradientMap(img, cols, pos)
      }
    }
    return img
  }

  // Fully colour-adjusted ImageData (for CPU diffusion + halftone).
  function getAdjustedImageData(drawable, W, H) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = s.resample === 'bilinear'
    ctx.filter = `brightness(${1 + s.brightness / 100}) contrast(${1 + s.contrast / 100}) saturate(${1 + s.saturation / 100}) hue-rotate(${s.hue}deg) blur(${s.blur}px)`
    ctx.drawImage(drawable, 0, 0, W, H)
    ctx.filter = 'none'
    let img = ctx.getImageData(0, 0, W, H)
    img = applyEffects(img)
    if (s.invert) { const d = img.data; for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2] } }
    return img
  }

  function rawImageData(drawable, W, H) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    cv.getContext('2d').drawImage(drawable, 0, 0, W, H)
    return cv.getContext('2d').getImageData(0, 0, W, H)
  }

  // Auto-orient: ink the subject, not the background. Compares corner luminance
  // (background proxy) with the centre (subject) and returns whether to invert.
  function shouldInvert(drawable) {
    const n = 32
    const cv = document.createElement('canvas'); cv.width = n; cv.height = n
    const ctx = cv.getContext('2d'); ctx.drawImage(drawable, 0, 0, n, n)
    const d = ctx.getImageData(0, 0, n, n).data
    const lum = p => (0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2]) / 255
    const bg = [0, n - 1, n * (n - 1), n * n - 1].reduce((a, p) => a + lum(p), 0) / 4
    let c = 0, k = 0
    for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) { c += lum(y * n + x); k++ }
    return bg < (c / k) - 0.06   // dark background, lighter subject → invert so subject inks
  }

  function paletteRgb() {
    const sorted = sortByLuma(palette.colors)
    return { colors: palette.colors.map(hexToRgb), dark: hexToRgb(sorted[0]), light: hexToRgb(sorted[sorted.length - 1]) }
  }

  function buildHtOpts(cell) {
    const { dark, light } = paletteRgb()
    const shape = ['square', 'diamond'].includes(s.htAlgo) ? s.htAlgo : 'round'
    const base = { cell, shape, scale: s.htScale, disabled: disabledSet }
    if (s.inkMode === 'cmyk') return { ...base, inkMode: 'cmyk', bg: '#ffffff', angles: { c: s.angC, m: s.angM, y: s.angY, k: s.angK } }
    if (s.inkMode === 'palette') {
      const sorted = sortByLuma(palette.colors)
      const paperHex = sorted[sorted.length - 1]
      let inkHexes = palette.colors.filter(c => c !== paperHex)
      let paperRgb = hexToRgb(paperHex), bg = paperHex
      if (!inkHexes.length) { inkHexes = [sorted[0]]; paperRgb = [255, 255, 255]; bg = '#ffffff' }
      return { ...base, inkMode: 'palette', inks: inkHexes.map(hexToRgb), paper: paperRgb, names: inkHexes, bg }
    }
    return { ...base, inkMode: 'mono', bg: rgbCss(light), ink: rgbCss(dark), paper: rgbCss(light), angle: s.htAngle }
  }

  // The ink set for the current mode (colour + key + angle), shared by the GL
  // params and the gradient editor.
  function htInks() {
    const norm = hex => hexToRgb(hex).map(v => v / 255)
    if (s.inkMode === 'cmyk') return [
      { key: 'c', name: 'Cyan', color: [0, 0.68, 0.94], angle: s.angC },
      { key: 'm', name: 'Magenta', color: [0.93, 0, 0.55], angle: s.angM },
      { key: 'y', name: 'Yellow', color: [1, 0.95, 0], angle: s.angY },
      { key: 'k', name: 'Black', color: [0.06, 0.06, 0.06], angle: s.angK },
    ]
    if (s.inkMode === 'palette') return palette.colors.map((hx, i) => ({ key: hx, name: hx, color: norm(hx), angle: HT_ANGLES[i % HT_ANGLES.length] }))
    return [{ key: 'ink', name: 'Ink', color: norm(sortByLuma(palette.colors)[0]), angle: s.htAngle }]
  }

  // The colour "stops" for the gradient editor in the current mode (halftone inks,
  // or dither palette colours for indexed/mono). Empty for tonal/rgb dither.
  function currentInks() {
    if (s.halftone) return htInks()
    const norm = hex => hexToRgb(hex).map(v => v / 255)
    if (s.mode === 'indexed') return palette.colors.map(hx => ({ key: hx, name: hx, color: norm(hx) }))
    if (s.mode === 'mono') { const srt = sortByLuma(palette.colors); return [{ key: srt[0], name: 'Dark', color: norm(srt[0]) }, { key: srt[srt.length - 1], name: 'Light', color: norm(srt[srt.length - 1]) }] }
    return []
  }

  // Attach the per-ink tonal controls (position defaults to the colour's luminance).
  function inksWithCtl() {
    return currentInks().map(ink => {
      const c = s.inkCtl[ink.key] || {}
      const ll = 0.299 * ink.color[0] + 0.587 * ink.color[1] + 0.114 * ink.color[2]
      return { ...ink, pos: c.pos ?? ll, spread: c.spread ?? 1, intensity: c.intensity ?? 1 }
    })
  }

  // Per-palette-colour controls aligned with a dither palette (indexed/mono only).
  function ditherPalCtl(pal) {
    let hexList = null
    if (s.mode === 'indexed') hexList = palette.colors
    else if (s.mode === 'mono') { const srt = sortByLuma(palette.colors); hexList = [srt[0], srt[srt.length - 1]] }
    if (!hexList) return null
    return pal.map((rgb, i) => {
      const c = s.inkCtl[hexList[i]] || {}
      const ll = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255
      return { pos: c.pos ?? ll, spread: c.spread ?? 1, intensity: c.intensity ?? 1 }
    })
  }

  // GPU halftone parameters (ink set, paper, screen geometry).
  function buildGlHt(cell) {
    const inkModeId = s.inkMode === 'cmyk' ? 0 : s.inkMode === 'palette' ? 1 : 2
    return {
      inks: inksWithCtl(), inkModeId, paper: hexToRgb(s.paperColor).map(v => v / 255),
      paperAlpha: s.paperTransparent ? 0 : 1,
      cell, htShapeId: HT_SHAPE_ID[s.htAlgo] ?? 0, gamma: Math.max(0.2, s.htGamma), dotSize: s.htDotSize,
      reg: s.htReg, dotGain: s.htDotGain, freqVary: s.htFreqVary, paperGrain: s.htPaperGrain,
      ...maskP(),
    }
  }

  // Shared post + colour uniform builders for the GL engine.
  // outScale: the output buffer's upscale factor — px-based FX (grain, phosphor
  // mask) are multiplied by it so they read in working-resolution pixels
  // regardless of how far the present buffer is supersampled.
  // time: seconds for the animation loop (0 = frozen) — drives glitch & grain.
  function postP(outScale = 1, time = 0) {
    const maskId = { none: 0, aperture: 1, shadow: 2 }[s.crtMask] ?? 0
    return {
      post: s.post,
      glow: s.post && s.glow, glowAmt: s.glowAmt, glowThreshold: s.glowThreshold,
      glowTint: s.post && s.glow ? hexToRgb(s.glowTint).map(v => v / 255) : [1, 1, 1],
      chroma: s.post && s.chroma ? s.chromaAmt : 0,
      scan: s.post && s.crt ? s.scan : 0, scanCount: s.scanCount,
      curve: s.post && s.crt ? s.curve : 0, vignette: s.post && s.crt ? s.vignette : 0,
      mask: s.post && s.crt ? maskId : 0, maskAmt: s.crtMaskAmt, maskScale: outScale,
      glitch: s.post && s.glitch ? s.glitchAmt : 0,
      grain: s.post && s.grain ? s.grainAmt : 0, grainSize: s.grainSize * outScale,
      temp: s.post && s.grade ? s.temp / 100 : 0, tint: s.post && s.grade ? s.tint / 100 : 0,
      wave: s.post && s.wave ? s.waveAmt * 0.05 : 0, waveFreq: s.waveFreq, waveAxis: { h: 0, v: 1, both: 2 }[s.waveAxis] ?? 0,
      streak: s.post && s.streak ? s.streakAmt : 0,
      vhs: s.post && s.vhs ? s.vhsAmt : 0,
      edge: s.post && s.edge ? s.edgeAmt : 0, edgeThresh: s.edgeThresh, edgeColor: hexToRgb(s.edgeColor).map(v => v / 255),
      time,
    }
  }
  // Subject/region mask params shared by the GL dither + halftone passes.
  function maskP() {
    return { maskOn: s.maskOn, maskMode: s.maskMode, maskRaw: s.maskRaw, maskLo: s.maskLo, maskHi: s.maskHi, maskFeather: Math.max(0.001, s.maskFeather), maskInvert: s.maskInvert }
  }
  // Per-image mask data: background-luma estimate (subject mode) + a raw working-size
  // canvas (raw-original compositing). Computed only when the mask is on.
  function maskExtra(drawable, W, H) {
    if (!s.maskOn) return {}
    const out = {}
    if (s.maskMode === 'subject') out.bgLuma = bgLumaOf(drawable)
    if (s.maskRaw) out.origCanvas = rawCanvas(drawable, W, H)
    return out
  }
  // Background luminance proxy: average of the four corners (matches auto-invert).
  function bgLumaOf(drawable) {
    const n = 32
    const cv = document.createElement('canvas'); cv.width = n; cv.height = n
    const ctx = cv.getContext('2d'); ctx.drawImage(drawable, 0, 0, n, n)
    const d = ctx.getImageData(0, 0, n, n).data
    const lum = p => (0.299 * d[p * 4] + 0.587 * d[p * 4 + 1] + 0.114 * d[p * 4 + 2]) / 255
    return [0, n - 1, n * (n - 1), n * n - 1].reduce((a, p) => a + lum(p), 0) / 4
  }
  function rawCanvas(drawable, W, H) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    cv.getContext('2d').drawImage(drawable, 0, 0, W, H)
    return cv
  }
  function colorP(neutral) {
    return neutral
      ? { bright: 1, contrast: 1, hue: 0, sat: 1, invert: false }
      : { bright: 1 + s.brightness / 100, contrast: 1 + s.contrast / 100, hue: s.hue / 360, sat: 1 + s.saturation / 100, invert: s.invert }
  }
  const gapRgb = () => hexToRgb(s.gapColor).map(v => v / 255)

  function present(dims) {
    setResultDims(dims)
    const key = `${src?.name}|${dims.w}x${dims.h}`
    if (key !== fittedKey.current) { fittedKey.current = key; requestAnimationFrame(() => fitView(dims)) }
    // Live edits show the raw canvas (fast, may alias when scaled). Once edits
    // settle, swap to a mipmapped <img> so scaling is clean (no moiré/halo).
    // While animating we keep the live canvas — never settle to a static frame.
    setSettled(false)
    clearTimeout(urlTimer.current)
    if (animatingRef.current) return
    urlTimer.current = setTimeout(() => {
      try { setPreviewUrl(canvasRef.current.toDataURL('image/png')); setSettled(true) } catch {}
    }, 160)
  }

  function drawFallback(sourceCanvas, outW, outH) {
    const cv = canvasRef.current
    cv.width = outW; cv.height = outH
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, outW, outH)
    ctx.drawImage(sourceCanvas, 0, 0, outW, outH)
  }

  // Keep output within the GPU's texture/canvas limit so nothing gets clipped.
  function capScale(W, H, scale, maxArg) {
    const max = Math.min(glRef.current?.maxTex || 4096, maxArg || 4096)
    let sc = scale
    while (sc > 1 && (W * sc > max || H * sc > max)) sc--
    return Math.max(1, sc)
  }

  function renderFrame(drawable, w, h, opts = {}) {
    const gl = glRef.current
    const quiet = opts.quiet   // batch export: skip React state churn / fit

    // ── Halftone ──
    if (s.halftone) {
      const { W, H } = htWorkingSize(w, h)
      const htCell = Math.max(2, Math.round(Math.max(W, H) / s.htDpi))
      // Target ~10 output px per cell; the engine supersamples 2× on top for AA, so
      // cap the base so 2× still fits the GPU texture limit.
      const outScale = capScale(W, H, Math.min(4, Math.max(1, Math.round(10 / htCell))), 2048)
      const outW = W * outScale, outH = H * outScale
      if (gl) {
        const srcCv = prepSpatial(drawable, W, H, true)   // smooth source → clean screen
        const ht = buildGlHt(htCell)
        // composite uses only enabled inks; individual layers are rendered lazily.
        const enabled = ht.inks.filter(ink => !disabledSet.has(ink.key))
        lastOutScale.current = outScale
        gl.renderHalftone(srcCv, { ...ht, inks: enabled.length ? enabled : ht.inks, ...maskExtra(drawable, W, H), ...colorP(false), ...postP(outScale) }, outW, outH)
        lastRef.current = { type: 'halftone', glHt: { srcCv, ht, outW, outH }, inks: ht.inks }
        if (!quiet) {
          if (ht.inks.length > 1) setLayersMeta(ht.inks.map(ink => ({ key: ink.key, name: ink.name, colorCss: cssRgb01(ink.color), angle: ink.angle })))
          else { setLayersMeta([]); if (view === 'separations') setView('result') }
          present({ w: outW, h: outH })
        }
        return
      }
      // CPU fallback
      const img = getAdjustedImageData(drawable, W, H)
      htSourceRef.current = img
      const { composite, layers: ls } = renderHalftone(img, buildHtOpts(htCell))
      lastRef.current = { type: 'halftone', layers: ls, cpuCanvas: composite }
      drawFallback(composite, composite.width, composite.height)
      if (!quiet) {
        if (ls.length > 1) setLayersMeta(ls.map(l => ({ key: l.key, name: l.name, colorCss: l.colorCss, angle: l.angle })))
        else { setLayersMeta([]); if (view === 'separations') setView('result') }
        present({ w: composite.width, h: composite.height })
      }
      return
    }

    if (!quiet) { setLayersMeta([]); if (view === 'separations') setView('result') }
    const ordered = isOrdered(s.algorithm)
    const { W, H } = workingSize(w, h)
    const outScale = capScale(W, H, (s.edgeShape !== 'square' || s.post) ? 5 : 1)
    const outW = W * outScale, outH = H * outScale

    lastOutScale.current = outScale
    if (ordered && gl) {
      const srcCv = prepSpatial(drawable, W, H)
      const pr = paletteRgb()
      const pal = buildPalette({ mode: s.mode, levels: s.levels, paletteColors: pr.colors, dark: pr.dark, light: pr.light }) || []
      const phase = s.phaseAnim ? [phaseRef.current, phaseRef.current * 0.6] : [0, 0]
      gl.render(srcCv, {
        applyDither: true, applyShape: true, algorithm: s.algorithm, algoKind: algoKind(s.algorithm),
        mode: s.mode, palette: pal, palCtl: ditherPalCtl(pal), levels: s.levels, spread: s.spread,
        jitter: s.jitter, phase, ...maskP(), ...maskExtra(drawable, W, H),
        shape: SHAPE_IDX[s.edgeShape], gap: gapRgb(), ...colorP(false), ...postP(outScale, opts.time || 0),
      }, outW, outH)
      lastRef.current = { type: 'gl', srcCanvas: srcCv }
      if (!quiet) present({ w: outW, h: outH })
      return
    }

    // Diffusion (CPU dither) — feed result through GPU shape + post.
    const img = getAdjustedImageData(drawable, W, H)
    const { dark, light, colors } = paletteRgb()
    const dpal = buildPalette({ mode: s.mode, levels: s.levels, paletteColors: colors, dark, light }) || []
    const dithered = processImage(img, { algorithm: s.algorithm, mode: s.mode, levels: s.levels, spread: s.spread, strength: s.strength, serpentine: s.serpentine, paletteColors: colors, dark, light, palControls: ditherPalCtl(dpal) })
    if (s.maskOn) {
      const keep = s.maskRaw ? rawImageData(drawable, W, H) : img
      applyMaskCpu(dithered, keep, { ...maskP(), ...maskExtra(drawable, W, H) })
    }
    const cv = document.createElement('canvas'); cv.width = dithered.width; cv.height = dithered.height
    cv.getContext('2d').putImageData(dithered, 0, 0)
    lastRef.current = { type: 'dither', cpuCanvas: cv }
    if (gl) gl.render(cv, { applyDither: false, applyShape: true, shape: SHAPE_IDX[s.edgeShape], gap: gapRgb(), ...colorP(true), ...postP(outScale) }, outW, outH)
    else drawFallback(cv, outW, outH)
    if (!quiet) present({ w: outW, h: outH })
  }

  // ── Result canvas for export / clipboard ────────────────────────────────────
  function getResultCanvas() {
    const gl = glRef.current
    if (gl && lastRef.current?.type !== undefined) return gl.readToCanvas()
    return lastRef.current?.cpuCanvas || canvasRef.current
  }

  // ── Pan / zoom ──────────────────────────────────────────────────────────────
  function fitView(dims, tries = 0) {
    const vp = viewportRef.current
    if (!vp || !dims) return
    const cw = vp.clientWidth, ch = vp.clientHeight
    if ((cw < 80 || ch < 80) && tries < 10) { requestAnimationFrame(() => fitView(dims, tries + 1)); return }
    if (cw < 80 || ch < 80) { setZoom(1); setPan({ x: 20, y: 20 }); return }
    const pad = 32
    let z = Math.min((cw - pad) / dims.w, (ch - pad) / dims.h)
    z = Math.max(0.02, Math.min(z, 24))
    setZoom(z); setPan({ x: (cw - dims.w * z) / 2, y: (ch - dims.h * z) / 2 })
  }
  function onWheel(e) {
    if (view !== 'result' || !src) return
    e.preventDefault()
    const rect = viewportRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const z2 = Math.max(0.02, Math.min(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 40))
    setPan({ x: cx - (cx - pan.x) / zoom * z2, y: cy - (cy - pan.y) / zoom * z2 }); setZoom(z2)
  }
  function onPointerDown(e) {
    if (view !== 'result') return
    if (space || e.button === 1) { e.preventDefault(); panRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; viewportRef.current.setPointerCapture(e.pointerId) }
  }
  function onPointerMove(e) { if (panRef.current) setPan({ x: panRef.current.px + (e.clientX - panRef.current.x), y: panRef.current.py + (e.clientY - panRef.current.y) }) }
  function onPointerUp(e) { if (panRef.current) { panRef.current = null; try { viewportRef.current.releasePointerCapture(e.pointerId) } catch {} } }

  // Hand the current rendered result over to the Post FX tool (cross-tool feed).
  function sendToPostFX() {
    if (!src) return
    const cv = getResultCanvas()
    if (cv) sendImageToPostFX(cv.toDataURL('image/png'))
  }

  // ── Exports ─────────────────────────────────────────────────────────────────
  function exportPng() {
    if (!src) return
    const base = getResultCanvas()
    const scale = lastRef.current?.type === 'halftone' ? 1 : Math.max(1, exportScale)
    let cv = base
    if (scale > 1) {
      cv = document.createElement('canvas'); cv.width = base.width * scale; cv.height = base.height * scale
      const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false
      ctx.drawImage(base, 0, 0, cv.width, cv.height)
    }
    downloadCanvas(cv, baseName() + '.png')
  }
  function svgAvailable() {
    if (s.halftone) return true
    if (s.post) return false
    return isMatrixOrdered(s.algorithm) || s.algorithm === 'threshold'
  }
  function exportSvg() {
    if (!src || !svgAvailable()) return
    if (s.halftone) {
      const hw = htWorkingSize(src.w, src.h)
      const cell = Math.max(2, Math.round(Math.max(hw.W, hw.H) / s.htDpi))
      const img = getAdjustedImageData(src.img, hw.W, hw.H)
      const svg = renderHalftoneSvg(img, buildHtOpts(cell))
      downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), baseName() + '.svg'); return
    }
    // Ordered/threshold pixel modes → run-length-merged vector
    const dw = workingSize(src.w, src.h)
    const img = getAdjustedImageData(src.img, dw.W, dw.H)
    const { dark, light, colors } = paletteRgb()
    const dithered = processImage(img, { algorithm: s.algorithm, mode: s.mode, levels: s.levels, spread: s.spread, strength: 1, serpentine: false, paletteColors: colors, dark, light })
    const svg = ditherToSvg(dithered, { shape: s.edgeShape, gap: s.gapColor })
    downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), baseName() + '.svg')
  }
  async function copyClipboard() {
    if (!src) return
    getResultCanvas().toBlob(async blob => {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]) } catch (err) { console.warn('clipboard', err) }
    }, 'image/png')
  }
  function exportSeparation(key) {
    const lr = lastRef.current
    if (lr?.layers) { const l = lr.layers.find(l => l.key === key); if (l) downloadCanvas(l.canvas, baseName() + `-${safeName(l.name)}.png`); return }
    if (lr?.inks) { const i = lr.inks.findIndex(k => k.key === key); const cv = getHtLayerCanvas(i); if (cv) downloadCanvas(cv, baseName() + `-${safeName(key)}.png`) }
  }
  function exportAllLayers() {
    const lr = lastRef.current
    const inks = lr?.inks || lr?.layers
    if (!inks) return
    inks.filter(k => !disabledSet.has(k.key)).forEach((k, i) => setTimeout(() => {
      const cv = lr.layers ? lr.layers.find(l => l.key === k.key)?.canvas : getHtLayerCanvas(lr.inks.findIndex(x => x.key === k.key))
      if (cv) downloadCanvas(cv, baseName() + `-${safeName(k.name || k.key)}.png`)
    }, i * 250))
  }
  function baseName() { return (src?.name || 'dither').replace(/\.[^.]+$/, '') + '-dither' }

  // ── Sequence export ─────────────────────────────────────────────────────────
  function renderFrameToCanvas(f) {
    renderFrame(f.canvas, f.canvas.width, f.canvas.height, { quiet: true })
    return getResultCanvas()
  }
  async function exportGif() {
    if (!src) return
    setExporting('gif')
    try {
      const frames = seq ? seq.frames : [{ canvas: src.img, delay: 100 }]
      const canvases = [], delays = []
      for (const f of frames) { canvases.push(renderFrameToCanvas(f)); delays.push(f.delay || 100); await new Promise(r => setTimeout(r)) }
      const blob = await encodeGif(canvases, delays)
      if (blob) downloadBlob(blob, baseName() + '.gif')
    } finally {
      setExporting(null)
      if (seq) { const cf = seq.frames[frameIdx]; renderFrame(cf.canvas, cf.canvas.width, cf.canvas.height) }
    }
  }
  async function exportFramesZip() {
    if (!seq) return
    setExporting('frames')
    try {
      const canvases = []
      for (const f of seq.frames) { canvases.push(renderFrameToCanvas(f)); await new Promise(r => setTimeout(r)) }
      const blob = await framesToZip(canvases, baseName())
      downloadBlob(blob, baseName() + '-frames.zip')
    } finally {
      setExporting(null)
      const cf = seq.frames[frameIdx]; renderFrame(cf.canvas, cf.canvas.width, cf.canvas.height)
    }
  }

  // ── Motion loop export ──────────────────────────────────────────────────────
  // Samples the LFO loop at exactly fps×duration frames over one period — the
  // last frame leads back into the first, so GIF/video/frames loop seamlessly.
  async function renderMotionFrames(onFrame) {
    const st = getState()
    const fps = Math.max(1, Math.round(st.motionFps)), dur = Math.max(0.25, st.motionDur)
    const n = Math.max(2, Math.round(fps * dur))
    for (let i = 0; i < n; i++) {
      modRef.current = computeMods(st.lfos, i / n, st)
      renderFrame(src.img, src.w, src.h, { quiet: true, time: (i / fps) * (st.animSpeed || 1) })
      onFrame(getResultCanvas(), Math.round(1000 / fps), i, n)
      if (i % 4 === 3) await new Promise(r => setTimeout(r))
    }
    modRef.current = null
  }
  async function exportMotionGif() {
    if (!src || exporting) return
    setExporting('mgif')
    try {
      const canvases = [], delays = []
      await renderMotionFrames((cv, delay) => { canvases.push(cv); delays.push(delay) })
      const blob = await encodeGif(canvases, delays)
      if (blob) downloadBlob(blob, baseName() + '-loop.gif')
    } finally { modRef.current = null; setExporting(null); renderFrame(src.img, src.w, src.h) }
  }
  async function exportMotionFrames() {
    if (!src || exporting) return
    setExporting('mframes')
    try {
      const canvases = []
      await renderMotionFrames(cv => canvases.push(cv))
      const blob = await framesToZip(canvases, baseName() + '-loop')
      downloadBlob(blob, baseName() + '-loop-frames.zip')
    } finally { modRef.current = null; setExporting(null); renderFrame(src.img, src.w, src.h) }
  }
  // Record exactly one loop off the live canvas via MediaRecorder (same approach
  // as the Post FX tool's video export).
  function pickVideoMime() {
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    return (typeof MediaRecorder !== 'undefined' && types.find(t => MediaRecorder.isTypeSupported(t))) || null
  }
  async function exportMotionVideo() {
    const mime = pickVideoMime()
    if (!src || exporting || !mime) return
    setExporting('mvideo')
    try {
      const st = getState()
      const fps = Math.max(1, Math.round(st.motionFps)), dur = Math.max(0.25, st.motionDur)
      const stream = canvasRef.current.captureStream(fps)
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
      const chunks = []
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
      const stopped = new Promise(res => { rec.onstop = res })
      rec.start()
      const track = stream.getVideoTracks()[0]
      const n = Math.max(2, Math.round(fps * dur))
      await new Promise(resolve => {
        let i = 0
        const tickFrame = () => {
          modRef.current = computeMods(st.lfos, (i % n) / n, st)
          renderFrame(src.img, src.w, src.h, { quiet: true, time: (i / fps) * (st.animSpeed || 1) })
          if (track && track.requestFrame) track.requestFrame()
          if (++i > n) { resolve(); return }
          setTimeout(tickFrame, 1000 / fps)
        }
        tickFrame()
      })
      rec.stop()
      await stopped
      const ext = mime.includes('mp4') ? 'mp4' : 'webm'
      downloadBlob(new Blob(chunks, { type: mime }), baseName() + '-loop.' + ext)
    } finally { modRef.current = null; setExporting(null); renderFrame(src.img, src.w, src.h) }
  }

  // ── Palette / preset helpers ────────────────────────────────────────────────
  function saveIncoming() { if (incoming.length) { savePalette('From Color tool', incoming); clearIncomingColors(); setIncoming([]) } }
  function extractFromImage() { if (src) { const { W, H } = workingSize(src.w, src.h); savePalette('Image colours', extractPalette(rawImageData(src.img, W, H), Math.max(2, extractN))) } }
  function toggleLayer(key) { const set = new Set(s.htDisabled); set.has(key) ? set.delete(key) : set.add(key); setState({ htDisabled: [...set] }) }

  function randomize() {
    const a = ALGORITHMS[Math.floor(Math.random() * ALGORITHMS.length)].id
    const pals = palettes
    const p = pals[Math.floor(Math.random() * pals.length)]
    const shapes = ['square', 'round', 'diamond']
    setState({
      algorithm: a, paletteId: p.id, mode: Math.random() < 0.5 ? 'indexed' : 'mono',
      edgeShape: shapes[Math.floor(Math.random() * 3)],
      post: Math.random() < 0.5, glow: true, chroma: Math.random() < 0.4, crt: Math.random() < 0.3,
      halftone: false,
    })
  }

  const algoIdx = ALGORITHMS.findIndex(a => a.id === s.algorithm)
  const stepAlgo = d => setState({ algorithm: ALGORITHMS[(algoIdx + d + ALGORITHMS.length) % ALGORITHMS.length].id })
  const cursor = panRef.current ? 'grabbing' : space ? 'grab' : 'default'

  // ── Context menu actions ────────────────────────────────────────────────────
  const menuItems = [
    { label: 'Open / replace image…', icon: 'upload', fn: () => fileRef.current?.click() },
    src && { label: 'Copy result', icon: 'content_copy', fn: copyClipboard },
    src && { label: 'Save PNG', icon: 'download', fn: exportPng },
    src && svgAvailable() && { label: 'Save SVG', icon: 'download', fn: exportSvg },
    src && { label: 'Delete image', icon: 'delete', danger: true, fn: () => { setSrc(null); lastRef.current = null; if (glRef.current) { canvasRef.current.width = 1; canvasRef.current.height = 1 } } },
    { sep: true },
    { label: 'Fit to view', icon: 'image', fn: () => fitView(resultDims) },
    { label: '100%', fn: () => { const vp = viewportRef.current; setZoom(1); setPan({ x: (vp.clientWidth - resultDims.w) / 2, y: (vp.clientHeight - resultDims.h) / 2 }) } },
    { sep: true },
    { label: 'Randomize', icon: 'refresh', fn: randomize },
    { label: 'Reset all settings', icon: 'refresh', danger: true, fn: resetState },
  ].filter(Boolean)

  // ── Mode-aware control derivations ──────────────────────────────────────────
  const dither = !s.halftone
  const colourspaces = dither
    ? [['mono', 'Mono'], ['tonal', 'Tonal'], ['indexed', 'Indexed'], ['rgb', 'RGB']]
    : [['mono', 'Mono'], ['cmyk', 'CMYK'], ['palette', 'Palette']]
  const colourspaceVal = dither ? s.mode : s.inkMode
  const setColourspace = v => setState(dither ? { mode: v } : { inkMode: v })
  const usesPalette = dither ? s.mode !== 'rgb' : s.inkMode !== 'cmyk'

  return (
    <div style={{ display: 'flex', height: '100%', background: C.bg, color: C.text, fontFamily: 'system-ui, sans-serif', overflow: 'hidden' }}
      onClick={() => menu && setMenu(null)}>

      {/* ── Left: preview ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderBottom: `1px solid ${C.border}`, background: C.sidebar, flexShrink: 0 }}>
          <Btn icon="upload" label="Open image" onClick={() => fileRef.current?.click()} primary />
          <input ref={fileRef} type="file" accept="image/*,.gif" multiple style={{ display: 'none' }}
            onChange={e => { if (e.target.files?.length) loadFiles(e.target.files); e.target.value = '' }} />
          <Btn icon="grain" label="Debug" onClick={loadDebug} title="Load a halftone test pattern" />
          {src && <span style={{ fontSize: 11, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{src.name} · {src.w}×{src.h}</span>}
          <div style={{ flex: 1 }} />
          <IconToggle title="Undo (Ctrl+Z)" disabled={!canUndo()} onClick={undo}>↶</IconToggle>
          <IconToggle title="Redo (Ctrl+Y)" disabled={!canRedo()} onClick={redo}>↷</IconToggle>
          {layersMeta.length > 1 && (
            <div style={{ display: 'flex', gap: 2, background: C.ctrl, borderRadius: 6, padding: 2, marginLeft: 6 }}>
              {['result', 'separations'].map(v => (
                <button key={v} onClick={() => setView(v)} style={{ background: view === v ? C.accentLo : 'transparent', border: 'none', borderRadius: 4, color: view === v ? C.accent : C.muted, padding: '3px 10px', fontSize: 10, cursor: 'pointer', textTransform: 'capitalize' }}>{v}</button>
              ))}
            </div>
          )}
        </div>

        <div
          ref={viewportRef}
          onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onMouseDown={e => { if (e.button === 1) e.preventDefault() }}
          onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) loadFiles(e.dataTransfer.files) }}
          style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', cursor, background: dragOver ? C.accentLo : checkerBg(), backgroundSize: '20px 20px', outline: dragOver ? `2px dashed ${C.accent}` : 'none', outlineOffset: -8 }}
        >
          {!src && (
            <div style={{ textAlign: 'center', color: C.muted, pointerEvents: 'none' }}>
              <Icon name="image" size={48} color={C.border} />
              <div style={{ marginTop: 12, fontSize: 13 }}>Drop an image here, paste (Ctrl+V), or Open image</div>
            </div>
          )}

          <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', display: src && view === 'result' ? 'block' : 'none' }}>
            <canvas ref={canvasRef} style={{ display: 'block', imageRendering: (s.halftone || s.edgeShape !== 'square') ? 'auto' : 'pixelated', boxShadow: '0 0 0 1px rgba(255,255,255,0.06)' }} />
            {settled && previewUrl && <img src={previewUrl} alt="result" draggable={false} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', imageRendering: (s.halftone || s.edgeShape !== 'square') ? 'auto' : 'pixelated' }} />}
          </div>

          {src && view === 'separations' && layersMeta.length > 1 && (
            <div style={{ position: 'absolute', inset: 0, overflow: 'auto', padding: 16, display: 'flex', flexWrap: 'wrap', gap: 14, alignContent: 'flex-start', justifyContent: 'center' }}>
              {layersMeta.map(l => {
                const off = disabledSet.has(l.key)
                return (
                  <div key={l.key} style={{ textAlign: 'center', opacity: off ? 0.4 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 }}>
                      <span style={{ width: 12, height: 12, borderRadius: 3, background: l.colorCss, border: '1px solid rgba(255,255,255,0.2)' }} />
                      <span style={{ fontSize: 10, color: C.muted }}>{l.name} · {l.angle}°</span>
                    </div>
                    <img src={layerUrls[l.key]} alt={l.name} style={{ maxWidth: 220, maxHeight: 220, background: '#fff', imageRendering: 'auto', display: 'block' }} />
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 6 }}>
                      <MiniBtn onClick={() => toggleLayer(l.key)} accent={!off}>{off ? 'Show' : 'Hide'}</MiniBtn>
                      <MiniBtn onClick={() => exportSeparation(l.key)}>Export</MiniBtn>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {src && view === 'result' && (
            <>
              <div style={{ position: 'absolute', bottom: 10, left: 10, display: 'flex', gap: 4, alignItems: 'center', background: 'rgba(8,8,10,0.8)', borderRadius: 6, padding: 4, border: `1px solid ${C.border}` }}>
                <ZoomBtn onClick={() => fitView(resultDims)}>Fit</ZoomBtn>
                <ZoomBtn onClick={() => { const vp = viewportRef.current; setZoom(1); setPan({ x: (vp.clientWidth - resultDims.w) / 2, y: (vp.clientHeight - resultDims.h) / 2 }) }}>1:1</ZoomBtn>
                <span style={{ fontSize: 10, color: C.muted, minWidth: 38, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{Math.round(zoom * 100)}%</span>
                {!glRef.current && <span style={{ fontSize: 9, color: '#c47' }}>CPU</span>}
              </div>
              <div style={{ position: 'absolute', bottom: 10, right: 10, fontSize: 9, color: C.muted, background: 'rgba(8,8,10,0.7)', borderRadius: 5, padding: '3px 7px', pointerEvents: 'none' }}>Space / middle-drag to pan · scroll to zoom · right-click for menu</div>
            </>
          )}
        </div>

        {/* Sequence timeline */}
        {seq && seq.frames.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderTop: `1px solid ${C.border}`, background: C.sidebar, flexShrink: 0 }}>
            <button onClick={() => setPlaying(p => !p)} style={{ background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, padding: '4px 10px', fontSize: 11, cursor: 'pointer', minWidth: 56 }}>{playing ? 'Pause' : 'Play'}</button>
            <input type="range" min={0} max={seq.frames.length - 1} value={frameIdx} onChange={e => { setPlaying(false); setFrameIdx(+e.target.value) }} style={{ flex: 1, accentColor: ACC }} />
            <span style={{ fontSize: 10, color: C.muted, minWidth: 54, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{frameIdx + 1} / {seq.frames.length}</span>
            <Btn icon="download" label={exporting === 'gif' ? 'GIF…' : 'GIF'} onClick={exportGif} disabled={!!exporting} />
            <Btn icon="download" label={exporting === 'frames' ? 'ZIP…' : 'Frames'} onClick={exportFramesZip} disabled={!!exporting} />
          </div>
        )}
      </div>

      {/* ── Right: controls ── */}
      <div style={{ width: 322, flexShrink: 0, background: C.sidebar, borderLeft: `1px solid ${C.border}`, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>

        {incoming.length > 0 && (
          <div style={{ margin: 12, padding: 10, borderRadius: 8, background: C.accentLo, border: `1px solid ${C.accent}` }}>
            <div style={{ fontSize: 11, color: C.accent, marginBottom: 6 }}>{incoming.length} colours from Color Palette</div>
            <div style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'wrap' }}>{incoming.map((c, i) => <span key={i} style={{ width: 16, height: 16, borderRadius: 3, background: c, border: '1px solid rgba(255,255,255,0.15)' }} />)}</div>
            <div style={{ display: 'flex', gap: 6 }}><MiniBtn onClick={saveIncoming} accent>Save as palette</MiniBtn><MiniBtn onClick={() => { clearIncomingColors(); setIncoming([]) }}>Dismiss</MiniBtn></div>
          </div>
        )}

        <div style={{ padding: '4px 14px 24px' }}>

          {/* ── Mode switch ── */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: C.ctrl, borderRadius: 8, padding: 4 }}>
            {[['dither', 'Dither'], ['halftone', 'Halftone']].map(([m, lbl]) => {
              const on = (m === 'halftone') === s.halftone
              return (
                <button key={m} onClick={() => setState({ halftone: m === 'halftone' })} style={{
                  flex: 1, background: on ? C.accent : 'transparent', border: 'none', borderRadius: 6,
                  color: on ? '#fff' : C.muted, padding: '7px 0', fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.02em',
                }}>{lbl}</button>
              )
            })}
          </div>

          <Section title="Presets"><PresetStrip s={s} /></Section>

          {/* ── INPUT ── */}
          <Section title="Input">
            {dither && (
              <div>
                <Row label="Sizing"><Seg options={[['detail', 'Detail'], ['pixel', 'Pixel size']]} value={s.sizeMode} onChange={v => setState({ sizeMode: v })} /></Row>
                {s.sizeMode === 'pixel'
                  ? <NumberSlider label="Pixel size" min={1} max={32} step={1} value={s.pixelSize} onChange={v => setState({ pixelSize: v })} accent={ACC} suffix="px" labelWidth={70} />
                  : <NumberSlider label="Detail / res" min={32} max={1024} step={8} value={s.resolution} onChange={v => setState({ resolution: v })} accent={ACC} suffix="px" labelWidth={70} />}
                <Row label="Resampling"><Seg options={[['nearest', 'Crisp'], ['bilinear', 'Smooth']]} value={s.resample} onChange={v => setState({ resample: v })} /></Row>
                <div style={{ fontSize: 9, color: C.muted, margin: '10px 0 4px' }}>Dither algorithm</div>
                <div onWheel={e => { e.preventDefault(); stepAlgo(e.deltaY > 0 ? 1 : -1) }} style={{ display: 'flex', gap: 4, alignItems: 'center' }} title="Scroll or ‹ › to flip through — preview updates live">
                  <StepBtn onClick={() => stepAlgo(-1)}>‹</StepBtn>
                  <select value={s.algorithm} onChange={e => setState({ algorithm: e.target.value })} style={{ ...selectStyle, flex: 1 }}>
                    {Object.entries(ALGO_GROUPS).map(([group, items]) => <optgroup key={group} label={group}>{items.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</optgroup>)}
                  </select>
                  <StepBtn onClick={() => stepAlgo(1)}>›</StepBtn>
                </div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>{algoIdx + 1} / {ALGORITHMS.length} · {ALGORITHMS[algoIdx]?.group}</div>
                {isOrdered(s.algorithm)
                  ? <div style={{ marginTop: 8 }}><NumberSlider label="Spread" min={0} max={1} step={0.01} value={s.spread} onChange={v => setState({ spread: v })} accent={ACC} /></div>
                  : !isCurve(s.algorithm) && <div style={{ marginTop: 8 }}><NumberSlider label="Strength" min={0} max={1} step={0.01} value={s.strength} onChange={v => setState({ strength: v })} accent={ACC} /></div>}
                {!isOrdered(s.algorithm) && !isCurve(s.algorithm) && <Toggle label="Serpentine scan" checked={s.serpentine} onChange={v => setState({ serpentine: v })} />}
                {isOrdered(s.algorithm) && isMatrixOrdered(s.algorithm) && (
                  <>
                    <NumberSlider label="Jitter" min={0} max={1} step={0.02} value={s.jitter} onChange={v => setState({ jitter: v })} accent={ACC} labelWidth={70} />
                    <Toggle label="Animate screen (shimmer)" checked={s.phaseAnim} onChange={v => setState({ phaseAnim: v })} />
                  </>
                )}
              </div>
            )}

            {!dither && (
              <div>
                <Row label="Screen"><select value={s.htAlgo} onChange={e => setState({ htAlgo: e.target.value })} style={{ ...selectStyle, width: 130 }}>{HT_ALGOS.map(a => <option key={a} value={a}>{a}</option>)}</select></Row>
                <NumberSlider label="DPI" min={20} max={300} step={1} value={s.htDpi} onChange={v => setState({ htDpi: v })} accent={ACC} labelWidth={70} />
                <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>≈ {s.htDpi} dots across · higher = finer</div>
                <NumberSlider label="Tone γ" min={0.3} max={2.5} step={0.05} value={s.htGamma} onChange={v => setState({ htGamma: v })} accent={ACC} labelWidth={70} />
                <NumberSlider label="Dot size" min={0.3} max={1.3} step={0.01} value={s.htDotSize} onChange={v => setState({ htDotSize: v })} accent={ACC} labelWidth={70} />
                <div style={{ fontSize: 9, color: C.muted, margin: '10px 0 2px' }}>Print feel</div>
                <NumberSlider label="Dot gain" min={0} max={1} step={0.02} value={s.htDotGain} onChange={v => setState({ htDotGain: v })} accent={ACC} labelWidth={70} />
                <NumberSlider label="Paper grain" min={0} max={1} step={0.02} value={s.htPaperGrain} onChange={v => setState({ htPaperGrain: v })} accent={ACC} labelWidth={70} />
                {s.inkMode !== 'mono' && <NumberSlider label="Misregister" min={0} max={1} step={0.02} value={s.htReg} onChange={v => setState({ htReg: v })} accent={ACC} labelWidth={70} />}
                {s.inkMode !== 'mono' && <NumberSlider label="Freq vary" min={0} max={1} step={0.02} value={s.htFreqVary} onChange={v => setState({ htFreqVary: v })} accent={ACC} labelWidth={70} />}
                {s.inkMode === 'mono' && <Row label="Angle"><select value={s.htAngle} onChange={e => setState({ htAngle: +e.target.value })} style={{ ...selectStyle, width: 120 }}>{[0, 7.5, 15, 22.5, 30, 45, 60, 75].map(a => <option key={a} value={a}>{a}°</option>)}</select></Row>}
                {s.inkMode === 'cmyk' && <div style={{ marginTop: 6 }}><div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>Screen angles</div>{[['C', 'angC'], ['M', 'angM'], ['Y', 'angY'], ['K', 'angK']].map(([lbl, key]) => <NumberSlider key={key} label={lbl} min={0} max={90} step={0.5} value={s[key]} onChange={v => setState({ [key]: v })} accent={ACC} suffix="°" />)}</div>}
              </div>
            )}
          </Section>

          {/* ── EFFECT CONTROLS ── */}
          <Section title="Effect controls">
            <NumberSlider label="Brightness" min={-100} max={100} step={1} value={s.brightness} onChange={v => setState({ brightness: v })} accent={ACC} />
            <NumberSlider label="Contrast" min={-100} max={100} step={1} value={s.contrast} onChange={v => setState({ contrast: v })} accent={ACC} />
            <NumberSlider label="Blur" min={0} max={8} step={0.1} value={s.blur} onChange={v => setState({ blur: v })} accent={ACC} suffix="px" />
            <NumberSlider label="Sharpen" min={0} max={1} step={0.05} value={s.sharpen} onChange={v => setState({ sharpen: v })} accent={ACC} />
            <NumberSlider label="Denoise ◂▸ Noise" min={-1} max={1} step={0.02} value={s.denoise} onChange={v => setState({ denoise: v })} accent={ACC} labelWidth={96} />
            <div style={{ height: 8 }} />
            <NumberSlider label="Black point" min={0} max={1} step={0.01} value={s.levelsLow} onChange={v => setState({ levelsLow: Math.min(v, s.levelsHigh - 0.02) })} accent={ACC} labelWidth={70} />
            <NumberSlider label="White point" min={0} max={1} step={0.01} value={s.levelsHigh} onChange={v => setState({ levelsHigh: Math.max(v, s.levelsLow + 0.02) })} accent={ACC} labelWidth={70} />
            <NumberSlider label="Gamma" min={0.2} max={3} step={0.02} value={s.levelsGamma} onChange={v => setState({ levelsGamma: v })} accent={ACC} labelWidth={70} />
            <NumberSlider label="Posterize" min={0} max={16} step={1} value={s.posterize} onChange={v => setState({ posterize: v })} accent={ACC} labelWidth={70} />
          </Section>

          {/* ── COLOUR ── */}
          <Section title="Colour">
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {colourspaces.map(([m, lbl]) => (
                <button key={m} onClick={() => setColourspace(m)} style={{ flex: 1, background: colourspaceVal === m ? C.accentLo : C.ctrl, border: `1px solid ${colourspaceVal === m ? C.accent : C.border}`, borderRadius: 5, color: colourspaceVal === m ? C.accent : C.muted, padding: '5px 0', fontSize: 10, cursor: 'pointer' }}>{lbl}</button>
              ))}
            </div>
            {dither && (s.mode === 'tonal' || s.mode === 'rgb') && <NumberSlider label={s.mode === 'rgb' ? 'Levels / ch' : 'Tones'} min={2} max={s.mode === 'rgb' ? 8 : 16} step={1} value={s.levels} onChange={v => setState({ levels: v })} accent={ACC} />}
            {!dither && s.inkMode === 'cmyk' && <div style={{ fontSize: 9, color: C.muted, margin: '0 0 6px' }}>Process separation — the photographic look. Each channel screens into a rosette.</div>}
            {!dither && s.inkMode === 'palette' && <div style={{ fontSize: 9, color: C.muted, margin: '0 0 6px' }}>One screen per palette colour. Use “From image” to pull inks from the photo.</div>}
            <NumberSlider label="Hue" min={-180} max={180} step={1} value={s.hue} onChange={v => setState({ hue: v })} accent={ACC} suffix="°" />
            <NumberSlider label="Saturation" min={-100} max={100} step={1} value={s.saturation} onChange={v => setState({ saturation: v })} accent={ACC} />
            <Toggle label="Invert" checked={s.invert} onChange={v => setState({ invert: v })} />
            <Toggle label="Gradient map (luma → palette)" checked={s.gradMap} onChange={v => setState({ gradMap: v })} />
            {s.gradMap && <GradMapEditor colors={sortByLuma(palette.colors)} stops={s.gradStops} />}
            {usesPalette && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>{dither ? 'Palette' : 'Inks'}</div>
                <PaletteManager s={s} palettes={palettes} palette={palette} />
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
                  <Btn icon="palette" label="From image" onClick={extractFromImage} disabled={!src} />
                  <EditableNumber value={extractN} min={2} max={32} step={1} onChange={setExtractN} accent={ACC} width={34} />
                  <span style={{ fontSize: 9, color: C.muted }}>colours</span>
                </div>
              </div>
            )}
          </Section>

          {/* ── REGION MASK ── */}
          <Section title="Region mask">
            <Toggle label="Limit the effect" checked={s.maskOn} onChange={v => setState({ maskOn: v })} />
            {s.maskOn && (
              <div style={{ marginTop: 6 }}>
                <Row label="Target"><Seg options={[['luma', 'Tone band'], ['subject', 'Subject']]} value={s.maskMode} onChange={v => setState({ maskMode: v })} /></Row>
                {s.maskMode === 'subject' ? (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>Affects areas whose tone differs from the background (corners) — rough subject isolation.</div>
                    <NumberSlider label="Sensitivity" min={0} max={1} step={0.01} value={s.maskLo} onChange={v => setState({ maskLo: v })} accent={ACC} labelWidth={70} />
                  </div>
                ) : (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>Affects only this luminance range — the rest shows through.</div>
                    <NumberSlider label="Low" min={0} max={1} step={0.01} value={s.maskLo} onChange={v => setState({ maskLo: Math.min(v, s.maskHi - 0.02) })} accent={ACC} labelWidth={70} />
                    <NumberSlider label="High" min={0} max={1} step={0.01} value={s.maskHi} onChange={v => setState({ maskHi: Math.max(v, s.maskLo + 0.02) })} accent={ACC} labelWidth={70} />
                  </div>
                )}
                <NumberSlider label="Feather" min={0} max={0.5} step={0.01} value={s.maskFeather} onChange={v => setState({ maskFeather: v })} accent={ACC} labelWidth={70} />
                <Toggle label="Invert" checked={s.maskInvert} onChange={v => setState({ maskInvert: v })} />
                <Toggle label="Keep raw original (ignore adjustments)" checked={s.maskRaw} onChange={v => setState({ maskRaw: v })} />
              </div>
            )}
          </Section>

          {/* ── OUTPUT ── */}
          <Section title="Output">
            {dither && (
              <>
                <Row label="Edges"><Seg options={[['square', 'Pixel'], ['round', 'Round'], ['diamond', 'Diamond']]} value={s.edgeShape} onChange={v => setState({ edgeShape: v })} /></Row>
                {s.edgeShape !== 'square' && <Row label="Gap fill"><input type="color" value={s.gapColor} onChange={e => setState({ gapColor: e.target.value })} style={{ width: 40, height: 22, background: 'none', border: `1px solid ${C.border}`, borderRadius: 4 }} /></Row>}
              </>
            )}
            {!dither && (
              <>
                <Row label="Paper">
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {!s.paperTransparent && <input type="color" value={s.paperColor} onChange={e => setState({ paperColor: e.target.value })} style={{ width: 34, height: 22, background: 'none', border: `1px solid ${C.border}`, borderRadius: 4 }} />}
                    <MiniBtn accent={s.paperTransparent} onClick={() => setState({ paperTransparent: !s.paperTransparent })}>Transparent</MiniBtn>
                  </div>
                </Row>
                {layersMeta.length > 1 && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 9, color: C.muted, marginBottom: 6 }}>Layers ({layersMeta.filter(l => !disabledSet.has(l.key)).length}/{layersMeta.length} on)</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {layersMeta.map(l => {
                        const off = disabledSet.has(l.key)
                        return (
                          <button key={l.key} onClick={() => toggleLayer(l.key)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: C.ctrl, border: `1px solid ${off ? C.border : C.accent}`, borderRadius: 5, color: off ? C.muted : C.text, padding: '4px 8px', fontSize: 10, cursor: 'pointer', opacity: off ? 0.6 : 1 }}>
                            <span style={{ width: 12, height: 12, borderRadius: 3, background: l.colorCss, border: '1px solid rgba(255,255,255,0.2)', flexShrink: 0 }} />
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
                            <span style={{ fontSize: 9, color: C.muted }}>{l.angle}°</span>
                            <Icon name={off ? 'close' : 'check_circle'} size={12} color={off ? C.muted : C.accent} />
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
            <div style={{ height: 8 }} />
            {dither && <Row label="PNG scale"><NumberSlider min={1} max={8} step={1} value={exportScale} onChange={setExportScale} accent={ACC} suffix="×" labelWidth={0} /></Row>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
              <Btn icon="download" label="PNG" onClick={exportPng} disabled={!src} />
              <Btn icon="download" label="SVG" onClick={exportSvg} disabled={!src || !svgAvailable()} title={svgAvailable() ? 'Vector export' : 'SVG: turn off post FX / use halftone or an ordered algorithm'} />
              <Btn icon="content_copy" label="Copy" onClick={copyClipboard} disabled={!src} />
              <Btn icon="send" label="Send to Post FX" onClick={sendToPostFX} disabled={!src} title="Hand the current result to the Post FX tool" />
            </div>
            {!dither && layersMeta.length > 1 && <div style={{ marginTop: 6 }}><Btn icon="download" label="Export each layer (PNG)" onClick={exportAllLayers} disabled={!src} /></div>}
          </Section>

          {/* ── POST ── */}
          <Section title="Post-processing">
            <Toggle label="Enable post FX" checked={s.post} onChange={v => setState({ post: v })} />
            {!glRef.current && s.post && <div style={{ fontSize: 9, color: '#c47', marginTop: 4 }}>Needs WebGL — unavailable, post FX skipped.</div>}
            {s.post && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <FxBlock label="Glow / Bloom" on={s.glow} onToggle={v => setState({ glow: v })}>
                  <NumberSlider label="Intensity" min={0} max={2} step={0.05} value={s.glowAmt} onChange={v => setState({ glowAmt: v })} accent={ACC} />
                  <NumberSlider label="Threshold" min={0} max={1} step={0.02} value={s.glowThreshold} onChange={v => setState({ glowThreshold: v })} accent={ACC} />
                  <Row label="Tint"><input type="color" value={s.glowTint} onChange={e => setState({ glowTint: e.target.value })} style={{ width: 40, height: 22, background: 'none', border: `1px solid ${C.border}`, borderRadius: 4 }} /></Row>
                </FxBlock>
                <FxBlock label="CRT / Scanlines" on={s.crt} onToggle={v => setState({ crt: v })}>
                  <NumberSlider label="Scanlines" min={0} max={1} step={0.02} value={s.scan} onChange={v => setState({ scan: v })} accent={ACC} />
                  <NumberSlider label="Count" min={80} max={600} step={10} value={s.scanCount} onChange={v => setState({ scanCount: v })} accent={ACC} />
                  <NumberSlider label="Curve" min={0} max={1} step={0.02} value={s.curve} onChange={v => setState({ curve: v })} accent={ACC} />
                  <NumberSlider label="Vignette" min={0} max={1} step={0.02} value={s.vignette} onChange={v => setState({ vignette: v })} accent={ACC} />
                  <Row label="Mask"><Seg options={[['none', 'Off'], ['aperture', 'Grille'], ['shadow', 'Shadow']]} value={s.crtMask} onChange={v => setState({ crtMask: v })} /></Row>
                  {s.crtMask !== 'none' && <NumberSlider label="Mask amt" min={0} max={1} step={0.02} value={s.crtMaskAmt} onChange={v => setState({ crtMaskAmt: v })} accent={ACC} labelWidth={70} />}
                </FxBlock>
                <FxBlock label="Chromatic aberration" on={s.chroma} onToggle={v => setState({ chroma: v })}>
                  <NumberSlider label="Amount" min={0} max={4} step={0.05} value={s.chromaAmt} onChange={v => setState({ chromaAmt: v })} accent={ACC} />
                </FxBlock>
                <FxBlock label="Anamorphic streaks" on={s.streak} onToggle={v => setState({ streak: v })}>
                  <NumberSlider label="Intensity" min={0} max={2} step={0.05} value={s.streakAmt} onChange={v => setState({ streakAmt: v })} accent={ACC} />
                  <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>Horizontal lens flares from highlights — tinted by the Glow tint.</div>
                </FxBlock>
                <FxBlock label="Ink outline (edges)" on={s.edge} onToggle={v => setState({ edge: v })}>
                  <NumberSlider label="Strength" min={0} max={1} step={0.02} value={s.edgeAmt} onChange={v => setState({ edgeAmt: v })} accent={ACC} />
                  <NumberSlider label="Threshold" min={0} max={1} step={0.02} value={s.edgeThresh} onChange={v => setState({ edgeThresh: v })} accent={ACC} labelWidth={70} />
                  <Row label="Colour"><input type="color" value={s.edgeColor} onChange={e => setState({ edgeColor: e.target.value })} style={{ width: 40, height: 22, background: 'none', border: `1px solid ${C.border}`, borderRadius: 4 }} /></Row>
                </FxBlock>
                <FxBlock label="Wave / warp" on={s.wave} onToggle={v => setState({ wave: v })}>
                  <NumberSlider label="Amount" min={0} max={1} step={0.02} value={s.waveAmt} onChange={v => setState({ waveAmt: v })} accent={ACC} />
                  <NumberSlider label="Frequency" min={1} max={40} step={1} value={s.waveFreq} onChange={v => setState({ waveFreq: v })} accent={ACC} labelWidth={70} />
                  <Row label="Axis"><Seg options={[['h', 'Horiz'], ['v', 'Vert'], ['both', 'Both']]} value={s.waveAxis} onChange={v => setState({ waveAxis: v })} /></Row>
                </FxBlock>
                <FxBlock label="VHS / analog" on={s.vhs} onToggle={v => setState({ vhs: v })}>
                  <NumberSlider label="Amount" min={0} max={1} step={0.02} value={s.vhsAmt} onChange={v => setState({ vhsAmt: v })} accent={ACC} />
                  <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>Tape wobble, chroma bleed, snow + head-switch tear. Best animated.</div>
                </FxBlock>
                <FxBlock label="Glitch / Signal" on={s.glitch} onToggle={v => setState({ glitch: v })}>
                  <NumberSlider label="Amount" min={0} max={1} step={0.02} value={s.glitchAmt} onChange={v => setState({ glitchAmt: v })} accent={ACC} />
                </FxBlock>
                <FxBlock label="Film grain" on={s.grain} onToggle={v => setState({ grain: v })}>
                  <NumberSlider label="Amount" min={0} max={1} step={0.02} value={s.grainAmt} onChange={v => setState({ grainAmt: v })} accent={ACC} />
                  <NumberSlider label="Size" min={1} max={6} step={0.5} value={s.grainSize} onChange={v => setState({ grainSize: v })} accent={ACC} suffix="px" />
                </FxBlock>
                <FxBlock label="Colour grade" on={s.grade} onToggle={v => setState({ grade: v })}>
                  <NumberSlider label="Temp" min={-100} max={100} step={1} value={s.temp} onChange={v => setState({ temp: v })} accent={ACC} />
                  <NumberSlider label="Tint" min={-100} max={100} step={1} value={s.tint} onChange={v => setState({ tint: v })} accent={ACC} />
                </FxBlock>
                {(s.glitch || s.grain || s.vhs || s.wave) && (
                  <FxBlock label="Animate (glitch · grain · warp · VHS)" on={s.animate} onToggle={v => setState({ animate: v })}>
                    <NumberSlider label="Speed" min={0.1} max={4} step={0.1} value={s.animSpeed} onChange={v => setState({ animSpeed: v })} accent={ACC} suffix="×" />
                    <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>Live preview only — export still captures a single frame.</div>
                  </FxBlock>
                )}
              </div>
            )}
          </Section>

          {/* ── MOTION ── */}
          <Section title="Motion · seamless loop">
            <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>
              Modulators animate settings around their current values. Integer cycles per loop — every export loops perfectly.
            </div>
            <Toggle label="Play motion" checked={sBase.motionPlay} onChange={v => setState({ motionPlay: v })} />
            <NumberSlider label="Loop length" min={0.5} max={10} step={0.5} value={sBase.motionDur} onChange={v => setState({ motionDur: v })} accent={ACC} suffix="s" labelWidth={70} />
            <NumberSlider label="FPS" min={5} max={60} step={1} value={sBase.motionFps} onChange={v => setState({ motionFps: v })} accent={ACC} labelWidth={70} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {sBase.lfos.map(lfo => <LfoBlock key={lfo.id} lfo={lfo} halftone={sBase.halftone} />)}
            </div>
            <div style={{ marginTop: 8 }}>
              <Btn icon="add" label="Add modulator" onClick={() => setState({ lfos: [...getState().lfos, mkLfo(sBase.halftone ? 'htDotSize' : 'hue')] })} />
            </div>
            {sBase.lfos.length > 0 && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  <Btn icon="download" label={exporting === 'mgif' ? 'GIF…' : 'Loop GIF'} onClick={exportMotionGif} disabled={!src || !!exporting} />
                  <Btn icon="videocam" label={exporting === 'mvideo' ? 'Video…' : (pickVideoMime() ? 'Video' : 'No video')} onClick={exportMotionVideo} disabled={!src || !!exporting || !pickVideoMime()} />
                  <Btn icon="download" label={exporting === 'mframes' ? 'ZIP…' : 'Frames'} onClick={exportMotionFrames} disabled={!src || !!exporting} />
                </div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 6 }}>
                  Exports one loop ({Math.round(Math.max(1, sBase.motionFps) * Math.max(0.25, sBase.motionDur))} frames). Glitch / grain / VHS noise re-rolls per frame, so it reads seamless too.
                </div>
              </>
            )}
          </Section>

        </div>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  )
}

// ── Preset strip ────────────────────────────────────────────────────────────────
// Mirrors the algorithm picker: grouped dropdown + ‹ › steppers + scroll-wheel,
// with a "N / total · group" counter underneath.
function PresetStrip({ s }) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')

  const all = [...BUILTIN_PRESETS, ...s.savedPresets]
  const idx = all.findIndex(p => p.id === s.presetId)
  const current = idx >= 0 ? all[idx] : null
  const curGroup = current ? (current.group || 'Saved') : null

  // Build grouped <optgroup>s preserving builtin group order, then saved presets.
  const groups = []
  for (const p of BUILTIN_PRESETS) {
    let g = groups.find(x => x.label === (p.group || 'Other'))
    if (!g) { g = { label: p.group || 'Other', items: [] }; groups.push(g) }
    g.items.push(p)
  }
  if (s.savedPresets.length) groups.push({ label: 'Saved', items: s.savedPresets })

  const step = d => {
    if (!all.length) return
    const base = idx < 0 ? 0 : (idx + d + all.length) % all.length
    applyPreset(all[base])
  }

  return (
    <div>
      <div onWheel={e => { e.preventDefault(); step(e.deltaY > 0 ? 1 : -1) }}
        style={{ display: 'flex', gap: 4, alignItems: 'center' }}
        title="Scroll or ‹ › to flip through — preview updates live">
        <StepBtn onClick={() => step(-1)}>‹</StepBtn>
        <select value={s.presetId || ''} onChange={e => { const p = all.find(x => x.id === e.target.value); if (p) applyPreset(p) }} style={{ ...selectStyle, flex: 1 }}>
          {!current && <option value="">— Custom —</option>}
          {groups.map(g => <optgroup key={g.label} label={g.label}>{g.items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
        </select>
        <StepBtn onClick={() => step(1)}>›</StepBtn>
      </div>
      <div style={{ fontSize: 9, color: C.muted, marginTop: 4 }}>
        {current ? `${idx + 1} / ${all.length} · ${curGroup}` : `Custom · ${all.length} presets`}
      </div>

      {naming ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Preset name…"
            onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { saveCurrentPreset(name.trim()); setNaming(false); setName('') } }}
            style={{ flex: 1, background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '3px 6px', fontSize: 10, outline: 'none' }} />
          <MiniBtn accent onClick={() => { if (name.trim()) { saveCurrentPreset(name.trim()); setNaming(false); setName('') } }}>Save</MiniBtn>
          <MiniBtn onClick={() => setNaming(false)}>×</MiniBtn>
        </div>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <MiniBtn onClick={() => setNaming(true)}>+ Save current as preset</MiniBtn>
          {current && s.savedPresets.some(sp => sp.id === current.id) && <MiniBtn danger onClick={() => removeSavedPreset(current.id)}>Delete</MiniBtn>}
        </div>
      )}
    </div>
  )
}

// ── Motion modulator row ────────────────────────────────────────────────────────
// One LFO: which setting it drives, its wave, cycles per loop, depth and phase.
// Spin (full-period sweep) is only offered for cyclic parameters.
function LfoBlock({ lfo, halftone }) {
  const def = PARAM_BY_KEY[lfo.param]
  const upd = patch => setState({ lfos: getState().lfos.map(l => l.id === lfo.id ? { ...l, ...patch } : l) })
  const del = () => setState({ lfos: getState().lfos.filter(l => l.id !== lfo.id) })
  const groups = []
  for (const p of MOTION_PARAMS) {
    let g = groups.find(x => x.label === p.group)
    if (!g) { g = { label: p.group, items: [] }; groups.push(g) }
    g.items.push(p)
  }
  const waves = WAVES.filter(([id]) => id !== 'spin' || def?.cyclic)
  const wrongMode = def && ((def.group === 'Halftone' && !halftone) || (def.group === 'Dither' && halftone))
  return (
    <div style={{ border: `1px solid ${lfo.on ? C.accent : C.border}`, borderRadius: 6, padding: '6px 8px', background: C.ctrl }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 34, flexShrink: 0, marginTop: -8 }}><Toggle label="" checked={lfo.on} onChange={v => upd({ on: v })} /></div>
        <select value={lfo.param} onChange={e => { const d = PARAM_BY_KEY[e.target.value]; upd({ param: e.target.value, wave: lfo.wave === 'spin' && !d?.cyclic ? 'sine' : lfo.wave }) }} style={{ ...selectStyle, flex: 1 }}>
          {groups.map(g => <optgroup key={g.label} label={g.label}>{g.items.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}</optgroup>)}
        </select>
        <button onClick={del} title="Remove modulator" style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', display: 'flex', padding: 2 }}>
          <Icon name="delete" size={13} />
        </button>
      </div>
      {wrongMode && <div style={{ fontSize: 9, color: '#c47', marginTop: 4 }}>This setting only applies in {def.group} mode.</div>}
      {lfo.on && (
        <div style={{ marginTop: 6 }}>
          <Row label="Wave"><select value={lfo.wave} onChange={e => upd({ wave: e.target.value })} style={{ ...selectStyle, width: 110 }}>{waves.map(([id, lbl]) => <option key={id} value={id}>{lbl}</option>)}</select></Row>
          <NumberSlider label="Cycles / loop" min={1} max={8} step={1} value={lfo.cycles} onChange={v => upd({ cycles: Math.round(v) })} accent={ACC} labelWidth={70} />
          {lfo.wave !== 'spin' && <NumberSlider label="Depth" min={0} max={100} step={1} value={lfo.depth} onChange={v => upd({ depth: v })} accent={ACC} suffix="%" labelWidth={70} />}
          <NumberSlider label="Phase" min={0} max={360} step={5} value={lfo.phase} onChange={v => upd({ phase: v })} accent={ACC} suffix="°" labelWidth={70} />
          {lfo.wave === 'noise' && <div style={{ marginTop: 6 }}><MiniBtn onClick={() => upd({ seed: (Math.random() * 0xffffff) | 0 })}>Reroll noise</MiniBtn></div>}
        </div>
      )}
    </div>
  )
}

// ── Context menu ──────────────────────────────────────────────────────────────
function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null)
  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) })
  }, [x, y])
  return (
    <div ref={ref} style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 1000, background: '#15151a', border: `1px solid ${C.border}`, borderRadius: 8, padding: 4, minWidth: 180, boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}
      onClick={e => e.stopPropagation()}>
      {items.map((it, i) => it.sep
        ? <div key={i} style={{ height: 1, background: C.border, margin: '4px 6px' }} />
        : <button key={i} onClick={() => { it.fn(); onClose() }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderRadius: 5, color: it.danger ? '#ff5070' : C.text, padding: '6px 8px', fontSize: 11, cursor: 'pointer' }}
            onMouseEnter={e => e.currentTarget.style.background = C.ctrl} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            {it.icon ? <Icon name={it.icon} size={13} /> : <span style={{ width: 13 }} />}{it.label}
          </button>)}
    </div>
  )
}

// ── Palette manager ─────────────────────────────────────────────────────────────
function PaletteManager({ s, palettes, palette }) {
  const isSaved = s.savedPalettes.some(p => p.id === s.paletteId)
  return (
    <div>
      <select value={s.paletteId} onChange={e => setState({ paletteId: e.target.value })} style={selectStyle}>
        <optgroup label="Built-in">{palettes.filter(p => !s.savedPalettes.some(sp => sp.id === p.id)).map(p => <option key={p.id} value={p.id}>{p.name} ({p.colors.length})</option>)}</optgroup>
        {s.savedPalettes.length > 0 && <optgroup label="Saved">{s.savedPalettes.map(p => <option key={p.id} value={p.id}>{p.name} ({p.colors.length})</option>)}</optgroup>}
      </select>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 8 }}>{palette.colors.map((c, i) => <span key={i} title={c} style={{ width: 20, height: 20, borderRadius: 4, background: c, border: '1px solid rgba(255,255,255,0.12)' }} />)}</div>
      {isSaved && <div style={{ display: 'flex', gap: 6, marginTop: 8 }}><input defaultValue={palette.name} onBlur={e => updateSavedPalette(s.paletteId, { name: e.target.value })} style={{ flex: 1, background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '3px 6px', fontSize: 10, outline: 'none' }} /><MiniBtn danger onClick={() => removeSavedPalette(s.paletteId)}>Delete</MiniBtn></div>}
    </div>
  )
}

// ── Gradient editor: tonal position + per-ink strength/spread ───────────────────
function GradientEditor({ inks }) {
  const [sel, setSel] = useState(inks[0]?.key)
  const barRef = useRef(null)
  const drag = useRef(null)
  const onMove = e => {
    if (!drag.current || !barRef.current) return
    const r = barRef.current.getBoundingClientRect()
    let x = (e.clientX - r.left) / r.width
    setInkCtl(drag.current, { pos: Math.max(0, Math.min(1, x)) })
  }
  const end = () => { drag.current = null }
  const selInk = inks.find(i => i.key === sel) || inks[0]
  return (
    <div>
      <div ref={barRef} onPointerMove={onMove} onPointerUp={end} onPointerLeave={end}
        style={{ position: 'relative', height: 30, borderRadius: 6, border: `1px solid ${C.border}`, background: 'linear-gradient(to right, #000, #fff)', cursor: 'crosshair' }}>
        {inks.map(ink => {
          const css = cssRgb01(ink.color)
          const size = 9 + Math.min(ink.intensity, 2) * 6
          const on = sel === ink.key
          return (
            <span key={ink.key}
              onPointerDown={e => { e.preventDefault(); setSel(ink.key); drag.current = ink.key; try { e.currentTarget.setPointerCapture(e.pointerId) } catch {} }}
              title={ink.name}
              style={{ position: 'absolute', left: `${ink.pos * 100}%`, top: '50%', width: size, height: size, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: css, border: `2px solid ${on ? '#fff' : 'rgba(0,0,0,0.55)'}`, boxShadow: '0 1px 3px rgba(0,0,0,0.6)', cursor: 'grab' }} />
          )
        })}
      </div>
      {selInk && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: C.muted, marginBottom: 2 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: cssRgb01(selInk.color), border: '1px solid rgba(255,255,255,0.2)' }} />
            {selInk.name} · tone {Math.round(selInk.pos * 100)}%
          </div>
          <NumberSlider label="Intensity" min={0} max={2} step={0.05} value={selInk.intensity} onChange={v => setInkCtl(selInk.key, { intensity: v })} accent={ACC} labelWidth={70} />
          <NumberSlider label="Spread" min={0.05} max={1} step={0.01} value={selInk.spread} onChange={v => setInkCtl(selInk.key, { spread: v })} accent={ACC} labelWidth={70} />
        </div>
      )}
    </div>
  )
}

// ── Gradient-map editor: drag palette stops along the tone ramp ─────────────────
function GradMapEditor({ colors, stops }) {
  const n = colors.length
  const pos = (Array.isArray(stops) && stops.length === n) ? stops : colors.map((_, i) => i / (n - 1))
  const barRef = useRef(null)
  const drag = useRef(null)
  const set = (i, p) => { const next = pos.slice(); next[i] = Math.max(0, Math.min(1, p)); setState({ gradStops: next }) }
  const onMove = e => { if (drag.current == null || !barRef.current) return; const r = barRef.current.getBoundingClientRect(); set(drag.current, (e.clientX - r.left) / r.width) }
  const end = () => { drag.current = null }
  const grad = `linear-gradient(to right, ${colors.map((c, i) => `${c} ${Math.round(pos[i] * 100)}%`).join(', ')})`
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 9, color: C.muted, marginBottom: 4 }}>Drag stops to reshape the tone ramp (shadows → highlights)</div>
      <div ref={barRef} onPointerMove={onMove} onPointerUp={end} onPointerLeave={end}
        style={{ position: 'relative', height: 26, borderRadius: 6, border: `1px solid ${C.border}`, background: grad, cursor: 'crosshair' }}>
        {colors.map((c, i) => (
          <span key={i} title={c}
            onPointerDown={e => { e.preventDefault(); drag.current = i; try { e.currentTarget.setPointerCapture(e.pointerId) } catch {} }}
            style={{ position: 'absolute', left: `${pos[i] * 100}%`, top: '50%', width: 12, height: 12, transform: 'translate(-50%,-50%)', borderRadius: '50%', background: c, border: '2px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.6)', cursor: 'grab' }} />
        ))}
      </div>
      <div style={{ marginTop: 6 }}><MiniBtn onClick={() => setState({ gradStops: null })}>Reset spacing</MiniBtn></div>
    </div>
  )
}

// ── Primitives ────────────────────────────────────────────────────────────────
const selectStyle = { width: '100%', background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, padding: '5px 8px', fontSize: 11, outline: 'none', cursor: 'pointer' }

function Section({ title, children }) {
  return <div style={{ marginBottom: 18 }}><div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: C.muted, textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>{children}</div>
}
function Row({ label, children }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}><span style={{ fontSize: 10, color: '#888', minWidth: 60 }}>{label}</span><div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>{children}</div></div>
}
function Seg({ options, value, onChange }) {
  return <div style={{ display: 'flex', gap: 3 }}>{options.map(([v, lbl]) => (
    <button key={v} onClick={() => onChange(v)} style={{ background: value === v ? C.accentLo : C.ctrl, border: `1px solid ${value === v ? C.accent : C.border}`, borderRadius: 4, color: value === v ? C.accent : C.muted, padding: '3px 8px', fontSize: 10, cursor: 'pointer' }}>{lbl}</button>
  ))}</div>
}
function Toggle({ label, checked, onChange }) {
  return (
    <button onClick={() => onChange(!checked)} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', marginTop: 8, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: checked ? C.text : C.muted }}>
      <span style={{ width: 30, height: 16, borderRadius: 8, flexShrink: 0, position: 'relative', background: checked ? C.accent : C.ctrl, border: `1px solid ${checked ? C.accent : C.border}`, transition: 'background 0.15s' }}>
        <span style={{ position: 'absolute', top: 1, left: checked ? 15 : 1, width: 12, height: 12, borderRadius: '50%', background: checked ? '#fff' : C.mutedHi, transition: 'left 0.15s' }} />
      </span>
      <span style={{ fontSize: 11 }}>{label}</span>
    </button>
  )
}
function FxBlock({ label, on, onToggle, children }) {
  return (
    <div style={{ border: `1px solid ${on ? C.accent : C.border}`, borderRadius: 6, padding: '6px 8px', background: C.ctrl }}>
      <Toggle label={label} checked={on} onChange={onToggle} />
      {on && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  )
}
function Btn({ icon, label, onClick, primary, disabled, title }) {
  return <button onClick={onClick} disabled={disabled} title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: primary ? C.accentLo : C.ctrl, border: `1px solid ${primary ? C.accent : C.border}`, borderRadius: 5, color: disabled ? C.border : (primary ? C.accent : C.text), padding: '5px 10px', fontSize: 11, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>{icon && <Icon name={icon} size={13} />}{label}</button>
}
function IconToggle({ children, onClick, disabled, title }) {
  return <button onClick={onClick} disabled={disabled} title={title} style={{ width: 26, height: 24, background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 5, color: disabled ? C.border : C.text, fontSize: 13, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>{children}</button>
}
function StepBtn({ children, onClick }) {
  return <button onClick={onClick} style={{ width: 24, height: 28, flexShrink: 0, background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, fontSize: 16, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</button>
}
function ZoomBtn({ children, onClick }) {
  return <button onClick={onClick} style={{ background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '2px 8px', fontSize: 10, cursor: 'pointer' }}>{children}</button>
}
function MiniBtn({ children, onClick, danger, accent }) {
  const col = danger ? '#ff4060' : accent ? C.accent : C.muted
  const bd = danger ? '#6a001f' : accent ? C.accent : C.border
  return <button onClick={onClick} style={{ background: danger ? '#3a0010' : accent ? C.accentLo : C.ctrl, border: `1px solid ${bd}`, borderRadius: 4, color: col, padding: '3px 9px', fontSize: 10, cursor: 'pointer' }}>{children}</button>
}

// ── helpers ─────────────────────────────────────────────────────────────────────
function isOrdered(id) {
  return id === 'threshold' || id === 'random' || id === 'ign' || isMatrixOrdered(id)
}
function isCurve(id) { return id === 'riemersma' || id === 'riemersma-hard' }
function smooth01(e0, e1, x) { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }
// Blend a dithered ImageData back toward the (adjusted) original within a luma band.
function applyMaskCpu(dithered, orig, m) {
  const d = dithered.data, o = orig.data
  const fe = Math.max(0.001, m.maskFeather)
  const subject = m.maskMode === 'subject', bg = m.bgLuma ?? 0
  for (let i = 0; i < d.length; i += 4) {
    const lt = (0.299 * o[i] + 0.587 * o[i + 1] + 0.114 * o[i + 2]) / 255
    let w = subject
      ? smooth01(m.maskLo, m.maskLo + fe + 0.001, Math.abs(lt - bg))
      : smooth01(m.maskLo - fe, m.maskLo + fe, lt) * (1 - smooth01(m.maskHi - fe, m.maskHi + fe, lt))
    if (m.maskInvert) w = 1 - w
    d[i]     = o[i]     + (d[i]     - o[i])     * w
    d[i + 1] = o[i + 1] + (d[i + 1] - o[i + 1]) * w
    d[i + 2] = o[i + 2] + (d[i + 2] - o[i + 2]) * w
  }
}
function rgbCss([r, g, b]) { return `rgb(${r},${g},${b})` }
function cssRgb01(c) { return `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})` }
function safeName(name) { return String(name).replace(/[^a-z0-9]+/gi, '').slice(0, 12) || 'layer' }
function checkerBg() { return `conic-gradient(#141417 90deg, #0e0e11 90deg 180deg, #141417 180deg 270deg, #0e0e11 270deg)` }
function downloadCanvas(canvas, name) { canvas.toBlob(blob => downloadBlob(blob, name), 'image/png') }
function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); markSaved('dither-maker') }
