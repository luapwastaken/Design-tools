import { useState } from 'react'
import ShadowHighlight from './ShadowHighlight.jsx'
import Mixer from './Mixer.jsx'
import MaterialPanel from './MaterialPanel.jsx'

const ILL_PANELS = ['Shadow/Highlight', 'Materials', 'Mixer']

export default function IllustrationMode() {
  const [panel, setPanel] = useState('Shadow/Highlight')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', padding: '6px 10px', gap: 4, borderBottom: '1px solid #1e1e24', flexShrink: 0 }}>
        {ILL_PANELS.map(p => (
          <button key={p} onClick={() => setPanel(p)} style={{
            background: panel === p ? '#1e1e2e' : 'transparent',
            border: `1px solid ${panel === p ? '#3d2a7a' : 'transparent'}`,
            borderRadius: 4, color: panel === p ? '#e0d8ff' : '#555',
            padding: '3px 10px', fontSize: 10, cursor: 'pointer',
          }}>{p}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {panel === 'Shadow/Highlight' && <ShadowHighlight />}
        {panel === 'Materials' && <MaterialPanel />}
        {panel === 'Mixer' && <Mixer />}
      </div>
    </div>
  )
}
