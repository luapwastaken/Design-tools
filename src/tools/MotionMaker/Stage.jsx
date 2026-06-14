// ── Motion Maker — Stage (live preview with pan/zoom) ──────────────────────────
// Same viewport model as the Dither / Post FX tools: drag (or middle-drag) to pan,
// scroll to zoom, Fit / 1:1 buttons. (Space is reserved for play/pause here, so we
// pan on left/middle drag rather than space-drag.)
import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { C } from '../LogoMaker/ui.jsx'
import { evaluateScene } from './engine.js'
import { SceneSvg } from './render.jsx'

const CHECKER = `repeating-conic-gradient(#1a1a1f 0% 25%, #141418 0% 50%) 50% / 24px 24px`

function ZoomBtn({ children, onClick }) {
  return <button onClick={onClick} style={{ background: C.ctrl, border: `1px solid ${C.border}`, borderRadius: 4, color: C.text, padding: '2px 8px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>{children}</button>
}

export default function Stage({ doc, frame }) {
  const scene = useMemo(() => evaluateScene(doc, frame), [doc, frame])
  const { w, h } = doc.canvas
  const vpRef = useRef(null)
  const panRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [grabbing, setGrabbing] = useState(false)

  const fit = useCallback((tries = 0) => {
    const vp = vpRef.current
    if (!vp) return
    const cw = vp.clientWidth, ch = vp.clientHeight
    if ((cw < 80 || ch < 80) && tries < 10) { requestAnimationFrame(() => fit(tries + 1)); return }
    const pad = 48
    let z = Math.min((cw - pad) / w, (ch - pad) / h)
    z = Math.max(0.05, Math.min(z, 8))
    setZoom(z); setPan({ x: (cw - w * z) / 2, y: (ch - h * z) / 2 })
  }, [w, h])

  useEffect(() => { fit() }, [w, h, fit])

  // Re-fit whenever the pane itself resizes (split-divider drag, panel resize, window
  // resize) so the artboard scales with the viewport like other design tools.
  useEffect(() => {
    const vp = vpRef.current
    if (!vp || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fit()) })
    ro.observe(vp)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [fit])

  function onWheel(e) {
    e.preventDefault()
    const rect = vpRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const z2 = Math.max(0.05, Math.min(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 16))
    setPan({ x: cx - (cx - pan.x) / zoom * z2, y: cy - (cy - pan.y) / zoom * z2 }); setZoom(z2)
  }
  function onPointerDown(e) {
    if (e.button === 0 || e.button === 1) {
      e.preventDefault()
      panRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
      setGrabbing(true)
      vpRef.current.setPointerCapture(e.pointerId)
    }
  }
  function onPointerMove(e) {
    if (panRef.current) setPan({ x: panRef.current.px + (e.clientX - panRef.current.x), y: panRef.current.py + (e.clientY - panRef.current.y) })
  }
  function onPointerUp(e) {
    if (panRef.current) { panRef.current = null; setGrabbing(false); try { vpRef.current.releasePointerCapture(e.pointerId) } catch {} }
  }

  return (
    <div ref={vpRef}
      onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onMouseDown={e => { if (e.button === 1) e.preventDefault() }}
      style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', background: C.bg, cursor: grabbing ? 'grabbing' : 'grab' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
        <div style={{ width: w, height: h, background: CHECKER, boxShadow: `0 0 0 ${1 / zoom}px ${C.border}` }}>
          <SceneSvg scene={scene} style={{ width: w, height: h, display: 'block' }} />
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 10, left: 10, display: 'flex', gap: 4, alignItems: 'center', background: 'rgba(8,8,10,0.8)', borderRadius: 6, padding: 4, border: `1px solid ${C.border}` }}>
        <ZoomBtn onClick={() => fit()}>Fit</ZoomBtn>
        <ZoomBtn onClick={() => { const vp = vpRef.current; setZoom(1); setPan({ x: (vp.clientWidth - w) / 2, y: (vp.clientHeight - h) / 2 }) }}>1:1</ZoomBtn>
        <span style={{ fontSize: 10, color: C.muted, minWidth: 38, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{Math.round(zoom * 100)}%</span>
      </div>
      <div style={{ position: 'absolute', bottom: 10, right: 10, fontSize: 9, color: C.muted, background: 'rgba(8,8,10,0.7)', borderRadius: 5, padding: '3px 7px', pointerEvents: 'none' }}>Drag to pan · scroll to zoom</div>
    </div>
  )
}
