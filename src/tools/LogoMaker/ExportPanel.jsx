import { useState } from 'react'
import { btn } from './ui.jsx'
import { buildFaviconZip } from '../../lib/export.js'

// ── FaviconExport ─────────────────────────────────────────────────────────────
// Props: iconFile, bgColor
export function FaviconExport({ iconFile, bgColor }) {
  const [state, setState] = useState(null) // null | 'generating' | 'done'

  if (!iconFile) return null

  async function handleClick() {
    setState('generating')
    try {
      const source = iconFile.raw || iconFile.dataUrl
      const blob = await buildFaviconZip(source, bgColor)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'favicon-bundle.zip'
      a.click()
      URL.revokeObjectURL(url)
      setState('done')
      setTimeout(() => setState(null), 2500)
    } catch (err) {
      console.error('Favicon export failed:', err)
      setState(null)
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={handleClick}
        disabled={state === 'generating'}
        style={{ ...btn(true), width: '100%', padding: '7px 0', opacity: state === 'generating' ? 0.6 : 1 }}
      >
        {state === 'generating' ? 'Generating…' : state === 'done' ? '✓ Done' : '⬇ Favicon Bundle (.zip)'}
      </button>
    </div>
  )
}
