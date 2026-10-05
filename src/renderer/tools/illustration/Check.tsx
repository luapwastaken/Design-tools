// Tab 3, Check values: every ramp in colour and in greyscale side by side with a verdict (Value),
// then the ramps as each kind of colour vision sees them (outlined pairs merge), then the problems
// as a list, each with its one-click fix. The two flag gaps are typed here.
import { useSyncExternalStore } from 'react';
import { cssColor, simulateCvd, type Cvd } from '../../../shared/color/index.ts';
import type { Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Icon, NumberField, Tooltip } from '../../ui/index.ts';
import { fmtL, plural, stepWord } from '../common/names.ts';
import type { Doc } from './actions.ts';
import { Problems, type Checks } from './CheckPane.tsx';
import { nameOf, rampName, stepsOf, type IllustrationDoc } from './doc.ts';
import { hot, patchView, pointAt, type IllustrationView } from './view-state.ts';
import s from './Check.module.css';

const KINDS: { kind: Cvd; label: string }[] = [
  { kind: 'deutan', label: 'Deuteranopia' },
  { kind: 'protan', label: 'Protanopia' },
  { kind: 'tritan', label: 'Tritanopia' },
  { kind: 'achromat', label: 'Achromatopsia' },
];
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
  const hit = new Set(checks.collisions.flatMap((c) => [c.a.id, c.b.id]));
  const gap = v.flagL / 100;

  /** the verdict on one row: the first pair of steps closer than the gap, or a base that reads as another */
  const verdict = (r: (typeof rows)[number]): string | null => {
    const nums = r.steps.map((w) => w.step ?? 0);
    const [lo, hi] = [Math.min(0, ...nums), Math.max(0, ...nums)];
    const word = (w: Swatch) => (r.ramp ? cap(stepWord(w.step ?? 0, lo, hi)) : nameOf(d, w));
    for (let i = 1; i < r.steps.length; i++) if (Math.abs(r.steps[i].oklch[0] - r.steps[i - 1].oklch[0]) < gap) return `${word(r.steps[i - 1])} and ${word(r.steps[i])} too close`;
    if (r.steps.some((w) => hit.has(w.id))) return 'Reads as another base';
    return null;
  };

  return (
    <div className={s.tab}>
      <div className={s.flags}>
        <label className={s.flag}>
          <span>Flag steps closer than</span>
          <NumberField label="Value gap" hideLabel value={v.flagL} min={1} max={20} step={0.5} precision={1} unit="ΔL" width={96} onChange={(flagL) => patchView({ flagL })} />
        </label>
        <label className={s.flag}>
          <span>Colours merge below</span>
          <NumberField label="Vision gap" hideLabel value={v.flagE} min={1} max={40} step={0.5} precision={1} unit="ΔE" width={96} onChange={(flagE) => patchView({ flagE })} />
        </label>
        <span className={s.count}>{checks.problems ? plural(checks.problems, 'problem') : 'No problems'}</span>
      </div>

      <section className={s.board} aria-label="Greyscale">
        <h3 className={s.title}>
          Value <span className={s.sub}>every ramp in greyscale; steps should step evenly</span>
        </h3>
        <div className={s.vrows}>
          {rows.map((r) => {
            const bad = verdict(r);
            return (
              <div key={r.id} className={s.vrow}>
                <span className={s.name}>{r.name}</span>
                <div className={s.strip}>
                  {r.steps.map((w) => (
                    <Tooltip key={w.id} content={`${nameOf(d, w)} · L ${fmtL(w.oklch[0])}`}>
                      <i className={cx(hit.has(w.id) && s.collide, lit.includes(w.id) && s.hot)} style={{ background: cssColor(w.oklch) }} {...pointAt([w.id])} />
                    </Tooltip>
                  ))}
                </div>
                <div className={s.strip}>
                  {r.steps.map((w, i) => {
                    const close = i > 0 && Math.abs(w.oklch[0] - r.steps[i - 1].oklch[0]) < gap;
                    return (
                      <Tooltip key={w.id} content={`${nameOf(d, w)} · L ${fmtL(w.oklch[0])}${close ? ' · too close to the step before it' : ''}${hit.has(w.id) ? ' · reads as another base' : ''}`}>
                        <i className={cx(hit.has(w.id) && s.collide, close && s.near, lit.includes(w.id) && s.hot)} style={{ background: cssColor([w.oklch[0], 0, 0]) }} {...pointAt([w.id])} />
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

      <section className={s.board} aria-label="Colour vision">
        <h3 className={s.title}>
          Colour vision <span className={s.sub}>the ramps as each kind of colour vision sees them; outlined pairs merge</span>
        </h3>
        <div className={s.sims}>
          {KINDS.map(({ kind, label }) => {
            const pair = checks.vision[kind];
            const merged = pair?.flag ? new Set([pair.a.id, pair.b.id]) : new Set<string>();
            return (
              <div key={kind} className={s.sim}>
                <span className={s.simLabel}>
                  {label}
                  {merged.size > 0 && <Icon name="error" size={14} className={s.warn} />}
                </span>
                {rows.map((r) => (
                  <div key={r.id} className={s.simRow}>
                    {r.steps.map((w: Swatch) => (
                      <i key={w.id} className={cx(merged.has(w.id) && s.merge, lit.includes(w.id) && s.hot)} style={{ background: cssColor(simulateCvd(w.oklch, kind)) }} {...pointAt([w.id])} />
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </section>

      <Problems doc={doc} v={v} checks={checks} />
    </div>
  );
}
