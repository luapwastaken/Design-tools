// The four checks (spec §2), always visible under the swatches. Each points at the swatches it is
// about (hover lights them in the row) and carries its own one-click fix, one history step each.
import { memo } from 'react';
import type { ContrastPair } from '../../../shared/palette/checks.ts';
import { isGround, isInk } from '../../../shared/palette/roles.ts';
import { cssColor } from '../../../shared/color/index.ts';
import { Button, Icon, Module, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { setColours, type Doc } from './actions.ts';
import { displayName, listNames, type DesignDoc, type DesignView } from './doc.ts';
import { Print } from './Print.tsx';
import { results } from './results.ts';
import { fmtL } from './SwatchChip.tsx';
import { Value } from './Value.tsx';
import { Vision } from './Vision.tsx';
import { pointAt } from './view-state.ts';
import s from './Checks.module.css';

export type CheckProps = { doc: Doc; d: DesignDoc; v: DesignView };

/** memo: mid-drag on a long palette the view re-renders every frame while the settled document it passes stays put */
export const Checks = memo(function Checks(p: CheckProps) {
  const r = results(p.d.swatches, p.v.flagL, p.v.flagE);
  return (
    <div className={cx(s.checks, p.v.print && s.printOpen)}>
      <Contrast {...p} pairs={r.contrast} failing={r.failing} />
      <div className={s.right}>
        <Value {...p} collisions={r.collisions} contrast={r.contrast} />
        <Vision {...p} vision={r.vision} />
      </div>
      <Print {...p} out={r.outOfSrgb} />
    </div>
  );
});

// ── contrast ─────────────────────────────────────────────────────────────────────────────────────

const LOG21 = Math.log(21);
/** ratios 1 to 21 on a log scale, as WCAG's thresholds are spaced */
const at = (ratio: number) => `${(Math.log(Math.min(21, Math.max(1, ratio))) / LOG21) * 100}%`;
const MARKS = [3, 4.5, 7];

const fixVerb = (p: ContrastPair) => (p.fix!.oklch[0] > p.text.oklch[0] ? 'Lift' : 'Darken');

function Contrast({ doc, d, pairs, failing }: CheckProps & { pairs: ContrastPair[]; failing: ContrastPair[] }) {
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
    <Module
      title="Contrast"
      sub="Text on background · WCAG 2.2"
      readout={pairs.length ? `${body} of ${pairs.length} pass body text` : undefined}
      scroll
      flush
      className={s.contrast}
      footer={worst && <Advice p={worst} several={several(worst)} />}
    >
      {pairs.length === 0 ? (
        <p className={s.none}>{d.swatches.length < 2 ? 'Add a text colour and a background to check them as a pair.' : 'Give swatches a Background or Surface role, or add a lighter or darker one, to pair text with grounds.'}</p>
      ) : (
        <>
          <div className={s.ctScale}>
            <span className="lbl">Specimen</span>
            <span className="lbl">Pair</span>
            <span className={cx('lbl', s.r)}>Ratio</span>
            <span className={s.scaleNums}>
              {[1, ...MARKS, 21].map((n) => (
                <span key={n} style={{ left: at(n) }}>
                  {n}
                </span>
              ))}
            </span>
            <span className={cx('lbl', s.r)}>Grade</span>
          </div>
          {pairs.map((p) => (
            <ContrastRow key={`${p.text.id}:${p.ground.id}`} doc={doc} p={p} lightest={p.ground.oklch[0] === lightest} />
          ))}
          {free.length > 0 && (
            <p className={s.skipped}>
              Not checked as text: {listNames(free.map((w) => `${displayName(w)} (${w.role})`))}. Custom roles are left out; give a swatch a job role or none to check it.
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
  const none = several ? ' No lightness of this hue passes on every ground it sits on.' : ' No lightness of this hue reaches the target here.';
  const fix = p.fix ? ` ${fixVerb(p)} it to L ${fmtL(p.fix.oklch[0])} for ${p.target}:1.` : none;
  return (
    <>
      <Icon name="error" size={16} className={s.adviceIcon} />
      <span>{size + fix}</span>
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
        <Icon name={icon} size={16} />
        {text}
      </span>
    </Tooltip>
  );
}

function ContrastRow({ doc, p, lightest }: { doc: Doc; p: ContrastPair; lightest: boolean }) {
  const fix = () => p.fix && setColours(doc, `${fixVerb(p)} ${displayName(p.text)} for contrast`, { [p.fix.swatchId]: p.fix.oklch });
  return (
    <div className={s.ctRow} {...pointAt([p.text.id, p.ground.id])}>
      <div className={s.spec} style={{ background: cssColor(p.ground.oklch), color: cssColor(p.text.oklch) }} aria-hidden="true">
        <span className={s.aa}>Aa</span>
        <span className={s.sm}>
          Body 12
          <br />
          Label 11
        </span>
      </div>
      <div className={s.pair}>
        <span className={s.p}>
          {displayName(p.text)} on {displayName(p.ground)}
        </span>
        <span className={s.j}>
          {p.text.role ?? 'No role'} on {p.ground.role ?? (lightest ? 'the lightest' : 'the darkest')}
        </span>
      </div>
      <div className={s.ratio}>
        {p.ratio.toFixed(2)}
        <small>:1</small>
      </div>
      <div className={s.gauge} aria-hidden="true">
        <i className={s.bar} />
        <i className={s.fill} style={{ width: at(p.ratio) }} />
        {MARKS.map((m) => (
          <i key={m} className={cx(s.th, m === p.target && s.target)} style={{ left: at(m) }} />
        ))}
        <i className={s.end} style={{ left: at(p.ratio) }} />
      </div>
      {/* the fix sits under the grade it answers, so the gauge keeps the mockup's width */}
      <div className={s.gradeCell}>
        <Grade p={p} />
        {p.fix && (
          <Button size="xs" onClick={fix} tooltip={`${fixVerb(p)} ${displayName(p.text)} to L ${fmtL(p.fix.oklch[0])} for ${p.fix.ratio.toFixed(2)}:1`}>
            {fixVerb(p)} to L {fmtL(p.fix.oklch[0])}
          </Button>
        )}
      </div>
    </div>
  );
}
