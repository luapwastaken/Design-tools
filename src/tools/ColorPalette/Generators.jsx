import { useState, useMemo } from 'react'
import { generateHarmony, generateRamp, oklchToHex } from '../../lib/color.js'
import { addSwatch, usePalette } from './store.js'
import { NumberSlider, EditableNumber } from '../../components/NumberField.jsx'
import { Section, FieldLabel, ModeChip, StepBtn, DiceBtn, AddBtn, SwatchStrip, LockableStrip, ACCENT, T } from './panelUi.jsx'

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
            className="cp-input cp-input--mono"
            style={{ width: 100 }}
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

// ── Range row (min + max sliders) ─────────────────────────────────────────────

function RangeRow({ label, minVal, maxVal, onMinChange, onMaxChange, step, min, max }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <FieldLabel style={{ width: 62, flexShrink: 0 }}>{label}</FieldLabel>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: T.micro, color: T.faint, width: 24 }}>min</span>
          <input type="range" min={min} max={max} step={step} value={minVal}
            onChange={e => onMinChange(+e.target.value)}
            style={{ flex: 1, accentColor: ACCENT }}
          />
          <EditableNumber value={+(minVal * 100).toFixed(1)} onChange={v => onMinChange(v / 100)}
            min={min * 100} max={max * 100} step={step * 100} dec={0} suffix="%" width={30} color={T.muted} accent={ACCENT} />
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <span style={{ fontSize: T.micro, color: T.faint, width: 24 }}>max</span>
          <input type="range" min={min} max={max} step={step} value={maxVal}
            onChange={e => onMaxChange(+e.target.value)}
            style={{ flex: 1, accentColor: ACCENT }}
          />
          <EditableNumber value={+(maxVal * 100).toFixed(1)} onChange={v => onMaxChange(v / 100)}
            min={min * 100} max={max * 100} step={step * 100} dec={0} suffix="%" width={30} color={T.muted} accent={ACCENT} />
        </div>
      </div>
    </div>
  )
}
