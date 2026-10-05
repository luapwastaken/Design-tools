// Mix it, "how do I mix this?" (spec §3.3): recipes from the paints you own, for the selected
// colour or for every ramp's base, each with its parts, the mix beside the target, and ΔE. Try it
// puts a recipe in the well and on the brush, so it can be checked on paper.
import { useDeferredValue, useMemo } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import type { Pigment } from '../../../shared/paint/pigments.ts';
import { recipes, type Recipe } from '../../../shared/paint/recipe.ts';
import { Button, InspectorGroup, Segmented, Tooltip } from '../../ui/index.ts';
import { baseOf, nameOf, rampName, type IllustrationDoc } from './doc.ts';
import { PaintsButton } from './Paints.tsx';
import { patchView, type IllustrationView } from './view-state.ts';
import s from './Paint.module.css';

const FOR: { value: IllustrationView['recipesFor']; label: string; tip: string }[] = [
  { value: 'selected', label: 'Selected', tip: 'Three recipes for the selected colour' },
  { value: 'bases', label: 'Every base', tip: 'The best recipe for every ramp’s base' },
];
const MAX: { value: '1' | '2' | '3'; label: string; tip: string }[] = [
  { value: '1', label: '1', tip: 'One paint, straight from the tube' },
  { value: '2', label: '2', tip: 'Up to two paints' },
  { value: '3', label: '3', tip: 'Up to three paints' },
];

/** from this ΔE on a mix is another colour: offered as the nearest, never as a recipe */
const FAR = 10;
/** ΔE in words, as a painter reads it */
const verdict = (e: number) => (e < 2 ? 'Match' : e < 5 ? 'Close' : 'Near');
const partsText = (r: Recipe) => r.parts.map((p) => `${p.parts} ${p.pigment.name}`).join(' + ');

type Props = {
  d: IllustrationDoc;
  v: IllustrationView;
  sel: { id: string; name: string; oklch: Oklch } | null;
  owned: Pigment[];
  hidden: boolean;
  /** Try it: the recipe into the well, and the well onto the brush */
  onTry(r: Recipe): void;
  className?: string;
};

/** `d`: the settled document, so a picker drag doesn't solve recipes on every frame */
export function Recipes({ d, v, sel, owned, hidden, onTry, className }: Props) {
  const targets = v.recipesFor === 'bases' ? d.ramps.flatMap((r) => (baseOf(d, r.id) ? [{ id: r.id, name: rampName(d, r), oklch: baseOf(d, r.id)!.oklch }] : [])) : sel ? [sel] : [];
  const key = `${v.recipesFor}|${v.maxPaints}|${owned.map((p) => p.id).join()}|${targets.map((t) => `${t.name}:${t.oklch.join()}`).join('|')}`;
  // the solver runs only while the Paint side shows (~25ms a colour), and a frame after it shows, so
  // that task is not the one that shows the pane
  const deferred = useDeferredValue(hidden ? '' : key, '');
  const found = useMemo(
    () => (deferred && owned.length ? targets.map((t) => ({ t, list: recipes(t.oklch, owned, { maxPigments: v.maxPaints, count: v.recipesFor === 'bases' ? 1 : 3 }) })) : []),
    [deferred],
  );
  return (
    <InspectorGroup
      id="illustration.mix"
      title="Mix it"
      sub={v.recipesFor === 'bases' ? 'a recipe for every base' : sel ? `a recipe for ${sel.name}` : undefined}
      actions={<PaintsButton v={v} />}
      className={className}
    >
      <div className={s.opts}>
        <Segmented label="Paints per mix" info="Parts by volume, tinting strength included. Tubes vary, so adjust by eye. Gouache gives the mix at full strength; one watercolour pass is a first wash." options={MAX} value={String(v.maxPaints) as '1' | '2' | '3'} onChange={(m) => patchView({ maxPaints: Number(m) as 1 | 2 | 3 })} />
        <Segmented label="For" options={FOR} value={v.recipesFor} onChange={(recipesFor) => patchView({ recipesFor })} />
      </div>
      {!owned.length ? (
        <p className={s.none}>Recipes use only the paints you own: tick them under the paints button above.</p>
      ) : !targets.length ? (
        <p className={s.none}>{v.recipesFor === 'bases' ? 'Add a base colour to find how to mix it.' : 'Select a colour to find how to mix it.'}</p>
      ) : !deferred ? null : (
        <div className={s.rlist}>
          {found.flatMap(({ t, list }) => {
            const name = v.recipesFor === 'bases' ? t.name : null;
            const close = list.filter((r) => r.deltaE < FAR);
            // three wrong answers would read as three answers: say it plainly, with the nearest
            if (!close.length && list[0]) return [<FarRow key={t.id} target={t.oklch} name={name} r={list[0]} more={v.maxPaints < 3} onTry={onTry} />];
            return close.map((r, i) => <RecipeRow key={`${t.id}:${i}`} target={t.oklch} name={name} r={r} onTry={onTry} />);
          })}
          {found.every((f) => !f.list.length) && <p className={s.none}>No mix of your paints comes near. Tick more paints, or allow more per mix.</p>}
        </div>
      )}
    </InspectorGroup>
  );
}

