import { useState } from 'react'
import { usePalette, updateSwatch } from './store.js'
import { wcagContrast, oklchToHex } from '../../lib/color.js'
import { T, MiniBtn, HexInput, Hint, Badge, FieldLabel } from './panelUi.jsx'

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
  const passAA  = ratio >= 4.5
  const passAAA = ratio >= 7.0
  const passLarge = ratio >= 3.0

  const adjL = fgOklch ? findLForContrast(fgOklch.c, fgOklch.h, bgHex, 4.5) : null
  const ratingColor = passAA ? T.ok : passLarge ? T.warn : T.bad

  return (
    <div style={{
      borderRadius: T.rLg, overflow: 'hidden',
      border: `1px solid ${passAA ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.2)'}`,
      background: T.panel,
    }}>
      {/* The sample is the honest part — real foreground on real background at
          two sizes, so "passes for large text only" is something you can see
          rather than only read. */}
      <div style={{
        background: bgHex, padding: '12px 16px',
        display: 'flex', alignItems: 'baseline', gap: 14, minHeight: 62,
      }}>
        <span style={{ color: fgHex, fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>Aa</span>
        <span style={{ color: fgHex, fontSize: 13 }}>Body text at 13px</span>
      </div>

      <div style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <FieldLabel style={{ minWidth: 46, color: T.textDim }}>{bgLabel}</FieldLabel>
        <span className="cp-num" style={{ fontSize: T.title, fontWeight: 700, color: ratingColor, minWidth: 62 }}>
          {ratio.toFixed(2)}:1
        </span>
        <Badge tone={passAAA ? 'pass' : 'fail'} title="AAA needs 7:1 for normal text">AAA</Badge>
        <Badge tone={passAA ? 'pass' : 'fail'} title="AA needs 4.5:1 for normal text">AA</Badge>
        <Badge tone={passLarge ? 'pass' : 'fail'} title="Large text needs 3:1">Large</Badge>
        <div style={{ flex: 1 }} />
        {!passAA && adjL !== null && (
          <MiniBtn variant="primary" onClick={() => onAdjust(adjL)}
            title={`Adjust lightness to ${adjL.toFixed(3)} to reach AA, keeping hue and chroma`}>
            Fix to AA
          </MiniBtn>
        )}
        {!passAA && adjL === null && (
          <FieldLabel style={{ color: T.faint }}>No AA possible at this hue</FieldLabel>
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

  if (!sw) return <Hint>Select a swatch to check its contrast.</Hint>

  const bgs = [...PRESETS, ...(showCustom ? [{ label: 'Custom', hex: customBg }] : [])]

  function handleAdjust(newL) {
    updateSwatch(sw.id, { oklch: { ...sw.oklch, l: newL } })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <FieldLabel>Checking</FieldLabel>
        <span style={{ width: 18, height: 18, borderRadius: 4, background: sw.hex, border: `1px solid ${T.line}` }} />
        <span className="cp-num" style={{ fontSize: T.body, color: T.text }}>{sw.hex}</span>
        <span className="cp-label" style={{ color: T.muted }}>{sw.name || 'Unnamed'}</span>
        <div style={{ flex: 1 }} />
        <MiniBtn onClick={() => setShowCustom(v => !v)}
          style={showCustom ? { background: T.accentSoft, borderColor: T.accentLine, color: T.accentText } : undefined}>
          {showCustom ? 'Hide custom' : '+ Custom background'}
        </MiniBtn>
      </div>

      {showCustom && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <FieldLabel style={{ minWidth: 70 }}>Custom</FieldLabel>
          <input type="color" value={customBg} onChange={e => setCustomBg(e.target.value)}
            aria-label="Custom background colour"
            style={{ width: 38, height: 28, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
          <HexInput value={customBg} aria-label="Custom background hex"
            onCommit={setCustomBg}
            style={{ width: 104 }} />
        </div>
      )}

      {bgs.map(bg => (
        <ContrastCard key={bg.label}
          fgHex={sw.hex} fgOklch={sw.oklch}
          bgHex={bg.hex} bgLabel={bg.label}
          onAdjust={handleAdjust} />
      ))}

      <Hint>
        AA needs 4.5:1 for normal text and 3:1 for large or bold text. AAA needs 7:1.
        "Fix to AA" moves lightness only, holding hue and chroma, so the colour keeps its character.
      </Hint>
    </div>
  )
}
