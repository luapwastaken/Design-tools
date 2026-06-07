import { useState } from 'react'
import { deltaE, contrast, inSrgbGamut, gamutMap, toHex, toOklch, oklchToHex } from '../../lib/color.js'
import { getState, updateSwatch } from './store.js'

function runAutoFix(swatches) {
  const fixes = []
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

  // 3. Check contrast against designated background (role 'white' or 'black')
  const bg = swatches.find(s => s.role === 'white') ?? swatches.find(s => s.role === 'black')
  if (bg) {
    for (const sw of swatches) {
      if (sw.id === bg.id || processed.has(sw.id)) continue
      if (sw.role !== 'accent' && sw.role !== 'main' && sw.role !== 'pop') continue
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
          if (contrast(testHex, bg.hex) >= 4.5) {
            bestL = testL
            break
          }
        }
        const newHex = oklchToHex(bestL, c, h)
        if (newHex !== sw.hex) {
          fixes.push({
            id: sw.id,
            type: 'contrast',
            description: `"${sw.name || sw.hex}" has low contrast (${ratio.toFixed(1)}:1) against background — adjusted lightness`,
            newHex,
          })
        }
      }
    }
  }

  return fixes
}

export default function AutoFix() {
  const [fixes, setFixes] = useState(null)
  const [accepted, setAccepted] = useState(new Set())

  function analyze() {
    const { swatches } = getState()
    setFixes(runAutoFix(swatches))
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
    for (const fix of fixes) {
      if (accepted.has(fix.id)) {
        updateSwatch(fix.id, { hex: fix.newHex })
      }
    }
    setFixes(null)
  }

  if (!fixes) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{ fontSize: 11, color: '#888', margin: 0 }}>
          Runs a pass over the palette: snap near-duplicates, gamut-map out-of-sRGB colors, nudge low-contrast swatches.
        </p>
        <Btn onClick={analyze}>Analyze palette</Btn>
      </div>
    )
  }

  if (!fixes.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: '#22c55e' }}>✓ No issues found.</div>
        <Btn onClick={() => setFixes(null)} secondary>Done</Btn>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, color: '#888' }}>{fixes.length} suggestion{fixes.length !== 1 ? 's' : ''}</div>
      {fixes.map(fix => (
        <div key={fix.id} style={{
          display: 'flex', gap: 8, alignItems: 'flex-start',
          background: '#151520', borderRadius: 6, padding: 8,
          border: `1px solid ${accepted.has(fix.id) ? '#2a5a8f' : '#2a2a35'}`,
        }}>
          <input type="checkbox" checked={accepted.has(fix.id)} onChange={() => toggle(fix.id)}
            style={{ marginTop: 2, accentColor: '#5ab4ff' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#5ab4ff', textTransform: 'uppercase', marginBottom: 2 }}>
              {fix.type}
            </div>
            <div style={{ fontSize: 11, color: '#ccc' }}>{fix.description}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
              <div style={{ fontSize: 10, color: '#888' }}>→</div>
              <div style={{ width: 16, height: 16, borderRadius: 3, background: fix.newHex, border: '1px solid #333' }} />
              <div style={{ fontSize: 10, color: '#888', fontFamily: 'monospace' }}>{fix.newHex}</div>
            </div>
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <Btn onClick={applySelected} disabled={!accepted.size}>Apply selected ({accepted.size})</Btn>
        <Btn onClick={() => setFixes(null)} secondary>Cancel</Btn>
      </div>
    </div>
  )
}

function Btn({ children, onClick, secondary, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: secondary || disabled ? 'transparent' : '#1e3a5f',
      border: `1px solid ${secondary || disabled ? '#333' : '#2a5a8f'}`,
      borderRadius: 5, color: disabled ? '#444' : secondary ? '#888' : '#5ab4ff',
      padding: '5px 12px', fontSize: 11, cursor: disabled ? 'default' : 'pointer',
    }}>
      {children}
    </button>
  )
}
