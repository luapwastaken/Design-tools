import { useState, useEffect, useRef } from 'react'
import {
  usePalette, setMode, setValueLock, setHueLock,
  updateSwatch, addSwatch, removeSwatch, duplicateSwatch,
  reorderSwatches, setActive, sendToTool,
  toggleSelected, setSelected, clearSelected, bulkRemove, bulkUpdate,
  undo, redo, getState,
} from './store.js'
import { oklchToHex, autoName } from '../../lib/color.js'
import { pickScreenColor, eyeDropperSupported } from '../../lib/eyedropper.js'
import Icon from '../../components/Icon.jsx'
import Picker from './Picker.jsx'
import DesignMode from './DesignMode.jsx'
import IllustrationMode from './IllustrationMode.jsx'
import PrintPanel from './PrintPanel.jsx'
import ExportPanel from './ExportPanel.jsx'
import colorNames from '../../data/colorNames.json'

export const C = {
  bg:       '#0b0b0d',
  sidebar:  '#0e0e11',
  panel:    '#111114',
  border:   '#1e1e24',
  accent:   '#8b5cf6',
  accentLo: '#2d1a5e',
  text:     '#f0ede7',
  muted:    '#4a4a54',
  mutedHi:  '#6a6a7a',
}

const SWATCH_SZ = 76

