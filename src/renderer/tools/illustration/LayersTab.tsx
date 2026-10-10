// Tab 7, Layers: your flat colours, plus the few blend layers that shade them the way you would in Krita,
// Clip Studio or Procreate, each with an exact colour and opacity to type in. Left, a still life painted from the
// flats (Flats | Recipe | Target), what goes muddy, and Advanced; right, the layer stack, the recipe as text, and
// a row of switches per ramp. The flats are the ramps' bases and the targets their own steps. The recipe is
// solved when the palette settles (never per drag frame) and kept while only the pointer moves.
// The maths is shared/palette/recipe.ts; the words and the compositing are layers.ts; the picture is still-life.ts.
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cssColor } from '../../../shared/color/index.ts';
import { ALL_ON, hexRgb, MODE_NAME, muddyAll, recipeText, solveRecipe, typedHex, type Eyes, type FlatIn, type Recipe, type Rgb, type Space } from '../../../shared/palette/recipe.ts';
import { cx } from '../../ui/cx.ts';
import { Button, copyText, IconButton, InspectorGroup, NumberField, Segmented, Select, Toggle } from '../../ui/index.ts';
import { GreyscaleButton } from '../common/Greyscale.tsx';
import { plural } from '../common/names.ts';
import { useSettled } from '../common/settled.ts';
import { selected, type Doc } from './actions.ts';
import { offerLayers, SHOWS, setFlag, setPart } from './layer-actions.ts';
import { allFlats, allTogether, hintOf, paintRecipe, paintTargets, PARTS, partRamps, recipeFlats, rowsOf, shadowIn, type Row } from './layers.ts';
import { sceneLight } from './scene.ts';
import { PART_IDS, stillLifeOf, type PartId } from './still-life.ts';
import { patchView, type IllustrationView } from './view-state.ts';
import type { IllustrationDoc } from './doc.ts';
import s from './LayersTab.module.css';

/** the picture is drawn this many pixels wide and shown smaller; it is the still life's masks that are sized once */
const SIZE = 520;
/** a part with no ramp to show (an empty palette never gets here) */
const NONE = cssColor([0.6, 0, 0]);

const SPACES: { value: Space; label: string }[] = [
  { value: 'srgb', label: 'sRGB (as the apps do)' },
  { value: 'linear', label: 'Linear light' },
];
const SPACE_NAME: Record<Space, string> = { srgb: 'sRGB', linear: 'linear light' };
const NAME: Record<Space, string> = { srgb: 'sRGB', linear: 'Linear light' };

