// Light (UX pass): the ramps on lit shapes, with the selected ramp's lighting beside them, so a
// change is seen where it lands.
import { rampsFromLoose, select, selected, type Doc } from './actions.ts';
import { baseOf, looseOf, rampName, stepsOf, type IllustrationDoc } from './doc.ts';
import { Lighting } from './Lighting.tsx';
import { LIT_VIEW, LitPreview, type LitRamp, type LitView } from './LitPreview.tsx';
import { patchView, shaped, type IllustrationView } from './view-state.ts';
import s from './View.module.css';

export function LightPane({ doc, d, v, hidden }: { doc: Doc; d: IllustrationDoc; v: IllustrationView; hidden: boolean }) {
  // the preview follows every frame of a drag: it is how a ramp is judged
  const ramps: LitRamp[] = d.ramps.map((r) => ({ id: r.id, name: rampName(d, r), steps: stepsOf(d, r.id).map((w) => w.oklch), hero: r.hero }));
  const lit = shaped(v.preview, LIT_VIEW);
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
      <Lighting doc={doc} d={d} v={v} className={s.lighting} />
    </div>
  );
}
