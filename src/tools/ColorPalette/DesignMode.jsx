import Generators from './Generators.jsx'
import Recipes from './Recipes.jsx'
import ImageExtract from './ImageExtract.jsx'
import Gradient from './Gradient.jsx'
import Report from './Report.jsx'
import Accessibility from './Accessibility.jsx'
import Structure from './Structure.jsx'
import Reproduction from './Reproduction.jsx'
import InContext from './InContext.jsx'
import AutoFix from './AutoFix.jsx'
import PaintMix from './PaintMix.jsx'
import { useState } from 'react'
import { T } from './tokens.js'
import { ResetBtn } from './panelUi.jsx'
import { useUi, setUi } from './uiState.js'

// ── Design-mode panels ────────────────────────────────────────────────────────
//
// Eleven flat chips became eight in three named groups. The groups are the point:
// the old row mixed three unrelated jobs — inventing colours, auditing them, and
// mixing physical paint — with nothing to say which was which, so there was no
// way to guess where anything lived.
//
// Grade, Contrast, BG Check and Vision were four separate panels answering one
// question ("can people see this?"), three of them computing WCAG ratios against
// a background. They are now sub-views inside Accessibility.
//
// Check reads as a sequence rather than a pile: Report says whether anything is
// wrong, the four middle panels each answer one question about the palette, and
// AutoFix is where you act. Structure pairs the value measurement with Harmony's
// critique, which opens on value anyway.

const GROUPS = [
  {
    id: 'build', label: 'Build',
    hint: 'Invent colours',
    panels: [
      { id: 'Generators', label: 'Generators', El: Generators },
      { id: 'Recipes',    label: 'Recipes',    El: Recipes },
      { id: 'Image',      label: 'Image',      El: ImageExtract },
      { id: 'Gradient',   label: 'Gradient',   El: Gradient },
    ],
  },
  {
    id: 'check', label: 'Check',
    hint: 'Audit what you have',
    panels: [
      { id: 'Report',        label: 'Report',        El: Report },
      { id: 'Structure',     label: 'Structure',     El: Structure },
      { id: 'Accessibility', label: 'Accessibility', El: Accessibility },
      { id: 'Reproduction',  label: 'Reproduction',  El: Reproduction },
      { id: 'In context',    label: 'In context',    El: InContext },
      { id: 'AutoFix',       label: 'AutoFix',       El: AutoFix },
    ],
  },
  {
    id: 'paint', label: 'Paint',
    hint: 'Mix it for real',
    panels: [
      { id: 'Paint Mix', label: 'Paint Mix', El: PaintMix },
    ],
  },
]

const ALL = GROUPS.flatMap(g => g.panels)

export default function DesignMode() {
  const { panel } = useUi()
  const current = ALL.some(p => p.id === panel) ? panel : ALL[0].id

  // Resetting a panel is exactly "throw away this component's state", which
  // React already does when a key changes. Bumping the key is one mechanism that
  // resets all eleven panels — including the ones holding a dozen useStates —
  // without each one having to hoist its defaults out and write a reset of its
  // own that then drifts from them.
  //
  // The one thing it can't reach is state a panel persists itself: PaintMix
  // reloads your owned pigments from localStorage on mount, so it carries its
  // own reset for that list.
  const [resetSeq, setResetSeq] = useState({})
  const resetPanel = id => setResetSeq(s => ({ ...s, [id]: (s[id] ?? 0) + 1 }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      <nav aria-label="Design panels" style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap',
        gap: 6, rowGap: 6, padding: '8px 12px',
        borderBottom: `1px solid ${T.line}`, flexShrink: 0,
      }}>
        {GROUPS.map((g, gi) => (
          <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {gi > 0 && (
              <span aria-hidden style={{
                width: 1, height: 16, background: T.line, margin: '0 6px',
              }} />
            )}
            <span className="cp-micro" title={g.hint} style={{ color: T.faint, marginRight: 2 }}>
              {g.label}
            </span>
            {g.panels.map(p => (
              <button key={p.id} type="button"
                onClick={() => setUi({ panel: p.id, group: g.id })}
                aria-current={current === p.id ? 'page' : undefined}
                className={current === p.id ? 'cp-chip is-active' : 'cp-chip'}
              >{p.label}</button>
            ))}
          </div>
        ))}
        <span style={{ flex: 1, minWidth: 12 }} />
        {/* Sits clear of the drawer's collapse chevron, which is pinned right. */}
        <span style={{ marginRight: 30 }}>
          <ResetBtn
            label={`Reset ${current}`}
            title={`Put the ${current} panel back to its defaults — your palette is untouched`}
            onReset={() => resetPanel(current)}
          />
        </span>
      </nav>

      {/* Every panel stays mounted and inactive ones are hidden, rather than
          unmounting all but one. Unmounting was throwing away 62 pieces of
          component state on every tab click — a configured Recipes brief, a
          loaded image, an AutoFix result — so glancing at another panel cost
          you your work. The panels memoise on `swatches`, so the ones you
          can't see cost a few hundred microseconds per palette edit. */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {ALL.map(p => (
          <div key={p.id}
            hidden={current !== p.id}
            style={current === p.id
              ? { height: '100%', overflowY: 'auto', padding: '12px 14px' }
              : undefined}
          >
            <p.El key={resetSeq[p.id] ?? 0} />
          </div>
        ))}
      </div>
    </div>
  )
}
