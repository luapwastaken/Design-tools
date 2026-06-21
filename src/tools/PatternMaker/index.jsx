import { useState, useRef, useEffect } from 'react'
import ShapesTab from './ShapesTab.jsx'
import MeteoriteTab from './MeteoriteTab.jsx'
import { C, MIN_PANEL, MAX_PANEL } from './ui.jsx'

// Shared shell: tab switcher ("Shapes" | "Meteorite") + the panel-resize chrome
// both tabs reuse. Each tab owns its own controls, preview, session and storage key.

const SHELL_KEY = 'designtools-patternmaker-shell'
function shellLoad() {
  try { return JSON.parse(localStorage.getItem(SHELL_KEY) || '{}') } catch { return {} }
}

const TABS = [['shapes', 'Shapes'], ['meteorite', 'Meteorite']]

export default function PatternMaker() {
  const [tab, setTab] = useState(() => shellLoad().tab ?? 'shapes')
  const [panelW, setPanelW] = useState(() => shellLoad().panelW ?? 268)

  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(0)

  useEffect(() => {
    const onMove = e => {
      if (!dragging.current) return
      const delta = e.clientX - startX.current
      setPanelW(Math.min(MAX_PANEL, Math.max(MIN_PANEL, startW.current + delta)))
    }
    const onUp = () => { dragging.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  useEffect(() => {
    try { localStorage.setItem(SHELL_KEY, JSON.stringify({ tab, panelW })) } catch {}
  }, [tab, panelW])

  const onResizeStart = e => {
    dragging.current = true
    startX.current = e.clientX
    startW.current = panelW
    document.body.style.cursor = 'col-resize'
    e.preventDefault()
  }

  // Rendered at the top of each tab's control panel so the switcher sits in a
  // consistent place regardless of which tab is active.
  const tabBar = (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: C.accent,
        marginBottom: 8 }}>PATTERN MAKER</div>
      <div style={{ display: 'flex', gap: 3 }}>
        {TABS.map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)} style={{
            flex: 1, padding: '6px 0', border: `1px solid ${tab === v ? C.accent : C.border}`,
            borderRadius: 4, background: tab === v ? C.accent : 'transparent',
            color: tab === v ? '#000' : C.muted, cursor: 'pointer', fontSize: 11,
            fontWeight: tab === v ? 700 : 400, fontFamily: 'inherit', letterSpacing: '0.04em',
          }}>{l}</button>
        ))}
      </div>
    </div>
  )

  const props = { panelW, onResizeStart, tabBar }
  // Both tabs stay mounted (display toggled) so their state and auto-save survive
  // switching back and forth.
  return (
    <div style={{ height: '100%', overflow: 'hidden' }}>
      <div style={{ height: '100%', display: tab === 'shapes' ? 'block' : 'none' }}>
        <ShapesTab {...props} />
      </div>
      <div style={{ height: '100%', display: tab === 'meteorite' ? 'block' : 'none' }}>
        <MeteoriteTab {...props} />
      </div>
    </div>
  )
}
