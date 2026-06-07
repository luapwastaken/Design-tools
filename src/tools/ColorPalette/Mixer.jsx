// ── Paint Mixer ───────────────────────────────────────────────────────────────
// NOTE: no emoji in the UI — use <Icon /> (Google Material icons) only.
//
// A small paint studio: pick real pigments, knead them together in a dedicated
// mixing well, and paint on a wet canvas where colours flow and mix like real
// paint (spectral Kubelka–Munk, see lib/spectral.js + lib/paintSim.js).

import { useState, useRef, useEffect } from 'react'
import { PaintSim } from '../../lib/paintSim.js'
import { makePaint, SPECTRAL_BANDS as NB } from '../../lib/spectral.js'
import { PIGMENTS, pigmentTraits } from '../../data/pigments.js'
import { usePalette, addSwatch } from './store.js'
import { NumberSlider } from '../../components/NumberField.jsx'
import Icon from '../../components/Icon.jsx'

const ACCENT = '#8b5cf6'
const GRID = 256          // paint-canvas sim resolution (smoothly upscaled to fit)
const WELL = 150          // mixing-well sim resolution
const FLOW_MS = 33        // watercolor flow tick budget (~30fps) to cap CPU

// Build a brush-ready paint from a single cell of a sim (used by the well).
function paintFromCell(sim, cx, cy) {
  const i = (cy | 0) * sim.w + (cx | 0)
  const base = i * NB
  return {
    hex: sim.sampleHex(cx, cy),
    K: sim.K.slice(base, base + NB),
    S: sim.S.slice(base, base + NB),
    tint: 1,
    opacity: sim.op[i] || 0.6,
    granulation: sim.gran[i] || 0,
    staining: sim.stain[i] || 0.4,
    name: 'Mixed',
  }
}

// ── Paint canvas ──────────────────────────────────────────────────────────────
function PaintCanvas({ paintRef, mediumRef, toolRef, settingsRef, onPick }) {
  const canvasRef = useRef(null)
  const simRef = useRef(null)
  const ctxRef = useRef(null)
  const bufRef = useRef(null)
  const drawing = useRef(false)
  const last = useRef(null)
  const running = useRef(false)

  if (!simRef.current) simRef.current = new PaintSim(GRID, GRID)

  // Render immediately so strokes always show. Only the touched region is
  // re-rendered/uploaded (dirty rect), so high resolution stays cheap. The rAF
  // loop below only runs while watercolor paint is still wet (page can idle).
  function renderNow() {
    if (!ctxRef.current || !bufRef.current) return
    const rect = simRef.current.consumeDirty()
    if (!rect) return
    simRef.current.render(bufRef.current, rect)
    ctxRef.current.putImageData(bufRef.current, 0, 0, rect.x0, rect.y0, rect.x1 - rect.x0 + 1, rect.y1 - rect.y0 + 1)
  }

  function kickFlow() {
    if (running.current || mediumRef.current !== 'watercolor') return
    running.current = true
    let lastT = 0
    const loop = t => {
      const sim = simRef.current
      if (sim.wetCount > 0) {
        if (t - lastT >= FLOW_MS) { lastT = t; sim.step(); renderNow() }  // ~30fps
        requestAnimationFrame(loop)
      } else running.current = false
    }
    requestAnimationFrame(loop)
  }

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d')
    ctxRef.current = ctx
    bufRef.current = ctx.createImageData(GRID, GRID)
    simRef.current.markAllDirty()
    renderNow()
    const clear = () => { simRef.current.clear(); renderNow() }
    window.addEventListener('mixer:clearCanvas', clear)
    return () => window.removeEventListener('mixer:clearCanvas', clear)
  }, [])

  // keep the sim's brush in sync with the selected paint
  useEffect(() => {
    const sync = () => simRef.current.setBrush(paintRef.current)
    sync()
  })

  function gridXY(e) {
    const r = canvasRef.current.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width * GRID, (e.clientY - r.top) / r.height * GRID]
  }

  function depositParams(x, y) {
    const s = settingsRef.current
    const wc = mediumRef.current === 'watercolor'
    return {
      x, y, r: s.size / 2, flow: s.flow,
      water: wc ? s.water : 0,
      load: wc ? s.load : s.load * 1.6,
      hardness: s.hardness, aspect: s.aspect, angle: s.angle * Math.PI / 180,
    }
  }

  function strokeTo(x, y) {
    const sim = simRef.current
    const s = settingsRef.current
    const [lx, ly] = last.current
    const dist = Math.hypot(x - lx, y - ly)
    const step = Math.max(1, (s.size / 2) * 0.3)
    const steps = Math.max(1, Math.floor(dist / step))
    if (toolRef.current === 'smudge') {
      const vx = (x - lx) / steps, vy = (y - ly) / steps
      for (let i = 1; i <= steps; i++) {
        sim.smudge({ x: lx + (x - lx) * i / steps, y: ly + (y - ly) * i / steps, vx, vy, r: s.size / 2, strength: s.smudge, hardness: s.hardness, aspect: s.aspect, angle: s.angle * Math.PI / 180 })
      }
    } else {
      for (let i = 0; i <= steps; i++) {
        sim.deposit(depositParams(lx + (x - lx) * i / steps, ly + (y - ly) * i / steps))
      }
    }
    last.current = [x, y]
    renderNow()
    kickFlow()
  }

  function onDown(e) {
    const [x, y] = gridXY(e)
    if (toolRef.current === 'pick' || e.altKey) {
      onPick(simRef.current.sampleHex(x, y))
      return
    }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
    drawing.current = true
    last.current = [x, y]
    if (toolRef.current !== 'smudge') { simRef.current.deposit(depositParams(x, y)); renderNow(); kickFlow() }
  }
  function onMove(e) { if (drawing.current) { const [x, y] = gridXY(e); strokeTo(x, y) } }

  useEffect(() => {
    const stop = () => { drawing.current = false; last.current = null }
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => { window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop) }
  }, [])

  return (
    <canvas
      ref={canvasRef} width={GRID} height={GRID}
      onPointerDown={onDown} onPointerMove={onMove}
      style={{
        width: '100%', aspectRatio: '1 / 1', display: 'block', borderRadius: 8,
        border: '1px solid #2a2a35', cursor: toolRef.current === 'pick' ? 'crosshair' : 'cell',
        touchAction: 'none', background: '#fff',
      }}
    />
  )
}

