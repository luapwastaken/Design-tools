// Tab 3, Check values: every ramp in colour and in greyscale with a verdict, the Value ruler (the
// bases pinned by value, one cluster flag with its fix), Colour vision (a strip per simulation
// with its closest pair and ΔE), then the problems as a list, each with its one-click fix.
import { useSyncExternalStore } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { greyOf, valueOf } from '../../../shared/color/value.ts';
import type { Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Tooltip } from '../../ui/index.ts';
import { fmtV, stepWord } from '../common/names.ts';
import { Value } from '../common/Value.tsx';
import { mergingCvd, Vision } from '../common/Vision.tsx';
import type { Doc } from './actions.ts';
import { fixRules, Problems, type Checks } from './CheckPane.tsx';
import { toastMoved } from '../common/fixes.ts';
import { nameOf, rampName, rampOf, recolour, stepsOf, type IllustrationDoc } from './doc.ts';
import { hot, patchView, pointAt, type IllustrationView } from './view-state.ts';
import s from './Check.module.css';

/** past this many colours the strips' names over them can't be read */
const NAMED = 12;
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function CheckTab({ doc, d, v, checks }: { doc: Doc; d: IllustrationDoc; v: IllustrationView; checks: Checks }) {
  const lit = useSyncExternalStore(hot.subscribe, hot.get);
  // the rows: each ramp's steps, then the colours in no ramp
  const rows = [
    ...d.ramps.map((r) => ({ id: r.id, name: rampName(d, r), steps: stepsOf(d, r.id), ramp: true })),
    ...(() => {
      const loose = d.swatches.filter((w) => !d.ramps.some((r) => r.id === w.group));
      return loose.length ? [{ id: 'loose', name: 'Loose', steps: loose, ramp: false }] : [];
    })(),
  ];
  // a ramp step by its place in the ramp ("Skin 4/5"): readable where a pair has one short line
  const short = (w: Swatch) => {
    const r = rampOf(checks.settled, w.group);
    if (!r || w.step === 0) return w.name;
    const list = stepsOf(checks.settled, r.id);
    return `${rampName(checks.settled, r)} ${list.findIndex((x) => x.id === w.id) + 1}/${list.length}`;
  };
  const host = {
    pointAt,
    rules: fixRules(checks.settled),
    onFix: (label: string, changes: Record<string, Oklch>) => {
      doc.transact(label, (x) => Object.entries(changes).reduce((y, [id, o]) => recolour(y, id, o), x));
      const base = checks.shown.some((w) => changes[w.id] && w.step === 0 && checks.settled.ramps.some((r) => r.id === w.group));
      toastMoved(doc, checks.shown, changes, 'V', base ? ' Its ramp followed.' : '');
    },
  };
  // a simulation chosen in the strips stays; otherwise the one that merges a pair shows
  const cvd = mergingCvd(checks.vision, v.cvd);
  const hit = new Set(checks.collisions.flatMap((c) => [c.a.id, c.b.id]));
  const gap = v.flagL / 100;

  /** the verdict on one row: the first pair of steps closer than the gap, or a base that reads as another */
  const verdict = (r: (typeof rows)[number]): string | null => {
    const nums = r.steps.map((w) => w.step ?? 0);
    const [lo, hi] = [Math.min(0, ...nums), Math.max(0, ...nums)];
    const word = (w: Swatch) => (r.ramp ? cap(stepWord(w.step ?? 0, lo, hi)) : nameOf(d, w));
    for (let i = 1; i < r.steps.length; i++) if (Math.abs(valueOf(r.steps[i].oklch) - valueOf(r.steps[i - 1].oklch)) < gap) return `${word(r.steps[i - 1])} and ${word(r.steps[i])} too close`;
    if (r.steps.some((w) => hit.has(w.id))) return 'Reads as another base';
    return null;
  };

  return (
    <div className={s.tab}>
      <section className={s.board} aria-label="Greyscale">
        <h3 className={s.title}>
          Value <span className={s.sub}>every ramp by value; steps should step evenly</span>
        </h3>
        <div className={s.vrows}>
          {rows.map((r) => {
            const bad = verdict(r);
            return (
              <div key={r.id} className={s.vrow}>
                <span className={s.name}>{r.name}</span>
                <div className={s.strip}>
                  {r.steps.map((w) => (
                    <Tooltip key={w.id} content={`${nameOf(d, w)} · V ${fmtV(w.oklch)}`}>
                      <i className={cx(hit.has(w.id) && s.collide, lit.includes(w.id) && s.hot)} data-colour style={{ background: cssColor(w.oklch) }} {...pointAt([w.id])} />
                    </Tooltip>
                  ))}
                </div>
                <div className={s.strip}>
                  {r.steps.map((w, i) => {
                    const close = i > 0 && Math.abs(valueOf(w.oklch) - valueOf(r.steps[i - 1].oklch)) < gap;
                    return (
                      <Tooltip key={w.id} content={`${nameOf(d, w)} · V ${fmtV(w.oklch)}${close ? ' · too close to the step before it' : ''}${hit.has(w.id) ? ' · reads as another base' : ''}`}>
                        <i className={cx(hit.has(w.id) && s.collide, close && s.near, lit.includes(w.id) && s.hot)} style={{ background: cssColor(greyOf(valueOf(w.oklch))) }} {...pointAt([w.id])} />
                      </Tooltip>
                    );
                  })}
                </div>
                <span className={cx(s.verdict, bad && s.bad)}>{bad ?? 'Even steps'}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* the ruler: the bases pinned by value, one flag and one fix for the run that reads as one grey */}
      <Value {...host} swatches={checks.bases} sub={d.ramps.length ? 'Ramp bases' : undefined} collisions={checks.collisions} flagL={v.flagL} onFlagL={(flagL) => patchView({ flagL })} className={s.module} />
      <Vision
        {...host}
        swatches={checks.shown}
        short={short}
        vision={checks.vision}
        names={checks.shown.length <= NAMED}
        flagE={v.flagE}
        onFlagE={(flagE) => patchView({ flagE })}
        cvd={cvd}
        onCvd={(k) => patchView({ cvd: k })}
        className={s.module}
      />

      <Problems doc={doc} v={v} checks={checks} />
    </div>
  );
}
