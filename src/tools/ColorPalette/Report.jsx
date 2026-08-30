import { useMemo } from 'react'
import { usePalette } from './store.js'
import { setUi } from './uiState.js'
import { runAll } from './checks.js'
import { T, Section, Hint, Body, Finding, MiniBtn, Stat, Badge } from './panelUi.jsx'

// ── Report ────────────────────────────────────────────────────────────────────
//
// The entry point to the Check group. Without it, finding out that nothing is
// wrong means visiting six panels one at a time and reading each — so in practice
// nobody checks anything until something has already gone wrong.
//
// Every number here comes from checks.js, the same module the individual panels
// read from, so this can't drift into disagreeing with the panel it summarises.

export default function Report() {
  const { swatches, printProfile } = usePalette()
  const { sections, issues, notes } = useMemo(
    () => runAll(swatches, printProfile, 'riso'),
    [swatches, printProfile]
  )

  if (swatches.length < 2) {
    return <Hint>Add at least two swatches for a report.</Hint>
  }

  const verdict = issues.length === 0
    ? notes.length === 0
      ? { tone: 'pass', head: 'Sound', body: 'Nothing structural to fix. The palette holds up on value, contrast, reproduction and roles.' }
      : { tone: 'pass', head: 'Sound, with refinements', body: `No structural problems. ${notes.length} thing${notes.length === 1 ? '' : 's'} worth a look, none of them blocking.` }
    : { tone: 'fail', head: `${issues.length} problem${issues.length === 1 ? '' : 's'} to fix`, body: 'These will show up in use — in greyscale, on press, or for anyone who has trouble with contrast.' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>

      <div style={{
        display: 'flex', gap: 14, alignItems: 'flex-start',
        padding: '14px 16px', borderRadius: T.rLg,
        background: T.raised,
        border: `1px solid ${issues.length ? 'rgba(248,113,113,0.35)' : 'rgba(74,222,128,0.3)'}`,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: T.title, fontWeight: 700, marginBottom: 4,
            color: issues.length ? T.bad : T.ok,
          }}>{verdict.head}</div>
          <Body>{verdict.body}</Body>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <Stat label="Colours" value={swatches.length} good />
          <Stat label="Issues" value={issues.length} good={issues.length === 0} />
          <Stat label="Notes" value={notes.length} good={notes.length === 0} />
        </div>
      </div>

      {/* Every section reports, including the clean ones. A check that stays
          silent when it passes is indistinguishable from a check that never ran —
          which is exactly the failure AutoFix used to have. */}
      {sections.map(sec => {
        const secIssues = sec.findings.filter(f => f.sev === 'issue')
        const secNotes = sec.findings.filter(f => f.sev === 'note')
        const tone = secIssues.length ? 'fail' : secNotes.length ? 'partial' : 'pass'
        return (
          <Section key={sec.id} label={sec.label}
            hint={secIssues.length ? `${secIssues.length} issue${secIssues.length === 1 ? '' : 's'}`
              : secNotes.length ? `${secNotes.length} note${secNotes.length === 1 ? '' : 's'}`
              : 'clear'}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Badge tone={tone}>
                {tone === 'fail' ? 'Needs work' : tone === 'partial' ? 'Worth a look' : 'Clear'}
              </Badge>
              <div style={{ flex: 1 }} />
              {sec.panel !== 'Report' && (
                <MiniBtn onClick={() => setUi({ panel: sec.panel })}>
                  Open {sec.panel} →
                </MiniBtn>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sec.findings.map((f, i) => <Finding key={i} sev={f.sev}>{f.text}</Finding>)}
            </div>
          </Section>
        )
      })}

      <Hint>
        Reproduction is measured against the print profile set in the Reproduction
        panel, matched to Riso inks. Harmony and the full accessibility breakdown
        have their own panels — this only reports whether there's something there
        worth opening them for.
      </Hint>
    </div>
  )
}
