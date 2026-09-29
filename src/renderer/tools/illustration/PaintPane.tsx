// Paint (spec §3.3, UX pass): the scratch canvas with its tool bar and tray, and beside it how to mix
// the selected colour from the paints you own (the paint box is behind Mix it's paints button).
import { useMemo, useSyncExternalStore } from 'react';
import { useSettled } from '../common/settled.ts';
import { selected, type Doc } from './actions.ts';
import { looseOf, named, rampName, stepsOf, type IllustrationDoc } from './doc.ts';
import { PaintCanvas } from './PaintCanvas.tsx';
import { ownedPaints } from './Paints.tsx';
import { paintSettings, type PaletteSet } from './paint-sources.ts';
import { pickFromCanvas } from './proposals.ts';
import { recipeTarget, Recipes } from './Recipes.tsx';
import { getView, patchView, type IllustrationView } from './view-state.ts';
import s from './Paint.module.css';

export function PaintPane({ doc, d, v, hidden }: { doc: Doc; d: IllustrationDoc; v: IllustrationView; hidden: boolean }) {
  // recipes wait for a drag to end: solving them is too slow for every frame
  const settled = useSettled(doc, 0);
  const owned = ownedPaints(v);
  const itemId = useSyncExternalStore(doc.subscribe, () => doc.source()?.itemId ?? null);
  // the tray's palette colours: a set per ramp, each step by its name ("Skin shadow")
  const sets = useMemo((): PaletteSet[] => {
    const shown = new Map(named(d).map((w) => [w.id, w]));
    const loose = looseOf(d);
    return [
      ...d.ramps.map((r) => ({ key: r.id, name: rampName(d, r), swatches: stepsOf(d, r.id).map((w) => shown.get(w.id)!) })),
      ...(loose.length ? [{ key: 'loose', name: 'Loose', swatches: loose.map((w) => shown.get(w.id)!) }] : []),
    ];
  }, [d]);
  return (
    <div className={s.pane}>
      <PaintCanvas
        itemId={itemId}
        pigments={owned}
        sets={sets}
        settings={paintSettings(v.canvas)}
        onSettings={(patch) => patchView({ canvas: { ...getView().canvas, ...patch } })}
        paintings={v.paintings}
        onPaintings={(paintings) => patchView({ paintings })}
        onPick={pickFromCanvas}
      />
      <Recipes d={settled} v={v} sel={recipeTarget(settled, selected(settled, v.selected))} owned={owned} hidden={hidden} className={s.recipes} />
    </div>
  );
}
