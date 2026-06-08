import { useState, useEffect, useRef, useCallback } from 'react'
import { NumberSlider, EditableNumber } from '../../components/NumberField.jsx'
import Icon from '../../components/Icon.jsx'
import { create as createGL } from '../../lib/glPostFX.js'
import { processFile } from '../../lib/file.js'
import { markSaved } from '../../lib/unsavedChanges.js'
import { EFFECTS, EFFECT_LIST, CATEGORIES, BLEND_MODES } from './effects.js'
import {
  usePostFX, getState, addEffect, removeEffect, updateLayer, setLayerParam,
  toggleLayer, selectLayer, moveLayer, reorderLayer, duplicateLayer, clearStack,
  setState, resetState, undo, redo, canUndo, canRedo,
  saveCurrentPreset, applyPreset, removeSavedPreset,
  getIncomingImage, clearIncomingImage,
} from './store.js'

const C = {
  bg: '#0b0b0d', sidebar: '#0e0e11', panel: '#111114', ctrl: '#18181c',
  border: '#1e1e24', accent: '#36d6c3', accentLo: '#0c2e2a',
  text: '#f0ede7', muted: '#5a5a64', mutedHi: '#8a8a96',
}
const ACC = C.accent
const MAX_EDGE = 1600   // cap the working long edge for interactive performance

