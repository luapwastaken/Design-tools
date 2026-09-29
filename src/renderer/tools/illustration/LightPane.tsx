// Under the ramps, Light (spec §2): the ramps on lit shapes, and how the palette reads in value and
// to colour-blind eyes (Design's Value and Colour vision checks). Value compares the ramps' bases:
// steps of different ramps share values by design, and the order inside a ramp is the row's own
// value strip and its "Value breaks" mark.
import { useMemo } from 'react';
import type { Oklch } from '../../../shared/color/index.ts';
import { cvdClosest, valueCollisions } from '../../../shared/palette/checks.ts';
import { useSettled } from '../common/settled.ts';
import { Value } from '../common/Value.tsx';
import { Vision, VISIONS, type Kind } from '../common/Vision.tsx';
import { rampsFromLoose, select, selected, type Doc } from './actions.ts';
import type { Swatch } from '../../../shared/types.ts';
import { baseOf, looseOf, named, rampName, rampOf, recolour, stepsOf, type IllustrationDoc } from './doc.ts';
import { LIT_VIEW, LitPreview, type LitRamp, type LitView } from './LitPreview.tsx';
import { patchView, pointAt, shaped, type IllustrationView } from './view-state.ts';
import s from './View.module.css';

/** past this many swatches their names over the colour-vision strips can't be read */
const NAMED = 12;

export function LightPane({ doc, d, v, hidden }: { doc: Doc; d: IllustrationDoc; v: IllustrationView; hidden: boolean }) {
  const settled = useSettled(doc);
  // blank names filled in, as the checks' sentences name them
  const shown = useMemo(() => named(settled), [settled]);
  // the bases, and colours in no ramp: what a painting's big shapes are
  const bases = useMemo(() => shown.filter((w) => w.step === 0 || !settled.ramps.some((r) => r.id === w.group)), [shown, settled.ramps]);
  const collisions = useMemo(() => (hidden ? [] : valueCollisions(bases, v.flagL / 100)), [bases, v.flagL, hidden]);
  const vision = useMemo(
    () => Object.fromEntries(VISIONS.map((k) => [k, hidden ? null : cvdClosest(shown, k, { flagBelow: v.flagE })])) as Record<Kind, ReturnType<typeof cvdClosest>>,
    [shown, v.flagE, hidden],
  );
  // the preview follows every frame of a drag: it is how a ramp is judged
  const ramps: LitRamp[] = d.ramps.map((r) => ({ id: r.id, name: rampName(d, r), steps: stepsOf(d, r.id).map((w) => w.oklch), hero: r.hero }));
  const lit = shaped(v.preview, LIT_VIEW);
  // a ramp step by its place in the ramp ("Skin 4/5"): readable where a pair has one short line
  const short = (w: Swatch) => {
    const r = rampOf(settled, w.group);
    if (!r || w.step === 0) return w.name;
    const steps = stepsOf(settled, r.id);
    return `${rampName(settled, r)} ${steps.findIndex((x) => x.id === w.id) + 1}/${steps.length}`;
  };
  const host = {
    swatches: shown,
    pointAt,
    onFix: (label: string, changes: Record<string, Oklch>) => doc.transact(label, (x) => Object.entries(changes).reduce((y, [id, o]) => recolour(y, id, o), x)),
  };
  return (
    <div className={s.lightPane}>
      <LitPreview
        ramps={ramps}
        selected={selected(d, v.selected)?.group ?? null}
        view={lit}
        onView={(patch: Partial<LitView>) => patchView({ preview: { ...lit, ...patch } })}
        onSelect={(id) => select(baseOf(d, id)?.id ?? null)}
        hidden={hidden}
        empty={
          looseOf(d).length
            ? {
                title: 'These colours are in no ramp yet',
                detail: 'Make ramps from them, and they show here on a sphere, a cube and a cloth fold under one light.',
                action: { label: 'Make ramps', icon: 'auto_awesome_motion', onClick: () => rampsFromLoose(doc) },
              }
            : undefined
        }
      />
      <div className={s.checks}>
        <Value {...host} swatches={bases} sub={settled.ramps.length ? 'Ramp bases' : undefined} collisions={collisions} flagL={v.flagL} onFlagL={(flagL) => patchView({ flagL })} />
        <Vision {...host} short={short} vision={vision} names={shown.length <= NAMED} flagE={v.flagE} onFlagE={(flagE) => patchView({ flagE })} cvd={v.cvd} onCvd={(cvd) => patchView({ cvd })} />
      </div>
    </div>
  );
}
