// "How do I mix this?" (spec §3.3): recipes from the paints you own, for the selected colour or
// for every ramp's base, each with its parts, the mix beside the target, and ΔE.
import { useMemo } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import type { Pigment } from '../../../shared/paint/pigments.ts';
import { recipes, type Recipe } from '../../../shared/paint/recipe.ts';
import { Module, Segmented, Tooltip } from '../../ui/index.ts';
import { baseOf, nameOf, rampName, type IllustrationDoc } from './doc.ts';
import { patchView, type IllustrationView } from './view-state.ts';
import s from './Paint.module.css';

const FOR: { value: IllustrationView['recipesFor']; label: string; tip: string }[] = [
  { value: 'selected', label: 'Selected', tip: 'Three recipes for the selected colour' },
  { value: 'bases', label: 'Bases', tip: 'The best recipe for every ramp’s base' },
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

type Props = { d: IllustrationDoc; v: IllustrationView; sel: { id: string; name: string; oklch: Oklch } | null; owned: Pigment[]; hidden: boolean };

/** `d`: the settled document, so a picker drag doesn't solve recipes on every frame */
export function Recipes({ d, v, sel, owned, hidden }: Props) {
  const targets = v.recipesFor === 'bases' ? d.ramps.flatMap((r) => (baseOf(d, r.id) ? [{ id: r.id, name: rampName(d, r), oklch: baseOf(d, r.id)!.oklch }] : [])) : sel ? [sel] : [];
  const key = `${v.recipesFor}|${v.maxPaints}|${owned.map((p) => p.id).join()}|${targets.map((t) => `${t.name}:${t.oklch.join()}`).join('|')}`;
  // the solver runs only while the Paint side shows (~25ms a colour)
  const found = useMemo(
    () => (hidden || !owned.length ? [] : targets.map((t) => ({ t, list: recipes(t.oklch, owned, { maxPigments: v.maxPaints, count: v.recipesFor === 'bases' ? 1 : 3 }) }))),
    [key, hidden],
  );
  return (
    <Module
      title="Recipes"
      sub={v.recipesFor === 'bases' ? 'Every base' : sel ? sel.name : undefined}
      actions={<Segmented options={FOR} value={v.recipesFor} onChange={(recipesFor) => patchView({ recipesFor })} mono fit className={s.small} />}
      scroll
      flush
      className={s.recipes}
      footer={<span className={s.fine}>Parts by volume, tinting strength included. Tube colours vary: mix, then adjust by eye.</span>}
    >
      <Segmented
        label="Paints per mix"
        options={MAX}
        value={String(v.maxPaints) as '1' | '2' | '3'}
        onChange={(m) => patchView({ maxPaints: Number(m) as 1 | 2 | 3 })}
        className={s.maxRow}
      />
      {!owned.length ? (
        <p className={s.none}>Tick the paints you own below. Recipes use only those.</p>
      ) : !targets.length ? (
        <p className={s.none}>{v.recipesFor === 'bases' ? 'Add a base colour to find how to mix it.' : 'Select a colour to find how to mix it.'}</p>
      ) : (
        <div className={s.rlist}>
          {found.flatMap(({ t, list }) => {
            const name = v.recipesFor === 'bases' ? t.name : null;
            const close = list.filter((r) => r.deltaE < FAR);
            // three wrong answers would read as three answers: say it plainly, with the nearest
            if (!close.length && list[0]) return [<FarRow key={t.id} target={t.oklch} name={name} r={list[0]} more={v.maxPaints < 3} />];
            return close.map((r, i) => <RecipeRow key={`${t.id}:${i}`} target={t.oklch} name={name} rank={name === null ? i + 1 : null} r={r} />);
          })}
          {found.every((f) => !f.list.length) && <p className={s.none}>No mix of your paints comes near. Tick more paints, or allow more per mix.</p>}
        </div>
      )}
    </Module>
  );
}

function RecipeRow({ target, name, rank, r }: { target: Oklch; name: string | null; rank: number | null; r: Recipe }) {
  return (
    <div className={s.recipe}>
      <Tooltip content="Target, then the mix">
        <span className={s.pairChips} aria-label="Target and mix">
          <i style={{ background: cssColor(target) }} />
          <i style={{ background: cssColor(r.result) }} />
        </span>
      </Tooltip>
      <div className={s.parts}>
        {name !== null ? <span className={s.rname}>{name}</span> : <span className="lbl">Recipe {rank}</span>}
        <span className={s.mix}>
          {r.parts.map((p, i) => (
            <span key={p.pigment.id} className={s.part}>
              {i > 0 && <span className={s.plus}>+</span>}
              <i className={s.pchip} style={{ background: cssColor(p.pigment.oklch) }} />
              <b>{p.parts}</b> {p.pigment.name}
            </span>
          ))}
        </span>
      </div>
      <span className={s.de}>
        <span className={s.deNum}>ΔE {r.deltaE.toFixed(1)}</span>
        <span className="lbl">{verdict(r.deltaE)}</span>
      </span>
    </div>
  );
}

/** no mix of the owned paints comes close: the nearest, as a sentence rather than a recipe */
function FarRow({ target, name, r, more }: { target: Oklch; name: string | null; r: Recipe; more: boolean }) {
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
    </div>
  );
}

/** the selected colour as the recipes name it */
export const recipeTarget = (d: IllustrationDoc, w: { id: string; oklch: Oklch } | null) => (w ? { id: w.id, name: nameOf(d, d.swatches.find((x) => x.id === w.id)!), oklch: w.oklch } : null);
