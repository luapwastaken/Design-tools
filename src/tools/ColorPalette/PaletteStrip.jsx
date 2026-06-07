import { usePalette, setActive, removeSwatch } from './store.js'

export default function PaletteStrip() {
  const { swatches, active } = usePalette()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 1 }}>Strip</div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {swatches.map(sw => (
          <div
            key={sw.id}
            title={sw.name || sw.hex}
            onClick={() => setActive(sw.id)}
            onContextMenu={e => { e.preventDefault(); removeSwatch(sw.id) }}
            style={{
              width: 28, height: 28, borderRadius: 5, background: sw.hex,
              border: `2px solid ${sw.id === active ? '#5ab4ff' : 'rgba(255,255,255,0.1)'}`,
              cursor: 'pointer', transition: 'border-color 0.1s',
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 9, color: '#555' }}>Right-click to remove from strip</div>
    </div>
  )
}
