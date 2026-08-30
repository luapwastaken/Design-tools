import { useState } from 'react'
import { deltaE, contrast, inSrgbGamut, gamutMap, toHex, toOklch, oklchToHex } from '../../lib/color.js'
import { getState, updateSwatch } from './store.js'
import { T, Btn, MiniBtn, Card, Body, Hint, Badge } from './panelUi.jsx'

// Returns the fixes it found AND the checks it could not run. The second half
// matters: the contrast pass needs a swatch tagged `white` or `black` to grade
// against, and when the palette has neither it used to skip that pass in silence
// and still report "✓ No issues found" — a green tick for work that never
// happened. A check that didn't run is now reported as not having run.
function runAutoFix(swatches) {
  const fixes = []
  const skipped = []
  const processed = new Set()

  // 1. Snap near-duplicates (ΔE < 1)
  for (let i = 0; i < swatches.length; i++) {
    for (let j = i + 1; j < swatches.length; j++) {
      const de = deltaE(swatches[i].hex, swatches[j].hex)
      if (de < 1 && !processed.has(swatches[j].id)) {
        processed.add(swatches[j].id)
        fixes.push({
          id: swatches[j].id,
          type: 'near-duplicate',
          description: `"${swatches[j].name || swatches[j].hex}" is nearly identical to "${swatches[i].name || swatches[i].hex}" (ΔE ${de.toFixed(2)})`,
          newHex: swatches[i].hex,
        })
      }
    }
  }

  // 2. Gamut-map out-of-sRGB colors
  for (const sw of swatches) {
    if (!processed.has(sw.id) && !inSrgbGamut(sw.hex)) {
      const mapped = gamutMap(sw.hex)
      const mappedHex = toHex(mapped)
      fixes.push({
        id: sw.id,
        type: 'gamut',
        description: `"${sw.name || sw.hex}" is out of sRGB gamut — mapped to ${mappedHex}`,
        newHex: mappedHex,
      })
    }
  }

  // 3. Check contrast against the designated background
  const bg = swatches.find(s => s.role === 'white') ?? swatches.find(s => s.role === 'black')
  const graded = swatches.filter(s => s.role === 'accent' || s.role === 'main' || s.role === 'pop')

  if (!bg) {
    skipped.push('Contrast was not checked — no swatch is tagged with the "white" or "black" role, so there is no background to grade against. Set a role on the swatch that acts as your background.')
  } else if (!graded.length) {
    skipped.push('Contrast was not checked — no swatch is tagged "main", "accent" or "pop", so nothing was treated as foreground.')
  } else {
    for (const sw of graded) {
      if (sw.id === bg.id || processed.has(sw.id)) continue
      const ratio = contrast(sw.hex, bg.hex)
      if (ratio < 4.5) {
        // Nudge L until contrast passes or we hit a limit
        const { l, c, h } = toOklch(sw.hex)
        const bgL = toOklch(bg.hex).l
        let bestL = l
        for (let step = 0; step <= 20; step++) {
          const dir = bgL > 0.5 ? -1 : 1
          const testL = Math.max(0, Math.min(1, l + dir * step * 0.05))
          const testHex = oklchToHex(testL, c, h)
          if (contrast(testHex, bg.hex) >= 4.5) { bestL = testL; break }
        }
        const newHex = oklchToHex(bestL, c, h)
        if (newHex !== sw.hex) {
          fixes.push({
            id: sw.id,
            type: 'contrast',
            description: `"${sw.name || sw.hex}" has low contrast (${ratio.toFixed(1)}:1) against "${bg.name || bg.hex}" — adjusted lightness`,
            newHex,
          })
        }
      }
    }
  }

  const ran = ['near-duplicates', 'sRGB gamut', ...(skipped.length ? [] : ['contrast'])]
  return { fixes, skipped, ran }
}

export default function AutoFix() {
  const [result, setResult] = useState(null)
  const [accepted, setAccepted] = useState(new Set())

  function analyze() {
    const { swatches } = getState()
    setResult(runAutoFix(swatches))
    setAccepted(new Set())
  }

  function toggle(id) {
    setAccepted(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function applySelected() {
    for (const fix of result.fixes) {
      if (accepted.has(fix.id)) updateSwatch(fix.id, { hex: fix.newHex })
    }
    setResult(null)
  }

  if (!result) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 620 }}>
        <Body>
          Runs three passes over the palette: snap near-duplicates, gamut-map colours
          outside sRGB, and nudge low-contrast swatches until they reach AA.
        </Body>
        <Hint>
          The contrast pass grades against whichever swatch you've tagged
          "white" or "black". Without one it can't run, and will say so.
        </Hint>
        <Btn variant="primary" onClick={analyze} style={{ alignSelf: 'flex-start' }}>
          Analyse palette
        </Btn>
      </div>
    )
  }

  const { fixes, skipped, ran } = result

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 620 }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Badge tone={fixes.length ? 'partial' : skipped.length ? 'neutral' : 'pass'}>
          {fixes.length
            ? `${fixes.length} suggestion${fixes.length === 1 ? '' : 's'}`
            : 'Nothing to fix'}
        </Badge>
        <Hint>Checked: {ran.join(' · ')}</Hint>
      </div>

      {/* An unrun check is stated plainly rather than folded into a pass. */}
      {skipped.map((note, i) => (
        <Card key={i} style={{ borderColor: 'rgba(251,191,36,0.4)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Badge tone="partial">Not checked</Badge>
            <Body style={{ flex: 1 }}>{note}</Body>
          </div>
        </Card>
      ))}

      {fixes.map(fix => (
        <Card key={fix.id} tone={accepted.has(fix.id) ? 'accent' : undefined}>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer' }}>
            <input type="checkbox" checked={accepted.has(fix.id)} onChange={() => toggle(fix.id)}
              style={{ marginTop: 3, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="cp-micro" style={{ color: T.accentText, marginBottom: 3 }}>{fix.type}</div>
              <Body>{fix.description}</Body>
              <div style={{ display: 'flex', gap: 7, marginTop: 6, alignItems: 'center' }}>
                <span style={{ fontSize: T.label, color: T.muted }}>→</span>
                <span style={{ width: 18, height: 18, borderRadius: 4, background: fix.newHex, border: `1px solid ${T.line}` }} />
                <span className="cp-num" style={{ fontSize: T.label, color: T.muted }}>{fix.newHex}</span>
              </div>
            </div>
          </label>
        </Card>
      ))}

      <div style={{ display: 'flex', gap: 8 }}>
        {fixes.length > 0 && (
          <>
            <Btn variant="primary" onClick={applySelected} disabled={!accepted.size}>
              Apply selected ({accepted.size})
            </Btn>
            <MiniBtn onClick={() => setAccepted(new Set(fixes.map(f => f.id)))}>Select all</MiniBtn>
          </>
        )}
        <MiniBtn onClick={() => setResult(null)}>{fixes.length ? 'Cancel' : 'Done'}</MiniBtn>
      </div>
    </div>
  )
}
