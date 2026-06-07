import { useState } from 'react'

// ── Color palette ─────────────────────────────────────────────────────────────
export const C = {
  bg:     '#0b0b0d',
  panel:  '#111114',
  ctrl:   '#18181c',
  border: '#252528',
  accent: '#5ab4ff',
  text:   '#f0ede7',
  muted:  '#595960',
  dim:    '#2e2e33',
}

// ── Button style helper ───────────────────────────────────────────────────────
export function btn(accent = false) {
  return {
    padding: '5px 11px', border: 'none', borderRadius: 4,
    background: accent ? C.accent : C.ctrl,
    color: accent ? '#000' : C.muted,
    fontSize: 11, fontWeight: 700, cursor: 'pointer',
    fontFamily: 'inherit', letterSpacing: 0.3,
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

export function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: C.muted,
        textTransform: 'uppercase', paddingBottom: 8,
        borderBottom: `1px solid ${C.border}`, marginBottom: 10,
      }}>{title}</div>
      {children}
    </div>
  )
}

export function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 6 }}>
      <span style={{ fontSize: 11, color: C.muted, width: 80, flexShrink: 0, letterSpacing: 0.3 }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>{children}</div>
    </div>
  )
}

export function SliderRow({ label, min, max, step = 0.01, value, onChange, suffix = '', toFixed = 2 }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const display = step >= 1 ? Math.round(value).toString() : value.toFixed(toFixed)

  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 6 }}>
      <span style={{ fontSize: 11, color: C.muted, width: 80, flexShrink: 0 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: C.accent, cursor: 'pointer', height: 2 }}
      />
      {editing ? (
        <input autoFocus value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => {
            const v = parseFloat(draft)
            if (!isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
            setEditing(false)
          }}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setEditing(false) }}
          style={{ width: 42, fontSize: 11, background: C.ctrl, border: 'none', borderBottom: `1px solid ${C.accent}`, color: C.text, padding: '1px 2px', outline: 'none', textAlign: 'right', fontFamily: 'inherit' }}
        />
      ) : (
        <span onClick={() => { setDraft(display); setEditing(true) }}
          style={{ fontSize: 11, color: C.text, minWidth: 42, textAlign: 'right', cursor: 'text', padding: '1px 2px' }}>
          {display}{suffix}
        </span>
      )}
    </div>
  )
}

export function HexInput({ value, onChange }) {
  const [draft, setDraft] = useState('')
  const [focused, setFocused] = useState(false)

  function commit(raw) {
    const hex = raw.startsWith('#') ? raw : '#' + raw
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) onChange(hex)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        style={{ width: 20, height: 20, padding: 0, border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0 }}
      />
      <input
        value={focused ? draft : value.replace('#', '')}
        onFocus={() => { setDraft(value.replace('#', '')); setFocused(true) }}
        onBlur={() => { commit(draft); setFocused(false) }}
        onChange={e => { setDraft(e.target.value); commit(e.target.value) }}
        style={{ flex: 1, fontSize: 11, background: 'none', border: 'none', borderBottom: focused ? `1px solid ${C.accent}` : '1px solid transparent', color: C.text, padding: '1px 2px', outline: 'none', fontFamily: 'inherit' }}
      />
    </div>
  )
}

export function Toggle({ label, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, cursor: 'pointer' }}
      onClick={() => onChange(!value)}>
      <div style={{ width: 28, height: 14, borderRadius: 7, background: value ? C.accent : C.dim, position: 'relative', flexShrink: 0, transition: 'background 0.15s' }}>
        <div style={{ position: 'absolute', top: 2, left: value ? 16 : 2, width: 10, height: 10, borderRadius: '50%', background: value ? '#000' : C.muted, transition: 'left 0.15s' }} />
      </div>
      <span style={{ fontSize: 11, color: value ? C.text : C.muted }}>{label}</span>
    </div>
  )
}

export function SegmentedControl({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', background: C.ctrl, borderRadius: 4, padding: 2, gap: 2 }}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)} style={{
          flex: 1, padding: '4px 0', border: 'none', borderRadius: 3, cursor: 'pointer',
          fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
          background: value === o.value ? C.accent : 'transparent',
          color: value === o.value ? '#000' : C.muted,
          transition: 'background 0.12s, color 0.12s',
        }}>{o.label}</button>
      ))}
    </div>
  )
}
