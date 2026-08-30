// ── Shared panel UI ───────────────────────────────────────────────────────────
//
// The single component vocabulary for the Color Palette tool. Before this file
// carried its weight the tool had 25 locally-defined presentational components
// across 22 files — three separate AddBtn implementations, two ModeChips, two
// SwatchStrips, two Sections — each with its own padding, radius and hover
// behaviour. Panels import from here; they do not redefine.
//
// Interaction state (:hover, :focus-visible, :disabled) lives in
// colorpalette.css. Inline styles here handle layout only, so a hover rule is
// written once instead of once per button.

import { useState } from 'react'
import Icon from '../../components/Icon.jsx'
import { T, MONO } from './tokens.js'

export { T, MONO }
export const ACCENT = T.accent

// ── Structure ─────────────────────────────────────────────────────────────────

export function Section({ label, hint, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="cp-micro" style={{
        borderBottom: `1px solid ${T.line}`, paddingBottom: 6,
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10,
      }}>
        <span>{label}</span>
        {hint && (
          <span className="cp-hint" style={{ textTransform: 'none', letterSpacing: 0, textAlign: 'right' }}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

// A raised container for one result, finding or recipe.
export function Card({ children, tone, style }) {
  const edge = tone === 'accent' ? T.accentLine : T.line
  return (
    <div style={{
      background: T.raised, border: `1px solid ${edge}`,
      borderRadius: T.rLg, padding: 12, ...style,
    }}>
      {children}
    </div>
  )
}

// ── Text ──────────────────────────────────────────────────────────────────────

export function FieldLabel({ children, style }) {
  return <span className="cp-label" style={style}>{children}</span>
}

export function Hint({ children, style }) {
  return <p className="cp-hint" style={{ margin: 0, ...style }}>{children}</p>
}

export function Body({ children, style }) {
  return <p className="cp-body" style={{ margin: 0, ...style }}>{children}</p>
}

// Hex codes, ratios, percentages — anything columnar or compared by eye.
export function Num({ children, style }) {
  return <span className="cp-num" style={style}>{children}</span>
}

// ── Buttons ───────────────────────────────────────────────────────────────────

export function Btn({ children, onClick, variant = 'default', disabled, title, style, type = 'button' }) {
  const cls = variant === 'default' ? 'cp-btn' : `cp-btn cp-btn--${variant}`
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled} style={style} className={cls}>
      {children}
    </button>
  )
}

// Compact button for dense action rows (bulk bar, inline fixes).
export function MiniBtn({ children, onClick, variant, disabled, title, style }) {
  return (
    <Btn onClick={onClick} variant={variant} disabled={disabled} title={title}
      style={{ padding: '4px 9px', fontSize: T.label, ...style }}>
      {children}
    </Btn>
  )
}

export function IconBtn({ children, onClick, title, danger, disabled, style }) {
  const cls = danger ? 'cp-icon-btn cp-icon-btn--danger' : 'cp-icon-btn'
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} style={style} className={cls}>
      {children}
    </button>
  )
}

export function AddBtn({ children, onClick, disabled, style }) {
  return (
    <Btn variant="primary" onClick={onClick} disabled={disabled}
      style={{ alignSelf: 'flex-start', ...style }}>
      {children}
    </Btn>
  )
}

export function StepBtn({ children, onClick, title }) {
  return (
    <Btn onClick={onClick} title={title}
      style={{ width: 26, height: 26, padding: 0, fontSize: T.title }}>
      {children}
    </Btn>
  )
}

export function DiceBtn({ onClick, title = 'Reroll' }) {
  return (
    <Btn onClick={onClick} title={title}
      style={{ width: 30, height: 28, padding: 0, fontSize: T.title, color: T.accentText }}>
      ⚄
    </Btn>
  )
}

// Segmented-control member / filter toggle.
export function ModeChip({ active, onClick, children, title, grow = true }) {
  const cls = active ? 'cp-chip is-active' : 'cp-chip'
  return (
    <button type="button" onClick={onClick} title={title} className={cls}
      aria-pressed={active} style={{ flex: grow ? 1 : '0 0 auto' }}>
      {children}
    </button>
  )
}

