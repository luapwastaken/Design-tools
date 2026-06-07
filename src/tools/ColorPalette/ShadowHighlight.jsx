import { useState } from 'react'
import { oklchToHex, toOklch, oklchPixel } from '../../lib/color.js'
import { usePalette, addSwatch } from './store.js'
import { NumberSlider, EditableNumber } from '../../components/NumberField.jsx'

const ACCENT = '#5ab4ff'

export default function ShadowHighlight() {
  const { swatches, active } = usePalette()
  const sw = swatches.find(s => s.id === active)

  const [shadowHue, setShadowHue] = useState(240)  // cool/blue shadows
  const [lightHue, setLightHue] = useState(55)     // warm/yellow highlights
  const [shadowDrop, setShadowDrop] = useState(0.35)
  const [lightRise, setLightRise] = useState(0.35)
  const [hueShift, setHueShift] = useState(0.25)   // how much to shift toward ambient hue

  if (!sw) {
    return <div style={{ color: '#666', fontSize: 12 }}>Select a swatch to generate shadow/highlight ramp.</div>
  }

  const { l, c, h } = sw.oklch

  function lerpHue(baseH, targetH, t) {
    // Shortest path around the hue wheel
    let diff = ((targetH - baseH + 540) % 360) - 180
    return ((baseH + diff * t) + 360) % 360
  }

  // 5-stop ramp: shadow → shadow-mid → base → highlight-mid → highlight
  const stops = [
    { l: Math.max(0.03, l - shadowDrop), c: c * 0.8, h: lerpHue(h, shadowHue, hueShift * 1.0) },
    { l: Math.max(0.03, l - shadowDrop * 0.5), c: c * 0.9, h: lerpHue(h, shadowHue, hueShift * 0.5) },
    { l, c, h },
    { l: Math.min(0.97, l + lightRise * 0.5), c: c * 0.9, h: lerpHue(h, lightHue, hueShift * 0.5) },
    { l: Math.min(0.97, l + lightRise), c: c * 0.7, h: lerpHue(h, lightHue, hueShift * 1.0) },
  ]

  const hexes = stops.map(s => oklchToHex(s.l, s.c, s.h))
  const stopNames = ['Shadow', 'Shadow mid', 'Base', 'Highlight mid', 'Highlight']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {hexes.map((hex, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
            <div style={{
              width: '100%', aspectRatio: '1 / 1.2', borderRadius: 5, background: hex,
              border: i === 2 ? '2px solid #5ab4ff' : '1px solid #333',
            }} />
            <div style={{ fontSize: 8, color: '#666', fontFamily: 'monospace' }}>{hex.slice(1)}</div>
          </div>
        ))}
      </div>

      <NumberSlider label="Shadow drop (L)" value={shadowDrop} min={0.05} max={0.6} step={0.01} onChange={setShadowDrop} accent={ACCENT} />
      <NumberSlider label="Light rise (L)" value={lightRise} min={0.05} max={0.6} step={0.01} onChange={setLightRise} accent={ACCENT} />
      <NumberSlider label="Hue shift" value={hueShift} min={0} max={1} step={0.05} onChange={setHueShift} accent={ACCENT} />

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <HueChip label="Shadow hue" value={shadowHue} onChange={setShadowHue} />
        <HueChip label="Light hue" value={lightHue} onChange={setLightHue} />
      </div>

      <button
        onClick={() => hexes.forEach((hex, i) => { if (i !== 2) addSwatch(hex, 'freeform', { name: stopNames[i] }) })}
        style={{
          background: '#1e3a5f', border: '1px solid #2a5a8f', borderRadius: 5,
          color: '#5ab4ff', padding: '5px 12px', fontSize: 11, cursor: 'pointer',
        }}
      >
        Add ramp to palette
      </button>
    </div>
  )
}

function HueChip({ label, value, onChange }) {
  const [r, g, b] = oklchPixel(0.65, 0.2, value)
  const chipColor = `rgb(${r},${g},${b})`
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 10, color: '#888', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ width: 16, height: 16, borderRadius: 3, background: chipColor, border: '1px solid #333', flexShrink: 0 }} />
        <input type="range" min={0} max={359} value={value} onChange={e => onChange(+e.target.value)}
          style={{ flex: 1, accentColor: chipColor }} />
        <EditableNumber value={value} onChange={onChange} min={0} max={359} step={1} accent={ACCENT} suffix="°" width={32} color="#ccc" />
      </div>
    </div>
  )
}
