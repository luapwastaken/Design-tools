// Paint tab (spec §3.3): the scratch canvas (toolbox, options row, paper) on the left, and the
// Mixer in a column on the right: the well and tubes (drawn by the canvas, which owns the brush) and
// Mix it, how to mix the selected colour from the paints you own (the paint box is behind Mix it's paints button).
// A ramp colour clicked while Paint shows loads the brush; Try it on a recipe fills the well with it.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { Recipe } from '../../../shared/paint/recipe.ts';
import { toast } from '../../ui/index.ts';
import { useSettled } from '../common/settled.ts';
import { selected, type Doc } from './actions.ts';
import { looseSets, named, rampName, stepsOf, type IllustrationDoc } from './doc.ts';
import { PaintCanvas } from './PaintCanvas.tsx';
import { ownedPaints } from './Paints.tsx';
import { paintSettings, wellFromRecipe, type PaintSettings, type PaletteSet, type WellPart } from './paint-sources.ts';
import { pickFromCanvas } from './proposals.ts';
import { recipeTarget, Recipes } from './Recipes.tsx';
import { clicked, getView, patchView, type IllustrationView } from './view-state.ts';
import s from './PaintPane.module.css';

/** written whole: a saved view from before the brushes existed is read once, as its sizes were meant */
const setPaint = (patch: Partial<PaintSettings>) => patchView({ canvas: { ...paintSettings(getView().canvas), ...patch } });
const sameWell = (a: WellPart[], b: WellPart[]) => a.length === b.length && a.every((w, i) => w.id === b[i].id && w.parts === b[i].parts);

/** a recipe onto the brush: its parts in the well, the well loaded, the Paint tool on */
function tryRecipe(r: Recipe): void {
  const was = paintSettings(getView().canvas);
  const well = wellFromRecipe(r);
  setPaint({ well, paint: 'well', tool: 'paint' });
  if (!was.well.length || sameWell(was.well, well)) return;
  toast.show({
    icon: 'brush',
    message: 'The well holds this recipe now. Undo puts your mix back.',
    undo: () => setPaint({ well: was.well, paint: was.paint }),
    when: () => sameWell(paintSettings(getView().canvas).well, well),
  });
}

export function PaintPane({ doc, d, v, hidden }: { doc: Doc; d: IllustrationDoc; v: IllustrationView; hidden: boolean }) {
  // the well and the tubes are drawn by the paint canvas into this column
  const [mixer, setMixer] = useState<HTMLElement | null>(null);
  // recipes wait for a drag to end: solving them is too slow for every frame
  const settled = useSettled(doc, 0);
  const owned = useMemo(() => ownedPaints(v), [v.owned, v.custom]);
  const itemId = useSyncExternalStore(doc.subscribe, () => doc.source()?.itemId ?? null);
  const settings = useMemo(() => paintSettings(v.canvas), [v.canvas]);
  // the tray's palette colours: a set per ramp, each step by its name ("Skin shadow")
  const sets = useMemo((): PaletteSet[] => {
    const shown = new Map(named(d).map((w) => [w.id, w]));
    return [
      ...d.ramps.map((r) => ({ key: r.id, name: rampName(d, r), swatches: stepsOf(d, r.id).map((w) => shown.get(w.id)!) })),
      ...looseSets(d).map((g) => ({ key: g.label ?? 'loose', name: g.label ?? 'Loose', swatches: g.list.map((w) => shown.get(w.id)!) })),
    ];
  }, [d]);

  // a ramp colour clicked (or chosen with Enter or Space) goes on the brush; other selection changes leave it
  useEffect(() => {
    if (hidden) return;
    return clicked.subscribe(() => {
      const c = clicked.get();
      if (!c) return;
      const cur = paintSettings(getView().canvas);
      setPaint({ paint: `swatch:${c.id}`, ...(cur.tool === 'pick' ? { tool: 'paint' as const } : {}) });
    });
  }, [hidden]);

  const sel = recipeTarget(settled, selected(settled, v.selected));
  return (
    <div className={s.pane}>
      <PaintCanvas
        itemId={itemId}
        hidden={hidden}
        pigments={owned}
        sets={sets}
        settings={settings}
        onSettings={setPaint}
        paintings={v.paintings}
        onPaintings={(paintings) => patchView({ paintings })}
        onPick={pickFromCanvas}
        mixer={mixer}
        target={sel?.oklch ?? null}
      />
      <div ref={setMixer} className={s.mixer} />
      {mixer && createPortal(<Recipes d={settled} v={v} sel={sel} owned={owned} hidden={hidden} onTry={tryRecipe} />, mixer)}
    </div>
  );
}
