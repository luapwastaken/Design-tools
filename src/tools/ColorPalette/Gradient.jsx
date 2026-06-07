import { useState, useMemo } from 'react'
import { interpolate, toHex } from '../../lib/color.js'
import { addSwatch, usePalette } from './store.js'
import { NumberSlider } from '../../components/NumberField.jsx'
import Icon from '../../components/Icon.jsx'
import { Section, FieldLabel, ModeChip, AddBtn, SwatchStrip, ACCENT } from './panelUi.jsx'

const SPACES = [
  { id: 'oklch', label: 'OKLCH' },
  { id: 'oklab', label: 'OKLab' },
  { id: 'srgb',  label: 'sRGB' },
]

export default function Gradient() {
  const { swatches } = usePalette()
  const opts = swatches.length ? swatches : [{ id: 'a', hex: '#5ab4ff' }, { id: 'b', hex: '#f0f0f0' }]

  const [fromId, setFromId] = useState(opts[0].id)
  const [toId,   setToId]   = useState(opts[opts.length - 1].id)
  const [stops,  setStops]  = useState(7)
  const [space,  setSpace]  = useState('oklch')
  const [angle,  setAngle]  = useState(90)
  const [copied, setCopied] = useState(false)

  const fromHex = opts.find(s => s.id === fromId)?.hex ?? opts[0].hex
  const toHex_  = opts.find(s => s.id === toId)?.hex ?? opts[opts.length - 1].hex

  const ramp = useMemo(() => Array.from({ length: stops }, (_, i) => {
    const t = stops > 1 ? i / (stops - 1) : 0
    return toHex(interpolate(fromHex, toHex_, t, space))
  }), [fromHex, toHex_, stops, space])

  const cssGradient = `linear-gradient(${angle}deg, ${ramp.join(', ')})`

  function copy() {
    navigator.clipboard?.writeText(`background: ${cssGradient};`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <Section label="Gradient Builder" hint="interpolated in OKLCH">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <FieldLabel style={{ width: 36 }}>From</FieldLabel>
        <SwatchSelect value={fromId} onChange={setFromId} options={opts} />
        <FieldLabel style={{ width: 18 }}>To</FieldLabel>
        <SwatchSelect value={toId} onChange={setToId} options={opts} />
      </div>

      <div style={{ display: 'flex', gap: 4 }}>
        {SPACES.map(s => (
          <ModeChip key={s.id} active={space === s.id} onClick={() => setSpace(s.id)}>{s.label}</ModeChip>
        ))}
      </div>

      <NumberSlider label="Stops" min={2} max={16} step={1} value={stops} onChange={setStops} accent={ACCENT} labelWidth={40} numWidth={32} />
      <NumberSlider label="Angle" min={0} max={360} step={1} value={angle} onChange={setAngle} accent={ACCENT} labelWidth={40} numWidth={32} suffix="°" />

      {/* smooth preview */}
      <div style={{ height: 44, borderRadius: 8, background: cssGradient, border: '1px solid #222230' }} />
      {/* discrete stops */}
      <SwatchStrip hexes={ramp} height={28} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <AddBtn onClick={() => ramp.forEach(h => addSwatch(h))}>+ Add {stops} stops</AddBtn>
        <button onClick={copy} style={{
          display: 'flex', alignItems: 'center', gap: 5,
          background: '#131318', border: '1px solid #222230', borderRadius: 5,
          color: copied ? '#7ee787' : '#888', padding: '5px 10px', fontSize: 10, cursor: 'pointer',
        }}>
          <Icon name={copied ? 'check_circle' : 'content_copy'} size={12} />
          {copied ? 'Copied' : 'Copy CSS'}
        </button>
      </div>
    </Section>
  )
}

function SwatchSelect({ value, onChange, options }) {
  const cur = options.find(s => s.id === value) ?? options[0]
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
      <span style={{ width: 16, height: 16, borderRadius: 4, background: cur.hex, border: '1px solid #2a2a38', flexShrink: 0 }} />
      <select value={value} onChange={e => onChange(e.target.value)} style={{
        flex: 1, background: '#111118', border: '1px solid #2a2a38', borderRadius: 4,
        color: '#b0a8d8', padding: '3px 4px', fontSize: 10, outline: 'none', minWidth: 0,
      }}>
        {options.map(s => (
          <option key={s.id} value={s.id}>{s.name || s.hex}</option>
        ))}
      </select>
    </div>
  )
}
