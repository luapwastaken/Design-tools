import { useState, useEffect, useRef, useCallback } from 'react'
import { NumberSlider } from '../../components/NumberField.jsx'
import Icon from '../../components/Icon.jsx'
import { toGray, flatten, autoLevels, applyLevels, toInk, despeckle, compose, smoothMask, traceContours, loopsToSvg, renderLoops, otsu, adjustWeight } from '../../lib/lineart.js'
import { useLineart, setState, getState, undo, redo, resetState, TOOL_ID } from './store.js'
import { sendImageToPostFX } from '../PostFX/store.js'
import { processFile } from '../../lib/file.js'
import { markDirty, markSaved } from '../../lib/unsavedChanges.js'

const C = {
  bg: '#0b0b0d', panel: '#111114', ctrl: '#18181c',
  border: '#1e1e24', accent: '#fbbf24', accentLo: '#3a2c0a',
  text: '#f0ede7', muted: '#5a5a64', mutedHi: '#8a8a96',
}
const ACC = C.accent

const PREVIEW_LONG = 1600   // working long edge for the live preview
const TRACE_LONG = 2200     // cap for SVG tracing (keeps node counts sane)

const CHANNELS = [
  { id: 'luma', label: 'Luma' },
  { id: 'red', label: 'Red' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
]
const MODES = [
  { id: 'soft', label: 'Smooth' },
  { id: 'hard', label: 'Hard' },
  { id: 'adaptive', label: 'Adaptive' },
]

export default function LineartTool() {
  const s = useLineart()
  const fileRef = useRef(null)
  const canvasRef = useRef(null)
  const viewportRef = useRef(null)

  const [src, setSrc] = useState(null)          // { img, w, h, name }
  const [view, setView] = useState('result')
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [specks, setSpecks] = useState(0)

  // stage caches — keyed by the params each stage depends on
  const grayCache = useRef({ key: '', data: null, w: 0, h: 0 })
  const flatCache = useRef({ key: '', data: null })

  // pan / zoom
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [space, setSpace] = useState(false)
  const panRef = useRef(null)
  const fittedKey = useRef('')
  const [dims, setDims] = useState(null)

  // ── Keyboard: space pan, undo/redo ──────────────────────────────────────────
  useEffect(() => {
    const isField = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
    function down(e) {
      if (e.code === 'Space' && !isField()) { e.preventDefault(); setSpace(true); return }
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); undo() }
      else if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey) || (e.key === 'Z' && e.shiftKey))) { e.preventDefault(); redo() }
    }
    function up(e) { if (e.code === 'Space') setSpace(false) }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up) }
  }, [])

  // ── Image input ─────────────────────────────────────────────────────────────
  const loadFile = useCallback(async file => {
    if (!file || !file.type.startsWith('image/')) return
    const r = await processFile(file)
    if (!r || r.type !== 'raster') return
    const img = new Image()
    img.onload = () => {
      fittedKey.current = ''
      grayCache.current.key = ''
      flatCache.current.key = ''
      autoSetup(img, img.naturalWidth, img.naturalHeight)
      setSrc({ img, w: img.naturalWidth, h: img.naturalHeight, name: r.name })
      setView('result')
      markDirty(TOOL_ID)
    }
    img.src = r.dataUrl
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function onPaste(e) {
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))
      if (item) loadFile(item.getAsFile())
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [loadFile])

  // ── Pipeline ────────────────────────────────────────────────────────────────
  // Runs the full chain at the given long-edge cap and returns { imageData, w, h,
  // alpha }. Stage caches make slider drags cheap: only stages whose params
  // changed recompute (the flatten blur is the expensive one).
  function runPipeline(longCap, useCache = true) {
    if (!src) return null
    const st = getState()
    const scale = Math.min(1, longCap / Math.max(src.w, src.h))
    const W = Math.max(1, Math.round(src.w * scale))
    const H = Math.max(1, Math.round(src.h * scale))

    // stage 1 — grayscale
    const grayKey = `${src.name}|${W}x${H}|${st.channel}|${st.invert}`
    let gray
    if (useCache && grayCache.current.key === grayKey) gray = grayCache.current.data
    else {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H
      const ctx = cv.getContext('2d')
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(src.img, 0, 0, W, H)
      gray = toGray(ctx.getImageData(0, 0, W, H), st.channel, st.invert)
      if (useCache) grayCache.current = { key: grayKey, data: gray, w: W, h: H }
    }

    // stage 2 — paper flattening (radius stored in native px → scale to working)
    const flatKey = `${grayKey}|${st.flatten}|${st.flattenRadius}|${st.flattenStrength}`
    let flat
    if (useCache && flatCache.current.key === flatKey) flat = flatCache.current.data
    else {
      flat = st.flatten ? flatten(gray, W, H, Math.max(2, st.flattenRadius * scale), st.flattenStrength) : gray
      if (useCache) flatCache.current = { key: flatKey, data: flat }
    }

    // stage 3 — levels
    const leveled = applyLevels(flat, st.levelLow, st.levelHigh, st.gamma)

    // stage 4 — threshold → ink alpha
    let alpha = toInk(leveled, W, H, {
      mode: st.mode,
      threshold: st.threshold / 100,
      softness: st.softness / 100,
      blockSize: Math.max(2, st.blockSize * scale),
      offset: st.offset / 100,
    })

    // stage 5 — despeckle (area scales with the square of the resolution)
    let removed = despeckle(alpha, W, H, Math.round(st.despeckleSize * scale * scale))

    // stage 5b — line weight (thicken/thin strokes)
    if (st.lineWeight) alpha = adjustWeight(alpha, W, H, st.lineWeight * scale)

    // stage 6 — edge smoothing (rounds threshold staircase before trace/compose)
    const smoothed = st.lineSmooth > 0 ? smoothMask(alpha, W, H, st.lineSmooth * scale) : alpha

    // stage 7 — vector trace (vector mode) or raster compose
    const result = { w: W, h: H, alpha: smoothed, removed, scale }
    if (st.outputMode === 'vector') {
      result.loops = traceContours(smoothed, W, H, { simplify: st.svgSimplify, smooth: st.svgSmooth })
    } else {
      const bg = st.bgMode === 'transparent' ? null
        : st.bgMode === 'white' ? [255, 255, 255]
        : hexToRgb(st.bgColor)
      result.imageData = compose(smoothed, W, H, hexToRgb(st.lineColor), bg)
    }
    return result
  }

  // ── Viewport painting ────────────────────────────────────────────────────────
  // Vector mode renders the traced loops at *screen* resolution (zoom × dpr), so
  // lines stay crisp at any zoom instead of CSS-scaling a fixed raster. The trace
  // is cached in previewRef; zoom changes only repaint, they don't re-trace.
  const previewRef = useRef(null)   // { loops, w, h } | { imageData, w, h }
  function paintPreview(zoomNow = zoom) {
    const p = previewRef.current, cv = canvasRef.current
    if (!p || !cv) return
    const st = getState()
    if (p.loops) {
      const dpr = window.devicePixelRatio || 1
      const rs = Math.min(4, Math.max(0.05, zoomNow * dpr))
      const bg = st.bgMode === 'transparent' ? null : st.bgMode === 'white' ? '#ffffff' : st.bgColor
      const rendered = renderLoops(p.loops, p.w, p.h, rs, st.lineColor, bg)
      cv.width = rendered.width; cv.height = rendered.height
      cv.getContext('2d').drawImage(rendered, 0, 0)
    } else if (p.imageData) {
      cv.width = p.w; cv.height = p.h
      cv.getContext('2d').putImageData(p.imageData, 0, 0)
    }
  }

  // Repaint (without re-tracing) when zoom settles, so vector lines stay sharp.
  useEffect(() => {
    if (!src || view !== 'result' || !previewRef.current?.loops) return
    const t = setTimeout(() => paintPreview(zoom), 100)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  // ── Live preview (debounced) ────────────────────────────────────────────────
  const deps = JSON.stringify({ ...s, _: src ? src.name + src.w + src.h : null, view })
  useEffect(() => {
    if (!src) return
    let cancelled = false
    const t = setTimeout(() => {
      if (cancelled) return
      const cv = canvasRef.current
      if (!cv) return
      if (view === 'original') {
        const scale = Math.min(1, PREVIEW_LONG / Math.max(src.w, src.h))
        const W = Math.max(1, Math.round(src.w * scale)), H = Math.max(1, Math.round(src.h * scale))
        cv.width = W; cv.height = H
        const ctx = cv.getContext('2d')
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(src.img, 0, 0, W, H)
        present(W, H)
        return
      }
      const r = runPipeline(PREVIEW_LONG)
      if (!r) return
      previewRef.current = r
      paintPreview()
      setSpecks(r.removed)
      present(r.w, r.h)
    }, 60)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps])

  function present(w, h) {
    setDims({ w, h })
    const key = `${src?.name}|${w}x${h}`
    if (key !== fittedKey.current) { fittedKey.current = key; requestAnimationFrame(() => fitView({ w, h })) }
  }

  // ── Auto levels ─────────────────────────────────────────────────────────────
  // Suggest black/white points from the flattened histogram of the current image.
  function runAutoLevels() {
    if (!src) return
    const st = getState()
    const scale = Math.min(1, PREVIEW_LONG / Math.max(src.w, src.h))
    const W = Math.max(1, Math.round(src.w * scale)), H = Math.max(1, Math.round(src.h * scale))
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const ctx = cv.getContext('2d'); ctx.drawImage(src.img, 0, 0, W, H)
    let g = toGray(ctx.getImageData(0, 0, W, H), st.channel, st.invert)
    if (st.flatten) g = flatten(g, W, H, Math.max(2, st.flattenRadius * scale), st.flattenStrength)
    const { low, high } = autoLevels(g)
    setState({ levelLow: +low.toFixed(3), levelHigh: +high.toFixed(3) })
  }

  // ── One-shot auto setup ─────────────────────────────────────────────────────
  // Analyses the image and sets everything needed for an immediate clean result:
  // inverted-scan detection, black/white points, an Otsu line threshold, and a
  // resolution-scaled despeckle. Runs on every image load and via "Auto adjust".
  function autoSetup(img, w, h) {
    const scale = Math.min(1, 1000 / Math.max(w, h))
    const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale))
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, W, H)
    let g = toGray(ctx.getImageData(0, 0, W, H), 'luma', false)
    // inverted scan: dark background (corner average) → white-on-dark
    const corner = (x, y) => g[y * W + x]
    const bg = (corner(2, 2) + corner(W - 3, 2) + corner(2, H - 3) + corner(W - 3, H - 3)) / 4
    const invert = bg < 0.45
    if (invert) { const inv = new Float32Array(g.length); for (let i = 0; i < g.length; i++) inv[i] = 1 - g[i]; g = inv }
    const st = getState()
    const flat = flatten(g, W, H, Math.max(2, st.flattenRadius * scale), 1)
    const { low, high } = autoLevels(flat)
    const leveled = applyLevels(flat, low, high, 1)
    // bias a little above Otsu so faint stroke edges survive the soft ramp
    const threshold = Math.round(Math.min(85, Math.max(15, otsu(leveled) * 100 + 8)))
    setState({
      channel: 'luma', invert, flatten: true, mode: 'soft', gamma: 1,
      levelLow: +low.toFixed(3), levelHigh: +high.toFixed(3),
      threshold,
      ...cleanupParams(st.cleanup, Math.max(w, h)),
    })
  }

  // Cleanup macro → the underlying detail params, scaled to the scan resolution.
  function cleanupParams(v, longEdge) {
    return {
      cleanup: v,
      despeckleSize: Math.round((longEdge / 1200) ** 2 * (4 + v * 0.36)),
      lineSmooth: +(0.5 + v / 100 * 2.5).toFixed(2),
    }
  }
  function setCleanup(v) { setState(cleanupParams(v, src ? Math.max(src.w, src.h) : 1200)) }

  // ── Pan / zoom ──────────────────────────────────────────────────────────────
  function fitView(d, tries = 0) {
    const vp = viewportRef.current
    if (!vp || !d) return
    const cw = vp.clientWidth, ch = vp.clientHeight
    if ((cw < 80 || ch < 80) && tries < 10) { requestAnimationFrame(() => fitView(d, tries + 1)); return }
    const pad = 32
    let z = Math.min((cw - pad) / d.w, (ch - pad) / d.h)
    z = Math.max(0.02, Math.min(z, 24))
    setZoom(z); setPan({ x: (cw - d.w * z) / 2, y: (ch - d.h * z) / 2 })
  }
  function onWheel(e) {
    if (!src) return
    e.preventDefault()
    const rect = viewportRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const z2 = Math.max(0.02, Math.min(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 40))
    setPan({ x: cx - (cx - pan.x) / zoom * z2, y: cy - (cy - pan.y) / zoom * z2 }); setZoom(z2)
  }
  function onPointerDown(e) {
    if (space || e.button === 1) { e.preventDefault(); panRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; viewportRef.current.setPointerCapture(e.pointerId) }
  }
  function onPointerMove(e) { if (panRef.current) setPan({ x: panRef.current.px + (e.clientX - panRef.current.x), y: panRef.current.py + (e.clientY - panRef.current.y) }) }
  function onPointerUp(e) { if (panRef.current) { panRef.current = null; try { viewportRef.current.releasePointerCapture(e.pointerId) } catch {} } }

  // ── Exports (full resolution — pipeline re-runs uncached at native size) ────
  function resultCanvasFullRes() {
    const st = getState()
    // vector PNG: trace at a capped working size (node counts stay sane), then
    // render the smooth paths at native resolution — clean edges, no upscaling blur
    const long = st.outputMode === 'vector' ? Math.min(TRACE_LONG, Math.max(src.w, src.h)) : Math.max(src.w, src.h)
    const r = runPipeline(long, false)
    if (!r) return null
    if (r.loops) {
      const bg = st.bgMode === 'transparent' ? null : st.bgMode === 'white' ? '#ffffff' : st.bgColor
      return { cv: renderLoops(r.loops, r.w, r.h, Math.max(src.w, src.h) / long, st.lineColor, bg), r }
    }
    const cv = document.createElement('canvas'); cv.width = r.w; cv.height = r.h
    cv.getContext('2d').putImageData(r.imageData, 0, 0)
    return { cv, r }
  }
  function withBusy(fn) {
    if (!src || busy) return
    setBusy(true)
    // let React paint the busy state before the synchronous pipeline run
    setTimeout(() => { try { fn() } finally { setBusy(false) } }, 30)
  }
  function exportPng() {
    withBusy(() => {
      const out = resultCanvasFullRes()
      if (out) { downloadCanvas(out.cv, baseName() + '.png'); markSaved(TOOL_ID) }
    })
  }
  function exportSvg() {
    withBusy(() => {
      const r = runPipeline(Math.min(TRACE_LONG, Math.max(src.w, src.h)), false)
      if (!r) return
      const loops = r.loops || traceContours(r.alpha, r.w, r.h, { simplify: s.svgSimplify, smooth: s.svgSmooth })
      const bg = s.bgMode === 'transparent' ? null : s.bgMode === 'white' ? '#ffffff' : s.bgColor
      const svg = loopsToSvg(loops, r.w, r.h, { color: s.lineColor, background: bg })
      downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), baseName() + '.svg')
      markSaved(TOOL_ID)
    })
  }
  async function copyClipboard() {
    withBusy(() => {
      const out = resultCanvasFullRes()
      if (!out) return
      out.cv.toBlob(async blob => {
        try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]) } catch (err) { console.warn('clipboard', err) }
      }, 'image/png')
    })
  }
  function sendToPostFX() {
    withBusy(() => {
      const out = resultCanvasFullRes()
      if (out) sendImageToPostFX(out.cv.toDataURL('image/png'))
    })
  }
  function baseName() { return (src?.name || 'scan').replace(/\.[^.]+$/, '') + '-lineart' }

  // ── UI ──────────────────────────────────────────────────────────────────────
  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden', background: C.bg, color: C.text }}>

      {/* ── Viewport ── */}
      <div
        ref={viewportRef}
        onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); loadFile(e.dataTransfer.files[0]) }}
        style={{
          flex: 1, position: 'relative', overflow: 'hidden',
          cursor: panRef.current ? 'grabbing' : space ? 'grab' : 'default',
          outline: dragOver ? `2px dashed ${ACC}` : 'none', outlineOffset: -8,
        }}
      >
        {src ? (
          <div style={{ position: 'absolute', transform: `translate(${pan.x}px, ${pan.y}px)`, transformOrigin: '0 0' }}>
            <canvas
              ref={canvasRef}
              style={{
                width: (dims?.w || 1) * zoom, height: (dims?.h || 1) * zoom,
                imageRendering: view === 'result' && s.outputMode === 'raster' && zoom > 3 ? 'pixelated' : 'auto',
                // checkerboard shows through transparent output
                background: view === 'result' && s.bgMode === 'transparent'
                  ? 'repeating-conic-gradient(#26262c 0% 25%, #1b1b20 0% 50%) 0 0 / 20px 20px'
                  : '#fff',
              }}
            />
          </div>
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', color: C.muted }}>
            <Icon name="image" size={42} color={C.muted} />
            <div style={{ fontSize: 13 }}>Drop a photo or scan of a sketch</div>
            <div style={{ fontSize: 11 }}>or paste from clipboard (Ctrl+V)</div>
            <button onClick={() => fileRef.current?.click()} style={btnStyle(true)}>Open image</button>
          </div>
        )}

        {/* view toggle + zoom readout */}
        {src && (
          <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
            {['original', 'result'].map(v => (
              <button key={v} onClick={() => setView(v)} style={chipStyle(view === v)}>
                {v === 'original' ? 'Original' : 'Lineart'}
              </button>
            ))}
            <span style={{ fontSize: 10, color: C.muted, marginLeft: 6 }}>
              {src.w}×{src.h}px · {Math.round(zoom * 100)}% · space-drag to pan
            </span>
          </div>
        )}
        {busy && (
          <div style={{ position: 'absolute', bottom: 12, left: 12, fontSize: 11, color: ACC }}>
            Processing full resolution…
          </div>
        )}
      </div>

      {/* ── Controls panel ── */}
      <div style={{ width: 304, flexShrink: 0, overflowY: 'auto', background: C.panel, borderLeft: `1px solid ${C.border}`, padding: '12px 14px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Scan to Lineart</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <IconBtn name="undo" title="Undo (Ctrl+Z)" onClick={undo} />
            <IconBtn name="redo" title="Redo (Ctrl+Y)" onClick={redo} />
            <IconBtn name="refresh" title="Reset settings" onClick={resetState} />
          </div>
        </div>

        <Section title="Source">
          <button onClick={() => fileRef.current?.click()} style={btnStyle()}>
            <Icon name="upload" size={13} /> {src ? 'Replace image' : 'Open image'}
          </button>
          {src && <div style={{ fontSize: 10, color: C.mutedHi, marginTop: 6, wordBreak: 'break-all' }}>{src.name}</div>}
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { loadFile(e.target.files[0]); e.target.value = '' }} />
        </Section>

        <Section title="Quick adjust">
          <button onClick={() => src && autoSetup(src.img, src.w, src.h)} disabled={!src} style={btnStyle(true)}>
            <Icon name="bolt" size={13} /> Auto adjust
          </button>
          <NumberSlider label="Line pickup" min={1} max={99} value={s.threshold} onChange={v => setState({ threshold: v })} accent={ACC} suffix="%" />
          <NumberSlider label="Cleanup" min={0} max={100} value={s.cleanup} onChange={setCleanup} accent={ACC} />
          <NumberSlider label="Line weight" min={-4} max={4} step={0.5} value={s.lineWeight} onChange={v => setState({ lineWeight: v })} accent={ACC} suffix="px" dec={1} />
          <Hint>Everything is set automatically when an image loads. Pickup catches fainter lines, Cleanup removes noise, Weight thickens or thins strokes.</Hint>
        </Section>

        <Section title="Output">
          <Row label="Line colour">
            <input type="color" value={s.lineColor} onChange={e => setState({ lineColor: e.target.value })} style={colorStyle} />
          </Row>
          <Row label="Background">
            {['transparent', 'white', 'custom'].map(m => (
              <button key={m} onClick={() => setState({ bgMode: m })} style={chipStyle(s.bgMode === m)}>
                {m === 'transparent' ? 'None' : m === 'white' ? 'White' : 'Colour'}
              </button>
            ))}
            {s.bgMode === 'custom' && (
              <input type="color" value={s.bgColor} onChange={e => setState({ bgColor: e.target.value })} style={colorStyle} />
            )}
          </Row>
        </Section>

        <Section title="Export">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={exportPng} disabled={!src || busy} style={btnStyle(true)}>
              <Icon name="download" size={13} /> PNG
            </button>
            <button onClick={exportSvg} disabled={!src || busy} style={btnStyle()}>
              <Icon name="download" size={13} /> SVG
            </button>
            <button onClick={copyClipboard} disabled={!src || busy} style={btnStyle()}>
              <Icon name="content_copy" size={13} /> Copy
            </button>
            <button onClick={sendToPostFX} disabled={!src || busy} style={btnStyle()}>
              <Icon name="send" size={13} /> Post FX
            </button>
          </div>
          <Hint>PNG renders at full scan resolution. SVG exports the traced vector paths.</Hint>
        </Section>

        <button onClick={() => setState({ showAdvanced: !s.showAdvanced })} style={{
          display: 'flex', alignItems: 'center', gap: 6, background: 'transparent',
          border: `1px solid ${C.border}`, borderRadius: 5, color: C.mutedHi,
          padding: '6px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <Icon name={s.showAdvanced ? 'arrow_upward' : 'arrow_downward'} size={12} />
          {s.showAdvanced ? 'Hide fine-tune' : 'Fine-tune'}
        </button>

        {s.showAdvanced && <>
        <Section title="Input">
          <Row label="Channel">
            {CHANNELS.map(c => (
              <button key={c.id} onClick={() => setState({ channel: c.id })} style={chipStyle(s.channel === c.id)}>{c.label}</button>
            ))}
          </Row>
          {s.channel === 'blue' && <Hint>Blue channel drops non-photo-blue pencil lines.</Hint>}
          <Toggle label="Invert (white lines on dark)" checked={s.invert} onChange={v => setState({ invert: v })} />
        </Section>

        <Section title="Paper clean-up">
          <Toggle label="Flatten paper / lighting" checked={s.flatten} onChange={v => setState({ flatten: v })} />
          {s.flatten && <>
            <NumberSlider label="Radius" min={8} max={400} value={s.flattenRadius} onChange={v => setState({ flattenRadius: v })} accent={ACC} suffix="px" />
            <NumberSlider label="Strength" min={0} max={1} step={0.05} value={s.flattenStrength} onChange={v => setState({ flattenStrength: v })} accent={ACC} />
          </>}
          <NumberSlider label="Despeckle" min={0} max={120} value={s.despeckleSize} onChange={v => setState({ despeckleSize: v })} accent={ACC} suffix="px²" />
          {s.despeckleSize > 0 && specks > 0 && <Hint>{specks} speck{specks === 1 ? '' : 's'} removed in preview.</Hint>}
        </Section>

        <Section title="Levels">
          <NumberSlider label="Black point" min={0} max={1} step={0.005} value={s.levelLow} onChange={v => setState({ levelLow: Math.min(v, s.levelHigh - 0.01) })} accent={ACC} dec={3} />
          <NumberSlider label="White point" min={0} max={1} step={0.005} value={s.levelHigh} onChange={v => setState({ levelHigh: Math.max(v, s.levelLow + 0.01) })} accent={ACC} dec={3} />
          <NumberSlider label="Gamma" min={0.2} max={3} step={0.05} value={s.gamma} onChange={v => setState({ gamma: v })} accent={ACC} dec={2} />
          <button onClick={runAutoLevels} disabled={!src} style={btnStyle()}>
            <Icon name="bolt" size={13} /> Auto levels
          </button>
        </Section>

        <Section title="Line extraction">
          <Row label="Mode">
            {MODES.map(m => (
              <button key={m.id} onClick={() => setState({ mode: m.id })} style={chipStyle(s.mode === m.id)}>{m.label}</button>
            ))}
          </Row>
          {s.mode !== 'adaptive' && (
            <NumberSlider label="Threshold" min={1} max={99} value={s.threshold} onChange={v => setState({ threshold: v })} accent={ACC} suffix="%" />
          )}
          {s.mode === 'soft' && (
            <NumberSlider label="Softness" min={0} max={40} value={s.softness} onChange={v => setState({ softness: v })} accent={ACC} suffix="%" />
          )}
          {s.mode === 'adaptive' && <>
            <NumberSlider label="Block size" min={4} max={200} value={s.blockSize} onChange={v => setState({ blockSize: v })} accent={ACC} suffix="px" />
            <NumberSlider label="Sensitivity" min={1} max={40} value={s.offset} onChange={v => setState({ offset: v })} accent={ACC} suffix="%" />
            <Hint>Picks up faint lines by comparing to the local mean.</Hint>
          </>}
        </Section>

        <Section title="Line quality">
          <Row label="Result">
            {[['vector', 'Clean vector'], ['raster', 'Keep texture']].map(([id, label]) => (
              <button key={id} onClick={() => setState({ outputMode: id })} style={chipStyle(s.outputMode === id)}>{label}</button>
            ))}
          </Row>
          {s.outputMode === 'vector' ? <>
            <NumberSlider label="Edge smooth" min={0} max={6} step={0.25} value={s.lineSmooth} onChange={v => setState({ lineSmooth: v })} accent={ACC} suffix="px" dec={2} />
            <NumberSlider label="Simplify" min={0} max={4} step={0.25} value={s.svgSimplify} onChange={v => setState({ svgSimplify: v })} accent={ACC} suffix="px" dec={2} />
            <NumberSlider label="Round corners" min={0} max={4} value={s.svgSmooth} onChange={v => setState({ svgSmooth: v })} accent={ACC} />
            <Hint>Lines are traced to smooth vector shapes — the preview, PNG and SVG all share them.</Hint>
          </> : <>
            <NumberSlider label="Edge smooth" min={0} max={6} step={0.25} value={s.lineSmooth} onChange={v => setState({ lineSmooth: v })} accent={ACC} suffix="px" dec={2} />
            <Hint>Raster keeps the original stroke texture (pencil grain, pressure) in the alpha.</Hint>
          </>}
        </Section>
        </>}
      </div>
    </div>
  )
}

// ── Small UI helpers ────────────────────────────────────────────────────────────
function Section({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, color: C.muted, borderBottom: `1px solid ${C.border}`, paddingBottom: 4 }}>{title}</div>
      {children}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 10, color: '#888', minWidth: 90, flexShrink: 0, paddingTop: 4 }}>{label}</span>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', flex: 1, minWidth: 0 }}>
        {children}
      </div>
    </div>
  )
}

