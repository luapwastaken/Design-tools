// Check mode (spec §4): the real ramps, seen the way a check sees them. Left, the ramps in greyscale
// with their lightness and the steps that sit too close; right, four simulated copies (the
// colour-vision kinds and greyscale) with colliding pairs outlined. Under the boards, the problems
// as a list, each with its one-click fix.
import { useSyncExternalStore, type CSSProperties } from 'react';
import { cssColor, simulateCvd, type Cvd } from '../../../shared/color/index.ts';
import type { Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Icon, NumberField, Tooltip } from '../../ui/index.ts';
import { OptionsBar, OptionsField } from '../common/OptionsBar.tsx';
import { surroundOf } from '../common/surround.ts';
import { fmtL, plural } from '../common/names.ts';
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

export function CheckMode({ doc, d, v, checks }: { doc: Doc; d: IllustrationDoc; v: IllustrationView; checks: Checks }) {
  const lit = useSyncExternalStore(hot.subscribe, hot.get);
  const surround = surroundOf(v.surround, d.swatches);
  // the board's rows: each ramp's steps, then the colours in no ramp
  const rows = [
    ...d.ramps.map((r) => ({ id: r.id, name: rampName(d, r), steps: stepsOf(d, r.id) })),
    ...(() => {
      const loose = d.swatches.filter((w) => !d.ramps.some((r) => r.id === w.group));
      return loose.length ? [{ id: 'loose', name: 'Loose', steps: loose }] : [];
    })(),
  ];
  const hit = new Set(checks.collisions.flatMap((c) => [c.a.id, c.b.id]));
  const gap = v.flagL / 100;
  return (
    <div className={s.mode}>
      <OptionsBar>
        <OptionsField label="Flag steps closer than">
          <NumberField label="Value gap" hideLabel value={v.flagL} min={1} max={20} step={0.5} precision={1} unit="ΔL" width={96} onChange={(flagL) => patchView({ flagL })} />
        </OptionsField>
        <OptionsField label="Colours merge below">
          <NumberField label="Vision gap" hideLabel value={v.flagE} min={1} max={40} step={0.5} precision={1} unit="ΔE" width={96} onChange={(flagE) => patchView({ flagE })} />
        </OptionsField>
        <span className={s.grow} />
        <span className={s.count}>{checks.problems ? plural(checks.problems, 'problem') : 'No problems'}</span>
      </OptionsBar>
      <div className={s.boards} style={{ '--surround': surround } as CSSProperties}>
        <section className={s.board} aria-label="Greyscale">
          <h3 className={s.title}>Value</h3>
          <p className={s.sub}>Greyscale by lightness. Bases that read as one grey, and steps closer than the gap, are marked.</p>
          <div className={s.rowsWrap}>
            {rows.map((r) => (
              <div key={r.id} className={s.row}>
                <span className={s.name}>{r.name}</span>
                <div className={s.strip}>
                  {r.steps.map((w, i) => {
                    const close = i > 0 && Math.abs(w.oklch[0] - r.steps[i - 1].oklch[0]) < gap;
                    return (
                      <Tooltip key={w.id} content={`${nameOf(d, w)} · L ${fmtL(w.oklch[0])}${close ? ' · too close to the step before it' : ''}${hit.has(w.id) ? ' · reads as another base' : ''}`}>
                        <span className={cx(s.cell, hit.has(w.id) && s.collide, lit.includes(w.id) && s.hot)} {...pointAt([w.id])}>
                          <i style={{ background: cssColor([w.oklch[0], 0, 0]) }} />
                          <span className={s.l}>{Math.round(w.oklch[0] * 100)}</span>
                          {close && <b className={s.close} />}
                        </span>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className={s.board} aria-label="Colour vision">
          <h3 className={s.title}>Colour vision</h3>
          <p className={s.sub}>The ramps as each kind of colour vision sees them; outlined pairs merge.</p>
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
      </div>
      <div className={s.dock}>
        <Problems doc={doc} v={v} checks={checks} />
      </div>
    </div>
  );
}
