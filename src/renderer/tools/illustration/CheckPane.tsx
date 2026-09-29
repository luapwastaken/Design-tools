// Check (UX pass): Design's Value and Colour vision checks as a list, problems first, the open one's
// detail beside it. Value compares the ramps' bases: steps of different ramps share values by
// design, and the order inside a ramp is the row's own value strip and its "Value breaks" mark.
import { useMemo } from 'react';
import type { Oklch } from '../../../shared/color/index.ts';
import { cvdClosest, valueCollisions, type CvdClosest, type ValueCollision } from '../../../shared/palette/checks.ts';
import type { Swatch } from '../../../shared/types.ts';
import { ListDetail, type ListItem } from '../common/ListDetail.tsx';
import { displayName, plural } from '../common/names.ts';
import { useSettled } from '../common/settled.ts';
import { Value } from '../common/Value.tsx';
import { mergingCvd, Vision, VISIONS, type Kind } from '../common/Vision.tsx';
import type { Doc } from './actions.ts';
import { named, rampName, rampOf, recolour, stepsOf, type IllustrationDoc } from './doc.ts';
import { patchView, pointAt, type IllustrationView } from './view-state.ts';

/** past this many swatches their names over the colour-vision strips can't be read */
const NAMED = 12;

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

export function CheckPane({ doc, v, checks }: { doc: Doc; v: IllustrationView; checks: Checks }) {
  const { settled, shown, bases, collisions, vision, merged } = checks;
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
  // as in Design: a simulation chosen in Colour vision stays; otherwise it shows one that merges, and
  // the list's line names the pair that simulation shows
  const cvd = v.check === 'vision' ? v.cvd : mergingCvd(vision, v.cvd);
  const says = vision[cvd]?.flag ? cvd : VISIONS.find((k) => k !== 'typical' && vision[k]?.flag);
  const items: ListItem[] = [
    {
      id: 'value',
      label: 'Value',
      icon: 'contrast',
      // nothing to compare yet: neither a pass nor a problem
      ok: bases.length < 2 ? undefined : !collisions.length,
      verdict:
        bases.length < 2
          ? 'Two or more bases compare here'
          : collisions.length
            ? `${displayName(collisions[0].a)} and ${displayName(collisions[0].b)} read as one grey${collisions.length > 1 ? `, and ${plural(collisions.length - 1, 'more pair')}` : ''}`
            : 'The bases stand apart in value',
      detail: (
        <Value {...host} swatches={bases} sub={settled.ramps.length ? 'Ramp bases' : undefined} collisions={collisions} flagL={v.flagL} onFlagL={(flagL) => patchView({ flagL })} />
      ),
    },
    {
      id: 'vision',
      label: 'Colour vision',
      icon: 'visibility',
      ok: shown.length < 2 ? undefined : !merged.length,
      verdict:
        shown.length < 2
          ? 'Two or more colours compare here'
          : says
            ? `${displayName(vision[says]!.a)} and ${displayName(vision[says]!.b)} merge in ${says} vision${merged.length > 1 ? `, and ${plural(merged.length - 1, 'more pair')}` : ''}`
            : 'Every colour stays apart in all four simulations',
      detail: (
        <Vision {...host} short={short} vision={vision} names={shown.length <= NAMED} flagE={v.flagE} onFlagE={(flagE) => patchView({ flagE })} cvd={cvd} onCvd={(k) => patchView({ check: 'vision', cvd: k })} />
      ),
    },
  ];
  const open = (check: string) => patchView(check === 'vision' ? { check, cvd } : { check });
  return <ListDetail items={items} value={v.check} onChange={open} />;
}
