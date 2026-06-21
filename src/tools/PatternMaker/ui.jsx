import { useState } from 'react'

// ── Shared helpers + controls for the Pattern Maker tabs ────────────────────────
// Extracted verbatim from the original single-file PatternMaker so the Shapes and
// Meteorite tabs reuse the same chrome and inputs.

export function mkRng(s) {
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function parseSvg(text) {
  try {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    if (doc.querySelector('parsererror')) return null
    const el = doc.querySelector('svg')
    if (!el) return null
    const vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number)
    const W = vb[2] || +el.getAttribute('width') || 100
    const H = vb[3] || +el.getAttribute('height') || 100
    const inner = el.innerHTML
      .replace(/<(style|title|desc)[\s\S]*?<\/\1>/gi, '')
      .replace(/\s+(id|data-name|class)="[^"]*"/g, '')
      .replace(/\sfill="[^"]*"/g, '')
      .replace(/fill\s*:[^;}"']+/g, '')
    return { content: inner, vbW: W, vbH: H }
  } catch { return null }
}

export const C = {
  bg: '#0b0b0d', panel: '#111114', ctrl: '#18181c',
  border: '#252528', accent: '#e8a838', text: '#f0ede7',
  muted: '#595960', dim: '#2e2e33',
}

export const MIN_PANEL = 200
export const MAX_PANEL = 480

export const Section = ({ title, children }) => (
  <div style={{ marginBottom: 18 }}>
    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: C.muted,
      textTransform: 'uppercase', marginBottom: 10, paddingBottom: 5,
      borderBottom: `1px solid ${C.border}` }}>
      {title}
    </div>
    {children}
  </div>
)

export const CtrlRow = ({ label, val, children }) => (
  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 7, gap: 8 }}>
    <div style={{ fontSize: 11, color: C.muted, width: 72, flexShrink: 0 }}>{label}</div>
    {children}
    {val !== undefined && (
      <div style={{ fontSize: 11, color: C.accent, width: 40, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{val}</div>
    )}
  </div>
)

export const Slider = ({ min, max, value, onChange, step = 1 }) => (
  <input type="range" min={min} max={max} value={value} step={step}
    onChange={e => onChange(+e.target.value)}
    style={{ flex: 1, accentColor: C.accent }} />
)

export const SliderRow = ({ label, min, max, value, onChange, step = 1, suffix = '' }) => {
  const [draft, setDraft] = useState(null)
  const [scrubbing, setScrubbing] = useState(false)
  const commit = raw => {
    const n = parseFloat(raw)
    if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)))
    setDraft(null)
  }
  const active = draft !== null

  // Drag the label horizontally to scrub the value (full range over ~200px).
  const onScrubStart = e => {
    e.preventDefault()
    const startX = e.clientX
    const startVal = value
    const perPx = (max - min) / 200
    setScrubbing(true)
    document.body.style.cursor = 'ew-resize'
    const move = ev => {
      const raw = startVal + (ev.clientX - startX) * perPx
      const snapped = Math.round(raw / step) * step
      onChange(Math.min(max, Math.max(min, snapped)))
    }
    const up = () => {
      setScrubbing(false)
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 7, gap: 8 }}>
      <div onMouseDown={onScrubStart} title="Drag to scrub"
        style={{ fontSize: 11, color: scrubbing ? C.accent : C.muted, width: 72, flexShrink: 0,
          cursor: 'ew-resize', userSelect: 'none' }}>{label}</div>
      <input type="range" min={min} max={max} value={value} step={step}
        onChange={e => onChange(+e.target.value)}
        style={{ flex: 1, accentColor: C.accent }} />
      <input
        type="text"
        value={active ? draft : String(value)}
        onFocus={e => { setDraft(String(value)); e.target.select() }}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { commit(e.target.value); e.target.blur() }
          if (e.key === 'Escape') { setDraft(null); e.target.blur() }
        }}
        style={{
          fontSize: 11, color: C.accent, width: 38, textAlign: 'right', flexShrink: 0,
          background: active ? C.ctrl : 'transparent',
          border: active ? `1px solid ${C.accent}` : 'none',
          borderRadius: 3, outline: 'none', fontFamily: 'inherit',
          padding: active ? '1px 3px' : '0',
          fontVariantNumeric: 'tabular-nums', cursor: 'text',
        }}
      />
      {suffix && <span style={{ fontSize: 11, color: C.muted, flexShrink: 0 }}>{suffix}</span>}
    </div>
  )
}

