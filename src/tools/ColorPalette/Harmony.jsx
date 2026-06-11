import { useMemo } from 'react'
import { usePalette, updateSwatch } from './store.js'
import { toOklch, oklchToHex } from '../../lib/color.js'

// ── Palette harmony critic ──────────────────────────────────────────────────
//
// Reads the palette the way an instructor would: value structure first, then
// hue relationships, chroma distribution and temperature. Each finding is a
// plain-language sentence; where a concrete improvement is computable it comes
// with a one-click fix. Advisory by design — it explains, it doesn't grade.

const SEV = {
  issue: { color: '#e0795a', label: 'Issue' },
  note: { color: '#d3b53f', label: 'Note' },
  good: { color: '#22c55e', label: 'Good' },
}

const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d }
const nameOf = sw => sw.name || sw.hex

function critique(swatches) {
  const findings = []
  if (swatches.length < 2) {
    return { summary: 'Add at least two swatches to analyse the palette.', findings }
  }
  const cols = swatches.map(sw => ({ sw, ...toOklch(sw.hex) }))
  const chromatic = cols.filter(c => c.c >= 0.04)

  // ── Value structure ─────────────────────────────────────────────────────────
  const ls = cols.map(c => c.l).sort((a, b) => a - b)
  const lMin = ls[0], lMax = ls[ls.length - 1], lRange = lMax - lMin
  const darkest = cols.reduce((a, b) => (a.l < b.l ? a : b))
  const lightest = cols.reduce((a, b) => (a.l > b.l ? a : b))

  if (lRange < 0.35) {
    findings.push({
      area: 'Value', sev: 'issue',
      text: `All ${cols.length} colours sit between ${pct(lMin)} and ${pct(lMax)} lightness — squinting at this palette, everything merges. A composition needs a value anchor.`,
      fixes: [
        mkFix(darkest.sw, { l: 0.22, c: darkest.c * 0.85, h: darkest.h }, `Darken ${nameOf(darkest.sw)} into an anchor`),
        mkFix(lightest.sw, { l: 0.93, c: Math.min(lightest.c, 0.05), h: lightest.h }, `Lift ${nameOf(lightest.sw)} to a light`),
      ].filter(f => f),
    })
  } else {
    if (lMin > 0.4) findings.push({
      area: 'Value', sev: 'note',
      text: `No dark anchor — the deepest colour (${nameOf(darkest.sw)}) is only ${pct(lMin)} lightness. Shadows and linework will have nothing to land on.`,
      fixes: [mkFix(darkest.sw, { l: 0.22, c: darkest.c * 0.85, h: darkest.h }, `Darken ${nameOf(darkest.sw)}`)].filter(f => f),
    })
    if (lMax < 0.75) findings.push({
      area: 'Value', sev: 'note',
      text: `No light — the brightest colour (${nameOf(lightest.sw)}) tops out at ${pct(lMax)}. Highlights will feel capped.`,
      fixes: [mkFix(lightest.sw, { l: 0.93, c: Math.min(lightest.c, 0.05), h: lightest.h }, `Lift ${nameOf(lightest.sw)}`)].filter(f => f),
    })
    if (lMin <= 0.4 && lMax >= 0.75) findings.push({
      area: 'Value', sev: 'good',
      text: `Solid value range (${pct(lMin)} → ${pct(lMax)}) — the palette holds up in greyscale.`,
    })
  }
  // biggest gap in the value ramp
  if (cols.length >= 4) {
    let gap = 0, at = 0
    for (let i = 1; i < ls.length; i++) if (ls[i] - ls[i - 1] > gap) { gap = ls[i] - ls[i - 1]; at = i }
    if (gap > 0.42) findings.push({
      area: 'Value', sev: 'note',
      text: `Big jump in the value ramp between ${pct(ls[at - 1])} and ${pct(ls[at])} — a mid-tone there would smooth transitions.`,
    })
  }

  // ── Hue relationships ───────────────────────────────────────────────────────
  let scheme = 'neutral'
  if (chromatic.length >= 2) {
    const clusters = clusterHues(chromatic)
    if (clusters.length === 1) {
      const span = clusters[0].span
      scheme = span < 25 ? 'monochromatic' : 'analogous'
      findings.push({
        area: 'Hue', sev: 'good',
        text: span < 25
          ? `Monochromatic — every chromatic colour lives within ${Math.round(span)}° of hue. Cohesive by construction; contrast must come from value and chroma.`
          : `Analogous — hues stay within a ${Math.round(span)}° arc around ${hueName(clusters[0].center)}. Naturally harmonious.`,
      })
    } else if (clusters.length === 2) {
      const d = hueDist(clusters[0].center, clusters[1].center)
      scheme = d > 140 ? 'complementary' : 'two-cluster'
      findings.push({
        area: 'Hue', sev: d > 140 ? 'good' : 'note',
        text: d > 140
          ? `Complementary structure — ${hueName(clusters[0].center)} against ${hueName(clusters[1].center)} (${Math.round(d)}° apart). Strong, balanced tension.`
          : `Two hue groups ${Math.round(d)}° apart (${hueName(clusters[0].center)} and ${hueName(clusters[1].center)}) — close enough to relate, far enough to feel unresolved. Either pull them together (analogous) or push one toward the complement.`,
      })
    } else {
      scheme = 'multi'
      findings.push({
        area: 'Hue', sev: 'note',
        text: `${clusters.length} distinct hue families (${clusters.map(cl => hueName(cl.center)).join(', ')}). Workable, but the more families, the more value/chroma discipline it takes to keep it coherent.`,
      })
    }
    // near-clash pairs: vivid colours 25–55° apart
    for (let i = 0; i < chromatic.length; i++) {
      for (let j = i + 1; j < chromatic.length; j++) {
        const a = chromatic[i], b = chromatic[j]
        const d = hueDist(a.h, b.h)
        if (d > 25 && d < 55 && a.c > 0.1 && b.c > 0.1) {
          const mover = a.c <= b.c ? a : b
          const anchor = a.c <= b.c ? b : a
          const alignedH = (anchor.h + (hueDist((anchor.h + 15) % 360, mover.h) < hueDist((anchor.h - 15 + 360) % 360, mover.h) ? 15 : -15) + 360) % 360
          findings.push({
            area: 'Hue', sev: 'issue',
            text: `${nameOf(a.sw)} and ${nameOf(b.sw)} are ${Math.round(d)}° apart at full strength — close enough to vibrate, not far enough to contrast. Classic clash zone.`,
            fixes: [mkFix(mover.sw, { l: mover.l, c: mover.c, h: alignedH }, `Pull ${nameOf(mover.sw)} toward ${nameOf(anchor.sw)}`)].filter(f => f),
          })
        }
      }
    }
  }

  // ── Chroma distribution ─────────────────────────────────────────────────────
  if (chromatic.length) {
    const vivid = chromatic.filter(c => c.c > 0.12).sort((a, b) => b.c - a.c)
    if (vivid.length >= 3 && vivid.length / cols.length > 0.5) {
      const hero = vivid[0]
      findings.push({
        area: 'Chroma', sev: 'issue',
        text: `${vivid.length} of ${cols.length} colours are at high saturation — they compete for attention and nothing reads as the accent. Keep one hero (${nameOf(hero.sw)} is the strongest) and mute the rest.`,
        fixes: vivid.slice(1).map(v => mkFix(v.sw, { l: v.l, c: v.c * 0.55, h: v.h }, `Mute ${nameOf(v.sw)}`)).filter(f => f),
      })
    } else if (vivid.length === 0 && chromatic.every(c => c.c < 0.07)) {
      const strongest = chromatic.reduce((a, b) => (a.c > b.c ? a : b))
      findings.push({
        area: 'Chroma', sev: 'note',
        text: `Everything is muted — calm, but there's no accent to direct the eye. Consider pushing one colour's saturation up.`,
        fixes: [mkFix(strongest.sw, { l: strongest.l, c: Math.max(0.14, strongest.c * 2.2), h: strongest.h }, `Boost ${nameOf(strongest.sw)} into an accent`)].filter(f => f),
      })
    } else if (vivid.length >= 1 && vivid.length <= 2) {
      findings.push({
        area: 'Chroma', sev: 'good',
        text: `Saturation hierarchy works — ${vivid.map(v => nameOf(v.sw)).join(' and ')} lead${vivid.length === 1 ? 's' : ''}, the rest support.`,
      })
    }
  }

  // ── Temperature ─────────────────────────────────────────────────────────────
  if (chromatic.length >= 2) {
    const isWarm = h => h <= 120 || h >= 330
    let warmW = 0, coolW = 0
    for (const c of chromatic) (isWarm(c.h) ? warmW += c.c : coolW += c.c)
    const total = warmW + coolW
    if (total > 0) {
      const warmPct = warmW / total
      if (warmPct > 0.8) findings.push({ area: 'Temperature', sev: 'note', text: 'Reads warm throughout. Cohesive — a small cool note would give the warms something to glow against.' })
      else if (warmPct < 0.2) findings.push({ area: 'Temperature', sev: 'note', text: 'Reads cool throughout. Cohesive — a small warm note would add life if it feels sterile.' })
      else findings.push({ area: 'Temperature', sev: 'good', text: `Warm/cool mix (${Math.round(warmPct * 100)}% warm by chroma weight) — temperature contrast is available for lighting and depth.` })
    }
  }

  // ── Summary line ────────────────────────────────────────────────────────────
  const issues = findings.filter(f => f.sev === 'issue').length
  const schemeWord = { monochromatic: 'a monochromatic', analogous: 'an analogous', complementary: 'a complementary', 'two-cluster': 'a split-hue', multi: 'a multi-hue', neutral: 'a mostly neutral' }[scheme]
  const summary = issues === 0
    ? `Reads as ${schemeWord} palette with no structural problems — notes below are refinements, not corrections.`
    : `Reads as ${schemeWord} palette with ${issues} structural issue${issues === 1 ? '' : 's'} worth addressing.`
  return { summary, findings }
}

