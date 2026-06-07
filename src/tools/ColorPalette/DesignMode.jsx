import { useState } from 'react'
import Generators from './Generators.jsx'
import Recipes from './Recipes.jsx'
import ImageExtract from './ImageExtract.jsx'
import Gradient from './Gradient.jsx'
import Grade from './Grade.jsx'
import Vision from './Vision.jsx'
import AutoFix from './AutoFix.jsx'
import ContrastMatrix from './ContrastMatrix.jsx'
import BGCheck from './BGCheck.jsx'

const PANELS = ['Generators', 'Recipes', 'Image', 'Gradient', 'Grade', 'Vision', 'AutoFix', 'Contrast', 'BG Check']

export default function DesignMode() {
  const [panel, setPanel] = useState('Generators')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', padding: '6px 10px', gap: 4, borderBottom: '1px solid #1e1e24', flexShrink: 0, flexWrap: 'wrap' }}>
        {PANELS.map(p => (
          <button key={p} onClick={() => setPanel(p)} style={{
            background: panel === p ? '#1e1a2e' : 'transparent',
            border: `1px solid ${panel === p ? '#3d2a7a' : 'transparent'}`,
            borderRadius: 4, color: panel === p ? '#e0d8ff' : '#555',
            padding: '3px 10px', fontSize: 10, cursor: 'pointer',
          }}>{p}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>
        {panel === 'Generators' && <Generators />}
        {panel === 'Recipes'    && <Recipes />}
        {panel === 'Image'      && <ImageExtract />}
        {panel === 'Gradient'   && <Gradient />}
        {panel === 'Grade'      && <Grade />}
        {panel === 'Vision'     && <Vision />}
        {panel === 'AutoFix'    && <AutoFix />}
        {panel === 'Contrast'   && <ContrastMatrix />}
        {panel === 'BG Check'   && <BGCheck />}
      </div>
    </div>
  )
}
