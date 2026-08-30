import { useState } from 'react'
import ValueStructure from './ValueStructure.jsx'
import Harmony from './Harmony.jsx'
import { ModeChip, Hint } from './panelUi.jsx'

// ── Structure ─────────────────────────────────────────────────────────────────
//
// Value and Harmony belong together: Harmony's critique opens on value structure
// and then describes it in prose. Pairing the measurement with the reading keeps
// them from disagreeing, and keeps the Check group at six destinations instead of
// seven — the flat wall of chips was the problem this rework set out to fix.

const VIEWS = [
  { id: 'value', label: 'Value', El: ValueStructure,
    hint: 'The palette sorted by lightness, in colour and in greyscale — the squint test, measured.' },
  { id: 'critique', label: 'Critique', El: Harmony,
    hint: 'A read of the whole palette: value, hue relationships, chroma distribution and temperature, with one-click fixes.' },
]

export default function Structure() {
  const [view, setView] = useState('value')
  const current = VIEWS.find(v => v.id === view) ?? VIEWS[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {VIEWS.map(v => (
          <ModeChip key={v.id} active={view === v.id} onClick={() => setView(v.id)} title={v.hint}>
            {v.label}
          </ModeChip>
        ))}
      </div>

      <Hint>{current.hint}</Hint>

      {VIEWS.map(v => (
        <div key={v.id} hidden={view !== v.id}><v.El /></div>
      ))}
    </div>
  )
}