export default function PostFX() {
  const s = usePostFX()
  const fileRef = useRef(null)
  const canvasRef = useRef(null)     // visible WebGL canvas
  const glRef = useRef(null)
  const workRef = useRef(null)       // downscaled source canvas fed to the engine
  const origUrlRef = useRef(null)    // dataURL of the working source (before/after + base layer)
  const rafRef = useRef(null)
  const startRef = useRef(performance.now())

  const [src, setSrc] = useState(null)   // { name, w, h }
  const [dragOver, setDragOver] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [split, setSplit] = useState(null)   // null = off; 0..1 = divider position
  const splitDragRef = useRef(false)

  // pan / zoom
  const viewportRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [space, setSpace] = useState(false)
  const panRef = useRef(null)

  // ── GL engine lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!canvasRef.current) return
    glRef.current = createGL(canvasRef.current)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  // ── Incoming image from another tool (e.g. Dither "Send to Post FX") ──────────
  useEffect(() => {
    const url = getIncomingImage()
    if (url) { loadFromUrl(url, 'from-dither.png'); clearIncomingImage() }
  }, [])

  // ── Load helpers ──────────────────────────────────────────────────────────────
  function loadFromUrl(url, name = 'image.png') {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale))
      const h = Math.max(1, Math.round(img.height * scale))
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h
      cv.getContext('2d').drawImage(img, 0, 0, w, h)
      workRef.current = cv
      origUrlRef.current = cv.toDataURL('image/png')
      glRef.current?.setSource(cv)
      setSrc({ name, w, h })
      requestAnimationFrame(() => fitView(w, h))
    }
    img.src = url
  }

  async function loadFile(file) {
    const r = await processFile(file)
    if (!r || r.type !== 'raster') return
    loadFromUrl(r.dataUrl, r.name)
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const gl = glRef.current
    if (!gl || !workRef.current) return
    const t = s.animate ? (performance.now() - startRef.current) / 1000 : 0
    gl.render(s.stack, EFFECTS, t)
  }, [s.stack, s.animate])

  // Re-render on any settings change.
  useEffect(() => { render() }, [render])

  // Animation loop — only while `animate` is on and an animated effect is present.
  useEffect(() => {
    if (!s.animate) { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; return }
    const loop = () => { render(); rafRef.current = requestAnimationFrame(loop) }
    rafRef.current = requestAnimationFrame(loop)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [s.animate, render])

  // ── Keyboard: space-pan + undo/redo ───────────────────────────────────────────
  useEffect(() => {
    const dn = e => {
      if (e.code === 'Space' && !e.target.matches('input,textarea')) { setSpace(true); e.preventDefault() }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo() }
    }
    const up = e => { if (e.code === 'Space') setSpace(false) }
    window.addEventListener('keydown', dn); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('keydown', dn); window.removeEventListener('keyup', up) }
  }, [])

  // ── Paste image ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const onPaste = e => {
      const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))
      if (item) loadFile(item.getAsFile())
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // ── Pan / zoom ────────────────────────────────────────────────────────────────
  function fitView(w, h) {
    const vp = viewportRef.current; if (!vp) return
    const z = Math.min((vp.clientWidth - 60) / w, (vp.clientHeight - 60) / h, 1)
    setZoom(z); setPan({ x: (vp.clientWidth - w * z) / 2, y: (vp.clientHeight - h * z) / 2 })
  }
  function onWheel(e) {
    if (!src) return
    e.preventDefault()
    const rect = viewportRef.current.getBoundingClientRect()
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top
    const z2 = Math.max(0.05, Math.min(zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 40))
    setPan({ x: cx - (cx - pan.x) / zoom * z2, y: cy - (cy - pan.y) / zoom * z2 }); setZoom(z2)
  }
  function onPointerDown(e) {
    if (space || e.button === 1) {
      e.preventDefault()
      panRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
      viewportRef.current.setPointerCapture(e.pointerId)
    }
  }
  function onPointerMove(e) {
    if (panRef.current) setPan({ x: panRef.current.px + (e.clientX - panRef.current.x), y: panRef.current.py + (e.clientY - panRef.current.y) })
    if (splitDragRef.current) {
      const rect = viewportRef.current.getBoundingClientRect()
      setSplit(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)))
    }
  }
  function onPointerUp(e) {
    if (panRef.current) { panRef.current = null; try { viewportRef.current.releasePointerCapture(e.pointerId) } catch {} }
    splitDragRef.current = false
  }

  // ── Export ────────────────────────────────────────────────────────────────────
  function exportPng() {
    render()
    requestAnimationFrame(() => {
      const cv = glRef.current?.readToCanvas() || canvasRef.current
      if (!cv) return
      const a = document.createElement('a')
      a.download = (src?.name?.replace(/\.[^.]+$/, '') || 'postfx') + '-fx.png'
      a.href = cv.toDataURL('image/png')
      a.click()
      markSaved('post-fx')
    })
  }

  function savePreset() {
    saveCurrentPreset(presetName || 'Preset')
    setPresetName('')
  }

  const selected = s.stack.find(l => l.id === s.selectedId)
  const cursor = panRef.current ? 'grabbing' : space ? 'grab' : 'default'

  return (
    <div style={{ display: 'flex', height: '100%', background: C.bg, color: C.text, fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* ── Left: preview ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <div
          ref={viewportRef}
          onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]) }}
          style={{
            position: 'absolute', inset: 0, cursor,
            background: 'repeating-conic-gradient(#141417 0% 25%, #0e0e11 0% 50%) 0 / 24px 24px',
            outline: dragOver ? `2px dashed ${ACC}` : 'none', outlineOffset: -8,
          }}
        >
          {/* original (before) base layer */}
          {src && (
            <div style={{ position: 'absolute', left: 0, top: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
              <img src={origUrlRef.current} width={src.w} height={src.h} draggable={false} style={{ display: 'block', imageRendering: 'auto' }} />
            </div>
          )}
          {/* processed (after) — clipped to the right of the split when active */}
          <div style={{
            position: 'absolute', left: 0, top: 0,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0',
            clipPath: split != null ? `inset(0 0 0 ${split * 100}%)` : 'none',
            display: src ? 'block' : 'none',
          }}>
            <canvas ref={canvasRef} style={{ display: 'block' }} />
          </div>
        </div>

        {/* split divider */}
        {src && split != null && (
          <div
            onPointerDown={e => { e.stopPropagation(); splitDragRef.current = true; viewportRef.current.setPointerCapture(e.pointerId) }}
            style={{ position: 'absolute', top: 0, bottom: 0, left: `${split * 100}%`, width: 2, background: ACC, cursor: 'ew-resize', zIndex: 5 }}
          >
            <div style={{ position: 'absolute', top: '50%', left: -9, width: 20, height: 20, marginTop: -10, borderRadius: '50%', background: ACC, color: '#06201d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>⇆</div>
          </div>
        )}

        {!src && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, pointerEvents: 'none' }}>
            <Icon name="image" size={48} color={C.muted} />
            <div style={{ color: C.mutedHi, fontSize: 14 }}>Drop an image, paste, or import to start</div>
            <div style={{ color: C.muted, fontSize: 11 }}>Then stack post-processing effects on the right</div>
          </div>
        )}

        {/* viewport HUD */}
        {src && (
          <>
            <div style={{ position: 'absolute', left: 12, top: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: C.muted, background: 'rgba(8,8,10,0.7)', borderRadius: 5, padding: '3px 8px' }}>{src.name} · {src.w}×{src.h}</span>
              {!glRef.current && <span style={{ fontSize: 10, color: '#e0795a' }}>WebGL unavailable</span>}
            </div>
            <div style={{ position: 'absolute', bottom: 10, right: 10, fontSize: 9, color: C.muted, background: 'rgba(8,8,10,0.7)', borderRadius: 5, padding: '3px 7px', pointerEvents: 'none' }}>
              Space / middle-drag to pan · scroll to zoom
            </div>
            <div style={{ position: 'absolute', bottom: 10, left: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <ZoomBtn onClick={() => fitView(src.w, src.h)}>Fit</ZoomBtn>
              <ZoomBtn onClick={() => { setZoom(1); setPan({ x: (viewportRef.current.clientWidth - src.w) / 2, y: (viewportRef.current.clientHeight - src.h) / 2 }) }}>1:1</ZoomBtn>
              <span style={{ fontSize: 10, color: C.muted, minWidth: 38, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{Math.round(zoom * 100)}%</span>
              <ZoomBtn onClick={() => setSplit(split == null ? 0.5 : null)} active={split != null}>Before / After</ZoomBtn>
            </div>
          </>
        )}
      </div>

      {/* ── Right: controls panel ────────────────────────────────────────── */}
      <div style={{ width: 320, flexShrink: 0, background: C.sidebar, borderLeft: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* header */}
        <div style={{ padding: 12, borderBottom: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="bolt" size={18} color={ACC} />
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 0.3 }}>Post FX</span>
            <div style={{ flex: 1 }} />
            <IconBtn name="undo" title="Undo" disabled={!canUndo()} onClick={undo} />
            <IconBtn name="redo" title="Redo" disabled={!canRedo()} onClick={redo} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Btn icon="upload" label="Import" onClick={() => fileRef.current?.click()} flex />
            <Btn icon="download" label="Export PNG" onClick={exportPng} disabled={!src} flex />
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => e.target.files[0] && loadFile(e.target.files[0])} />
        </div>

        {/* scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* effect stack */}
          <Section title={`Effect stack (${s.stack.length})`} right={s.stack.length > 0 && <MiniBtn onClick={clearStack}>Clear</MiniBtn>}>
            {s.stack.length === 0 && <div style={{ fontSize: 11, color: C.muted, padding: '6px 2px' }}>No effects yet. Add one below.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {s.stack.map((layer, i) => (
                <StackRow
                  key={layer.id} layer={layer} index={i} count={s.stack.length}
                  selected={layer.id === s.selectedId}
                  onSelect={() => selectLayer(layer.id)}
                  onToggle={() => toggleLayer(layer.id)}
                  onUp={() => moveLayer(layer.id, -1)}
                  onDown={() => moveLayer(layer.id, 1)}
                  onDup={() => duplicateLayer(layer.id)}
                  onRemove={() => removeEffect(layer.id)}
                  onReorder={reorderLayer}
                />
              ))}
            </div>
            <div style={{ position: 'relative', marginTop: 6 }}>
              <Btn icon="add" label="Add effect" onClick={() => setAddOpen(v => !v)} flex />
              {addOpen && <AddMenu onPick={t => { addEffect(t); setAddOpen(false) }} onClose={() => setAddOpen(false)} />}
            </div>
          </Section>

          {/* selected effect controls */}
          {selected && <EffectControls layer={selected} />}

          {/* animation */}
          <Section title="Animation">
            <Row label="Animate">
              <Toggle on={s.animate} onClick={() => setState({ animate: !s.animate })} />
            </Row>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Drives time-based effects (Glitch, Grain, VHS, Wave, Noise).</div>
          </Section>

          {/* presets */}
          <Section title="Presets">
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="Preset name"
                style={inputStyle} onKeyDown={e => e.key === 'Enter' && savePreset()} />
              <MiniBtn onClick={savePreset} disabled={s.stack.length === 0}>Save</MiniBtn>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 8 }}>
              {s.savedPresets.length === 0 && <div style={{ fontSize: 10, color: C.muted }}>No saved presets.</div>}
              {s.savedPresets.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '3px 6px', background: C.ctrl, borderRadius: 4 }}>
                  <span style={{ flex: 1, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={() => applyPreset(p)}>{p.name}</span>
                  <span style={{ fontSize: 9, color: C.muted }}>{p.stack.length}</span>
                  <span style={{ cursor: 'pointer', color: C.muted, display: 'flex' }} onClick={() => removeSavedPreset(p.id)}><Icon name="close" size={12} /></span>
                </div>
              ))}
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}

// ── Effect stack row ──────────────────────────────────────────────────────────
function StackRow({ layer, index, count, selected, onSelect, onToggle, onUp, onDown, onDup, onRemove, onReorder }) {
  const e = EFFECTS[layer.type]
  return (
    <div
      draggable
      onDragStart={ev => ev.dataTransfer.setData('text/plain', String(index))}
      onDragOver={ev => ev.preventDefault()}
      onDrop={ev => { ev.preventDefault(); const from = +ev.dataTransfer.getData('text/plain'); if (!isNaN(from)) onReorder(from, index) }}
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, padding: '5px 6px', borderRadius: 5, cursor: 'pointer',
        background: selected ? C.accentLo : C.ctrl,
        border: `1px solid ${selected ? ACC : 'transparent'}`,
        opacity: layer.enabled ? 1 : 0.5,
      }}
    >
      <span style={{ color: C.muted, display: 'flex', cursor: 'grab' }}><Icon name="drag_indicator" size={14} /></span>
      <span onClick={ev => { ev.stopPropagation(); onToggle() }} style={{ display: 'flex', color: layer.enabled ? ACC : C.muted }}>
        <Icon name={layer.enabled ? 'visibility' : 'visibility_off'} size={15} />
      </span>
      <span style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e?.label || layer.type}</span>
      <RowIcon name="arrow_upward" disabled={index === 0} onClick={onUp} />
      <RowIcon name="arrow_downward" disabled={index === count - 1} onClick={onDown} />
      <RowIcon name="content_copy" onClick={onDup} />
      <RowIcon name="delete" onClick={onRemove} />
    </div>
  )
}