export function LayersTab({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  // the document the recipe reads: live, but holding its state from before a drag, so a picker drag is not a solve a frame
  const settled = useSettled(doc, 0);
  const everyFlat = useMemo(() => allFlats(settled, v), [settled, v.layerBg, v.layerStar]);
  const flats = useMemo(() => recipeFlats(everyFlat, v), [everyFlat, v.layerOut]);
  // the same flats and targets solve to the same layers: a change that touches none of them (a rename, the pointer) solves nothing
  const key = JSON.stringify(flats.map(({ id, hex, star, background, targets, share }) => [id, hex, star, background, targets, share]));
  const recipe = useMemo(() => (flats.length ? solveRecipe(flats, { space: v.layerSpace, lightMode: v.layerLight }) : null), [key, v.layerSpace, v.layerLight]);
  const group = selected(d, v.selected)?.group;
  const { pair, preset } = sceneLight(settled, group);
  const [eyes, setEyes] = useState<Eyes>(ALL_ON);
  const rows = useMemo(() => (recipe ? rowsOf(recipe, flats, pair, v, eyes) : []), [recipe, pair, v.layerRim, v.layerRimOn, v.layerMood, v.layerMoodOn, eyes]);
  const warnings = useMemo(() => (recipe ? muddyAll(flats, recipe, eyes) : []), [recipe, eyes]);
  const parts = useMemo(() => partRamps(settled, v.layerParts), [settled.ramps, v.layerParts]);
  const muddyParts = PART_IDS.filter((p) => warnings.some((w) => w.id === parts[p]));

  const eye = (k: keyof Eyes) => setEyes((e) => ({ ...e, [k]: !e[k] }));
  // the Shadow 2 eye with the Shadow off turns both on, so a click always shows
  const flip = (r: Row) =>
    r.key === 'rim' ? patchView({ layerRimOn: !v.layerRimOn }) : r.key === 'mood' ? patchView({ layerMoodOn: !v.layerMoodOn }) : r.key === 'shadow2' && !eyes.shadow ? setEyes((e) => ({ ...e, shadow: true, shadow2: true })) : eye(r.key);
  const header = `Layer recipe: ${preset ? `${preset.label} light` : 'your light'}, blended in ${SPACE_NAME[v.layerSpace]}`;
  const text = useMemo(() => recipeText(rows, header), [rows, header]);

  return (
    <div className={s.tab}>
      <div className={s.layout}>
        <div className={s.left}>
          <section className={cx(s.stage, s.o1)} aria-label="The still life">
            <div className={s.bar}>
              <Segmented options={SHOWS.map((o, i) => ({ value: o.id, label: o.label, tip: `Press ${i + 1}` }))} value={v.layerShow} onChange={(layerShow) => patchView({ layerShow })} fit />
              <GreyscaleButton />
            </div>
            <Preview show={v.layerShow} flats={everyFlat} inRecipe={flats} parts={parts} rows={rows} recipe={recipe} space={v.layerSpace} muddy={v.layerShow === 'recipe' ? muddyParts : []} />
            <p className={s.caption}>{caption(v.layerShow, v.layerSpace, muddyParts.length > 0)}</p>
          </section>
          <div className={cx(s.parts, s.o3)} role="group" aria-label="Parts">
            {PARTS.map((p) => (
              <label key={p.id} className={s.part}>
                <span className={s.lab}>{p.label}</span>
                <Select
                  options={d.ramps.map((r) => ({ value: r.id, label: everyFlat.find((f) => f.id === r.id)?.name ?? '', swatch: everyFlat.find((f) => f.id === r.id)?.hex }))}
                  value={parts[p.id] ?? ''}
                  onChange={(ramp) => setPart(p.id, ramp)}
                />
              </label>
            ))}
          </div>
          <InspectorGroup className={s.o4} title="Goes muddy" meta={warnings.length ? `${warnings.length} to look at` : undefined} id="illustration.layers.muddy">
            {recipe ? <Muddy warnings={warnings} /> : <p className={s.hint}>Put a flat in the recipe to see what goes muddy.</p>}
          </InspectorGroup>
          <InspectorGroup className={s.o6} title="Advanced" defaultOpen={false} id="illustration.layers.advanced">
            <div className={s.adv}>
              <Segmented label="Blend in" options={SPACES} value={v.layerSpace} onChange={(layerSpace) => patchView({ layerSpace })} fit />
              <p className={s.hint}>
                <b>sRGB:</b> what Krita and Photoshop do in an ordinary sRGB document (confirmed); Clip Studio and Procreate very likely do the same.
              </p>
              <p className={s.hint}>
                <b>Linear light:</b> only for a linear Krita document, or Photoshop with its blend gamma set to 1.00. Switch to see how far apart they land.
              </p>
              {recipe && <Compare flats={flats} recipe={recipe} eyes={eyes} space={v.layerSpace} />}
            </div>
          </InspectorGroup>
        </div>

        <div className={s.right}>
          <InspectorGroup className={s.o2} title="Layers" meta={recipe ? plural(rows.length, 'layer') : undefined} id="illustration.layers.stack">
            {recipe ? (
              <>
                <div className={s.acts}>
                  <Button icon="palette" onClick={() => offerLayers(rows)} tooltip="Offer each layer that is on to the palette as a proposal, named like “Shadow · Multiply 80%”. Keep them and they travel with the .kpl and .swatches exports as loose swatches.">
                    Add layer colours to palette
                  </Button>
                  <Button size="xs" icon="content_copy" onClick={() => void copyText(text, 'Copied the recipe.')}>
                    Copy recipe
                  </Button>
                </div>
                <div className={s.stack}>
                  {rows.map((r) => (
                    <LayerRow key={r.key} r={r} lightMode={v.layerLight} flip={() => flip(r)} />
                  ))}
                </div>
                <div className={s.together}>
                  {allTogether(recipe, flats).map((t) => (
                    <span key={t.label}>
                      <b>{t.label}:</b> <span className={cx(s.fit, t.tone && s[t.tone])}>{t.fit}</span>
                    </span>
                  ))}
                </div>
                <p className={s.hint}>{hintOf(recipe, flats)}</p>
                <p className={s.hint}>
                  Add is called Addition in Krita (it also lists Linear Dodge), Linear Dodge (Add) in Photoshop, and Add in Clip Studio and Procreate. It is not Add (Glow), which behaves differently. These numbers are exact for Krita and Photoshop; Clip Studio and Procreate are not yet checked.
                </p>
                <span className={s.lab}>The recipe as text</span>
                <pre className={s.recipe} tabIndex={0} aria-label="The recipe as text">
                  {text}
                </pre>
              </>
            ) : (
              <p className={s.hint}>{everyFlat.length ? 'Every flat is out of the recipe. Turn one on under Flats.' : 'Each ramp is a flat here. Make a ramp to see its layers.'}</p>
            )}
          </InspectorGroup>
          <InspectorGroup className={s.o5} title="Flats" meta={`${flats.length} of ${everyFlat.length} in the recipe`} id="illustration.layers.flats">
            <div className={s.flats}>
              {everyFlat.map((f) => (
                <FlatRow key={f.id} f={f} out={v.layerOut.includes(f.id)} />
              ))}
            </div>
            <p className={s.hint}>A flat that is out of the recipe still shows in the picture, but the layers are not fitted to it. A background flat gets the Cast shadow instead of the Shadow. A flat that matters most counts three times.</p>
          </InspectorGroup>
        </div>
      </div>
    </div>
  );
}

const caption = (show: IllustrationView['layerShow'], space: Space, muddy: boolean): string =>
  show === 'flats'
    ? 'The flat colours, nothing else.'
    : show === 'target'
      ? 'What the ramps say the shading should be: each flat’s shadow, light and lightest step, painted into the same shapes. The recipe tries to match this.'
      : `The flats with the layers applied, blended in ${space === 'srgb' ? 'sRGB, as the apps do' : 'linear light'}.${muddy ? ' Dashed outlines mark flats that go muddy.' : ''}`;

// ── the picture ─────────────────────────────────────────────────────────────────────────────────

type PreviewProps = {
  show: IllustrationView['layerShow'];
  flats: FlatIn[];
  /** the flats the layers were fitted to */
  inRecipe: FlatIn[];
  parts: Record<PartId, string | null>;
  rows: Row[];
  recipe: Recipe | null;
  space: Space;
  muddy: PartId[];
};

/** the still life: flats painted, then (Recipe) the layers through the shading shapes, or (Target) the ramps' own steps; redrawn only when one of these changes */
function Preview({ show, flats, inRecipe, parts, rows, recipe, space, muddy }: PreviewProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const still = stillLifeOf(SIZE);
    const flat = (p: PartId) => flats.find((f) => f.id === parts[p]);
    still.paint(ctx, (p) => flat(p)?.hex ?? NONE);
    if (show !== 'flats') {
      const img = ctx.getImageData(0, 0, still.width, still.height);
      if (show === 'target') {
        const rgb = (p: PartId): [Rgb, Rgb, Rgb] | null => {
          const t = flat(p)?.targets;
          return t ? [hexRgb(typedHex(t.shadow)), hexRgb(typedHex(t.light)), hexRgb(typedHex(t.rim))] : null;
        };
        paintTargets(still, img.data, Object.fromEntries(PART_IDS.map((p) => [p, rgb(p)])) as Record<PartId, [Rgb, Rgb, Rgb] | null>);
      } else if (recipe) {
        // the Shadow is clipped to the character, the Cast shadow lands on the background: the two never share a pixel
        const onCast = (p: PartId) => !!recipe.cast && !!flat(p)?.background && inRecipe.some((f) => f.id === parts[p]);
        const second = recipe.shadow2 ? PART_IDS.filter((p) => recipe.shadow2!.clip.includes(parts[p] ?? '')) : null;
        const clips = { character: still.coverage(PART_IDS.filter((p) => !onCast(p))), background: still.coverage(PART_IDS.filter(onCast)), second: second && still.coverage(second) };
        paintRecipe(still, img.data, rows, clips, space);
      }
      ctx.putImageData(img, 0, 0);
    }
    if (muddy.length) still.outline(ctx, muddy, getComputedStyle(document.documentElement).getPropertyValue('--danger').trim());
  }, [show, flats, inRecipe, parts, rows, recipe, space, muddy.join()]);
  return <canvas ref={ref} width={SIZE} height={Math.round((SIZE * 3) / 4)} className={s.canvas} data-colour="" role="img" aria-label="A box, a ball and a can on a table in front of a wall, drawn from the flat colours" />;
}