export const HexInput = ({ value, onChange }) => {
  const [draft, setDraft] = useState(null)
  const valid = v => /^#[0-9a-fA-F]{6}$/.test(v)
  const commit = raw => {
    const v = raw.startsWith('#') ? raw : `#${raw}`
    if (valid(v)) onChange(v)
    setDraft(null)
  }
  const active = draft !== null
  return (
    <input
      type="text"
      value={active ? draft : value}
      onFocus={e => { setDraft(value); e.target.select() }}
      onChange={e => {
        const v = e.target.value
        setDraft(v)
        const c = v.startsWith('#') ? v : `#${v}`
        if (valid(c)) onChange(c)
      }}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') commit(e.target.value); if (e.key === 'Escape') setDraft(null) }}
      style={{
        fontSize: 11, color: active ? C.text : C.muted, flex: 1,
        background: 'transparent', border: 'none',
        borderBottom: `1px solid ${active ? C.accent : 'transparent'}`,
        outline: 'none', fontFamily: 'inherit', padding: '0 2px', letterSpacing: '0.05em',
        cursor: 'text',
      }}
    />
  )
}

export const Toggle = ({ value, onChange, label }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none', marginBottom: 7 }}>
    <div onClick={() => onChange(!value)} style={{ width: 28, height: 15, borderRadius: 8,
      background: value ? C.accent : C.dim, position: 'relative', transition: 'background .2s', flexShrink: 0 }}>
      <div style={{ position: 'absolute', top: 2, left: value ? 13 : 2, width: 11, height: 11,
        borderRadius: '50%', background: value ? '#000' : C.muted, transition: 'left .15s' }} />
    </div>
    <span style={{ fontSize: 11, color: value ? C.text : C.muted }}>{label}</span>
  </label>
)

// A color swatch + hex field row, used by both tabs.
export const ColorRow = ({ label, value, onChange }) => (
  <CtrlRow label={label}>
    <input type="color" value={value} onChange={e => onChange(e.target.value)}
      style={{ width: 36, height: 24, border: `1px solid ${C.border}`, borderRadius: 3, background: 'none', cursor: 'pointer', flexShrink: 0 }} />
    <HexInput value={value} onChange={onChange} />
  </CtrlRow>
)

export const btn = (accent) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  padding: '6px 14px', borderRadius: 4, border: 'none', cursor: 'pointer',
  fontSize: 11, fontWeight: 700, fontFamily: 'inherit',
  background: accent ? C.accent : C.ctrl,
  color: accent ? '#000' : C.muted,
})

// Small segmented control (used for the tab switcher and inline option pickers).
export const Segmented = ({ value, options, onChange, small }) => (
  <div style={{ display: 'flex', gap: 3 }}>
    {options.map(([v, l]) => (
      <button key={v} onClick={() => onChange(v)} style={{
        flex: 1, padding: small ? '4px 0' : '5px 0',
        border: `1px solid ${value === v ? C.accent : C.border}`,
        borderRadius: 3, background: value === v ? C.accent : 'transparent',
        color: value === v ? '#000' : C.muted, cursor: 'pointer', fontSize: 10,
        fontWeight: value === v ? 700 : 400, fontFamily: 'inherit', letterSpacing: '0.04em',
      }}>{l}</button>
    ))}
  </div>
)

// The shared draggable panel-resize handle. Calls onResizeStart(e) on mousedown.
export const ResizeHandle = ({ onResizeStart }) => (
  <div
    onMouseDown={onResizeStart}
    style={{ position: 'absolute', top: 0, right: 0, width: 5, height: '100%',
      cursor: 'col-resize', zIndex: 10, background: 'transparent' }}
    onMouseEnter={e => e.currentTarget.style.background = C.accent + '44'}
    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
  />
)