// ── Form controls ─────────────────────────────────────────────────────────────

export function Input({ value, onChange, placeholder, mono, style, ...rest }) {
  const cls = mono ? 'cp-input cp-input--mono' : 'cp-input'
  return (
    <input value={value} onChange={onChange} placeholder={placeholder}
      className={cls} style={style} {...rest} />
  )
}

export function Select({ value, onChange, children, style, ...rest }) {
  return (
    <select value={value} onChange={onChange} className="cp-select" style={style} {...rest}>
      {children}
    </select>
  )
}

// ── Readouts ──────────────────────────────────────────────────────────────────

export function Stat({ label, value, good }) {
  return (
    <div style={{
      flex: 1, background: T.raised, border: `1px solid ${T.line}`,
      borderRadius: T.rLg, padding: '8px 6px', textAlign: 'center',
    }}>
      <div className="cp-num" style={{
        fontSize: T.display, fontWeight: 700,
        color: good ? T.ok : T.warn,
      }}>{value}</div>
      <div className="cp-micro" style={{ marginTop: 2 }}>{label}</div>
    </div>
  )
}

export function Badge({ tone = 'neutral', children, title }) {
  const tones = {
    pass:    { bg: 'rgba(74,222,128,0.12)',  border: 'rgba(74,222,128,0.45)',  color: T.ok },
    partial: { bg: 'transparent',            border: 'rgba(251,191,36,0.45)',  color: T.warn },
    fail:    { bg: 'transparent',            border: 'rgba(248,113,113,0.35)', color: T.bad },
    neutral: { bg: 'transparent',            border: T.line,                   color: T.muted },
  }[tone]
  return (
    <span title={title} style={{
      fontSize: T.micro, fontWeight: 700, padding: '3px 7px', borderRadius: 4,
      background: tones.bg, border: `1px solid ${tones.border}`, color: tones.color,
      letterSpacing: 0.5, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

// ── Swatch strips ─────────────────────────────────────────────────────────────

// Hoverable strip with hex tooltips. `transform` maps each hex for display
// (e.g. CVD simulation) while the tooltip still reports the real colour.
export function SwatchStrip({ hexes, height = 52, transform }) {
  const [hovered, setHovered] = useState(null)
  return (
    <div style={{ display: 'flex', borderRadius: T.rLg, overflow: 'hidden', height, border: `1px solid ${T.line}` }}>
      {hexes.map((hex, i) => (
        <div key={i}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
          title={hex}
          style={{
            flex: hovered === i ? 1.6 : 1,
            background: transform ? transform(hex) : hex,
            position: 'relative', transition: 'flex 0.15s ease',
          }}
        >
          {hovered === i && <HexTip hex={hex} />}
        </div>
      ))}
    </div>
  )
}

// Coolors-style strip: click a slot to pin it so a reroll leaves it alone.
export function LockableStrip({ hexes, locked, onToggle, height = 56 }) {
  const [hovered, setHovered] = useState(null)
  return (
    <div style={{ display: 'flex', borderRadius: T.rLg, overflow: 'hidden', height, border: `1px solid ${T.line}` }}>
      {hexes.map((hex, i) => {
        const isLocked = locked[i] != null
        const fg = isLightHex(hex) ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.9)'
        const tip = isLocked ? 'locked, reroll keeps it' : 'unlocked, reroll changes it'
        return (
          <button key={i} type="button"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onToggle(i)}
            aria-pressed={isLocked}
            title={`${hex} — ${tip}`}
            style={{
              flex: 1, background: hex, position: 'relative', cursor: 'pointer',
              border: 'none', padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {(isLocked || hovered === i) && (
              <Icon name={isLocked ? 'lock' : 'lock_open'} size={14} color={fg} />
            )}
            {hovered === i && <HexTip hex={hex} />}
          </button>
        )
      })}
    </div>
  )
}

function HexTip({ hex }) {
  return (
    <span className="cp-num" style={{
      position: 'absolute', bottom: 4, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(0,0,0,0.78)', color: '#fff', fontSize: T.micro,
      padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap', pointerEvents: 'none',
    }}>{hex}</span>
  )
}

export function isLightHex(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55
}
