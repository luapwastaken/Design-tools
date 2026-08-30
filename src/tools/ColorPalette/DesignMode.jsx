import Generators from './Generators.jsx'
import Recipes from './Recipes.jsx'
import ImageExtract from './ImageExtract.jsx'
import Gradient from './Gradient.jsx'
import Accessibility from './Accessibility.jsx'
import AutoFix from './AutoFix.jsx'
import Harmony from './Harmony.jsx'
import PaintMix from './PaintMix.jsx'
import { T } from './tokens.js'
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
      { id: 'Accessibility', label: 'Accessibility', El: Accessibility },
      { id: 'Harmony',       label: 'Harmony',       El: Harmony },
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
            <p.El />
          </div>
        ))}
      </div>
    </div>
  )
}