function RowIcon({ name, onClick, disabled }) {
  return (
    <span
      onClick={ev => { ev.stopPropagation(); if (!disabled) onClick() }}
      style={{ display: 'flex', color: disabled ? '#2c2c33' : C.muted, cursor: disabled ? 'default' : 'pointer', padding: 1 }}
    ><Icon name={name} size={13} /></span>
  )
}

// ── Add-effect menu (grouped by category) ─────────────────────────────────────
function AddMenu({ onPick, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', h), 0)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div ref={ref} style={{
      position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 20,
      background: C.panel, border: `1px solid ${C.border}`, borderRadius: 6, padding: 6,
      maxHeight: 360, overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    }}>
      {CATEGORIES.map(cat => (
        <div key={cat.id} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, padding: '4px 6px 2px' }}>{cat.label}</div>
          {EFFECT_LIST.filter(e => e.category === cat.id).map(e => (
            <div key={e.type} onClick={() => onPick(e.type)}
              style={{ fontSize: 11, padding: '5px 8px', borderRadius: 4, cursor: 'pointer' }}
              onMouseEnter={ev => ev.currentTarget.style.background = C.ctrl}
              onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
              {e.label}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Selected-effect controls ──────────────────────────────────────────────────
function EffectControls({ layer }) {
  const e = EFFECTS[layer.type]
  if (!e) return null
  return (
    <Section title={e.label}>
      <Row label="Opacity">
        <NumberSlider min={0} max={1} step={0.01} value={layer.opacity ?? 1} onChange={v => updateLayer(layer.id, { opacity: v })} accent={ACC} labelWidth={0} numWidth={42} />
      </Row>
      <Row label="Blend">
        <select value={layer.blend ?? 0} onChange={ev => updateLayer(layer.id, { blend: +ev.target.value })} style={selectStyle}>
          {BLEND_MODES.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
        </select>
      </Row>
      <div style={{ height: 1, background: C.border, margin: '8px 0' }} />
      {(e.params || []).map(p => (
        <Param key={p.key} pdef={p} value={layer.params[p.key]} onChange={v => setLayerParam(layer.id, p.key, v)} />
      ))}
    </Section>
  )
}

function Param({ pdef, value, onChange }) {
  if (pdef.type === 'color') {
    return (
      <Row label={pdef.label}>
        <input type="color" value={value || pdef.default} onChange={e => onChange(e.target.value)}
          style={{ width: 36, height: 22, padding: 0, border: `1px solid ${C.border}`, borderRadius: 4, background: 'none', cursor: 'pointer' }} />
      </Row>
    )
  }
  if (pdef.type === 'bool') {
    return (
      <Row label={pdef.label}>
        <Toggle on={!!value} onClick={() => onChange(value ? 0 : 1)} />
      </Row>
    )
  }
  if (pdef.type === 'select') {
    return (
      <Row label={pdef.label}>
        <select value={value} onChange={e => onChange(+e.target.value)} style={selectStyle}>
          {pdef.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Row>
    )
  }
  return (
    <div style={{ marginBottom: 7 }}>
      <NumberSlider label={pdef.label} min={pdef.min} max={pdef.max} step={pdef.step} value={value ?? pdef.default}
        onChange={onChange} accent={ACC} suffix={pdef.suffix || ''} labelWidth={96} numWidth={46} />
    </div>
  )
}

// ── Small styled helpers ──────────────────────────────────────────────────────
function Section({ title, right, children }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6, color: C.mutedHi, fontWeight: 600 }}>{title}</span>
        <div style={{ flex: 1 }} />
        {right}
      </div>
      {children}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 26 }}>
      <span style={{ fontSize: 10, color: '#888', minWidth: 96, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>{children}</div>
    </div>
  )
}

function Btn({ icon, label, onClick, disabled, flex }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      flex: flex ? 1 : 'none', padding: '7px 10px', fontSize: 11, fontWeight: 500,
      background: C.ctrl, color: disabled ? C.muted : C.text, border: `1px solid ${C.border}`,
      borderRadius: 6, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    }}>
      {icon && <Icon name={icon} size={14} />}{label}
    </button>
  )
}