export default function ColorPalette() {
  const { swatches, active, mode, valueLockEnabled, hueLockEnabled, selected } = usePalette()
  const activeSwatch = swatches.find(s => s.id === active)
  const [view, setView] = useState('palette') // 'palette' | 'print' | 'export'
  const [greyColors, setGreyColors] = useState(false)
  const [dragIdx, setDragIdx] = useState(null)
  const [leftWidth, setLeftWidth] = useState(260)    // picker column px
  const [paletteH, setPaletteH] = useState(164)     // palette grid px

  const L_MIN = 252, L_MAX = 500
  const P_MIN = 100, P_MAX = 340

  useEffect(() => {
    function onKey(e) {
      const ctrl = e.ctrlKey || e.metaKey
      const inInput = document.activeElement?.tagName === 'INPUT'
      if (ctrl) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
        if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return }
      }
      if (!ctrl && (e.key === 'y' || e.key === 'Y') && !inInput) {
        setGreyColors(v => !v)
      }
      // Global eyedropper — press I anywhere to grab a colour from screen
      // and drop it onto the active swatch.
      if (!ctrl && (e.key === 'i' || e.key === 'I') && !inInput && eyeDropperSupported()) {
        e.preventDefault()
        pickScreenColor().then(hex => {
          if (!hex) return
          const { active } = getState()
          if (active) updateSwatch(active, { hex })
          else addSwatch(hex)
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    function onPaste(e) {
      const text = e.clipboardData?.getData('text') ?? ''
      if (!text) return
      const colors = parseColorList(text)
      if (colors.length === 1 && activeSwatch) {
        updateSwatch(activeSwatch.id, { hex: colors[0] })
      } else if (colors.length > 1) {
        for (const hex of colors) addSwatch(hex)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [active, activeSwatch])

  const colorFilter = greyColors ? { filter: 'grayscale(1)' } : {}

  return (
    <div style={{
      display: 'flex', height: '100%', background: C.bg, color: C.text,
      fontFamily: 'system-ui, sans-serif', overflow: 'hidden',
    }}>

      {/* ── Left: Picker column ─────────────────────────────────── */}
      <div style={{
        width: leftWidth, flexShrink: 0,
        background: C.sidebar, display: 'flex', flexDirection: 'column',
        padding: '14px 16px', gap: 10, overflowY: 'auto', overflow: 'hidden',
      }}>
        {/* Active color preview */}
        {activeSwatch && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{
              width: 40, height: 40, borderRadius: 8, background: activeSwatch.hex,
              border: `2px solid ${C.accent}`, flexShrink: 0, ...colorFilter,
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: C.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeSwatch.name || 'Unnamed'}
              </div>
              <div style={{ fontSize: 10, color: C.muted, fontFamily: 'monospace' }}>{activeSwatch.hex}</div>
            </div>
          </div>
        )}

        {/* Color picker */}
        <div style={colorFilter}>
          <Picker
            oklch={activeSwatch?.oklch}
            onChange={oklch => activeSwatch && updateSwatch(activeSwatch.id, { oklch })}
            valueLocked={valueLockEnabled}
            hueLocked={hueLockEnabled}
          />
        </div>

        {/* Lock toggles */}
        <div style={{ display: 'flex', gap: 6 }}>
          <LockBtn label={<><Icon name="lock" size={11} /> Value</>} checked={valueLockEnabled} onChange={setValueLock} title="Value lock — hold the perceived (greyscale) value steady as you change hue or chroma" />
          <LockBtn label="H" checked={hueLockEnabled} onChange={setHueLock} title="Hue lock — freeze H across all inputs" />
        </div>

        {/* Greyscale toggle */}
        <button
          onClick={() => setGreyColors(v => !v)}
          style={{
            background: greyColors ? C.accentLo : 'transparent',
            border: `1px solid ${greyColors ? C.accent : C.border}`,
            borderRadius: 5, color: greyColors ? C.accent : C.muted,
            padding: '4px 0', fontSize: 10, cursor: 'pointer', width: '100%',
          }}
        >
          {greyColors ? 'Greyscale on' : 'Greyscale'} — Y
        </button>

        {/* Send to tool */}
        <div style={{ marginTop: 'auto', paddingTop: 8 }}>
          <div style={{ fontSize: 9, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Send to</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <SendBtn label="Logo" onClick={() => sendToTool('logo-maker', swatches.map(s => s.hex))} />
            <SendBtn label="Pattern" onClick={() => sendToTool('pattern-maker', swatches.map(s => s.hex))} />
            <SendBtn label="Dither" onClick={() => sendToTool('dither-maker', (selected.length ? swatches.filter(s => selected.includes(s.id)) : swatches).map(s => s.hex))} />
          </div>
          <div style={{ fontSize: 9, color: '#2a2a35', marginTop: 6 }}>Ctrl+V — paste color(s)</div>
          {eyeDropperSupported() && (
            <div style={{ fontSize: 9, color: '#2a2a35', marginTop: 2 }}>I — pick color from screen</div>
          )}
        </div>
      </div>

      {/* ── Horizontal resize handle ─────────────────────────────── */}
      <HorzHandle onDelta={d => setLeftWidth(w => Math.max(L_MIN, Math.min(L_MAX, w + d)))} />

      {/* ── Right: Main content ─────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Top bar: mode tabs left, print/export right */}
        <div style={{
          display: 'flex', alignItems: 'stretch',
          borderBottom: `1px solid ${C.border}`, background: C.sidebar, flexShrink: 0,
        }}>
          {['design', 'illustration'].map(m => (
            <button key={m}
              onClick={() => { setMode(m); setView('palette') }}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: mode === m && view === 'palette' ? `2px solid ${C.accent}` : '2px solid transparent',
                color: mode === m && view === 'palette' ? C.text : C.muted,
                padding: '8px 18px', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize',
              }}>{m}</button>
          ))}
          <div style={{ flex: 1 }} />
          {['print', 'export'].map(v => (
            <button key={v}
              onClick={() => setView(view === v ? 'palette' : v)}
              style={{
                background: 'transparent', border: 'none',
                borderBottom: view === v ? `2px solid ${C.accent}` : '2px solid transparent',
                color: view === v ? C.text : C.muted,
                padding: '8px 16px', fontSize: 11, cursor: 'pointer', textTransform: 'capitalize',
              }}>{v}</button>
          ))}
        </div>

        {/* ── Secondary views ── */}
        {view === 'print' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}><PrintPanel /></div>
        )}
        {view === 'export' && (
          <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}><ExportPanel /></div>
        )}

        {/* ── Palette view ── */}
        {view === 'palette' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

            {/* ═══ PALETTE GRID — main visual focus ═══ */}
            <div style={{
              flexShrink: 0, padding: '16px 16px 12px',
              borderBottom: `1px solid ${C.border}`,
              overflowY: 'auto', height: paletteH,
            }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
                {swatches.map((sw, idx) => (
                  <SwatchCard
                    key={sw.id}
                    swatch={sw}
                    isActive={sw.id === active}
                    isSelected={selected.includes(sw.id)}
                    colorFilter={colorFilter}
                    onClick={e => {
                      if (e.ctrlKey || e.metaKey) {
                        toggleSelected(sw.id)
                        setActive(sw.id)
                      } else if (e.shiftKey) {
                        const anchorIdx = swatches.findIndex(s => s.id === active)
                        const min = Math.min(anchorIdx, idx)
                        const max = Math.max(anchorIdx, idx)
                        setSelected(swatches.slice(min, max + 1).map(s => s.id))
                      } else {
                        setActive(sw.id)
                        clearSelected()
                      }
                    }}
                    onDragStart={() => setDragIdx(idx)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => {
                      if (dragIdx !== null && dragIdx !== idx) reorderSwatches(dragIdx, idx)
                      setDragIdx(null)
                    }}
                    onDragEnd={() => setDragIdx(null)}
                  />
                ))}
                {/* Add swatch */}
                <button
                  onClick={() => addSwatch('#808080')}
                  style={{
                    width: SWATCH_SZ, height: SWATCH_SZ, borderRadius: 10,
                    background: 'transparent', border: `2px dashed ${C.border}`,
                    color: C.muted, fontSize: 24, cursor: 'pointer', flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    alignSelf: 'flex-start',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = C.mutedHi}
                  onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
                >+</button>
              </div>
            </div>

            {/* ── Vertical resize handle ── */}
            <VertHandle onDelta={d => setPaletteH(h => Math.max(P_MIN, Math.min(P_MAX, h + d)))} />

            {/* Bulk action bar — visible when 2+ swatches selected */}
            {selected.length > 1 && (
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center',
                padding: '6px 16px', borderBottom: `1px solid ${C.border}`,
                background: C.accentLo, flexShrink: 0,
              }}>
                <span style={{ fontSize: 10, color: C.accent, fontWeight: 500 }}>
                  {selected.length} selected
                </span>
                <div style={{ flex: 1 }} />
                <MiniBtn onClick={() => { bulkUpdate(selected, { name: '' }); swatches.filter(s => selected.includes(s.id)).forEach(s => updateSwatch(s.id, { name: autoName(s.hex, colorNames) })) }}>
                  Auto name all
                </MiniBtn>
                <BulkRoleSelect onChange={role => bulkUpdate(selected, { role })} />
                <MiniBtn danger onClick={() => bulkRemove(selected)}>
                  Delete ({selected.length})
                </MiniBtn>
                <MiniBtn onClick={clearSelected}>Clear</MiniBtn>
              </div>
            )}

            {/* Active swatch info bar */}
            {activeSwatch && (
              <div style={{
                display: 'flex', gap: 8, alignItems: 'center',
                padding: '8px 16px', borderBottom: `1px solid ${C.border}`,
                flexShrink: 0, background: C.panel,
              }}>
                <input
                  value={activeSwatch.name}
                  onChange={e => updateSwatch(activeSwatch.id, { name: e.target.value })}
                  placeholder="Name…"
                  style={{
                    width: 130, background: '#1a1a22', border: `1px solid ${C.border}`,
                    borderRadius: 5, color: C.text, padding: '4px 8px', fontSize: 11, outline: 'none',
                  }}
                />
                <MiniBtn onClick={() => updateSwatch(activeSwatch.id, { name: autoName(activeSwatch.hex, colorNames) })}>
                  Auto
                </MiniBtn>
                <MiniBtn onClick={() => swatches.forEach(sw => updateSwatch(sw.id, { name: autoName(sw.hex, colorNames) }))}>
                  Name all
                </MiniBtn>
                <div style={{ flex: 1 }} />
                <RoleSelect value={activeSwatch.role} onChange={role => updateSwatch(activeSwatch.id, { role })} />
                <IconBtn title={activeSwatch.locked ? 'Unlock color' : 'Lock color — prevent edits'} onClick={() => updateSwatch(activeSwatch.id, { locked: !activeSwatch.locked })}>
                  <Icon name={activeSwatch.locked ? 'lock' : 'lock_open'} size={13} />
                </IconBtn>
                <IconBtn title="Duplicate" onClick={() => duplicateSwatch(activeSwatch.id)}>
                  <Icon name="content_copy" size={13} />
                </IconBtn>
                <IconBtn danger title="Remove" onClick={() => removeSwatch(activeSwatch.id)}>
                  <Icon name="close" size={13} />
                </IconBtn>
              </div>
            )}

            {/* Mode sub-panels */}
            <div style={{ flex: 1, overflow: 'hidden' }}>
              {mode === 'design' ? <DesignMode /> : <IllustrationMode />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Swatch card for the palette grid ─────────────────────────────────────────

function SwatchCard({ swatch, isActive, isSelected, colorFilter, onClick, onDragStart, onDragOver, onDrop, onDragEnd }) {
  const [hover, setHover] = useState(false)
  const border = isActive
    ? `3px solid ${C.accent}`
    : isSelected
      ? `2px dashed ${C.accent}`
      : hover
        ? `2px solid ${C.mutedHi}`
        : '2px solid transparent'

  return (
    <div
      draggable
      onClick={onClick}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, cursor: 'pointer', flexShrink: 0, width: SWATCH_SZ }}
    >
      <div style={{
        width: SWATCH_SZ, height: SWATCH_SZ,
        borderRadius: 10, background: swatch.hex,
        border, boxSizing: 'border-box',
        position: 'relative',
        ...colorFilter,
      }}>
        {swatch.locked && (
          <div style={{
            position: 'absolute', bottom: 5, right: 5,
            width: 7, height: 7, borderRadius: '50%',
            background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.2)',
          }} />
        )}
      </div>
      <div style={{
        fontSize: 9, color: isActive ? C.text : C.muted,
        textAlign: 'center', width: '100%',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {swatch.name || swatch.hex}
      </div>
    </div>
  )
}

// ── Small UI components ───────────────────────────────────────────────────────

function LockBtn({ label, checked, onChange, title }) {
  return (
    <button title={title} onClick={() => onChange(!checked)} style={{
      flex: 1, background: checked ? C.accentLo : '#1a1a22',
      border: `1px solid ${checked ? C.accent : C.border}`,
      borderRadius: 5, color: checked ? C.accent : C.muted,
      padding: '4px 0', fontSize: 10, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
    }}>{label}</button>
  )
}

function MiniBtn({ children, onClick, danger }) {
  const base = danger ? { bg: '#3a0010', border: '#6a001f', color: '#ff4060' } : { bg: '#1a1a22', border: C.border, color: C.muted }
  return (
    <button onClick={onClick} style={{
      background: base.bg, border: `1px solid ${base.border}`,
      borderRadius: 4, color: base.color, padding: '3px 8px', fontSize: 10, cursor: 'pointer',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = danger ? '#e04060' : C.mutedHi; e.currentTarget.style.color = danger ? '#ff6080' : C.text }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = base.border; e.currentTarget.style.color = base.color }}
    >{children}</button>
  )
}

function BulkRoleSelect({ onChange }) {
  const ROLES = ['black', 'main', 'accent', 'white', 'pop', 'freeform']
  return (
    <select
      defaultValue=""
      onChange={e => { if (e.target.value) { onChange(e.target.value); e.target.value = '' } }}
      style={{
        background: '#1a1a22', border: `1px solid ${C.border}`, borderRadius: 4,
        color: C.muted, padding: '3px 6px', fontSize: 10, cursor: 'pointer', outline: 'none',
      }}
    >
      <option value="" disabled>Set role…</option>
      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
    </select>
  )
}

function SendBtn({ label, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, background: '#1a1a22', border: `1px solid ${C.border}`,
      borderRadius: 4, color: C.muted, padding: '4px 0', fontSize: 10, cursor: 'pointer',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = C.mutedHi; e.currentTarget.style.color = C.text }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.muted }}
    >{label}</button>
  )
}