type RowProps = { target: Oklch; name: string | null; r: Recipe; onTry(r: Recipe): void };

const TryIt = ({ r, onTry }: Pick<RowProps, 'r' | 'onTry'>) => (
  <Button size="xs" icon="brush" onClick={() => onTry(r)} tooltip={`Put ${partsText(r)} in the well and load the brush`}>
    Try it
  </Button>
);

/** best first: the target and the mix side by side, then each paint by its parts, one a line */
function RecipeRow({ target, name, r, onTry }: RowProps) {
  return (
    <div className={s.recipe}>
      <Tooltip content="Target, then the mix">
        <span className={s.pairChips} aria-label="Target and mix">
          <i style={{ background: cssColor(target) }} />
          <i style={{ background: cssColor(r.result) }} />
        </span>
      </Tooltip>
      <div className={s.parts}>
        {name !== null && <span className={s.rname}>{name}</span>}
        {r.parts.map((p) => (
          <span key={p.pigment.id} className={s.part}>
            <b>{p.parts}</b>
            <i className={s.pchip} style={{ background: cssColor(p.pigment.oklch) }} />
            {p.pigment.name}
          </span>
        ))}
      </div>
      <span className={s.de}>
        <span className={s.deNum}>ΔE {r.deltaE.toFixed(1)}</span>
        <span className="lbl">{verdict(r.deltaE)}</span>
        <TryIt r={r} onTry={onTry} />
      </span>
    </div>
  );
}

/** no mix of the owned paints comes close: the nearest, as a sentence rather than a recipe */
function FarRow({ target, name, r, more, onTry }: RowProps & { more: boolean }) {
  return (
    <div className={s.recipe}>
      <Tooltip content="Target, then the nearest mix">
        <span className={s.pairChips} aria-label="Target and nearest mix">
          <i style={{ background: cssColor(target) }} />
          <i style={{ background: cssColor(r.result) }} />
        </span>
      </Tooltip>
      <div className={s.parts}>
        {name !== null && <span className={s.rname}>{name}</span>}
        <span className={s.farText}>
          No close mix from your paints. Nearest: {partsText(r)}, ΔE {r.deltaE.toFixed(1)}. {more ? 'Allow more paints per mix, or tick more.' : 'Tick more paints, or add your own.'}
        </span>
      </div>
      <span className={s.de}>
        <TryIt r={r} onTry={onTry} />
      </span>
    </div>
  );
}

/** the selected colour as the recipes name it */
export const recipeTarget = (d: IllustrationDoc, w: { id: string; oklch: Oklch } | null) => (w ? { id: w.id, name: nameOf(d, d.swatches.find((x) => x.id === w.id)!), oklch: w.oklch } : null);
