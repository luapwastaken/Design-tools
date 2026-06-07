import { useState } from 'react'

// ── Shared editable-number controls ───────────────────────────────────────────
//
// Every numeric control in the app should be *editable* — click the value and
// type an exact number, or drag the slider. Use these primitives in every tool
// (and every new tab) so the behaviour stays consistent.
//
//   <NumberSlider label="Steps" min={3} max={12} value={steps} onChange={setSteps} />
//   <EditableNumber value={n} min={0} max={100} step={1} onChange={setN} suffix="%" />
//
// `accent` lets each tool theme the control to its own colour.

const DEFAULT_ACCENT = '#8b5cf6'

function decimalsFor(step) {
  if (step >= 1) return 0
  const s = String(step)
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

// Inline editable number — looks like text, becomes an input on focus.
export function EditableNumber({
  value, onChange, min = -Infinity, max = Infinity, step = 1,
  accent = DEFAULT_ACCENT, suffix = '', width = 44, dec,
  align = 'right', color = '#e0d8ff',
}) {
  const [draft, setDraft] = useState(null)
  const editing = draft !== null
  const places = dec ?? decimalsFor(step)
  const shown = typeof value === 'number'
    ? (places > 0 ? value.toFixed(places) : Math.round(value).toString())
    : String(value)

  const commit = raw => {
    const n = parseFloat(raw)
    if (!isNaN(n)) onChange(clamp(n, min, max))
    setDraft(null)
  }

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
      <input
        type="text"
        inputMode="decimal"
        value={editing ? draft : shown}
        onFocus={e => { setDraft(shown); e.target.select() }}
        onChange={e => setDraft(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { commit(e.target.value); e.target.blur() }
          else if (e.key === 'Escape') { setDraft(null); e.target.blur() }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const base = parseFloat(editing ? draft : shown)
            if (isNaN(base)) return
            const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
            const next = clamp(+(base + d).toFixed(places + 2), min, max)
            setDraft(String(next))
            onChange(next)
          }
        }}
        style={{
          width, textAlign: align, fontSize: 11, fontFamily: 'inherit',
          color: editing ? '#fff' : color,
          background: editing ? '#1a1a22' : 'transparent',
          border: `1px solid ${editing ? accent : 'transparent'}`,
          borderRadius: 3, padding: '1px 4px', outline: 'none',
          fontVariantNumeric: 'tabular-nums', cursor: 'text', boxSizing: 'border-box',
        }}
      />
      {suffix && <span style={{ fontSize: 10, color: '#666', flexShrink: 0 }}>{suffix}</span>}
    </span>
  )
}

// Label + slider + editable number, on one row.
export function NumberSlider({
  label, min, max, step = 1, value, onChange,
  accent = DEFAULT_ACCENT, suffix = '', labelWidth = 90, numWidth = 44, dec,
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {label != null && (
        <span style={{ fontSize: 10, color: '#888', minWidth: labelWidth, flexShrink: 0 }}>{label}</span>
      )}
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(+e.target.value)}
        style={{ flex: 1, accentColor: accent, minWidth: 40 }}
      />
      <EditableNumber
        value={value} onChange={onChange} min={min} max={max} step={step}
        accent={accent} suffix={suffix} width={numWidth} dec={dec}
      />
    </div>
  )
}
