import { useState, useMemo } from 'react'
import { generateHarmony, generateRamp, oklchToHex } from '../../lib/color.js'
import { addSwatch, usePalette } from './store.js'
import { NumberSlider, EditableNumber } from '../../components/NumberField.jsx'
import Icon from '../../components/Icon.jsx'

const ACCENT = '#8b5cf6'

// ── AcerolaFX palette generator (ported from HLSL) ────────────────────────────
// Original: https://github.com/GarrettGunnell/AcerolaFX/blob/main/Shaders/AcerolaFX_PaletteSwap.fx
//
// Colors are generated in OKLCH — perceptually uniform, so the palette feels
// coherent across hues. A seed drives all randomness; hue mode scales the spread.

const HUE_MODES = [
  { id: 0, label: 'Mono',   mult: 0.0  },
  { id: 1, label: 'Analog', mult: 0.25 },
  { id: 2, label: 'Comp',   mult: 0.33 },
  { id: 3, label: 'Triad',  mult: 0.66 },
  { id: 4, label: 'Tetrad', mult: 0.75 },
]

const HARMONY_TYPES = [
  { id: 'complementary',       label: 'Comp'   },
  { id: 'analogous',           label: 'Analog' },
  { id: 'triadic',             label: 'Triadic' },
  { id: 'split-complementary', label: 'Split'  },
  { id: 'tetradic',            label: 'Tetrad' },
]

// uint32 hash — faithful JS port of the HLSL hash in AcerolaFX
function h32(seed) {
  let n = (seed | 0) >>> 0
  n = (n ^ (n << 13)) >>> 0
  const inner = (Math.imul(Math.imul(n, n), 15731) + 0x789221) >>> 0
  n = (Math.imul(n, inner) + 0x76312589) >>> 0   // lower 32 bits of 0x1376312589
  return (n & 0x7fffffff) / 0x7fffffff
}

function lerp(a, b, t) { return a + (b - a) * t }

function generateRandomPalette({ seed, colorCount, hueModeIdx, lMin, lMax, cMin, cMax }) {
  const mult   = HUE_MODES[hueModeIdx].mult
  const TWO_PI = Math.PI * 2

  const hueBase         = h32(seed)      * TWO_PI
  const hueContrast     = lerp(0.1, 0.5,   h32(seed + 2))
  const L               = lerp(lMin, lMax, h32(seed + 13))
  const lumaContrast    = lerp(-0.2, 0.2,  h32(seed + 3))
  const C               = lerp(cMin, cMax, h32(seed + 5))
  const chromaContrast  = lerp(-0.08, 0.08, h32(seed + 7))

  return Array.from({ length: colorCount }, (_, i) => {
    const t   = colorCount > 1 ? i / (colorCount - 1) : 0
    const hOff = (hueContrast * t * TWO_PI + Math.PI / 4) * mult
    const l   = Math.max(0.05, Math.min(0.98, L + lumaContrast * t))
    const c   = Math.max(0,    Math.min(0.37,  C + chromaContrast * t))
    const hDeg = ((hueBase + hOff) / TWO_PI * 360 + 36000) % 360
    return oklchToHex(l, c, hDeg)
  })
}

function randSeed() { return Math.floor(Math.random() * 999_999_999) + 1 }

// ── Main component ─────────────────────────────────────────────────────────────

