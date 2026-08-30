import { useMemo, useState } from 'react'
import { usePalette, setPrintProfile } from './store.js'
import { reproduction, INK_LIBRARIES } from './checks.js'
import { tac } from '../../lib/cmyk.js'
import iccProfiles from '../../data/iccProfiles.json'
import { T, Section, Hint, Finding, Select, FieldLabel, Badge, ModeChip } from './panelUi.jsx'

// ── Reproduction ──────────────────────────────────────────────────────────────
//
// Will the palette survive leaving the screen? Every number here already existed
// in lib/cmyk.js and lib/colorMatch.js, and PrintPanel already showed them — for
// the active swatch, one at a time. Nothing had ever asked the question of the
// whole palette at once, which is the only altitude at which "can we print this
// job" is answerable.
//
// There is deliberately no CMYK round-trip ΔE column. The conversion in cmyk.js
// is a naive GCR formula and very nearly invertible, so a round-trip would report
// ~0 for every colour and amount to a check that always passes. TAC is measured
// against the profile's real limit and the ink match is real ΔE against real ink
// libraries, so both mean something.

export default function Reproduction() {
  const { swatches, printProfile } = usePalette()
  const [libraryId, setLibraryId] = useState('riso')

  const { findings, rows, profile, library } = useMemo(
    () => reproduction(swatches, printProfile, libraryId),
    [swatches, printProfile, libraryId]
  )

  if (!swatches.length) return <Hint>Add swatches to check how they reproduce.</Hint>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>

      <Section label="Destination" hint={`${profile.description} · ${profile.tac}% ink limit`}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <FieldLabel style={{ minWidth: 54 }}>Profile</FieldLabel>
          <Select value={printProfile} onChange={e => setPrintProfile(e.target.value)}
            aria-label="Print profile" style={{ flex: 1, minWidth: 200 }}>
            {iccProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <FieldLabel style={{ minWidth: 54 }}>Inks</FieldLabel>
          <div style={{ display: 'flex', gap: 4, flex: 1 }}>
            {INK_LIBRARIES.map(l => (
              <ModeChip key={l.id} active={libraryId === l.id} onClick={() => setLibraryId(l.id)}
                title={`Match against the ${l.label} library (${l.data.length} inks)`}>
                {l.label}
              </ModeChip>
            ))}
          </div>
        </div>
      </Section>

      <Section label="Findings">
        {findings.map((f, i) => <Finding key={i} sev={f.sev}>{f.text}</Finding>)}
      </Section>

      <Section label="Per colour" hint={`nearest ${library.label} ink by ΔE`}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
            <thead>
              <tr>
                {['', 'Colour', 'CMYK', 'Ink', `Nearest ${library.label}`, 'Match'].map(h => (
                  <th key={h} className="cp-micro" style={{
                    textAlign: 'left', padding: '0 8px 6px 0',
                    borderBottom: `1px solid ${T.line}`, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ sw, cmyk, tac: t, rich, srgb, ink }) => (
                <tr key={sw.id}>
                  <td style={cell}>
                    <span style={{
                      width: 24, height: 24, borderRadius: 4, display: 'block',
                      background: sw.hex, border: `1px solid ${T.line}`,
                    }} />
                  </td>
                  <td style={{ ...cell, maxWidth: 150 }}>
                    <div style={{
                      fontSize: T.body, color: T.text,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{sw.name || sw.hex}</div>
                    {!srgb && <span className="cp-micro" style={{ color: T.bad }}>out of sRGB</span>}
                  </td>
                  <td style={cell}>
                    <span className="cp-num" style={{ fontSize: T.label, color: T.muted, whiteSpace: 'nowrap' }}>
                      {cmyk.c}/{cmyk.m}/{cmyk.y}/{cmyk.k}
                    </span>
                  </td>
                  <td style={cell}>
                    <span className="cp-num" style={{
                      fontSize: T.body, fontWeight: 600,
                      color: t.over ? T.bad : tac(cmyk) > t.limit * 0.9 ? T.warn : T.muted,
                    }}>{t.tac}%</span>
                    {t.over && <div className="cp-micro" style={{ color: T.bad }}>over {t.limit}%</div>}
                    {rich && <div className="cp-micro" style={{ color: T.warn }}>flat black</div>}
                  </td>
                  <td style={{ ...cell, maxWidth: 160 }}>
                    {ink ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          width: 16, height: 16, borderRadius: 3, flexShrink: 0,
                          background: ink.hex, border: `1px solid ${T.line}`,
                        }} />
                        <span style={{
                          fontSize: T.label, color: T.textDim,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{ink.name}</span>
                      </div>
                    ) : <span className="cp-label" style={{ color: T.faint }}>—</span>}
                  </td>
                  <td style={cell}>
                    {ink && (
                      <Badge tone={ink.deltaE <= 3 ? 'pass' : ink.deltaE <= 8 ? 'partial' : 'fail'}
                        title={`ΔE ${ink.deltaE} — under 3 is a visual match, over 8 needs a custom mix`}>
                        ΔE {ink.deltaE}
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Hint>
          Ink is total area coverage — C+M+Y+K. Past the profile's limit the sheet
          can't dry and offsets onto the next one. "Flat black" means the colour
          would print as K alone, which reads thin next to a rich black.
        </Hint>
      </Section>
    </div>
  )
}

const cell = { padding: '7px 8px 7px 0', verticalAlign: 'top', borderBottom: `1px solid ${T.line}` }
