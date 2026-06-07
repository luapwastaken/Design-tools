const C = {
  sidebar: '#0e0e11',
  border:  '#1e1e24',
  accent:  '#e8a838',
  text:    '#f0ede7',
  muted:   '#4a4a54',
  hover:   '#18181e',
  active:  '#1c1c22',
}

export default function Sidebar({ tools, active, onSelect }) {
  return (
    <aside style={{
      width: 64,
      background: C.sidebar,
      borderRight: `1px solid ${C.border}`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '12px 0',
      gap: 4,
      flexShrink: 0,
      // Push below OS titlebar overlay on Windows (36px)
      paddingTop: 48,
      WebkitAppRegion: 'no-drag',
    }}>

      {/* App icon */}
      <div style={{
        position: 'absolute', top: 0, left: 0, width: 64, height: 36,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        WebkitAppRegion: 'drag',
      }}>
        <span style={{ fontSize: 16, color: C.accent }}>⬡</span>
      </div>

      {/* Tool buttons */}
      {tools.map(t => {
        const toolAccent = t.accentColor ?? C.accent
        const isActive = active === t.id
        return (
          <button
            key={t.id}
            title={t.label}
            onClick={() => onSelect(t.id)}
            style={{
              width: 42, height: 42,
              border: 'none',
              borderRadius: 8,
              background: isActive ? C.active : 'transparent',
              color: isActive ? toolAccent : C.muted,
              cursor: 'pointer',
              fontSize: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background 0.15s, color 0.15s',
              outline: isActive ? `1px solid ${C.border}` : 'none',
            }}
            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = C.hover }}
            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
          >
            {t.icon}
          </button>
        )
      })}
    </aside>
  )
}
