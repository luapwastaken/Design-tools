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

function MatchRow({ label, match }) {
  if (!match) return null
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 10 }}>
      <div style={{ width: 12, height: 12, borderRadius: 2, background: match.hex, border: '1px solid #333', flexShrink: 0 }} />
      <span style={{ color: '#888', minWidth: 30 }}>{label}</span>
      <span style={{ color: '#ccc', flex: 1 }}>{match.name}</span>
      <span style={{ color: '#666' }}>ΔE {match.deltaE}</span>
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

  if (!sw) return <div style={{ color: '#666', fontSize: 12, padding: 12 }}>Select a swatch.</div>

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
          style={{
            flex: 1, background: '#1a1a22', border: '1px solid #333', borderRadius: 4,
            color: '#f0ede7', padding: '4px 8px', fontSize: 11, outline: 'none',
          }}
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
            { k: 'K', v: cmyk.k, color: '#bbb' },
          ].map(({ k, v, color }) => (
            <div key={k} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 10, color, marginBottom: 2 }}>{k}</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#f0ede7' }}>{v}</div>
            </div>
          ))}
        </div>

        {/* TAC bar */}
        <div style={{ marginTop: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#888', marginBottom: 3 }}>
            <span>TAC {tacInfo.tac}%</span>
            <span style={{ color: tacInfo.over ? '#ef4444' : '#22c55e' }}>
              limit {tacInfo.limit}% {tacInfo.over ? '⚠ OVER' : '✓'}
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: '#1a1a22', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${Math.min(100, (tacInfo.tac / tacInfo.limit) * 100)}%`,
              background: tacInfo.over ? '#ef4444' : '#22c55e',
              borderRadius: 3,
              transition: 'width 0.2s',
            }} />
          </div>
        </div>

        {richBlack && (
          <div style={{ marginTop: 8, padding: 6, background: '#1a1a22', borderRadius: 5, fontSize: 10, color: '#f59e0b' }}>
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
            background: inGamut ? '#22c55e' : '#ef4444',
          }} />
          <span style={{ fontSize: 11, color: inGamut ? '#22c55e' : '#ef4444' }}>
            {inGamut ? 'In sRGB gamut' : 'Out of sRGB gamut'}
          </span>
          {!inGamut && (
            <button
              onClick={() => { const h = toHex(gamutMap(sw.hex)); updateSwatch(sw.id, { hex: h }) }}
              style={{ fontSize: 10, background: '#1e3a5f', border: '1px solid #2a5a8f', borderRadius: 4, color: '#5ab4ff', padding: '2px 8px', cursor: 'pointer' }}
            >
              Map to gamut
            </button>
          )}
        </div>
      </div>

      {/* Spot color toggle */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Label>Spot color</Label>
        <input type="checkbox" checked={!!sw.spotColor}
          onChange={e => updateSwatch(sw.id, { spotColor: e.target.checked })}
          style={{ accentColor: '#5ab4ff' }} />
        <span style={{ fontSize: 10, color: '#666' }}>
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
      <div style={{ paddingTop: 8, borderTop: '1px solid #1e1e24' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Label>Risograph mode</Label>
          <Toggle checked={risoMode} onChange={setRisoMode} />
        </div>
        {risoMode && (
          <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>
            Risograph mode constrains the palette to selected Riso inks. Select inks in the Riso ink panel.
          </div>
        )}
      </div>
    </div>
  )
}

function Label({ children }) {
  return <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>{children}</div>
}

function Toggle({ checked, onChange }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 32, height: 16, borderRadius: 8, cursor: 'pointer',
        background: checked ? '#5ab4ff' : '#333',
        position: 'relative', transition: 'background 0.15s',
      }}
    >
      <div style={{
        position: 'absolute', top: 2, left: checked ? 18 : 2,
        width: 12, height: 12, borderRadius: '50%', background: '#fff',
        transition: 'left 0.15s',
      }} />
    </div>
  )
}
