import { useState, useMemo } from 'react'
import { contrast } from '../../lib/color.js'
import { usePalette } from './store.js'
import { Section, FieldLabel } from './panelUi.jsx'

// WCAG 2.1 thresholds
function gradePair(ratio) {
  return {
    ratio,
    aaNormal:  ratio >= 4.5,
    aaaNormal: ratio >= 7,
    aaLarge:   ratio >= 3,
    aaaLarge:  ratio >= 4.5,
    uiComp:    ratio >= 3,   // non-text UI / graphics
  }
}

export default function Grade() {
  const { swatches } = usePalette()
  const [bgId, setBgId] = useState(null)

  // default background = lightest or darkest extreme so the report is meaningful
  const bg = swatches.find(s => s.id === bgId) ?? swatches[0]
  const fgs = swatches.filter(s => s.id !== bg?.id)

  const rows = useMemo(() => fgs.map(s => ({
    s, g: gradePair(contrast(s.hex, bg?.hex ?? '#000')),
  })), [fgs, bg])

  const passAA = rows.filter(r => r.g.aaNormal).length
  const passLarge = rows.filter(r => r.g.aaLarge).length
  const worst = rows.reduce((m, r) => r.g.ratio < m ? r.g.ratio : m, Infinity)
  const best  = rows.reduce((m, r) => r.g.ratio > m ? r.g.ratio : m, 0)

  if (!bg) return <Section label="Accessibility Grade"><FieldLabel>Add swatches to grade.</FieldLabel></Section>

  return (
    <Section label="Accessibility Grade" hint="WCAG 2.1">
      {/* background picker */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <FieldLabel>Background</FieldLabel>
        {swatches.map(s => (
          <button key={s.id} onClick={() => setBgId(s.id)} title={s.hex} style={{
            width: 22, height: 22, borderRadius: 5, background: s.hex,
            border: `2px solid ${s.id === bg.id ? '#8b5cf6' : '#2a2a38'}`, cursor: 'pointer', padding: 0,
          }} />
        ))}
      </div>

      {/* summary card */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Stat label="Pass AA" value={`${passAA}/${rows.length}`} good={passAA === rows.length} />
        <Stat label="Pass AA Large" value={`${passLarge}/${rows.length}`} good={passLarge === rows.length} />
        <Stat label="Worst" value={isFinite(worst) ? worst.toFixed(1) : '—'} good={worst >= 4.5} />
        <Stat label="Best" value={best ? best.toFixed(1) : '—'} good />
      </div>

      {/* per-swatch rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(({ s, g }) => (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: bg.hex, borderRadius: 6, padding: '6px 8px', border: '1px solid #222230',
          }}>
            <span style={{ color: s.hex, fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {s.name || s.hex}
            </span>
            <span style={{ color: s.hex, fontSize: 10, opacity: 0.8, fontVariantNumeric: 'tabular-nums' }}>
              {g.ratio.toFixed(2)}
            </span>
            <Badge ok={g.aaNormal} alt={g.aaLarge}>AA</Badge>
            <Badge ok={g.aaaNormal} alt={g.aaaLarge}>AAA</Badge>
          </div>
        ))}
      </div>
      <FieldLabel style={{ color: '#3d3d4a' }}>
        Filled = passes normal text · outline = large/UI only · empty = fails
      </FieldLabel>
    </Section>
  )
}

function Stat({ label, value, good }) {
  return (
    <div style={{
      flex: 1, background: '#131318', border: '1px solid #222230', borderRadius: 6,
      padding: '6px 4px', textAlign: 'center',
    }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: good ? '#7ee787' : '#e0a060', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 8, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
    </div>
  )
}

function Badge({ ok, alt, children }) {
  // ok = passes for normal text, alt = passes for large/UI only
  const state = ok ? 'full' : alt ? 'alt' : 'none'
  const styles = {
    full: { background: '#16331f', border: '#2e7d44', color: '#7ee787' },
    alt:  { background: 'transparent', border: '#5a4a20', color: '#e0a060' },
    none: { background: 'transparent', border: '#3a2024', color: '#7a4048' },
  }[state]
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
      background: styles.background, border: `1px solid ${styles.border}`, color: styles.color,
      letterSpacing: 0.5,
    }}>
      {children}
    </span>
  )
}