// ── the layer stack ─────────────────────────────────────────────────────────────────────────────

/** one layer: eye, name and mode, colour and hex, opacity, and how well it fits */
const LayerRow = memo(function LayerRow({ r, lightMode, flip }: { r: Row; lightMode: 'add' | 'screen'; flip(): void }) {
  const typed = r.key === 'rim' || r.key === 'mood';
  return (
    <div className={cx(s.lrow, !r.on && s.off)} data-layer={r.key}>
      <IconButton icon={r.on ? 'visibility' : 'visibility_off'} label={`Show ${r.name}`} size="sm" latched={r.on} onClick={flip} />
      <div className={s.lname}>
        <span>
          <b>{r.name}</b>
          {r.key === 'light' ? (
            <Segmented
              className={s.lmode}
              options={[
                { value: 'add', label: 'Add', tip: 'Add (Linear Dodge): adds the colour; strong on dark flats, can blow bright ones out' },
                { value: 'screen', label: 'Screen', tip: 'Screen: a softer lift that never goes past white' },
              ]}
              value={lightMode}
              onChange={(layerLight) => patchView({ layerLight })}
              fit
            />
          ) : (
            <span className={s.mode}>{MODE_NAME[r.mode]}</span>
          )}
        </span>
        <span className={s.note}>{r.key === 'light' ? `${r.note}, aimed at the ramps’ light steps` : r.note}</span>
      </div>
      <div className={s.lcol}>
        <i className={s.chip} data-colour="" style={{ background: r.hex }} />
        <code className={s.hex}>{r.hex}</code>
      </div>
      <div className={s.lpct}>
        {typed ? (
          <NumberField
            label={`${r.name} opacity`}
            hideLabel
            size="sm"
            value={r.pct}
            min={0}
            max={100}
            unit="%"
            width={64}
            onChange={(x) => patchView(r.key === 'rim' ? { layerRim: Math.round(x) } : { layerMood: Math.round(x) })}
          />
        ) : (
          <span className={s.mono}>{r.pct}%</span>
        )}
      </div>
      <div className={cx(s.fit, r.tone && s[r.tone])}>{r.fit}</div>
    </div>
  );
});