export default function Generators() {
  const { swatches, active } = usePalette()
  const activeHex = swatches.find(s => s.id === active)?.hex ?? '#808080'

  // ── Random palette state ──────────────────────────────────────────────────
  const [seed,        setSeed]        = useState(() => randSeed())
  const [colorCount,  setColorCount]  = useState(5)
  const [hueModeIdx,  setHueModeIdx]  = useState(1)
  const [lMin,        setLMin]        = useState(0.35)
  const [lMax,        setLMax]        = useState(0.80)
  const [cMin,        setCMin]        = useState(0.06)
  const [cMax,        setCMax]        = useState(0.28)

  const [locked, setLocked] = useState({})   // { index: pinnedHex }

  const randomPalette = useMemo(
    () => generateRandomPalette({ seed, colorCount, hueModeIdx, lMin, lMax, cMin, cMax }),
    [seed, colorCount, hueModeIdx, lMin, lMax, cMin, cMax]
  )

  // Locked slots keep their colour across rerolls; the rest follow the seed.
  const displayPalette = useMemo(
    () => randomPalette.map((h, i) => locked[i] ?? h),
    [randomPalette, locked]
  )

  function toggleLock(i) {
    setLocked(prev => {
      const next = { ...prev }
      if (next[i] != null) delete next[i]
      else next[i] = prev[i] ?? randomPalette[i]
      return next
    })
  }

  // ── Harmony state ─────────────────────────────────────────────────────────
  const [harmonyType, setHarmonyType] = useState('complementary')
  const harmonyColors = useMemo(
    () => generateHarmony(activeHex, harmonyType),
    [activeHex, harmonyType]
  )

  // ── Ramp state ────────────────────────────────────────────────────────────
  const [rampSteps, setRampSteps] = useState(8)
  const rampColors = useMemo(
    () => generateRamp(activeHex, rampSteps),
    [activeHex, rampSteps]
  )

  function addColors(hexes) {
    for (const hex of hexes) addSwatch(hex)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Random Palette ─────────────────────────────────────────────────── */}
      <Section label="Random Palette">

        {/* Hue mode chips */}
        <div style={{ display: 'flex', gap: 4 }}>
          {HUE_MODES.map((m, i) => (
            <ModeChip key={m.id} active={hueModeIdx === i} onClick={() => setHueModeIdx(i)}>
              {m.label}
            </ModeChip>
          ))}
        </div>

        {/* Count + seed row */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <FieldLabel>Count</FieldLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <StepBtn onClick={() => setColorCount(n => Math.max(2, n - 1))}>−</StepBtn>
            <EditableNumber value={colorCount} onChange={setColorCount} min={2} max={10} step={1} accent={ACCENT} width={28} align="center" />
            <StepBtn onClick={() => setColorCount(n => Math.min(10, n + 1))}>+</StepBtn>
          </div>
          <div style={{ flex: 1 }} />
          <FieldLabel>Seed</FieldLabel>
          <input
            type="number" value={seed} min={1} max={999999999}
            onChange={e => setSeed(Math.max(1, Math.min(999999999, +e.target.value || 1)))}
            style={{
              width: 90, background: '#111118', border: '1px solid #2a2a38',
              borderRadius: 4, color: '#b0a8d8', padding: '3px 6px',
              fontSize: 11, outline: 'none', fontVariantNumeric: 'tabular-nums',
            }}
          />
          <DiceBtn onClick={() => setSeed(randSeed())} title="Random seed" />
        </div>

        {/* Brightness range */}
        <RangeRow label="Brightness" minVal={lMin} maxVal={lMax}
          onMinChange={v => setLMin(Math.min(v, lMax - 0.05))}
          onMaxChange={v => setLMax(Math.max(v, lMin + 0.05))}
          step={0.01} min={0.05} max={0.98} />

        {/* Saturation range */}
        <RangeRow label="Saturation" minVal={cMin} maxVal={cMax}
          onMinChange={v => setCMin(Math.min(v, cMax - 0.01))}
          onMaxChange={v => setCMax(Math.max(v, cMin + 0.01))}
          step={0.005} min={0} max={0.37} />

        {/* Live preview strip with per-swatch lock — reroll keeps locked colors */}
        <LockableStrip hexes={displayPalette} locked={locked} onToggle={toggleLock} />

        <AddBtn onClick={() => addColors(displayPalette)}>
          + Add {colorCount} colors to palette
        </AddBtn>
      </Section>

      {/* ── Harmony ────────────────────────────────────────────────────────── */}
      <Section label="Harmony  ·  from active swatch">

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {HARMONY_TYPES.map(ht => (
            <ModeChip key={ht.id} active={harmonyType === ht.id} onClick={() => setHarmonyType(ht.id)}>
              {ht.label}
            </ModeChip>
          ))}
        </div>

        <SwatchStrip hexes={harmonyColors} />

        <AddBtn onClick={() => addColors(harmonyColors.slice(1))}>
          + Add {harmonyColors.length - 1} colors to palette
        </AddBtn>
      </Section>

      {/* ── Ramp ───────────────────────────────────────────────────────────── */}
      <Section label="Lightness Ramp  ·  from active swatch">

        <NumberSlider label="Steps" min={4} max={14} step={1} value={rampSteps} onChange={setRampSteps} accent={ACCENT} labelWidth={40} numWidth={32} />

        <SwatchStrip hexes={rampColors} />

        <AddBtn onClick={() => addColors(rampColors)}>
          + Add {rampSteps} colors to palette
        </AddBtn>
      </Section>

    </div>
  )
}

// ── Swatch strip ──────────────────────────────────────────────────────────────

