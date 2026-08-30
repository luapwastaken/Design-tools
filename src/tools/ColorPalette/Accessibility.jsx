import { useState } from 'react'
import Grade from './Grade.jsx'
import ContrastMatrix from './ContrastMatrix.jsx'
import BGCheck from './BGCheck.jsx'
import Vision from './Vision.jsx'
import { ModeChip, Hint } from './panelUi.jsx'

// ── Accessibility ─────────────────────────────────────────────────────────────
//
// Grade, Contrast, BG Check and Vision used to be four sibling chips in a row of
// eleven, which buried the fact that they answer one question from four angles —
// and that three of them are the same WCAG calculation with a different thing
// held fixed. Grade holds the background fixed and sweeps the palette; BG Check
// holds one swatch fixed and sweeps backgrounds; the matrix does neither and
// shows every pair. Naming the axis is what makes them easy to choose between.

const VIEWS = [
  { id: 'background', label: 'Against a background', El: Grade,
    hint: 'Every swatch measured against one background you pick.' },
  { id: 'swatch', label: 'One swatch everywhere', El: BGCheck,
    hint: 'The active swatch measured against white, black, paper and grey.' },
  { id: 'pairs', label: 'Every pair', El: ContrastMatrix,
    hint: 'The full matrix — every swatch against every other swatch.' },
  { id: 'vision', label: 'Colour vision', El: Vision,
    hint: 'How the palette reads to colour-blind viewers, and which colours collapse together.' },
]

export default function Accessibility() {
  const [view, setView] = useState('background')
  const current = VIEWS.find(v => v.id === view) ?? VIEWS[0]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {VIEWS.map(v => (
          <ModeChip key={v.id} active={view === v.id} onClick={() => setView(v.id)} title={v.hint} grow={false}>
            {v.label}
          </ModeChip>
        ))}
      </div>

      <Hint>{current.hint}</Hint>

      {/* Kept mounted so switching between the four views doesn't discard the
          background you chose in Grade or the custom colour in BG Check. */}
      {VIEWS.map(v => (
        <div key={v.id} hidden={view !== v.id}><v.El /></div>
      ))}
    </div>
  )
}
