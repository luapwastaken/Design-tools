import { useState, useMemo } from 'react'
import { contrast } from '../../lib/color.js'
import { usePalette } from './store.js'
import {
  resolveSlots, seriesColors, coverage, defaultScenes, SLOTS,
} from './inContextSlots.js'
import {
  Section, FieldLabel, Hint, ModeChip, Select, Badge, Finding, MiniBtn, T,
} from './panelUi.jsx'

// ── Your palette as a real layout ─────────────────────────────────────────────
//
// Swatch chips flatter a palette; a real layout does not. Which slot each colour
// fills is worked out in inContextSlots.js — surface and muted are derived from
// the ground rather than forced onto a brand colour, because a palette that
// happens to contain its own neutrals is the exception.
//
// The scenes exist because a nav bar and a card only ever exercise three
// colours. Past that you need surfaces that put many colours adjacent at small
// size, which is what the badge row and the chart are for.

const SCENES = [
  { id: 'interface', label: 'Interface', hint: 'Nav, card, buttons — the three-colour core.' },
  { id: 'status',    label: 'Status and tags', hint: 'Every colour carrying a label, so you can see which ones can host text.' },
  { id: 'data',      label: 'Data',     hint: 'A chart and stat tiles — every colour next to every other at small size.' },
]

const SLOT_LABELS = {
  background: 'Background', surface: 'Surface', text: 'Text',
  primary: 'Primary', accent: 'Accent', muted: 'Muted',
}

// Whichever of the ground pair reads better on a fill. Never a hardcoded
// white or black — the point is to show the palette doing the work.
const onFill = (slots, fill) =>
  contrast(slots.background.hex, fill) >= contrast(slots.text.hex, fill)
    ? slots.background.hex : slots.text.hex

