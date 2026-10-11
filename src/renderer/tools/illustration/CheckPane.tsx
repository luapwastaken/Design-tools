// Check (UX pass): the data behind Check mode. The boards show it; the pane under them lists what
// to fix (Problems). Value compares the ramps' bases: steps of different ramps share values by
// design, and the order inside a ramp is the row's own value strip and its "Value breaks" mark.
// A run of bases that read as one grey is ONE problem with one fix, however many pairs it holds.
import { useMemo } from 'react';
import type { Cvd, Oklch } from '../../../shared/color/index.ts';
import { valueOf } from '../../../shared/color/value.ts';
import { cvdClosest, valueCollisions, type CvdClosest, type ValueCollision } from '../../../shared/palette/checks.ts';
import type { Swatch } from '../../../shared/types.ts';
import { Button, Icon } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { partPair, spreadCluster, type FixRules } from '../common/adjust.ts';
import { toastMoved } from '../common/fixes.ts';
import { displayName, listNames, plural } from '../common/names.ts';
import { useSettled } from '../common/settled.ts';
import { clustersOf } from '../common/Value.tsx';
import { VISIONS, type Kind } from '../common/Vision.tsx';
import type { Doc } from './actions.ts';
import { isLayer, named, recolour, type IllustrationDoc } from './doc.ts';
import { pointAt, type IllustrationView } from './view-state.ts';
import s from './Check.module.css';

export type Checks = {
  settled: IllustrationDoc;
  /** blank names filled in, as the checks' sentences name them; the layer colours are not checked */
  shown: Swatch[];
  /** the bases, and colours in no ramp: what a painting's big shapes are */
  bases: Swatch[];
  collisions: ValueCollision[];
  /** the collisions grouped: each run of bases that read as one grey */
  clusters: Swatch[][];
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
    // layer colours are blend colours laid over the flats, not flats: they would only raise collisions the recipe depends on
    const shown = named(settled).filter((w) => !isLayer(w));
    const bases = shown.filter((w) => w.step === 0 || !settled.ramps.some((r) => r.id === w.group));
    const collisions = valueCollisions(bases, v.flagL / 100);
    const clusters = clustersOf(collisions);
    const vision = Object.fromEntries(VISIONS.map((k) => [k, cvdClosest(shown, k, { flagBelow: v.flagE })])) as Record<Kind, CvdClosest | null>;
    const pairs = new Map(VISIONS.flatMap((k) => (k !== 'typical' && vision[k]?.flag ? [[[vision[k]!.a.id, vision[k]!.b.id].sort().join(), vision[k]!] as const] : [])));
    const merged = [...pairs.values()];
    return { settled, shown, bases, collisions, clusters, vision, merged, problems: clusters.length + merged.length };
  }, [settled, v.flagL, v.flagE]);
}

/** a hand-editable step moves before a ramp base, which takes its whole ramp with it */
export const fixRules = (d: IllustrationDoc): FixRules => ({ rank: (w) => (w.step !== undefined && w.step !== 0 && d.ramps.some((r) => r.id === w.group) ? 0 : 1) });

const CVDS = VISIONS.filter((k): k is Cvd => k !== 'typical');
const samePair = (x: CvdClosest | null, y: CvdClosest) => !!x && ((x.a.id === y.a.id && x.b.id === y.b.id) || (x.a.id === y.b.id && x.b.id === y.a.id));

/**
 * The pane under Check's boards: what is wrong, one row per problem, each with its one-click fix
 * (one history step). Nothing wrong: a line per check saying so.
 */
export function Problems({ doc, v, checks }: { doc: Doc; v: IllustrationView; checks: Checks }) {
  const { shown, bases, clusters, vision, merged } = checks;
  const rules = fixRules(checks.settled);
  const fixTo = (label: string, changes: Record<string, Oklch>) => {
    doc.transact(label, (x) => Object.entries(changes).reduce((y, [id, o]) => recolour(y, id, o), x));
    // a base takes its ramp with it: the toast says so
    const base = shown.some((w) => changes[w.id] && w.step === 0 && checks.settled.ramps.some((r) => r.id === w.group));
    toastMoved(doc, shown, changes, 'V', base ? ' Its ramp followed.' : '');
  };
  const rows: { key: string; ids: string[]; text: React.ReactNode; fix?: { label: string; tip: string; run(): void }; blocked?: boolean }[] = [];

  for (const run of clusters) {
    const ids = run.map((w) => w.id);
    const others = bases.filter((w) => !ids.includes(w.id)).map((w) => valueOf(w.oklch));
    const { changes } = spreadCluster(run, v.flagL / 100, others, rules);
    const span = (valueOf(run.at(-1)!.oklch) - valueOf(run[0].oklch)) * 100;
    const names = run.map(displayName);
    rows.push({
      key: `v:${ids.join(':')}`,
      ids,
      text: (
        <>
          <b>{listNames(names)}</b> read as one grey, {span.toFixed(1)} apart in value.
        </>
      ),
      fix: changes
        ? { label: run.length === 2 ? 'Spread apart' : `Spread these ${run.length}`, tip: 'Space them just past the flag gap in value, hues kept. A hand-edited step moves before a ramp base.', run: () => fixTo(run.length === 2 ? `Spread ${names[0]} and ${names[1]} in value` : `Spread ${run.length} swatches in value`, changes) }
        : undefined,
    });
  }
  for (const p of merged) {
    const kinds = CVDS.filter((k) => vision[k]?.flag && samePair(vision[k], p));
    const { changes: parted } = partPair(p.a, p.b, kinds, v.flagE, shown, rules);
    rows.push({
      key: `c:${p.a.id}:${p.b.id}`,
      ids: [p.a.id, p.b.id],
      text: (
        <>
          <b>{displayName(p.a)}</b> and <b>{displayName(p.b)}</b> merge in {kinds.length === 4 ? 'every kind of' : kinds.join(', ')} vision.
          {!parted && ' No value spread parts them: change one of their hues.'}
        </>
      ),
      fix: parted ? { label: 'Part them', tip: `Spread them in value until ΔE reaches ${v.flagE.toFixed(1)}. A hand-edited step moves before a ramp base.`, run: () => fixTo(`Part ${displayName(p.a)} and ${displayName(p.b)}`, parted) } : undefined,
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