function mkFix(sw, oklch, label) {
  if (sw.locked) return null
  const hex = oklchToHex(oklch.l, oklch.c, oklch.h)
  if (hex === sw.hex) return null
  return { id: sw.id, hex, label }
}

const pct = v => `${Math.round(v * 100)}%`

// Greedy circular hue clustering — groups chromatic colours into ≤35°-wide arcs.
function clusterHues(chromatic) {
  const hs = chromatic.map(c => c.h).sort((a, b) => a - b)
  const used = new Array(hs.length).fill(false)
  const clusters = []
  for (let i = 0; i < hs.length; i++) {
    if (used[i]) continue
    const members = [hs[i]]; used[i] = true
    for (let j = 0; j < hs.length; j++) {
      if (!used[j] && members.some(m => hueDist(m, hs[j]) <= 35)) { members.push(hs[j]); used[j] = true; j = -1 }
    }
    // circular mean of the members
    let sx = 0, sy = 0
    for (const m of members) { sx += Math.cos(m * Math.PI / 180); sy += Math.sin(m * Math.PI / 180) }
    const center = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360
    const span = Math.max(...members.map(m => hueDist(m, center))) * 2
    clusters.push({ center, span, n: members.length })
  }
  return clusters.sort((a, b) => b.n - a.n)
}

