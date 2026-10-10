// What's in the picture: tick what the scene holds (Skin and Hair take a tone), and Make ramps replaces the
// scene's ramps with one per ticked subject, under the light it has, each with its material. While anything is
// ticked, Vary the colours keeps one ramp per ticked subject and varies within each. The ticks are view state.
import { KINDS } from '../../../shared/palette/variations.ts';
import { Button, Icon, Select, Toggle } from '../../ui/index.ts';
import { plural } from '../common/names.ts';
import type { Doc } from './actions.ts';
import { makeFromPicture, setTone, toggleKind } from './variation-actions.ts';
import { pictureOf } from './variations.ts';
import { patchView, type IllustrationView } from './view-state.ts';
import s from './Picture.module.css';

export function Picture({ doc, v }: { doc: Doc; v: IllustrationView }) {
  const n = pictureOf(v).length;
  return (
    <div className={s.pic} role="group" aria-label="What's in the picture">
      <button type="button" className={s.head} aria-expanded={v.pictureOpen} onClick={() => patchView({ pictureOpen: !v.pictureOpen })}>
        <Icon name={v.pictureOpen ? 'keyboard_arrow_down' : 'keyboard_arrow_right'} size={14} />
        <span className={s.cap}>What's in the picture</span>
        {n > 0 && <span className={s.count}>{n} ticked</span>}
      </button>
      {v.pictureOpen && (
        <>
          <div className={s.ticks}>
            {KINDS.map((k) => {
              const on = v.pictureOn.includes(k.kind);
              const tone = k.tones && (k.tones.find((t) => t.id === v.pictureTones[k.kind]) ?? k.tones[Math.floor(k.tones.length / 2)]);
              return (
                <span key={k.kind} className={s.tick}>
                  <Toggle quiet label={k.label} checked={on} onChange={() => toggleKind(k.kind)} />
                  {on && k.tones && tone && <Select label={`${k.label} tone`} options={k.tones.map((t) => ({ value: t.id, label: t.label }))} value={tone.id} onChange={(id) => setTone(k.kind, id)} />}
                </span>
              );
            })}
          </div>
          <div className={s.foot}>
            <Button size="xs" icon="auto_awesome_motion" disabled={!n} onClick={() => makeFromPicture(doc)} tooltip="Replace the ramps with one for each thing ticked, lit as the scene is">
              Make ramps
            </Button>
            <span className={s.fine}>{n ? `${plural(n, 'ramp')} for what is ticked.` : 'Tick what the picture holds.'}</span>
          </div>
        </>
      )}
    </div>
  );
}