// ── Mixing well — knead pigments into a custom colour ─────────────────────────
function useMixingWell({ onColor }) {
  const canvasRef = useRef(null)
  const simRef = useRef(null)
  const ctxRef = useRef(null)
  const bufRef = useRef(null)
  const drawing = useRef(false)
  const last = useRef(null)

  if (!simRef.current) simRef.current = new PaintSim(WELL, WELL)

  function repaint() {
    simRef.current.render(bufRef.current)
    ctxRef.current.putImageData(bufRef.current, 0, 0)
    onColor(simRef.current.sampleHex(WELL / 2, WELL / 2))
  }

  useEffect(() => {
    const ctx = canvasRef.current.getContext('2d')
    ctxRef.current = ctx
    bufRef.current = ctx.createImageData(WELL, WELL)
    repaint()
    const stop = () => { drawing.current = false; last.current = null }
    window.addEventListener('pointerup', stop)
    return () => window.removeEventListener('pointerup', stop)
  }, [])

  function gridXY(e) {
    const r = canvasRef.current.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width * WELL, (e.clientY - r.top) / r.height * WELL]
  }
  // dragging kneads the paint (smudge)
  function onMove(e) {
    if (!drawing.current) return
    const [x, y] = gridXY(e)
    const [lx, ly] = last.current
    simRef.current.smudge({ x, y, vx: x - lx, vy: y - ly, r: 16, strength: 0.5, hardness: 0.2 })
    last.current = [x, y]
    repaint()
  }

  // Add a dab of a pigment into the centre area (fired via a DOM event).
  useEffect(() => {
    const handler = e => {
      const { paint } = e.detail
      const sim = simRef.current
      sim.setBrush(paint)
      const cx = WELL / 2 + (Math.random() - 0.5) * 20
      const cy = WELL / 2 + (Math.random() - 0.5) * 20
      for (let k = 0; k < 3; k++) sim.deposit({ x: cx, y: cy, r: 18, flow: 0.7, load: 1, water: 0, hardness: 0.4 })
      repaint()
    }
    const el = canvasRef.current
    el.addEventListener('well:add', handler)
    return () => el.removeEventListener('well:add', handler)
  }, [])

  function clear() { simRef.current.clear(); repaint() }
  function loadBrush() { onColor(simRef.current.sampleHex(WELL / 2, WELL / 2), paintFromCell(simRef.current, WELL / 2, WELL / 2)) }

  return { canvasRef, drawing, last, gridXY, onMove, clear, loadBrush }
}

