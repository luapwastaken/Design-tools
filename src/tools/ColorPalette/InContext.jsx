import { useState, useMemo } from 'react'
import { contrast } from '../../lib/color.js'
import { usePalette } from './store.js'
import { Section, FieldLabel, Hint, ModeChip, Select, Badge, T } from './panelUi.jsx'

// ── Your palette as a real layout ─────────────────────────────────────────────
//
// Swatch chips flatter a palette; a real layout does not. The same mockup as
// Recipes' "In context" section, but fed by the user's own swatches instead of
// a generated system — slots default from roles (falling back to lightness /
// chroma heuristics) and each is overridable.

const SLOTS = [
  { key: 'background', label: 'Background' },
  { key: 'surface',    label: 'Surface' },
  { key: 'text',       label: 'Text' },
  { key: 'primary',    label: 'Primary' },
  { key: 'accent',     label: 'Accent' },
  { key: 'muted',      label: 'Muted' },
]

const byRole = (swatches, role) => swatches.find(s => s.role === role)
const byL = (swatches, dir) => [...swatches].sort((a, b) => dir * (a.oklch.l - b.oklch.l))[0]
const byChroma = swatches => [...swatches].sort((a, b) => b.oklch.c - a.oklch.c)

// Every slot must resolve to a swatch no matter how thin the palette is —
// with a single swatch every slot lands on it.
function defaultSlots(swatches) {
  const background = byRole(swatches, 'white') || byL(swatches, -1)
  const text = byRole(swatches, 'black') || byL(swatches, 1)
  const chromatic = byChroma(swatches)
  const primary = byRole(swatches, 'main') || chromatic[0]
  const accent = byRole(swatches, 'accent') || byRole(swatches, 'pop') || chromatic[1] || chromatic[0]
  const surface =
    swatches.filter(s => s.oklch.l !== background.oklch.l)
      .sort((a, b) => Math.abs(a.oklch.l - background.oklch.l) - Math.abs(b.oklch.l - background.oklch.l))[0]
    || background
  const mid = (background.oklch.l + text.oklch.l) / 2
  const muted = [...swatches].sort((a, b) => Math.abs(a.oklch.l - mid) - Math.abs(b.oklch.l - mid))[0]
  return { background, surface, text, primary, accent, muted }
}

function ratioWord(r) {
  return r >= 4.5 ? { word: 'AA', tone: 'pass' }
    : r >= 3 ? { word: 'Large only', tone: 'partial' }
    : { word: 'fails', tone: 'fail' }
}

export default function InContext() {
  const { swatches } = usePalette()
  const [overrides, setOverrides] = useState({})
  const [compact, setCompact] = useState(false)

  const defaults = useMemo(() => (swatches.length ? defaultSlots(swatches) : null), [swatches])

  if (!swatches.length) {
    return <Hint>Add swatches to your palette to see them in context.</Hint>
  }

  // An override pointing at a deleted swatch silently reverts to the default,
  // so removing a colour never strands a slot.
  const slot = key => {
    const o = overrides[key] && swatches.find(s => s.id === overrides[key])
    return o || defaults[key]
  }
  const hex = key => slot(key).hex

  // The mockup's type/padding stands in for a real website's scale — it is
  // content, not chrome, so it scales freely below the panel's 11px floor.
  const k = compact ? 0.8 : 1
  const px = n => Math.round(n * k * 10) / 10

  // Solid-button labels use whichever of the palette's own extremes reads best
  // on the fill — never a hardcoded white or black.
  const onSolid = fill => contrast(hex('background'), fill) >= contrast(hex('text'), fill)
    ? hex('background') : hex('text')

  const setSlot = (key, id) => setOverrides(prev => ({ ...prev, [key]: id }))

  const textRatio = contrast(hex('text'), hex('background'))
  const mutedRatio = contrast(hex('muted'), hex('background'))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Slot overrides ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {SLOTS.map(({ key, label }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FieldLabel style={{ width: 74, flexShrink: 0 }}>{label}</FieldLabel>
            <span style={{
              width: 16, height: 16, borderRadius: 4, flexShrink: 0,
              background: hex(key), border: `1px solid ${T.line}`,
            }} />
            <Select
              value={slot(key).id}
              onChange={e => setSlot(key, e.target.value)}
              style={{ flex: 1 }}
              aria-label={`${label} slot`}
            >
              {swatches.map(s => (
                <option key={s.id} value={s.id}>{s.name || s.hex}</option>
              ))}
            </Select>
          </div>
        ))}
      </div>

      {/* ── Live mockup ────────────────────────────────────────────────────── */}
      <Section label="In context">
        <div style={{ display: 'flex', gap: 4 }}>
          <ModeChip active={!compact} onClick={() => setCompact(false)}>Comfortable</ModeChip>
          <ModeChip active={compact} onClick={() => setCompact(true)}>Compact</ModeChip>
        </div>

        <div style={{
          background: hex('background'), borderRadius: 8,
          padding: px(16), border: `1px solid ${T.line}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: px(8), marginBottom: px(12) }}>
            <span style={{ width: px(22), height: px(22), borderRadius: px(6), background: hex('primary'), flexShrink: 0 }} />
            <span style={{ color: hex('text'), fontSize: px(14), fontWeight: 700, flex: 1 }}>Aa Brand</span>
            <span style={{ color: hex('muted'), fontSize: px(11) }}>Home</span>
            <span style={{ color: hex('muted'), fontSize: px(11) }}>Pricing</span>
          </div>

          <div style={{ background: hex('surface'), borderRadius: px(8), padding: px(12), marginBottom: px(12) }}>
            <div style={{ color: hex('text'), fontSize: px(12), fontWeight: 600, marginBottom: px(4) }}>Card title</div>
            <div style={{ color: hex('muted'), fontSize: px(11), lineHeight: 1.5 }}>
              Supporting copy sits on a raised surface above the page background.<br />
              Secondary information stays readable without competing with the title.
            </div>
          </div>

          <div style={{ display: 'flex', gap: px(8) }}>
            <span style={{ background: hex('primary'), color: onSolid(hex('primary')), fontSize: px(11), fontWeight: 600, padding: `${px(6)}px ${px(14)}px`, borderRadius: px(6) }}>Primary</span>
            <span style={{ background: hex('accent'), color: onSolid(hex('accent')), fontSize: px(11), fontWeight: 600, padding: `${px(6)}px ${px(14)}px`, borderRadius: px(6) }}>Get started</span>
            <span style={{ border: `1px solid ${hex('accent')}`, color: hex('accent'), fontSize: px(11), fontWeight: 600, padding: `${px(5)}px ${px(13)}px`, borderRadius: px(6) }}>Learn more</span>
          </div>
        </div>

        {/* ── Contrast readout ─────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {[
            { label: 'Text on background', ratio: textRatio },
            { label: 'Muted on background', ratio: mutedRatio },
          ].map(({ label, ratio }) => {
            const { word, tone } = ratioWord(ratio)
            return (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <FieldLabel style={{ color: T.muted }}>{label}</FieldLabel>
                <span className="cp-num" style={{ fontSize: T.label, color: T.textDim }}>{ratio.toFixed(2)}:1</span>
                <Badge tone={tone}>{word}</Badge>
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}
