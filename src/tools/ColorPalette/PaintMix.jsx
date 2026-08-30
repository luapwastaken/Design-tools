// ── "How do I mix this colour?" — paint recipe panel ──────────────────────────
// Pick a target colour and the pigments you actually own; the solver searches
// 1–3-paint Kubelka–Munk mixes and reports measurable recipes ("62% Titanium
// White + 28% Ultramarine + 10% Alizarin"). Reverse mode solves the whole
// palette at once.

import { useState, useMemo, useEffect } from 'react'
import { usePalette } from './store.js'
import { PIGMENTS } from '../../data/pigments.js'
import { solveRecipe, recipeVerdict } from '../../lib/paintRecipe.js'
import { Section, ACCENT, ModeChip, MiniBtn, Card, T } from './panelUi.jsx'

const OWNED_KEY = 'designtools-paintmix-owned'

function loadOwned() {
  try {
    const ids = JSON.parse(localStorage.getItem(OWNED_KEY))
    if (Array.isArray(ids) && ids.length) return new Set(ids)
  } catch {}
  return new Set(PIGMENTS.map(p => p.id))
}

export default function PaintMix() {
  const s = usePalette()
  const active = s.swatches.find(sw => sw.id === s.active) || s.swatches[0]
  const [target, setTarget] = useState(active?.hex || '#3a7ca5')
  const [followActive, setFollowActive] = useState(true)
  const [owned, setOwned] = useState(loadOwned)
  const [maxPigments, setMaxPigments] = useState(3)
  const [allMode, setAllMode] = useState(false)

  // follow the active swatch unless the user typed a custom target
  useEffect(() => {
    if (followActive && active?.hex) setTarget(active.hex)
  }, [active?.hex, followActive])

  useEffect(() => { localStorage.setItem(OWNED_KEY, JSON.stringify([...owned])) }, [owned])

  const pigments = useMemo(() => PIGMENTS.filter(p => owned.has(p.id)), [owned])

  const recipes = useMemo(
    () => (allMode || pigments.length < 2 ? [] : solveRecipe(target, pigments, { maxPigments, topN: 3 })),
    [target, pigments, maxPigments, allMode],
  )

  const paletteRecipes = useMemo(
    () => (allMode && pigments.length >= 2
      ? s.swatches.map(sw => ({ sw, recipe: solveRecipe(sw.hex, pigments, { maxPigments, topN: 1 })[0] }))
      : []),
    [allMode, s.swatches, pigments, maxPigments],
  )

  function toggleOwned(id) {
    setOwned(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 }}>
      <Section label="Your paints" hint="Untick what you don't own — recipes only use ticked pigments.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 4 }}>
          {PIGMENTS.map(p => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: T.label, color: owned.has(p.id) ? T.textDim : T.faint, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={owned.has(p.id)} onChange={() => toggleOwned(p.id)} style={{ accentColor: ACCENT }} />
              <span style={{ width: 12, height: 12, borderRadius: 3, background: p.hex, border: `1px solid ${T.line}`, flexShrink: 0 }} />
              {p.name}
            </label>
          ))}
        </div>
      </Section>

      <Section label="Mode">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <ModeChip active={!allMode} onClick={() => setAllMode(false)}>One colour</ModeChip>
          <ModeChip active={allMode} onClick={() => setAllMode(true)}>Whole palette</ModeChip>
          <div style={{ flex: 1 }} />
          <ModeChip active={maxPigments === 2} onClick={() => setMaxPigments(2)} title="Limit recipes to two paints">Max 2 paints</ModeChip>
          <ModeChip active={maxPigments === 3} onClick={() => setMaxPigments(3)} title="Allow three-paint recipes">Max 3</ModeChip>
        </div>
      </Section>

      {!allMode && (
        <>
          <Section label="Target colour" hint="Follows the active swatch, or pick any colour.">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="color" value={target}
                onChange={e => { setTarget(e.target.value); setFollowActive(false) }}
                style={{ width: 44, height: 30, padding: 0, border: `1px solid ${T.line}`, borderRadius: 5, background: 'none', cursor: 'pointer' }} />
              <span className="cp-num" style={{ fontSize: T.body, color: T.textDim }}>{target}</span>
              {!followActive && (
                <MiniBtn onClick={() => setFollowActive(true)}>Follow active swatch</MiniBtn>
              )}
            </div>
          </Section>

          {pigments.length < 2
            ? <div style={{ fontSize: T.body, color: T.muted }}>Tick at least two paints to solve recipes.</div>
            : recipes.map((r, i) => <RecipeCard key={i} rank={i + 1} recipe={r} target={target} />)}
        </>
      )}

      {allMode && (
        <Section label="Recipes for every swatch" hint="Best single recipe per palette colour with your ticked paints.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {paletteRecipes.map(({ sw, recipe }) => recipe && (
              <div key={sw.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: T.raised, borderRadius: 6, padding: '6px 8px' }}>
                <PairSwatch target={sw.hex} mix={recipe.hex} size={22} />
                <span style={{ fontSize: T.label, color: T.muted, minWidth: 84, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sw.name || sw.hex}</span>
                <span style={{ flex: 1, fontSize: T.label, color: T.textDim }}>
                  {recipe.parts.map(p => `${p.pct}% ${p.pigment.name}`).join(' + ')}
                </span>
                <Verdict de={recipe.de} />
              </div>
            ))}
          </div>
        </Section>
      )}

      <p style={{ fontSize: T.label, color: T.faint, margin: 0, lineHeight: 1.5 }}>
        Percentages are physical parts of the mix — tinting strength is already accounted for.
        Pigment colours are tube approximations; treat recipes as a starting point and adjust by eye.
      </p>
    </div>
  )
}

function RecipeCard({ rank, recipe, target }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: T.micro, color: T.faint, textTransform: 'uppercase', letterSpacing: 0.5 }}>Recipe {rank}</span>
        <Verdict de={recipe.de} />
        <span className="cp-num" style={{ fontSize: T.micro, color: T.faint }}>ΔE {recipe.de.toFixed(1)}</span>
        <div style={{ flex: 1 }} />
        <PairSwatch target={target} mix={recipe.hex} size={28} labelled />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {recipe.parts.map((p, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 14, height: 14, borderRadius: 3, background: p.pigment.hex, border: `1px solid ${T.line}`, flexShrink: 0 }} />
            <span style={{ fontSize: T.body, color: T.textDim, minWidth: 140 }}>{p.pigment.name}</span>
            <div style={{ flex: 1, height: 6, background: T.control, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${p.pct}%`, height: '100%', background: p.pigment.hex }} />
            </div>
            <span className="cp-num" style={{ fontSize: T.body, color: T.accentText, minWidth: 40, textAlign: 'right' }}>{p.pct}%</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

// Target / achieved swatch pair — butted together so any mismatch is visible.
function PairSwatch({ target, mix, size = 24, labelled = false }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: labelled ? 6 : 0 }}>
      {labelled && <span style={{ fontSize: T.micro, color: T.faint }}>target / mix</span>}
      <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: `1px solid ${T.line}` }}>
        <div style={{ width: size, height: size, background: target }} />
        <div style={{ width: size, height: size, background: mix }} />
      </div>
    </div>
  )
}

function Verdict({ de }) {
  const v = recipeVerdict(de)
  return <span style={{ fontSize: T.micro, fontWeight: 600, color: v.color, textTransform: 'uppercase', letterSpacing: 0.4 }}>{v.label}</span>
}
