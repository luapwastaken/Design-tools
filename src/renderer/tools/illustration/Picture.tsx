// What's in the picture: tick what the scene holds (Skin and Hair take a tone), and Make ramps replaces the
// scene's ramps with one per ticked subject, under the light it has, each with its material. While anything is
// ticked, Vary the colours keeps one ramp per ticked subject and varies within each. The ticks are view state.
import { useState } from 'react';
import { KINDS } from '../../../shared/palette/variations.ts';
import { Button, ConfirmInline, Icon, Select, Toggle } from '../../ui/index.ts';
import { plural } from '../common/names.ts';
import type { Doc } from './actions.ts';
import { makeFromPicture, setTone, toggleKind } from './variation-actions.ts';
import { pictureOf } from './variations.ts';
import { patchView, type IllustrationView } from './view-state.ts';
import s from './Picture.module.css';

/** `ramps` is how many the palette has now: Make ramps asks before it replaces any */
export function Picture({ doc, v, ramps }: { doc: Doc; v: IllustrationView; ramps: number }) {
  const n = pictureOf(v).length;
  const [asking, setAsking] = useState(false);
  // open while there is no ramp (the quickest way in), unless folded away; with ramps it is as it was left
  const open = ramps === 0 ? !v.pictureShut : v.pictureOpen;
  const toggle = () => patchView(ramps === 0 ? { pictureShut: open } : { pictureOpen: !open });
  return (
    <div className={s.pic} role="group" aria-label="What's in the picture">
      <button type="button" className={s.head} aria-expanded={open} onClick={toggle}>
        <Icon name={open ? 'keyboard_arrow_down' : 'keyboard_arrow_right'} size={14} />
        <span className={s.cap}>What's in the picture</span>
        {n > 0 && <span className={s.count}>{n} ticked</span>}
      </button>
      {open && (
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
          {asking && ramps > 0 ? (
            <ConfirmInline
              compact
              icon="auto_awesome_motion"
              title={`Replace the ${plural(ramps, 'ramp')} with ${plural(n, 'new one')}?`}
              detail="Hand-edited steps and ramp locks go too. Undo brings them back."
              confirmLabel="Replace"
              danger
              onConfirm={() => {
                setAsking(false);
                makeFromPicture(doc);
              }}
              onKeep={() => setAsking(false)}
            />
          ) : (
            <div className={s.foot}>
              <Button size="xs" icon="auto_awesome_motion" disabled={!n} onClick={() => (ramps ? setAsking(true) : makeFromPicture(doc))} tooltip="Replace the ramps with one for each thing ticked, lit as the scene is">
                Make ramps
              </Button>
              <span className={s.fine}>{n ? `${plural(n, 'ramp')} for what is ticked.` : 'Tick what the picture holds.'}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
