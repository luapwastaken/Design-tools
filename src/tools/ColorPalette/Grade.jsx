import { useState, useMemo } from 'react'
import { contrast } from '../../lib/color.js'
import { usePalette } from './store.js'
import { Section, FieldLabel, Stat, Badge, T } from './panelUi.jsx'

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
          <button key={s.id} type="button" onClick={() => setBgId(s.id)}
            title={`Grade against ${s.name || s.hex}`}
            aria-label={`Grade against ${s.name || s.hex}`}
            aria-pressed={s.id === bg.id}
            style={{
              width: 26, height: 26, borderRadius: 5, background: s.hex,
              border: `2px solid ${s.id === bg.id ? T.accent : T.line}`, cursor: 'pointer', padding: 0,
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

      {/* Per-swatch rows.
          The row used to be one block of the background colour with the swatch
          name written on it in the swatch's own colour — so the worse a colour
          scored, the harder its own row was to read, and the colours the report
          existed to flag were the ones you couldn't make out. The demonstration
          is worth keeping, so it stays as a fixed sample panel on the left; the
          name, ratio and badges moved onto the panel background where they are
          always legible. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {rows.map(({ s, g }) => (
          <div key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: T.raised, borderRadius: T.rLg, border: `1px solid ${T.line}`,
            padding: 4, paddingRight: 10,
          }}>
            <span aria-hidden style={{
              background: bg.hex, color: s.hex,
              width: 62, flexShrink: 0, textAlign: 'center',
              borderRadius: 5, padding: '6px 0',
              fontSize: T.body, fontWeight: 600, lineHeight: 1.2,
            }}>Aa</span>
            <span style={{
              color: T.text, fontSize: T.body, fontWeight: 500,
              flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {s.name || s.hex}
            </span>
            <span className="cp-num" style={{
              color: g.aaNormal ? T.ok : g.aaLarge ? T.warn : T.bad,
              fontSize: T.body, fontWeight: 600,
            }}>
              {g.ratio.toFixed(2)}
            </span>
            <Badge tone={g.aaNormal ? 'pass' : g.aaLarge ? 'partial' : 'fail'}
              title={`${g.ratio.toFixed(2)}:1 — AA needs 4.5:1 for normal text, 3:1 for large`}>AA</Badge>
            <Badge tone={g.aaaNormal ? 'pass' : g.aaaLarge ? 'partial' : 'fail'}
              title={`${g.ratio.toFixed(2)}:1 — AAA needs 7:1 for normal text, 4.5:1 for large`}>AAA</Badge>
          </div>
        ))}
      </div>
      <FieldLabel style={{ color: T.faint }}>
        Green = passes for normal text · amber = large or UI text only · red = fails
      </FieldLabel>
    </Section>
  )
}
