import { useState } from 'react'
import { usePalette, updateSwatch } from './store.js'
import { wcagContrast, wcagRating, oklchToHex } from '../../lib/color.js'

const PRESETS = [
  { label: 'White',  hex: '#ffffff' },
  { label: 'Black',  hex: '#000000' },
  { label: 'Paper',  hex: '#f5f2e8' },
  { label: 'Grey',   hex: '#808080' },
]

// Binary-search L to hit targetRatio against bgHex.
// Returns the adjusted L, or null if impossible.
function findLForContrast(c, h, bgHex, targetRatio = 4.5) {
  const darkHex  = oklchToHex(0.001, c, h)
  const lightHex = oklchToHex(0.999, c, h)
  const darkCont  = wcagContrast(darkHex,  bgHex)
  const lightCont = wcagContrast(lightHex, bgHex)

  if (Math.max(darkCont, lightCont) < targetRatio) return null

  if (lightCont > darkCont) {
    // Need a lighter color — search upper half
    let lo = 0.5, hi = 0.999
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      wcagContrast(oklchToHex(mid, c, h), bgHex) >= targetRatio ? hi = mid : lo = mid
    }
    return (lo + hi) / 2
  } else {
    // Need a darker color — search lower half
    let lo = 0.001, hi = 0.5
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      wcagContrast(oklchToHex(mid, c, h), bgHex) >= targetRatio ? lo = mid : hi = mid
    }
    return (lo + hi) / 2
  }
}

function ContrastCard({ fgHex, fgOklch, bgHex, bgLabel, onAdjust }) {
  const ratio = wcagContrast(fgHex, bgHex)
  const rating = wcagRating(ratio)
  const passAA  = ratio >= 4.5
  const passAAA = ratio >= 7.0
  const passLarge = ratio >= 3.0

  const adjL = fgOklch ? findLForContrast(fgOklch.c, fgOklch.h, bgHex, 4.5) : null

  const ratingColor = passAA ? '#4ade80' : passLarge ? '#facc15' : '#f87171'

  return (
    <div style={{
      borderRadius: 8, overflow: 'hidden',
      border: `1px solid ${passAA ? 'rgba(74,222,128,0.2)' : 'rgba(248,113,113,0.15)'}`,
      background: '#0e0e11',
    }}>
      {/* Preview */}
      <div style={{
        background: bgHex, padding: '10px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        minHeight: 56,
      }}>
        <span style={{ color: fgHex, fontSize: 14, fontWeight: 600 }}>Aa</span>
        <span style={{ color: fgHex, fontSize: 10 }}>Sample text</span>
      </div>

      {/* Info row */}
      <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 10, color: '#666', minWidth: 36 }}>{bgLabel}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: ratingColor, minWidth: 48 }}>
          {ratio.toFixed(2)}:1
        </span>
        <span style={{ fontSize: 10, color: passAAA ? '#4ade80' : '#444' }}>AAA</span>
        <span style={{ fontSize: 10, color: passAA ? '#4ade80' : '#f87171' }}>AA</span>
        <span style={{ fontSize: 10, color: passLarge ? '#facc15' : '#444' }}>Large</span>
        <div style={{ flex: 1 }} />
        {!passAA && adjL !== null && (
          <button
            onClick={() => onAdjust(adjL)}
            style={{
              background: '#2d1a5e', border: '1px solid #5a3a9f', borderRadius: 4,
              color: '#c4b5fd', padding: '2px 8px', fontSize: 9, cursor: 'pointer',
            }}
            title={`Adjust L to ${adjL.toFixed(3)} to reach AA`}
          >
            Fix to AA
          </button>
        )}
        {!passAA && adjL === null && (
          <span style={{ fontSize: 9, color: '#666' }}>no AA possible</span>
        )}
      </div>
    </div>
  )
}

export default function BGCheck() {
  const { swatches, active } = usePalette()
  const sw = swatches.find(s => s.id === active)
  const [customBg, setCustomBg] = useState('#1a1a2e')
  const [showCustom, setShowCustom] = useState(false)

  if (!sw) {
    return <div style={{ color: '#555', fontSize: 12 }}>Select a swatch to check contrast.</div>
  }

  const bgs = [
    ...PRESETS,
    ...(showCustom ? [{ label: 'Custom', hex: customBg }] : []),
  ]

  function handleAdjust(newL) {
    updateSwatch(sw.id, { oklch: { ...sw.oklch, l: newL } })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: '#666' }}>Checking:</span>
        <div style={{ width: 14, height: 14, borderRadius: 3, background: sw.hex, border: '1px solid #333' }} />
        <span style={{ fontSize: 10, color: '#aaa', fontFamily: 'monospace' }}>{sw.hex}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setShowCustom(v => !v)}
          style={{
            background: showCustom ? '#2d1a5e' : 'transparent',
            border: `1px solid ${showCustom ? '#5a3a9f' : '#333'}`,
            borderRadius: 4, color: showCustom ? '#c4b5fd' : '#555',
            padding: '2px 8px', fontSize: 9, cursor: 'pointer',
          }}
        >+ Custom BG</button>
      </div>

      {showCustom && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#666', minWidth: 60 }}>Custom BG</span>
          <input type="color" value={customBg} onChange={e => setCustomBg(e.target.value)}
            style={{ width: 32, height: 24, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
          <input value={customBg}
            onChange={e => { if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) setCustomBg(e.target.value) }}
            style={{ width: 80, background: '#1a1a22', border: '1px solid #333', borderRadius: 4, color: '#f0ede7', padding: '3px 6px', fontSize: 10, fontFamily: 'monospace', outline: 'none' }}
          />
        </div>
      )}

      {bgs.map(bg => (
        <ContrastCard
          key={bg.label}
          fgHex={sw.hex}
          fgOklch={sw.oklch}
          bgHex={bg.hex}
          bgLabel={bg.label}
          onAdjust={handleAdjust}
        />
      ))}

      <div style={{ fontSize: 9, color: '#444', lineHeight: 1.6 }}>
        AA requires 4.5:1 (normal text), 3:1 (large/bold text). AAA requires 7:1.
        "Fix to AA" adjusts lightness only, keeping hue and chroma.
      </div>
    </div>
  )
}