function Toggle({ label, checked, onChange }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, color: C.text, cursor: 'pointer', userSelect: 'none' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ accentColor: ACC }} />
      {label}
    </label>
  )
}

function Hint({ children }) {
  return <div style={{ fontSize: 10, color: C.mutedHi, lineHeight: 1.5 }}>{children}</div>
}

function IconBtn({ name, title, onClick }) {
  return (
    <button onClick={onClick} title={title} style={{
      background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 4,
      color: C.mutedHi, padding: '3px 5px', cursor: 'pointer', display: 'flex', alignItems: 'center',
    }}>
      <Icon name={name} size={13} />
    </button>
  )
}

function btnStyle(primary = false) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: primary ? C.accentLo : C.ctrl, color: primary ? ACC : C.text,
    border: `1px solid ${primary ? ACC : C.border}`, borderRadius: 5,
    padding: '5px 10px', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
  }
}

function chipStyle(active) {
  return {
    background: active ? C.accentLo : C.ctrl, color: active ? ACC : C.mutedHi,
    border: `1px solid ${active ? ACC : C.border}`, borderRadius: 4,
    padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
  }
}

const colorStyle = {
  width: 28, height: 22, padding: 0, border: `1px solid ${C.border}`,
  borderRadius: 4, background: 'transparent', cursor: 'pointer',
}

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function downloadCanvas(canvas, name) { canvas.toBlob(blob => downloadBlob(blob, name), 'image/png') }
function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