function RoleSelect({ value, onChange }) {
  const ROLES = ['black', 'main', 'accent', 'white', 'pop', 'freeform']
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      background: '#1a1a22', border: `1px solid ${C.border}`, borderRadius: 4,
      color: C.text, padding: '3px 6px', fontSize: 10, cursor: 'pointer', outline: 'none',
    }}>
      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
    </select>
  )
}

function IconBtn({ children, onClick, title, danger }) {
  return (
    <button title={title} onClick={onClick} style={{
      width: 22, height: 22, border: 'none', borderRadius: 4,
      background: 'transparent', color: danger ? '#e05' : C.muted,
      fontSize: 12, cursor: 'pointer', padding: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? '#3a0010' : '#2a2a35'; e.currentTarget.style.color = danger ? '#ff4060' : C.text }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = danger ? '#e05' : C.muted }}
    >{children}</button>
  )
}

// ── Resize handles ────────────────────────────────────────────────────────────

function HorzHandle({ onDelta }) {
  const ref = useRef(null)
  const dragging = useRef(false)
  const lastX = useRef(0)
  const [hot, setHot] = useState(false)

  return (
    <div
      ref={ref}
      onPointerDown={e => {
        dragging.current = true
        lastX.current = e.clientX
        e.currentTarget.setPointerCapture(e.pointerId)
        setHot(true)
      }}
      onPointerMove={e => {
        if (!dragging.current) return
        const d = e.clientX - lastX.current
        lastX.current = e.clientX
        if (d) onDelta(d)
      }}
      onPointerUp={() => { dragging.current = false; setHot(false) }}
      onPointerCancel={() => { dragging.current = false; setHot(false) }}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => { if (!dragging.current) setHot(false) }}
      style={{
        width: 5, flexShrink: 0, cursor: 'col-resize', zIndex: 10,
        background: hot ? C.accent : C.border,
        transition: 'background 0.15s',
      }}
    />
  )
}