// ── goes muddy, and the two blend spaces side by side ───────────────────────────────────────────

function Muddy({ warnings }: { warnings: ReturnType<typeof muddyAll> }) {
  if (!warnings.length) return <p className={s.ok}>No flat goes muddy under these layers.</p>;
  return (
    <ul className={s.warns}>
      {warnings.map((w) => {
        const [what, grey] = w.text.split(' Its grey value');
        return (
          <li key={`${w.id}-${w.zone}`} className={s.warn}>
            <span className={s.wchips}>
              <figure>
                <i className={s.chip} data-colour="" style={{ background: w.shaded }} />
                <figcaption>now</figcaption>
              </figure>
              <figure>
                <i className={s.chip} data-colour="" style={{ background: w.target }} />
                <figcaption>ramp</figcaption>
              </figure>
            </span>
            <span className={s.wtext}>
              {what}
              {grey && <small>Its grey value{grey}</small>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** each flat in shadow under the layers as they stand, in the space blended now and in the other: how far apart they land */
function Compare({ flats, recipe, eyes, space }: { flats: FlatIn[]; recipe: Recipe; eyes: Eyes; space: Space }) {
  const other: Space = space === 'srgb' ? 'linear' : 'srgb';
  return (
    <div className={s.cmp}>
      <span className={s.h}>Flat in shadow</span>
      <span className={s.h}>{NAME[space]} (now)</span>
      <span className={s.h}>{NAME[other]}</span>
      {flats.map((f) => {
        return (
          <div key={f.id} className={s.crow}>
            <span>{f.name}</span>
            {[shadowIn(f, recipe, eyes, space), shadowIn(f, recipe, eyes, other)].map((hex, i) => (
              <span key={i} className={s.cell2}>
                <i className={s.chip} data-colour="" style={{ background: hex }} />
                {hex}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── the flats ───────────────────────────────────────────────────────────────────────────────────

/** one ramp: in the recipe, in the background, and the star that makes it count three times */
const FlatRow = memo(function FlatRow({ f, out }: { f: FlatIn; out: boolean }) {
  return (
    <div className={s.flat} role="group" aria-label={f.name}>
      <i className={s.chip} data-colour="" style={{ background: f.hex }} />
      <div className={s.fname}>
        <b>{f.name}</b>
        <IconButton icon="star" label={`${f.name} matters most`} tip="Matters most: counts three times in the fit" size="sm" latched={f.star} onClick={() => setFlag('layerStar', f.id, !f.star)} />
      </div>
      <div className={s.flags}>
        <Toggle quiet label="In the recipe" checked={!out} onChange={(on) => setFlag('layerOut', f.id, !on)} />
        <Toggle quiet label="Background" checked={!!f.background} onChange={(on) => setFlag('layerBg', f.id, on)} />
      </div>
    </div>
  );
});
