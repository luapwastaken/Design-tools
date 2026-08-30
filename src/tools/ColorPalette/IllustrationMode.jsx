import ShadowHighlight from './ShadowHighlight.jsx'
import Mixer from './Mixer.jsx'
import MaterialPanel from './MaterialPanel.jsx'
import { useState } from 'react'
import { ModeChip, T, ResetBtn } from './panelUi.jsx'
import { useUi, setUi } from './uiState.js'

const PANELS = [
  { id: 'Shadow/Highlight', El: ShadowHighlight },
  { id: 'Materials',        El: MaterialPanel },
  { id: 'Mixer',            El: Mixer },
]

export default function IllustrationMode() {
  const { illPanel } = useUi()
  // Same remount-key reset as DesignMode; Mixer alone holds 13 useStates.
  const [resetSeq, setResetSeq] = useState({})
  const current = PANELS.some(p => p.id === illPanel) ? illPanel : PANELS[0].id

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <nav aria-label="Illustration panels" style={{
        display: 'flex', padding: '8px 12px', gap: 6,
        borderBottom: `1px solid ${T.line}`, flexShrink: 0,
      }}>
        {PANELS.map(p => (
          <ModeChip key={p.id} active={current === p.id}
            onClick={() => setUi({ illPanel: p.id })} grow={false}>{p.id}</ModeChip>
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ marginRight: 30 }}>
          <ResetBtn label={`Reset ${current}`}
            title={`Put the ${current} panel back to its defaults — your palette is untouched`}
            onReset={() => setResetSeq(s => ({ ...s, [current]: (s[current] ?? 0) + 1 }))} />
        </span>
      </nav>

      {/* Kept mounted, hidden when inactive — same reason as DesignMode. Mixer
          alone holds 13 pieces of state that used to evaporate on every tab
          click, and the panel choice now survives leaving the tool entirely. */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {PANELS.map(p => (
          <div key={p.id}
            hidden={current !== p.id}
            style={current === p.id
              ? { height: '100%', overflowY: 'auto', padding: '12px 14px' }
              : undefined}
          >
            <p.El key={resetSeq[p.id] ?? 0} />
          </div>
        ))}
      </div>
    </div>
  )
}