function MiniBtn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      fontSize: 10, padding: '3px 8px', background: C.ctrl, color: disabled ? C.muted : C.text,
      border: `1px solid ${C.border}`, borderRadius: 4, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  )
}

function IconBtn({ name, onClick, disabled, title }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} style={{
      display: 'flex', padding: 4, background: 'none', border: 'none',
      color: disabled ? '#2c2c33' : C.mutedHi, cursor: disabled ? 'default' : 'pointer',
    }}><Icon name={name} size={16} /></button>
  )
}

function ZoomBtn({ children, onClick, active }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 10, padding: '3px 8px', background: active ? C.accentLo : 'rgba(8,8,10,0.7)',
      color: active ? ACC : C.mutedHi, border: `1px solid ${active ? ACC : C.border}`, borderRadius: 4, cursor: 'pointer',
    }}>{children}</button>
  )
}

function Toggle({ on, onClick }) {
  return (
    <span onClick={onClick} style={{
      width: 34, height: 18, borderRadius: 10, background: on ? ACC : C.ctrl, border: `1px solid ${on ? ACC : C.border}`,
      position: 'relative', cursor: 'pointer', flexShrink: 0, transition: 'background 0.12s',
    }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 17 : 2, width: 12, height: 12, borderRadius: '50%', background: on ? '#06201d' : C.mutedHi, transition: 'left 0.12s' }} />
    </span>
  )
}

const inputStyle = {
  flex: 1, fontSize: 11, padding: '4px 8px', background: C.ctrl, color: C.text,
  border: `1px solid ${C.border}`, borderRadius: 4, outline: 'none', minWidth: 0,
}
const selectStyle = {
  fontSize: 11, padding: '3px 6px', background: C.ctrl, color: C.text,
  border: `1px solid ${C.border}`, borderRadius: 4, outline: 'none', cursor: 'pointer',
}
