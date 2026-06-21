import { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar.jsx'
import { globalUndo, globalRedo } from './lib/undo.js'
import PatternMaker from './tools/PatternMaker/index.jsx'
import LogoMaker from './tools/LogoMaker/index.jsx'
import ColorPalette from './tools/ColorPalette/index.jsx'
import DitherTool from './tools/DitherTool/index.jsx'
import PostFX from './tools/PostFX/index.jsx'
import LineartTool from './tools/LineartTool/index.jsx'
import MotionMaker from './tools/MotionMaker/index.jsx'
import CobaltTool from './tools/CobaltTool.jsx'
import Icon from './components/Icon.jsx'

// ── Tool registry: add new tools here ──────────────────────────────
const TOOLS = [
  {
    id: 'pattern-maker',
    label: 'Pattern Maker',
    icon: '✦',
    component: PatternMaker,
  },
  {
    id: 'logo-maker',
    label: 'Logo Maker',
    icon: '◫',
    accentColor: '#5ab4ff',
    component: LogoMaker,
  },
  {
    id: 'color-palette',
    label: 'Color Palette',
    icon: '◉',
    accentColor: '#8b5cf6',
    component: ColorPalette,
  },
  {
    id: 'dither-maker',
    label: 'Dither & Halftone',
    icon: <Icon name="grain" size={18} />,
    accentColor: '#f472b6',
    component: DitherTool,
  },
  {
    id: 'post-fx',
    label: 'Post FX',
    icon: <Icon name="bolt" size={18} />,
    accentColor: '#36d6c3',
    component: PostFX,
  },
  {
    id: 'lineart',
    label: 'Scan to Lineart',
    icon: <Icon name="edit" size={18} />,
    accentColor: '#fbbf24',
    component: LineartTool,
  },
  {
    id: 'motion-maker',
    label: 'Motion Maker',
    icon: <Icon name="movie_filter" size={18} />,
    accentColor: '#ff7849',
    component: MotionMaker,
  },
  {
    id: 'cobalt',
    label: 'cobalt.tools',
    icon: <Icon name="download" size={18} />,
    accentColor: '#7dd3fc',
    component: CobaltTool,
  },
]

export default function App() {
  const [active, setActive] = useState(TOOLS[0].id)
  const ActiveTool = TOOLS.find(t => t.id === active)?.component

  // ── Global undo / redo — dispatches to the active tool (see lib/undo.js) ──────
  useEffect(() => {
    function onKey(e) {
      const ctrl = e.ctrlKey || e.metaKey
      if (!ctrl) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); globalUndo() }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); globalRedo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: '#0b0b0d' }}>
      <Sidebar tools={TOOLS} active={active} onSelect={setActive} />

      {/* Main column: title bar strip + tool content */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Title bar strip — sits alongside the sidebar's drag region, fills the
            gap to the right where the Windows min/max/close buttons live */}
        <div style={{
          height: 36,
          flexShrink: 0,
          background: '#111114',
          WebkitAppRegion: 'drag',
          userSelect: 'none',
        }} />

        {ActiveTool && <ActiveTool />}
      </main>
    </div>
  )
}