const tint = (hex, a) => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${a})`
}

export default function InContext() {
  const { swatches } = usePalette()
  const [overrides, setOverrides] = useState({})
  const [variant, setVariant] = useState(0)
  const [scenes, setScenes] = useState(null)      // null = follow palette size
  const [showPair, setShowPair] = useState(false)

  const live = scenes ?? defaultScenes(swatches.length)

  const light = useMemo(
    () => (swatches.length ? resolveSlots(swatches, { variant, overrides }) : null),
    [swatches, variant, overrides]
  )
  const dark = useMemo(
    () => (swatches.length && showPair ? resolveSlots(swatches, { variant, overrides, dark: true }) : null),
    [swatches, variant, overrides, showPair]
  )

  if (!light) return <Hint>Add swatches to see them in a layout.</Hint>

  const series = seriesColors(swatches, light.slots)
  // Only count what is actually on screen: with the data and status scenes off,
  // the extra colours genuinely aren't being shown.
  const shownIds = new Set(Object.values(light.slots).map(s => s.id).filter(Boolean))
  if (live.status || live.data) series.forEach(s => shownIds.add(s.id))
  const cover = coverage(swatches, shownIds)

  const toggleScene = id => setScenes({ ...live, [id]: !live[id] })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 780 }}>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {SCENES.map(s => (
          <ModeChip key={s.id} active={!!live[s.id]} onClick={() => toggleScene(s.id)}
            title={s.hint} grow={false}>{s.label}</ModeChip>
        ))}
        <span style={{ flex: 1 }} />
        <MiniBtn
          onClick={() => setVariant(v => v + 1)}
          disabled={light.variants < 2}
          title={light.variants < 2
            ? 'Only one workable arrangement in this palette'
            : `Try the next of ${light.variants} arrangements`}>
          Shuffle
        </MiniBtn>
        <ModeChip active={showPair} onClick={() => setShowPair(v => !v)} grow={false}
          title="Render the same layout on a dark ground, to see whether the palette survives inversion">
          Light + dark
        </ModeChip>
      </div>

      {light.warnings.map((w, i) => <Finding key={i} sev="issue">{w}</Finding>)}

      {/* ── The layouts ──────────────────────────────────────────────────── */}
      <Mockup slots={light.slots} series={series} scenes={live}
        label={showPair ? 'Light' : null} />
      {dark && (
        <Mockup slots={dark.slots} series={seriesColors(swatches, dark.slots)} scenes={live}
          label="Dark" />
      )}

      {/* ── Coverage ─────────────────────────────────────────────────────── */}
      <Section label="Palette coverage"
        hint={`${cover.used.length} of ${swatches.length} in use`}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {swatches.map(sw => {
            const used = cover.used.some(u => u.id === sw.id)
            return (
              <span key={sw.id}
                title={`${sw.name || sw.hex} — ${used ? 'used in the layout' : 'not used'}`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '3px 8px 3px 4px', borderRadius: 20,
                  border: `1px solid ${used ? T.line : 'transparent'}`,
                  background: used ? T.raised : 'transparent',
                  opacity: used ? 1 : 0.45,
                }}>
                <span style={{
                  width: 13, height: 13, borderRadius: '50%', background: sw.hex,
                  border: `1px solid ${T.line}`,
                }} />
                <span className="cp-label" style={{ color: used ? T.textDim : T.faint }}>
                  {sw.name || sw.hex}
                </span>
              </span>
            )
          })}
        </div>
        <Hint>
          {cover.unused.length === 0
            ? 'Every colour is doing a job in this layout.'
            : `${cover.unused.length} colour${cover.unused.length === 1 ? '' : 's'} sit${cover.unused.length === 1 ? 's' : ''} unused. Turn on more scenes to give them somewhere to go, or take it as a sign the palette carries more colours than an interface needs.`}
        </Hint>
      </Section>

      {/* ── Assignment ───────────────────────────────────────────────────── */}
      <Section label="Assignment"
        hint="Surface and muted are worked out from the ground unless you pin them"
        action={Object.keys(overrides).length > 0
          ? <MiniBtn onClick={() => setOverrides({})}>Unpin all</MiniBtn>
          : null}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {SLOTS.map(key => {
            const s = light.slots[key]
            const isDerived = light.derived[key]
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <FieldLabel style={{ width: 82, flexShrink: 0 }}>{SLOT_LABELS[key]}</FieldLabel>
                <span style={{
                  width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                  background: s.hex, border: `1px solid ${T.line}`,
                }} />
                <Select
                  value={overrides[key] ?? ''}
                  aria-label={`${SLOT_LABELS[key]} colour`}
                  onChange={e => setOverrides(o => {
                    const next = { ...o }
                    if (e.target.value) next[key] = e.target.value
                    else delete next[key]
                    return next
                  })}
                  style={{ flex: 1 }}>
                  <option value="">
                    {isDerived ? `Worked out — ${s.hex}` : `Chosen for you — ${s.name || s.hex}`}
                  </option>
                  {swatches.map(sw => (
                    <option key={sw.id} value={sw.id}>{sw.name || sw.hex}</option>
                  ))}
                </Select>
                {isDerived && <Badge tone="neutral" title="Not one of your swatches — derived from the background and text so it always reads">derived</Badge>}
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}

// ── The mockup ────────────────────────────────────────────────────────────────
//
// Type sizes here stand in for a real website's scale, so they are content
// rather than this tool's chrome and are exempt from the panel's 11px floor.

function Mockup({ slots, series, scenes, label }) {
  const S = slots
  const ratio = contrast(S.text.hex, S.background.hex)

  return (
    <div>
      {label && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span className="cp-micro">{label}</span>
          <span className="cp-num" style={{ fontSize: T.label, color: T.muted }}>
            {ratio.toFixed(2)}:1
          </span>
          <Badge tone={ratio >= 4.5 ? 'pass' : ratio >= 3 ? 'partial' : 'fail'}>
            {ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'Large only' : 'fails'}
          </Badge>
        </div>
      )}

      <div style={{
        background: S.background.hex, borderRadius: T.rLg,
        border: `1px solid ${T.line}`, overflow: 'hidden',
      }}>
        {scenes.interface && <SceneInterface S={S} />}
        {scenes.status && <SceneStatus S={S} series={series} />}
        {scenes.data && <SceneData S={S} series={series} />}
      </div>
    </div>
  )
}

function SceneInterface({ S }) {
  return (
    <div style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ width: 24, height: 24, borderRadius: 7, background: S.primary.hex, flexShrink: 0 }} />
        <span style={{ color: S.text.hex, fontSize: 15, fontWeight: 700, flex: 1, letterSpacing: -0.2 }}>
          Aa Brand
        </span>
        <span style={{ color: S.muted.hex, fontSize: 12 }}>Home</span>
        <span style={{ color: S.muted.hex, fontSize: 12 }}>Pricing</span>
        <span style={{ color: S.accent.hex, fontSize: 12, fontWeight: 600 }}>Sign in</span>
      </div>

      <div style={{ background: S.surface.hex, borderRadius: 8, padding: 14, marginBottom: 14 }}>
        <div style={{ color: S.text.hex, fontSize: 13, fontWeight: 600, marginBottom: 5 }}>Card title</div>
        <div style={{ color: S.muted.hex, fontSize: 12, lineHeight: 1.55 }}>
          Supporting copy sits on a raised surface above the page background.
          Secondary information stays readable without competing with the title.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ background: S.primary.hex, color: onFill(S, S.primary.hex), fontSize: 12, fontWeight: 600, padding: '7px 15px', borderRadius: 6 }}>Primary</span>
        <span style={{ background: S.accent.hex, color: onFill(S, S.accent.hex), fontSize: 12, fontWeight: 600, padding: '7px 15px', borderRadius: 6 }}>Get started</span>
        <span style={{ border: `1px solid ${S.accent.hex}`, color: S.accent.hex, fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 6 }}>Learn more</span>
        <span style={{ color: S.muted.hex, fontSize: 12, textDecoration: 'underline', textUnderlineOffset: 3 }}>or read the docs</span>
      </div>
    </div>
  )
}

// Each colour as a solid pill with an automatically chosen label colour. This
// is the surface that answers "can I put type on this one?" for the whole
// palette at once — the question chips can't ask.
function SceneStatus({ S, series }) {
  return (
    <div style={{ padding: '0 18px 18px' }}>
      <Rule S={S} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginBottom: 14 }}>
        {series.map(c => (
          <span key={c.id} title={`${c.name} — ${contrast(onFill(S, c.hex), c.hex).toFixed(2)}:1 on its own label`}
            style={{
              background: c.hex, color: onFill(S, c.hex),
              fontSize: 11, fontWeight: 600, letterSpacing: 0.2,
              padding: '4px 11px', borderRadius: 20,
            }}>{c.name}</span>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {series.slice(0, 3).map(c => (
          <div key={c.id} style={{
            background: tint(c.hex, 0.13),
            borderLeft: `3px solid ${c.hex}`,
            borderRadius: '0 6px 6px 0', padding: '9px 12px',
          }}>
            <div style={{ color: S.text.hex, fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{c.name}</div>
            <div style={{ color: S.muted.hex, fontSize: 12, lineHeight: 1.5 }}>
              A callout tinted from this colour, with body copy over it.
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SceneData({ S, series }) {
  // Deterministic heights — a chart that reshuffles on every render makes it
  // harder, not easier, to compare two arrangements.
  const bars = series.map((c, i) => ({ ...c, v: 34 + ((i * 37) % 63) }))

  return (
    <div style={{ padding: '0 18px 18px' }}>
      <Rule S={S} />
      <div style={{ display: 'flex', gap: 9, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'Revenue', value: '£48.2k', c: S.primary.hex },
          { label: 'Active', value: '1,284', c: S.accent.hex },
          { label: 'Churn', value: '2.1%', c: S.muted.hex },
        ].map(k => (
          <div key={k.label} style={{
            flex: '1 1 110px', background: S.surface.hex, borderRadius: 8,
            padding: '10px 12px', borderTop: `2px solid ${k.c}`,
          }}>
            <div style={{ color: S.muted.hex, fontSize: 11, marginBottom: 3, letterSpacing: 0.3 }}>{k.label}</div>
            <div style={{ color: S.text.hex, fontSize: 19, fontWeight: 700, letterSpacing: -0.4 }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: S.surface.hex, borderRadius: 8, padding: '14px 14px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 96 }}>
          {bars.map(b => (
            <div key={b.id} title={`${b.name} — ${b.v}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
              <div style={{ height: `${b.v}%`, background: b.hex, borderRadius: '3px 3px 0 0', minHeight: 4 }} />
            </div>
          ))}
        </div>
        <div style={{ height: 1, background: tint(S.text.hex, 0.18), margin: '0 0 9px' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 12px' }}>
          {bars.map(b => (
            <span key={b.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: b.hex }} />
              <span style={{ color: S.muted.hex, fontSize: 11 }}>{b.name}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// A hairline drawn from the text colour, so scene divisions belong to the
// palette rather than to the panel around it.
function Rule({ S }) {
  return <div style={{ height: 1, background: tint(S.text.hex, 0.12), margin: '0 0 16px' }} />
}
