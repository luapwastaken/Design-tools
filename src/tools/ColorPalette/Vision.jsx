import { useMemo } from 'react'
import { simulateCVD, CVD_TYPES, deltaE } from '../../lib/color.js'
import { usePalette } from './store.js'
import { Section, FieldLabel, T } from './panelUi.jsx'

export default function Vision() {
  const { swatches } = usePalette()
  const hexes = swatches.map(s => s.hex)

  // Flag swatch pairs that collapse together under any CVD type — the colours a
  // colour-blind viewer can no longer tell apart. deltaE < ~10 ≈ hard to distinguish.
  const collisions = useMemo(() => {
    const out = []
    for (const t of CVD_TYPES) {
      if (t.id === 'normal') continue
      for (let i = 0; i < hexes.length; i++) {
        for (let j = i + 1; j < hexes.length; j++) {
          const a = simulateCVD(hexes[i], t.id)
          const b = simulateCVD(hexes[j], t.id)
          const dOrig = deltaE(hexes[i], hexes[j])
          const dSim = deltaE(a, b)
          if (dOrig > 12 && dSim < 8) out.push({ type: t.label, i, j })
        }
      }
    }
    return out
  }, [hexes])

  if (!hexes.length) return <Section label="Vision Check"><FieldLabel>Add swatches to simulate.</FieldLabel></Section>

  return (
    <Section label="Vision Check" hint="colour-blind simulation">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CVD_TYPES.map(t => (
          <div key={t.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
              <FieldLabel style={{ color: T.muted }}>{t.label}</FieldLabel>
              <FieldLabel style={{ color: T.faint, fontSize: T.micro }}>{t.note}</FieldLabel>
            </div>
            <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 32 }}>
              {hexes.map((h, i) => (
                <div key={i} style={{ flex: 1, background: simulateCVD(h, t.id) }} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {collisions.length > 0 ? (
        <div style={{
          background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.35)', borderRadius: T.rLg, padding: '10px 12px',
        }}>
          <div style={{ fontSize: T.label, color: T.warn, fontWeight: 600, marginBottom: 4 }}>
            {collisions.length} indistinguishable pair{collisions.length > 1 ? 's' : ''}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {collisions.slice(0, 6).map((c, k) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: T.body, color: T.textDim }}>
                <span style={{ width: 16, height: 16, borderRadius: 3, background: hexes[c.i], border: '1px solid rgba(0,0,0,0.35)' }} />
                <span style={{ width: 16, height: 16, borderRadius: 3, background: hexes[c.j], border: '1px solid rgba(0,0,0,0.35)' }} />
                collapse under {c.type}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <FieldLabel style={{ color: T.ok }}>No colour collisions detected — the palette is CVD-safe.</FieldLabel>
      )}
    </Section>
  )
}
