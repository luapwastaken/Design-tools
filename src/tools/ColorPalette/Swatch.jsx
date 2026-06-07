import { wcagContrast } from '../../lib/color.js'

const ROLES = ['black', 'main', 'accent', 'white', 'pop', 'freeform']

const ROLE_COLORS = {
  black: '#555', main: '#5ab4ff', accent: '#f9a825',
  white: '#ccc', pop: '#e040fb', freeform: '#666',
}

export default function Swatch({ swatch, isActive, onClick, onUpdate, onRemove, onDuplicate }) {
  const { hex, name, role, locked, id } = swatch
  const labelColor = wcagContrast(hex, '#fff') > 3 ? '#fff' : '#000'

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
        borderRadius: 6, cursor: 'pointer',
        background: isActive ? '#1c1c28' : 'transparent',
        border: `1px solid ${isActive ? '#333' : 'transparent'}`,
        transition: 'background 0.1s',
      }}
    >
      {/* Color chip */}
      <div style={{
        width: 28, height: 28, borderRadius: 5, background: hex,
        border: '1px solid rgba(255,255,255,0.1)', flexShrink: 0,
        position: 'relative',
      }}>
        {locked && (
          <div style={{
            position: 'absolute', bottom: 1, right: 1, fontSize: 8,
            lineHeight: 1, color: labelColor, opacity: 0.8,
          }}>🔒</div>
        )}
      </div>

      {/* Name + hex */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: '#d0cec8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name || hex}
        </div>
        {name && (
          <div style={{ fontSize: 10, color: '#666', fontFamily: 'monospace' }}>{hex}</div>
        )}
      </div>

      {/* Role badge */}
      <div style={{
        fontSize: 9, padding: '1px 4px', borderRadius: 3,
        background: ROLE_COLORS[role] + '33',
        color: ROLE_COLORS[role],
        textTransform: 'uppercase', letterSpacing: 0.5,
        flexShrink: 0,
      }}>
        {role}
      </div>

      {/* Controls — shown when active */}
      {isActive && (
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          <CtrlBtn title={locked ? 'Unlock' : 'Lock'} onClick={e => { e.stopPropagation(); onUpdate({ locked: !locked }) }}>
            {locked ? '🔒' : '🔓'}
          </CtrlBtn>
          <CtrlBtn title="Duplicate" onClick={e => { e.stopPropagation(); onDuplicate() }}>⧉</CtrlBtn>
          <CtrlBtn title="Remove" onClick={e => { e.stopPropagation(); onRemove() }} danger>✕</CtrlBtn>
        </div>
      )}
    </div>
  )
}

export function RoleSelect({ value, onChange }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: '#1a1a22', border: '1px solid #333', borderRadius: 4,
        color: '#f0ede7', padding: '3px 6px', fontSize: 11, cursor: 'pointer',
        outline: 'none',
      }}
    >
      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
    </select>
  )
}

function CtrlBtn({ children, onClick, title, danger }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 20, height: 20, border: 'none', borderRadius: 3, cursor: 'pointer',
        background: 'transparent', color: danger ? '#e05' : '#888',
        fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 0,
      }}
      onMouseEnter={e => { e.currentTarget.style.background = danger ? '#3a0010' : '#2a2a35' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}
