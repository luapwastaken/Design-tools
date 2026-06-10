import { useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import PatternMaker from './tools/PatternMaker.jsx'
import LogoMaker from './tools/LogoMaker/index.jsx'
import ColorPalette from './tools/ColorPalette/index.jsx'
import DitherTool from './tools/DitherTool/index.jsx'
import PostFX from './tools/PostFX/index.jsx'
import LineartTool from './tools/LineartTool/index.jsx'
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
