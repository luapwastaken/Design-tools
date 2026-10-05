// The Checks dock under the artboard (SPEC 3): the four checks as cards side by side, always
// attached, collapsible. Each card points at its swatches (hover outlines them on the artboard) and
// carries its own one-click fix, one history step each.
import { memo, useState } from 'react';
import type { ContrastPair } from '../../../shared/palette/checks.ts';
import { isGround, isInk } from '../../../shared/palette/roles.ts';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { Button, Icon, IconButton, Module, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { fmtL } from '../common/names.ts';
import { Value } from '../common/Value.tsx';
import { mergingCvd, Vision } from '../common/Vision.tsx';
import { setColours, type Doc } from './actions.ts';
import { displayName, listNames, type DesignDoc, type DesignView } from './doc.ts';
import { Print } from './Print.tsx';
import { results } from './results.ts';
import { patchView, pointAt } from './view-state.ts';
import s from './Dock.module.css';

type Props = { doc: Doc; d: DesignDoc; v: DesignView };

/** memo: mid-drag on a long palette the view re-renders every frame while the settled document it passes stays put */
export const ChecksDock = memo(function ChecksDock({ doc, d, v }: Props) {
  const r = results(d.swatches, d.ramps, v.flagL, v.flagE);
  // a simulation picked here stays; until then it shows one that merges a pair, so it opens on the fix
  const [picked, setPicked] = useState(false);
  const cvd = picked ? v.cvd : mergingCvd(r.vision, v.cvd);
  const host = { swatches: r.shown, pointAt, onFix: (label: string, changes: Record<string, Oklch>) => setColours(doc, label, changes) };
  const ok = r.toLookAt === 0;
  return (
    <section className={s.dock} aria-label="Checks" data-open={v.dock}>
      <header className={s.head}>
        <h2 className={s.title}>Checks</h2>
        <span className={cx(s.chip, ok ? s.good : s.bad)}>
          <Icon name={ok ? 'check' : 'warning'} size={14} />
          {ok ? 'Nothing to look at' : `${r.toLookAt} to look at`}
        </span>
        <span className={cx(s.chip, r.outOfSrgb.length ? s.bad : s.good)}>
          <Icon name={r.outOfSrgb.length ? 'warning' : 'check'} size={14} />
          {r.outOfSrgb.length ? `${r.outOfSrgb.length} out of sRGB` : 'Print-safe'}
        </span>
        <span className={s.grow} />
        <span className={s.hint}>Pairs follow your roles. Hover a row to find its colours.</span>
        <IconButton icon={v.dock ? 'keyboard_arrow_down' : 'keyboard_arrow_up'} label={v.dock ? 'Collapse the checks' : 'Open the checks'} shortcut="Ctrl+J" size="sm" latched={v.dock} onClick={() => patchView({ dock: !v.dock })} />
      </header>
      {v.dock && (
        <div className={cx(s.cards, v.inks && s.wide)}>
          {!v.inks && <Contrast doc={doc} d={d} pairs={r.contrast} failing={r.failing} />}
          {!v.inks && (
            <Vision
              {...host}
              className={s.card}
              vision={r.vision}
              names={false}
              flagE={v.flagE}
              onFlagE={(flagE) => patchView({ flagE })}
              cvd={cvd}
              onCvd={(k) => {
                setPicked(true);
                // choosing a simulation here also shows it on the artboard
                patchView({ cvd: k, sim: k });
              }}
            />
          )}
          {!v.inks && <Value {...host} className={s.card} collisions={r.collisions} contrast={r.contrast} flagL={v.flagL} onFlagL={(flagL) => patchView({ flagL })} />}
          <Print doc={doc} d={d} out={r.outOfSrgb} expanded={v.inks} onExpand={(inks) => patchView({ inks })} />
        </div>
      )}
    </section>
  );
});

// ── contrast ─────────────────────────────────────────────────────────────────────────────────────

const fixVerb = (p: ContrastPair) => (p.fix!.oklch[0] > p.text.oklch[0] ? 'Lift' : 'Darken');

function Contrast({ doc, d, pairs, failing }: { doc: Doc; d: DesignDoc; pairs: ContrastPair[]; failing: ContrastPair[] }) {
  const body = pairs.filter((p) => p.ratio >= 4.5).length;
  const worst = failing.reduce<ContrastPair | null>((a, b) => (!a || b.ratio < a.ratio ? b : a), null);
  // free roles (a Border, a Disabled grey) aren't text, so they aren't paired; say so rather than leave them out silently
  const paired = new Set(pairs.flatMap((p) => [p.text.id, p.ground.id]));
  const free = d.swatches.filter((w) => w.role !== null && !isGround(w.role) && !isInk(w.role) && !paired.has(w.id));
  // with no ground roles the darkest and lightest stand in; which one this pair uses
  const pool = d.swatches.filter((w) => !isInk(w.role));
  const lightest = Math.max(...(pool.length ? pool : d.swatches).map((w) => w.oklch[0]));
  const several = (p: ContrastPair) => pairs.filter((x) => x.text.id === p.text.id).length > 1;
  return (
    <Module title="Contrast" sub="WCAG 2.2 · text on ground" readout={pairs.length ? `${body} of ${pairs.length}` : undefined} scroll flush className={s.card}>
      {pairs.length === 0 ? (
        <p className={s.none}>{d.swatches.length < 2 ? 'Add a text colour and a background to check them as a pair.' : 'Give swatches a Background or Surface role, or add a lighter or darker one, to pair text with grounds.'}</p>
      ) : (
        <>
          {pairs.map((p) => (
            <Row key={`${p.text.id}:${p.ground.id}`} doc={doc} p={p} lightest={p.ground.oklch[0] === lightest} />
          ))}
          {worst && (
            <p className={cx(s.note, s.bad)}>
              <Advice p={worst} several={several(worst)} />
            </p>
          )}
          {free.length > 0 && (
            <p className={s.note}>
              <Icon name="info" size={16} />
              <span>Not checked as text: {listNames(free.map((w) => `${displayName(w)} (${w.role})`))}.</span>
            </p>
          )}
        </>
      )}
    </Module>
  );
}

function Advice({ p, several }: { p: ContrastPair; several: boolean }) {
  const pair = `${displayName(p.text)} on ${displayName(p.ground)}`;
  const size = p.grade === 'Fail' ? `${displayName(p.text)} fails as text on ${displayName(p.ground)} at any size.` : `${pair} passes only for large text and shapes.`;
  // the row's own button says the fix; with none, say why not
  const none = several ? ' No lightness of this hue passes on every ground it sits on.' : ' No lightness of this hue reaches the target here.';
  return (
    <>
      <Icon name="error" size={16} />
      <span>{p.fix ? size : size + none}</span>
    </>
  );
}

function Grade({ p }: { p: ContrastPair }) {
  const pass = p.ratio >= p.target;
  const large = p.grade === 'AA large · non-text';
  const icon = !pass && p.grade === 'Fail' ? 'close' : !pass && large ? 'format_size' : 'check';
  const text = p.grade === 'Fail' ? 'Fail' : large ? 'Large' : p.grade;
  const why = `${p.grade}. ${p.target === 3 ? 'A fill (button, chart mark) needs 3:1.' : 'Body text needs 4.5:1.'}`;
  return (
    <Tooltip content={why}>
      <span className={cx(s.grade, !pass && p.grade === 'Fail' && s.bad)}>
        <Icon name={icon} size={14} />
        {text}
      </span>
    </Tooltip>
  );
}

function Row({ doc, p, lightest }: { doc: Doc; p: ContrastPair; lightest: boolean }) {
  const fix = () => p.fix && setColours(doc, `${fixVerb(p)} ${displayName(p.text)} for contrast`, { [p.fix.swatchId]: p.fix.oklch });
  return (
    <div className={cx(s.crow, p.ratio < p.target && s.failing)} {...pointAt([p.text.id, p.ground.id])}>
      <span className={s.spec} style={{ background: cssColor(p.ground.oklch), color: cssColor(p.text.oklch) }} aria-hidden="true">
        Aa
      </span>
      <span className={s.pair}>
        <span className={s.p}>
          {displayName(p.text)} on {displayName(p.ground)}
        </span>
        <span className={s.j}>
          {p.text.role ?? 'No role'} on {p.ground.role ?? (lightest ? 'the lightest' : 'the darkest')}
        </span>
      </span>
      <span className={s.ratio}>{p.ratio.toFixed(2)}</span>
      <Grade p={p} />
      {p.fix && (
        <Button size="xs" onClick={fix} className={s.fix} tooltip={`${fixVerb(p)} ${displayName(p.text)} to L ${fmtL(p.fix.oklch[0])} for ${p.fix.ratio.toFixed(2)}:1`}>
          {fixVerb(p)} to L {fmtL(p.fix.oklch[0])}
        </Button>
      )}
    </div>
  );
}
