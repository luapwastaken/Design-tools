// Check (UX pass): the data behind Check mode. The boards show it; the pane under them lists what
// to fix (Problems). Value compares the ramps' bases: steps of different ramps share values by
// design, and the order inside a ramp is the row's own value strip and its "Value breaks" mark.
import { useMemo } from 'react';
import type { Cvd, Oklch } from '../../../shared/color/index.ts';
import { cvdClosest, valueCollisions, type CvdClosest, type ValueCollision } from '../../../shared/palette/checks.ts';
import type { Swatch } from '../../../shared/types.ts';
import { Button, Icon } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { cvdFix, valueFix } from '../common/adjust.ts';
import { displayName, plural } from '../common/names.ts';
import { useSettled } from '../common/settled.ts';
import { VISIONS, type Kind } from '../common/Vision.tsx';
import type { Doc } from './actions.ts';
import { named, recolour, type IllustrationDoc } from './doc.ts';
import { pointAt, type IllustrationView } from './view-state.ts';
import s from './Check.module.css';

export type Checks = {
  settled: IllustrationDoc;
  /** blank names filled in, as the checks' sentences name them */
  shown: Swatch[];
  /** the bases, and colours in no ramp: what a painting's big shapes are */
  bases: Swatch[];
  collisions: ValueCollision[];
  vision: Record<Kind, CvdClosest | null>;
  /** the pairs that merge under some simulation, once each however many merge them */
  merged: CvdClosest[];
  /** the Check tab's badge */
  problems: number;
};

/** computed once per settled change, for the tab's badge and the list alike */
export function useChecks(doc: Doc, v: IllustrationView): Checks {
  const settled = useSettled(doc);
  return useMemo(() => {
    const shown = named(settled);
    const bases = shown.filter((w) => w.step === 0 || !settled.ramps.some((r) => r.id === w.group));
    const collisions = valueCollisions(bases, v.flagL / 100);
    const vision = Object.fromEntries(VISIONS.map((k) => [k, cvdClosest(shown, k, { flagBelow: v.flagE })])) as Record<Kind, CvdClosest | null>;
    const pairs = new Map(VISIONS.flatMap((k) => (k !== 'typical' && vision[k]?.flag ? [[[vision[k]!.a.id, vision[k]!.b.id].sort().join(), vision[k]!] as const] : [])));
    const merged = [...pairs.values()];
    return { settled, shown, bases, collisions, vision, merged, problems: collisions.length + merged.length };
  }, [settled, v.flagL, v.flagE]);
}

const CVDS = VISIONS.filter((k): k is Cvd => k !== 'typical');
const samePair = (x: CvdClosest | null, y: CvdClosest) => !!x && ((x.a.id === y.a.id && x.b.id === y.b.id) || (x.a.id === y.b.id && x.b.id === y.a.id));

/**
 * The pane under Check's boards: what is wrong, one row per problem, each with its one-click fix
 * (one history step). Nothing wrong: a line per check saying so.
 */
export function Problems({ doc, v, checks }: { doc: Doc; v: IllustrationView; checks: Checks }) {
  const { shown, bases, collisions, vision, merged } = checks;
  const fixTo = (label: string, changes: Record<string, Oklch>) => doc.transact(label, (x) => Object.entries(changes).reduce((y, [id, o]) => recolour(y, id, o), x));
  const rows: { key: string; ids: string[]; text: React.ReactNode; fix?: { label: string; tip: string; run(): void } }[] = [];

  for (const c of collisions) {
    const others = bases.filter((w) => w.id !== c.a.id && w.id !== c.b.id).map((w) => w.oklch[0]);
    const [a, b] = valueFix([c.a.oklch, c.b.oklch], v.flagL / 100, others);
    rows.push({
      key: `v:${c.a.id}:${c.b.id}`,
      ids: [c.a.id, c.b.id],
      text: (
        <>
          <b>{displayName(c.a)}</b> and <b>{displayName(c.b)}</b> read as one grey, {(c.deltaL * 100).toFixed(1)} apart in lightness.
        </>
      ),
      fix: { label: 'Spread apart', tip: 'Space them just past the flag gap in lightness, hues kept', run: () => fixTo(`Spread ${displayName(c.a)} and ${displayName(c.b)} in lightness`, { [c.a.id]: a, [c.b.id]: b }) },
    });
  }
  for (const p of merged) {
    const kinds = CVDS.filter((k) => vision[k]?.flag && samePair(vision[k], p));
    const others = shown.filter((w) => w.id !== p.a.id && w.id !== p.b.id).map((w) => w.oklch[0]);
    let a = p.a.oklch;
    let b = p.b.oklch;
    for (const k of kinds) [a, b] = cvdFix(a, b, k, v.flagE, others) ?? [a, b];
    const parted = a !== p.a.oklch || b !== p.b.oklch;
    rows.push({
      key: `c:${p.a.id}:${p.b.id}`,
      ids: [p.a.id, p.b.id],
      text: (
        <>
          <b>{displayName(p.a)}</b> and <b>{displayName(p.b)}</b> merge in {kinds.length === 4 ? 'every kind of' : kinds.join(', ')} vision.
          {!parted && ' No lightness spread parts them: change one of their hues.'}
        </>
      ),
      fix: parted ? { label: 'Part them', tip: `Spread them in lightness until ΔE reaches ${v.flagE.toFixed(1)}`, run: () => fixTo(`Part ${displayName(p.a)} and ${displayName(p.b)}`, { [p.a.id]: a, [p.b.id]: b }) } : undefined,
    });
  }

  return (
    <section className={s.problems} aria-label="Problems">
      <header className={s.phead}>
        <h3 className={s.ptitle}>Problems</h3>
        <span className={s.pcount}>{checks.problems ? plural(checks.problems, 'problem') : 'All clear'}</span>
      </header>
      <div className={s.plist}>
        {rows.map((r) => (
          <div key={r.key} className={cx(s.prow, s.pbad)} {...pointAt(r.ids)}>
            <Icon name="error" size={16} className={s.picon} />
            <span className={s.ptext}>{r.text}</span>
            {r.fix && (
              <Button size="xs" onClick={r.fix.run} tooltip={r.fix.tip}>
                {r.fix.label}
              </Button>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <>
            <div className={s.prow}>
              <Icon name="check" size={16} className={s.pok} />
              <span className={s.ptext}>{bases.length < 2 ? 'Value: two or more bases compare here.' : 'Value: the bases stand apart.'}</span>
            </div>
            <div className={s.prow}>
              <Icon name="check" size={16} className={s.pok} />
              <span className={s.ptext}>{shown.length < 2 ? 'Colour vision: two or more colours compare here.' : 'Colour vision: every colour stays apart in all four simulations.'}</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
