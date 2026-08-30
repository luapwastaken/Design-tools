import { useMemo, useState } from 'react'
import { usePalette } from './store.js'
import { valueStructure } from './checks.js'
import { T, Section, Hint, ModeChip, FieldLabel, Finding } from './panelUi.jsx'

// ── Value structure ───────────────────────────────────────────────────────────
//
// The squint test. Colour is the loudest thing about a palette and the least
// important to whether it works: strip the hue and what's left is the structure
// everything else rests on. The tool had a greyscale toggle but nothing that
// analysed what the toggle revealed.
//
// Sorted by OKLCH lightness, which is perceptual — equal numeric steps read as
// equal steps — so the ramp below is an honest picture of the spacing rather
// than a plot of sRGB numbers.

export default function ValueStructure() {
  const { swatches } = usePalette()
  const [mode, setMode] = useState('both') // 'both' | 'grey' | 'colour'
  const { findings, rows, range, collisions } = useMemo(
    () => valueStructure(swatches), [swatches]
  )

  if (swatches.length < 2) {
    return <Hint>Add at least two swatches to read the palette's value structure.</Hint>
  }

  const collidingIds = new Set(collisions.flatMap(c => [c.a.sw.id, c.b.sw.id]))
  const showGrey = mode !== 'colour'
  const showColour = mode !== 'grey'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 720 }}>

      <Section label="The ramp" hint={`${rows.length} colours · ${Math.round(range * 100)}-point spread`}>
        <div style={{ display: 'flex', gap: 4 }}>
          <ModeChip active={mode === 'both'} onClick={() => setMode('both')}>Side by side</ModeChip>
          <ModeChip active={mode === 'grey'} onClick={() => setMode('grey')}>Greyscale only</ModeChip>
          <ModeChip active={mode === 'colour'} onClick={() => setMode('colour')}>Colour only</ModeChip>
        </div>

        {/* Sorted darkest to lightest, so uneven spacing and doubled-up values
            are visible as shape rather than something you have to read. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {rows.map(({ sw, l }) => {
            const clash = collidingIds.has(sw.id)
            return (
              <div key={sw.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '3px 6px', borderRadius: 6,
                background: clash ? 'rgba(248,113,113,0.09)' : 'transparent',
                border: `1px solid ${clash ? 'rgba(248,113,113,0.3)' : 'transparent'}`,
              }}>
                <span style={{
                  fontSize: T.label, color: clash ? T.bad : T.muted,
                  width: 118, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{sw.name || sw.hex}</span>

                {showColour && <Chip hex={sw.hex} />}
                {showGrey && <Chip hex={sw.hex} grey />}

                {/* The bar is the value itself — length is lightness. */}
                <div style={{ flex: 1, height: 12, background: T.control, borderRadius: 6, overflow: 'hidden', minWidth: 60 }}>
                  <div style={{
                    width: `${l * 100}%`, height: '100%',
                    background: `hsl(0 0% ${Math.round(l * 100)}%)`,
                  }} />
                </div>
                <span className="cp-num" style={{ fontSize: T.label, color: T.muted, width: 40, textAlign: 'right' }}>
                  {Math.round(l * 100)}%
                </span>
              </div>
            )
          })}
        </div>

        <Hint>
          Bar length is OKLCH lightness. Two bars the same length are the same value —
          they will read as one colour in greyscale, in single-colour print, and to
          anyone squinting at your work from across a room.
        </Hint>
      </Section>

      <Section label="Findings">
        {findings.map((f, i) => <Finding key={i} sev={f.sev}>{f.text}</Finding>)}
      </Section>
    </div>
  )
}

function Chip({ hex, grey }) {
  return (
    <span
      title={grey ? `${hex} — value only` : hex}
      style={{
        width: 30, height: 22, borderRadius: 4, flexShrink: 0,
        background: hex, border: `1px solid ${T.line}`,
        filter: grey ? 'grayscale(1)' : undefined,
      }}
    />
  )
}
