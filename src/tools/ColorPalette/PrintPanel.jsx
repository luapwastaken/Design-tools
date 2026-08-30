import { useState, useEffect, useRef } from 'react'
import { hexToCmyk, tacWarning, richBlackSuggestion, getProfile } from '../../lib/cmyk.js'
import { nearestMatch } from '../../lib/colorMatch.js'
import { inSrgbGamut, gamutMap, toHex } from '../../lib/color.js'
import { usePalette, setPrintProfile, updateSwatch, setRisoMode } from './store.js'
import iccProfiles from '../../data/iccProfiles.json'
import ral from '../../data/ral.json'
import hks from '../../data/hks.json'
import ncs from '../../data/ncs.json'
import riso from '../../data/riso.json'
import { T, MiniBtn, Hint } from './panelUi.jsx'

function MatchRow({ label, match }) {
  if (!match) return null
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: T.label }}>
      <div style={{ width: 12, height: 12, borderRadius: 2, background: match.hex, border: `1px solid ${T.line}`, flexShrink: 0 }} />
      <span style={{ color: T.muted, minWidth: 30 }}>{label}</span>
      <span style={{ color: T.textDim, flex: 1 }}>{match.name}</span>
      <span style={{ color: T.faint }}>ΔE {match.deltaE}</span>
    </div>
  )
}

export default function PrintPanel() {
  const { swatches, active, printProfile, risoMode } = usePalette()
  const sw = swatches.find(s => s.id === active)

  const matchCache = useRef({})

  function getMatches(hex) {
    if (matchCache.current[hex]) return matchCache.current[hex]
    const result = {
      ral: nearestMatch(hex, ral),
      hks: nearestMatch(hex, hks),
      ncs: nearestMatch(hex, ncs),
      riso: nearestMatch(hex, riso),
    }
    matchCache.current[hex] = result
    return result
  }

  if (!sw) return <Hint style={{ padding: 12 }}>Select a swatch.</Hint>

  const cmyk = hexToCmyk(sw.hex)
  const tacInfo = tacWarning(cmyk, printProfile)
  const richBlack = richBlackSuggestion(cmyk, printProfile)
  const inGamut = inSrgbGamut(sw.hex)
  const profile = getProfile(printProfile)
  const matches = getMatches(sw.hex)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Profile selector */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Label>Profile</Label>
        <select
          value={printProfile}
          onChange={e => setPrintProfile(e.target.value)}
          className="cp-select"
          style={{ flex: 1 }}
        >
          {iccProfiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {/* CMYK values */}
      <div>
        <Label>CMYK ({profile.name})</Label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 6 }}>
          {[
            { k: 'C', v: cmyk.c, color: '#00bcd4' },
            { k: 'M', v: cmyk.m, color: '#e91e63' },
            { k: 'Y', v: cmyk.y, color: '#fdd835' },
            { k: 'K', v: cmyk.k, color: T.textDim },
          ].map(({ k, v, color }) => (
            <div key={k} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: T.label, color, marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: T.display, fontWeight: 600, color: T.text }}>{v}</div>
            </div>
          ))}
        </div>

        {/* TAC bar */}
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: T.label, color: T.muted, marginBottom: 3 }}>
            <span>TAC {tacInfo.tac}%</span>
            <span style={{ color: tacInfo.over ? T.bad : T.ok }}>
              limit {tacInfo.limit}% {tacInfo.over ? '⚠ OVER' : '✓'}
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: T.control, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, (tacInfo.tac / tacInfo.limit) * 100)}%`,
              background: tacInfo.over ? T.bad : T.ok,
              borderRadius: 3,
              transition: 'width 0.2s',
            }} />
          </div>
        </div>

        {richBlack && (
          <div style={{ marginTop: 8, padding: 6, background: T.control, borderRadius: 5, fontSize: T.label, color: T.warn }}>
            Rich black suggestion: C{richBlack.c} M{richBlack.m} Y{richBlack.y} K{richBlack.k}
          </div>
        )}
      </div>

      {/* Gamut */}
      <div>
        <Label>Gamut</Label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: inGamut ? T.ok : T.bad,
          }} />
          <span style={{ fontSize: T.body, color: inGamut ? T.ok : T.bad }}>
            {inGamut ? 'In sRGB gamut' : 'Out of sRGB gamut'}
          </span>
          {!inGamut && (
            <MiniBtn variant="primary"
              onClick={() => { const h = toHex(gamutMap(sw.hex)); updateSwatch(sw.id, { hex: h }) }}>
              Map to gamut
            </MiniBtn>
          )}
        </div>
      </div>

      {/* Spot color toggle */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Label>Spot color</Label>
        <input type="checkbox" checked={!!sw.spotColor}
          onChange={e => updateSwatch(sw.id, { spotColor: e.target.checked })}
          style={{ accentColor: T.accent }} />
        <span style={{ fontSize: T.label, color: T.faint }}>
          Note: import your own .ase from Pantone Color Manager for Pantone matching.
        </span>
      </div>

      {/* Library matches */}
      <div>
        <Label>Nearest matches</Label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 6 }}>
          <MatchRow label="RAL" match={matches.ral} />
          <MatchRow label="HKS" match={matches.hks} />
          <MatchRow label="NCS" match={matches.ncs} />
          <MatchRow label="Riso" match={matches.riso} />
        </div>
      </div>

      {/* Riso mode toggle */}
      <div style={{ paddingTop: 8, borderTop: `1px solid ${T.line}` }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Label>Risograph mode</Label>
          <Toggle checked={risoMode} onChange={setRisoMode} />
        </div>
        {risoMode && (
          <Hint style={{ marginTop: 4 }}>
            Risograph mode constrains the palette to selected Riso inks. Select inks in the Riso ink panel.
          </Hint>
        )}
      </div>
    </div>
  )
}

function Label({ children }) {
  return <div className="cp-micro">{children}</div>
}

function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 32, height: 16, borderRadius: 8, cursor: 'pointer',
        background: checked ? T.accent : T.line,
        position: 'relative', transition: 'background 0.15s',
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2,
        width: 12, height: 12, borderRadius: '50%', background: T.text,
        transition: 'left 0.15s',
      }} />
    </div>
  )
}
