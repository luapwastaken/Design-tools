// ── Shared Design-Mode panel UI ───────────────────────────────────────────────
// Small presentational pieces reused across the Design-Mode panels so they all
// share one visual language (the same one Generators.jsx established).

import { useState } from 'react'

export const ACCENT = '#8b5cf6'

export function Section({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        fontSize: 9, color: '#555', textTransform: 'uppercase',
        letterSpacing: 1.2, borderBottom: '1px solid #1a1a24', paddingBottom: 5,
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      }}>
        <span>{label}</span>
        {hint && <span style={{ textTransform: 'none', letterSpacing: 0, color: '#3d3d4a' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

export function FieldLabel({ children, style }) {
  return <span style={{ fontSize: 10, color: '#666', ...style }}>{children}</span>
}

export function ModeChip({ active, onClick, children, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      flex: 1,
      background: active ? '#2d1a5e' : '#131318',
      border: `1px solid ${active ? '#6d3fbe' : '#222230'}`,
      borderRadius: 5, color: active ? '#c4b5fd' : '#555',
      padding: '4px 8px', fontSize: 10, cursor: 'pointer',
      transition: 'all 0.1s', whiteSpace: 'nowrap',
    }}>
      {children}
    </button>
  )
}

export function AddBtn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      alignSelf: 'flex-start',
      background: disabled ? '#15151c' : '#1a1030',
      border: `1px solid ${disabled ? '#222230' : '#3d2a7a'}`,
      borderRadius: 5, color: disabled ? '#444' : '#9d7dea',
      padding: '5px 12px', fontSize: 10,
      cursor: disabled ? 'default' : 'pointer',
    }}
      onMouseEnter={e => { if (disabled) return; e.currentTarget.style.background = '#2d1a5e'; e.currentTarget.style.color = '#c4b5fd' }}
      onMouseLeave={e => { if (disabled) return; e.currentTarget.style.background = '#1a1030'; e.currentTarget.style.color = '#9d7dea' }}
    >
      {children}
    </button>
  )
}

export function DiceBtn({ onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 28, height: 26, background: '#131318', border: '1px solid #222230',
      borderRadius: 4, color: ACCENT, fontSize: 14, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
      transition: 'border-color 0.1s, color 0.1s',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#6d3fbe'; e.currentTarget.style.color = '#c4b5fd' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#222230'; e.currentTarget.style.color = ACCENT }}
    >
      ⚄
    </button>
  )
}

// Hoverable swatch strip with hex tooltips. Optionally maps each hex through a
// transform (e.g. CVD simulation) for display while keeping the real hex in tip.
export function SwatchStrip({ hexes, height = 52, transform }) {
  const [hovered, setHovered] = useState(null)
  return (
    <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height }}>
      {hexes.map((hex, i) => {
        const shown = transform ? transform(hex) : hex
        return (
          <div key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{
              flex: hovered === i ? 1.6 : 1,
              background: shown, position: 'relative',
              transition: 'flex 0.15s ease',
            }}
          >
            {hovered === i && (
              <div style={{
                position: 'absolute', bottom: 4, left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.7)', color: '#fff',
                fontSize: 9, padding: '2px 5px', borderRadius: 3,
                fontFamily: 'monospace', whiteSpace: 'nowrap', pointerEvents: 'none',
              }}>
                {hex}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