function VertHandle({ onDelta }) {
  const ref = useRef(null)
  const dragging = useRef(false)
  const lastY = useRef(0)
  const [hot, setHot] = useState(false)

  return (
    <div
      ref={ref}
      onPointerDown={e => {
        dragging.current = true
        lastY.current = e.clientY
        e.currentTarget.setPointerCapture(e.pointerId)
        setHot(true)
      }}
      onPointerMove={e => {
        if (!dragging.current) return
        const d = e.clientY - lastY.current
        lastY.current = e.clientY
        if (d) onDelta(d)
      }}
      onPointerUp={() => { dragging.current = false; setHot(false) }}
      onPointerCancel={() => { dragging.current = false; setHot(false) }}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => { if (!dragging.current) setHot(false) }}
      style={{
        height: 5, flexShrink: 0, cursor: 'ns-resize',
        background: hot ? C.accent : C.border,
        transition: 'background 0.15s',
      }}
    />
  )
}

// ── Smart paste: detect hex, rgb(), oklch(), oklab(), or comma/newline list ───

function parseColorList(text) {
  const hexes = []
  const tokens = text.split(/[\n,;]+/).map(t => t.trim()).filter(Boolean)
  for (const tok of tokens) {
    const hex = tryParseToHex(tok)
    if (hex) hexes.push(hex)
  }
  if (!hexes.length) {
    const hex = tryParseToHex(text.trim())
    if (hex) hexes.push(hex)
  }
  return hexes
}

function tryParseToHex(str) {
  if (!str) return null
  const short = str.match(/^#?([0-9a-fA-F]{3})$/)
  if (short) {
    const [, h] = short
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
  }
  const full = str.match(/^#?([0-9a-fA-F]{6})$/)
  if (full) return `#${full[1]}`
  const rgb = str.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i)
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number)
    return `#${[r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`
  }
  const oklch = str.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i)
  if (oklch) {
    try { return oklchToHex(+oklch[1], +oklch[2], +oklch[3]) } catch {}
  }
  return null
}