function SwatchStrip({ hexes }) {
  const [hovered, setHovered] = useState(null)
  return (
    <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height: 52 }}>
      {hexes.map((hex, i) => (
        <div key={i}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
          style={{
            flex: hovered === i ? 1.6 : 1,
            background: hex, position: 'relative',
            transition: 'flex 0.15s ease',
          }}
        >
          {hovered === i && (
            <div style={{
              position: 'absolute', bottom: 4, left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.7)', color: '#fff',
              fontSize: 9, padding: '2px 5px', borderRadius: 3,
              fontFamily: 'monospace', whiteSpace: 'nowrap', pointerEvents: 'none',
            }}>
              {hex}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Lockable swatch strip (Coolors-style lock + reroll) ───────────────────────

function LockableStrip({ hexes, locked, onToggle }) {
  const [hovered, setHovered] = useState(null)
  return (
    <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', height: 56 }}>
      {hexes.map((hex, i) => {
        const isLocked = locked[i] != null
        const dark = isLightHex(hex)
        return (
          <div key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onToggle(i)}
            title={isLocked ? 'Unlock — reroll will change it' : 'Lock — reroll will keep it'}
            style={{
              flex: 1, background: hex, position: 'relative', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {(isLocked || hovered === i) && (
              <Icon name={isLocked ? 'lock' : 'lock_open'} size={13}
                color={dark ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)'} />
            )}
            {hovered === i && (
              <div style={{
                position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 8,
                padding: '1px 4px', borderRadius: 3, fontFamily: 'monospace',
                whiteSpace: 'nowrap', pointerEvents: 'none',
              }}>{hex}</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function isLightHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55
}

// ── Range row (min + max sliders) ─────────────────────────────────────────────

function RangeRow({ label, minVal, maxVal, onMinChange, onMaxChange, step, min, max }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <FieldLabel style={{ width: 62, flexShrink: 0 }}>{label}</FieldLabel>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: '#555', width: 18 }}>min</span>
          <input type="range" min={min} max={max} step={step} value={minVal}
            onChange={e => onMinChange(+e.target.value)}
            style={{ flex: 1, accentColor: ACCENT }}
          />
          <EditableNumber value={+(minVal * 100).toFixed(1)} onChange={v => onMinChange(v / 100)}
            min={min * 100} max={max * 100} step={step * 100} dec={0} suffix="%" width={30} color="#888" accent={ACCENT} />
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: 9, color: '#555', width: 18 }}>max</span>
          <input type="range" min={min} max={max} step={step} value={maxVal}
            onChange={e => onMaxChange(+e.target.value)}
            style={{ flex: 1, accentColor: ACCENT }}
          />
          <EditableNumber value={+(maxVal * 100).toFixed(1)} onChange={v => onMaxChange(v / 100)}
            min={min * 100} max={max * 100} step={step * 100} dec={0} suffix="%" width={30} color="#888" accent={ACCENT} />
        </div>
      </div>
    </div>
  )
}

// ── Small UI pieces ───────────────────────────────────────────────────────────

function Section({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        fontSize: 9, color: '#555', textTransform: 'uppercase',
        letterSpacing: 1.2, borderBottom: '1px solid #1a1a24', paddingBottom: 5,
      }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function FieldLabel({ children, style }) {
  return (
    <span style={{ fontSize: 10, color: '#666', ...style }}>{children}</span>
  )
}

function ModeChip({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      flex: 1,
      background: active ? '#2d1a5e' : '#131318',
      border: `1px solid ${active ? '#6d3fbe' : '#222230'}`,
      borderRadius: 5, color: active ? '#c4b5fd' : '#555',
      padding: '4px 0', fontSize: 10, cursor: 'pointer',
      transition: 'all 0.1s',
    }}>
      {children}
    </button>
  )
}

function StepBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: 22, height: 22, background: '#131318', border: '1px solid #222230',
      borderRadius: 4, color: '#888', fontSize: 14, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
    }}>
      {children}
    </button>
  )
}

function DiceBtn({ onClick, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      width: 28, height: 26, background: '#131318', border: '1px solid #222230',
      borderRadius: 4, color: '#8b5cf6', fontSize: 14, cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
      transition: 'border-color 0.1s, color 0.1s',
    }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = '#6d3fbe'; e.currentTarget.style.color = '#c4b5fd' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#222230'; e.currentTarget.style.color = '#8b5cf6' }}
    >
      ⚄
    </button>
  )
}

function AddBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      alignSelf: 'flex-start',
      background: '#1a1030', border: '1px solid #3d2a7a',
      borderRadius: 5, color: '#9d7dea',
      padding: '5px 12px', fontSize: 10, cursor: 'pointer',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = '#2d1a5e'; e.currentTarget.style.color = '#c4b5fd' }}
      onMouseLeave={e => { e.currentTarget.style.background = '#1a1030'; e.currentTarget.style.color = '#9d7dea' }}
    >
      {children}
    </button>
  )
}