function hueName(h) {
  const names = [[15, 'red'], [45, 'orange'], [75, 'amber'], [105, 'yellow'], [135, 'yellow-green'], [165, 'green'], [200, 'teal'], [240, 'cyan-blue'], [280, 'blue'], [315, 'purple'], [345, 'magenta'], [360, 'red']]
  for (const [limit, name] of names) if (h <= limit) return name
  return 'red'
}

export default function Harmony() {
  const s = usePalette()
  const { summary, findings } = useMemo(() => critique(s.swatches), [s.swatches])
  const allFixes = findings.flatMap(f => f.fixes || [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 620 }}>
      <p style={{ fontSize: 12, color: '#ccc', margin: 0, lineHeight: 1.5 }}>{summary}</p>

      {findings.map((f, i) => (
        <div key={i} style={{ background: '#151520', borderRadius: 6, padding: 10, border: '1px solid #2a2a35' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, color: SEV[f.sev].color }}>{SEV[f.sev].label}</span>
            <span style={{ fontSize: 9, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5 }}>{f.area}</span>
          </div>
          <div style={{ fontSize: 11, color: '#bbb', lineHeight: 1.5 }}>{f.text}</div>
          {f.fixes?.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {f.fixes.map((fix, j) => (
                <button key={j} onClick={() => updateSwatch(fix.id, { hex: fix.hex })} style={fixBtn}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: fix.hex, border: '1px solid #333', display: 'inline-block' }} />
                  {fix.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {allFixes.length > 1 && (
        <button onClick={() => allFixes.forEach(fix => updateSwatch(fix.id, { hex: fix.hex }))} style={{ ...fixBtn, alignSelf: 'flex-start', borderColor: '#3d2a7a', color: '#e0d8ff', background: '#1e1a2e' }}>
          Apply all {allFixes.length} fixes
        </button>
      )}

      <p style={{ fontSize: 10, color: '#666', margin: 0, lineHeight: 1.5 }}>
        Advisory only — stylised palettes break these rules on purpose. Locked swatches are never modified. Updates live as you edit.
      </p>
    </div>
  )
}

const fixBtn = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: '#18181c', border: '1px solid #2a2a35', borderRadius: 5,
  color: '#aaa', padding: '4px 10px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
}