// ── Pigment chip ──────────────────────────────────────────────────────────────
function Chip({ hex, label, active, onClick, title }) {
  return (
    <button onClick={onClick} title={title || label} style={{
      display: 'flex', alignItems: 'center', gap: 5, padding: '3px 6px',
      background: active ? '#2d1a5e' : '#15151c',
      border: `1px solid ${active ? ACCENT : '#2a2a35'}`,
      borderRadius: 5, cursor: 'pointer', color: active ? '#c4b5fd' : '#aaa', fontSize: 10,
    }}>
      <span style={{ width: 14, height: 14, borderRadius: 3, background: hex, border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0 }} />
      {label && <span style={{ whiteSpace: 'nowrap' }}>{label}</span>}
    </button>
  )
}

// ── Main Mixer ────────────────────────────────────────────────────────────────
export default function Mixer() {
  const { swatches, active } = usePalette()
  const activeHex = swatches.find(s => s.id === active)?.hex

  const [medium, setMedium] = useState('watercolor')
  const [tool, setTool] = useState('paint')
  const [pigmentId, setPigmentId] = useState('ultra')
  const [brushHex, setBrushHex] = useState('#2b2f86')
  const [wellHex, setWellHex] = useState('#ffffff')

  const [size, setSize] = useState(26)
  const [flow, setFlow] = useState(0.7)
  const [water, setWater] = useState(0.6)
  const [load, setLoad] = useState(1)
  const [hardness, setHardness] = useState(0.6)
  const [aspect, setAspect] = useState(1)
  const [angle, setAngle] = useState(0)
  const [smudge, setSmudge] = useState(0.5)

  // current brush paint (kept in a ref so the canvas loop reads it live)
  const paintRef = useRef(makePaint('#2b2f86', pigmentTraits(PIGMENTS.find(p => p.id === 'ultra'))))
  const mediumRef = useRef(medium); mediumRef.current = medium
  const toolRef = useRef(tool); toolRef.current = tool
  const settingsRef = useRef({})
  settingsRef.current = { size, flow, water, load, hardness, aspect, angle, smudge }

  function selectPigment(p) {
    setPigmentId(p.id); setBrushHex(p.hex)
    paintRef.current = makePaint(p.hex, pigmentTraits(p))
  }
  function selectHex(hex, paint) {
    setPigmentId(null); setBrushHex(hex)
    paintRef.current = paint ?? makePaint(hex)
  }

  // mixing well wiring
  const well = useMixingWell({ onColor: (hex, paint) => { setWellHex(hex); if (paint) selectHex(hex, paint) } })

  function addToWell(paint, hex) {
    setWellHex(hex)
    well.canvasRef.current?.dispatchEvent(new CustomEvent('well:add', { detail: { paint } }))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>

      {/* Top: canvas + mixing well side by side */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px', maxWidth: 360, minWidth: 240 }}>
          <PaintCanvas paintRef={paintRef} mediumRef={mediumRef} toolRef={toolRef} settingsRef={settingsRef}
            onPick={hex => addSwatch(hex)} />
          <ToolBar tool={tool} setTool={setTool} medium={medium} setMedium={setMedium}
            onClear={() => { /* canvas clear handled below */ window.dispatchEvent(new Event('mixer:clearCanvas')) }} />
        </div>

        {/* Mixing well column */}
        <div style={{ width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>Mixing well</div>
          <canvas ref={well.canvasRef} width={WELL} height={WELL}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); well.drawing.current = true; well.last.current = well.gridXY(e) }}
            onPointerMove={well.onMove}
            title="Drag to knead the paint together"
            style={{ width: 150, height: 150, borderRadius: 8, border: '1px solid #2a2a35', background: '#fff', cursor: 'grab', touchAction: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 18, height: 18, borderRadius: 4, background: wellHex, border: '1px solid #333' }} />
            <span style={{ fontSize: 10, color: '#aaa', fontFamily: 'monospace' }}>{wellHex}</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <MiniBtn onClick={well.loadBrush}>To brush</MiniBtn>
            <MiniBtn onClick={() => addSwatch(wellHex)}>+ Palette</MiniBtn>
            <MiniBtn onClick={well.clear}>Clear</MiniBtn>
          </div>
          <div style={{ fontSize: 9, color: '#555', lineHeight: 1.4 }}>Click pigments below to drop them in, then drag to knead.</div>
        </div>
      </div>

      {/* Brush colour readout */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#888' }}>Brush</span>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: brushHex, border: '1px solid #333' }} />
        <span style={{ fontSize: 11, color: '#aaa', fontFamily: 'monospace' }}>{brushHex}</span>
        {activeHex && (
          <MiniBtn onClick={() => selectHex(activeHex)}>Use selected</MiniBtn>
        )}
      </div>

      {/* Pigment tray */}
      <div>
        <div style={{ fontSize: 9, color: '#666', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Pigments — click to load brush · double-click to drop in well</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {PIGMENTS.map(p => (
            <span key={p.id} onDoubleClick={() => addToWell(makePaint(p.hex, pigmentTraits(p)), p.hex)}>
              <Chip hex={p.hex} label={p.name} active={pigmentId === p.id} onClick={() => selectPigment(p)}
                title={`${p.name} — tint ${p.tint}, ${Math.round(p.opacity * 100)}% opaque${p.staining > 0.6 ? ', staining' : ''}`} />
            </span>
          ))}
        </div>
      </div>

      {/* Palette colours as paints */}
      {swatches.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: '#666', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your palette</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {swatches.map(sw => (
              <span key={sw.id} onDoubleClick={() => addToWell(makePaint(sw.hex), sw.hex)}>
                <Chip hex={sw.hex} active={brushHex === sw.hex} onClick={() => selectHex(sw.hex)} title={sw.hex} />
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Brush settings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #1e1e24', paddingTop: 10 }}>
        <div style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>Brush</div>
        <NumberSlider label="Size" min={3} max={70} step={1} value={size} onChange={setSize} accent={ACCENT} suffix="px" labelWidth={70} />
        <NumberSlider label="Flow" min={0.05} max={1} step={0.01} value={flow} onChange={setFlow} accent={ACCENT} labelWidth={70} />
        <NumberSlider label="Pigment load" min={0.2} max={3} step={0.05} value={load} onChange={setLoad} accent={ACCENT} labelWidth={70} />
        {medium === 'watercolor' && (
          <NumberSlider label="Water" min={0} max={1} step={0.01} value={water} onChange={setWater} accent={ACCENT} labelWidth={70} />
        )}
        <NumberSlider label="Hardness" min={0} max={1} step={0.01} value={hardness} onChange={setHardness} accent={ACCENT} labelWidth={70} />
        <NumberSlider label="Tip aspect" min={1} max={5} step={0.1} value={aspect} onChange={setAspect} accent={ACCENT} labelWidth={70} />
        <NumberSlider label="Tip angle" min={0} max={180} step={1} value={angle} onChange={setAngle} accent={ACCENT} suffix="°" labelWidth={70} />
        {tool === 'smudge' && (
          <NumberSlider label="Smudge" min={0.05} max={1} step={0.01} value={smudge} onChange={setSmudge} accent={ACCENT} labelWidth={70} />
        )}
      </div>

      <div style={{ fontSize: 10, color: '#555', lineHeight: 1.5 }}>
        <b style={{ color: '#888' }}>Watercolor</b> flows and blooms while wet; <b style={{ color: '#888' }}>Oil</b> stays put and builds up.
        Alt-click or <b style={{ color: '#888' }}>Pick</b> samples a colour into your palette.
      </div>
    </div>
  )
}

function ToolBar({ tool, setTool, medium, setMedium, onClear }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
      <Seg options={[['watercolor', 'Watercolor'], ['oil', 'Oil']]} value={medium} onChange={setMedium} />
      <Seg options={[['paint', 'brush', 'Paint'], ['smudge', 'gesture', 'Smudge'], ['pick', 'colorize', 'Pick']]} value={tool} onChange={setTool} icons />
      <button onClick={onClear} title="Clear the canvas" style={{
        display: 'flex', alignItems: 'center', gap: 5, background: '#15151c', border: '1px solid #2a2a35',
        borderRadius: 5, color: '#888', padding: '4px 9px', fontSize: 11, cursor: 'pointer',
      }}><Icon name="delete" size={13} /> Clear</button>
    </div>
  )
}

function Seg({ options, value, onChange, icons }) {
  return (
    <div style={{ display: 'flex', gap: 2, background: '#0a0a0c', borderRadius: 6, padding: 2 }}>
      {options.map(opt => {
        const [val, a, b] = opt
        const label = icons ? b : a
        const icon = icons ? a : null
        const on = value === val
        return (
          <button key={val} onClick={() => onChange(val)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px',
            background: on ? '#2d1a5e' : 'transparent', border: `1px solid ${on ? ACCENT : 'transparent'}`,
            borderRadius: 4, color: on ? '#c4b5fd' : '#777', fontSize: 11, cursor: 'pointer',
          }}>{icon && <Icon name={icon} size={13} />}{label}</button>
        )
      })}
    </div>
  )
}

function MiniBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, background: '#1a1a22', border: '1px solid #2a2a35', borderRadius: 4,
      color: '#999', padding: '4px 6px', fontSize: 10, cursor: 'pointer', whiteSpace: 'nowrap',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = ACCENT; e.currentTarget.style.color = '#c4b5fd' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#2a2a35'; e.currentTarget.style.color = '#999' }}
    >{children}</button>
  )
}
