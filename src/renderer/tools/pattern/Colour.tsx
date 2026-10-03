// The Colour module (spec §3): a background on or off, and the shape colours, from a palette sent
// here or picked by hand, given out by shape or at random.
import { useState, type KeyboardEvent } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { fitChroma, wrapHue } from '../../../shared/palette/space.ts';
import { ColorField, ConfirmInline, IconButton, menu, Module, Segmented, Toggle, Tooltip, useDocColour } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { displayName, plural } from '../common/names.ts';
import { paletteMenu, useReadAhead } from '../common/palettes.ts';
import { removeColour, type Doc } from './actions.ts';
import { emptyDoc, MAX_COLOURS, type PatternDoc } from './doc.ts';
import s from './Colour.module.css';
import i from './Inspector.module.css';

const MODES = [
  { value: 'by-slot' as const, label: 'By shape' },
  { value: 'random' as const, label: 'Random' },
];

/** the background a toggle brings back: the one last switched off */
let lastBackground: Oklch = emptyDoc().background!;

export function ColourModule({ doc, d }: { doc: Doc; d: PatternDoc }) {
  const [picked, pick] = useState(0);
  // the delete arms a confirm in place of the colour's field (brief rule 3); picking another colour disarms it
  const [arming, setArming] = useState(false);
  const setPicked = (j: number) => {
    pick(j);
    setArming(false);
  };
  const at = Math.max(0, Math.min(picked, d.palette.length - 1));
  const bg = useDocColour(doc, {
    label: 'Change the background',
    key: 'background',
    get: (x) => x.background ?? lastBackground,
    set: (x, o) => ({ ...x, background: o }),
  });
  const ink = useDocColour(doc, {
    label: `Change shape colour ${at + 1}`,
    key: `palette:${at}`,
    get: (x) => x.palette[at] ?? [0, 0, 0],
    set: (x, o) => ({ ...x, palette: x.palette.map((c, j) => (j === at ? o : c)) }),
  });
  const users = d.slots.filter((x) => x.recolour && !x.colour).length;
  useReadAhead();

  const add = () => {
    const [l, c, h] = d.palette[at] ?? [0.5, 0.12, 250];
    // a neighbour of the picked colour, far enough round the wheel to tell apart
    const next = fitChroma([l, Math.max(c, 0.06), wrapHue(h + 47)]);
    doc.transact('Add a shape colour', (x) => ({ ...x, palette: [...x.palette.slice(0, at + 1), next, ...x.palette.slice(at + 1)] }));
    setPicked(at + 1);
  };
  const remove = () => {
    removeColour(doc, at);
    setPicked(Math.max(0, at - 1));
  };

  // one Tab stop; the arrows move the pick (brief §6)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    if (!step || !d.palette.length) return;
    e.preventDefault();
    const next = (at + step + d.palette.length) % d.palette.length;
    setPicked(next);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <Module
      title="Colour"
      sub={plural(d.palette.length, 'shape colour')}
      actions={<IconButton icon="palette" label="Shape colours from a Library palette" size="sm" onClick={(e) => menu.open(e.currentTarget.getBoundingClientRect(), paletteMenu('pattern'), { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined })} />}
    >
      <div className={i.stack}>
        <div className={i.row}>
          <Toggle
            label="Background"
            checked={d.background !== null}
            onChange={(on) => {
              if (!on && d.background) lastBackground = d.background;
              doc.transact(on ? 'Add a background' : 'Remove the background', (x) => ({ ...x, background: on ? lastBackground : null }));
            }}
            className={s.toggle}
          />
          <ColorField {...bg} name={`${d.background ? '' : 'Off · '}${displayName({ name: '', oklch: bg.value })}`} disabled={d.background === null} className={i.grow} />
        </div>

        <div className={cx(i.group, i.rule)}>
          <div className={s.head}>
            <span className="lbl">Shape colours</span>
            <span className={i.dim}>{users ? `${plural(users, 'shape')} take${users === 1 ? 's' : ''} them` : 'No shape takes them yet'}</span>
          </div>
          <div className={s.strip} role="radiogroup" aria-label="Shape colours" onKeyDown={onKey}>
            {d.palette.map((c, j) => {
              const says = `Colour ${j + 1}: ${displayName({ name: '', oklch: c })}`;
              return (
                <Tooltip key={j} content={says}>
                  <button type="button" role="radio" aria-label={says} aria-checked={j === at} tabIndex={j === at ? 0 : -1} className={cx(s.chip, j === at && s.on)} onClick={() => setPicked(j)}>
                    <i style={{ background: cssColor(c) }} />
                  </button>
                </Tooltip>
              );
            })}
            <IconButton icon="add" label={d.palette.length >= MAX_COLOURS ? `${MAX_COLOURS} colours is the most` : 'Add a colour next to the picked one'} size="sm" disabled={d.palette.length >= MAX_COLOURS} onClick={add} className={s.add} />
          </div>
          {arming && d.palette.length > 1 ? (
            <ConfirmInline
              icon="delete"
              title={`Remove colour ${at + 1}?`}
              detail="Shapes that use it take another from the palette. Undo brings it back."
              confirmLabel="Remove"
              danger
              onConfirm={remove}
              onKeep={() => setArming(false)}
            />
          ) : (
            d.palette.length > 0 && (
              <div className={i.row}>
                <ColorField {...ink} name={displayName({ name: '', oklch: ink.value })} className={i.grow} />
                <IconButton icon="delete" label={d.palette.length < 2 ? 'The last colour stays' : `Remove colour ${at + 1}`} size="sm" disabled={d.palette.length < 2} onClick={() => setArming(true)} />
              </div>
            )
          )}
        </div>

        <Segmented label="Give out" options={MODES} value={d.paletteMode} onChange={(paletteMode) => doc.transact(paletteMode === 'random' ? 'Give out colours at random' : 'Give out colours by shape', (x) => ({ ...x, paletteMode }))} />
        <p className={i.note}>
          {d.paletteMode === 'random' ? 'Each item draws a colour from the palette, from its own seed.' : 'The shapes that take palette colours get them in order.'} Send a palette here from the Library or Design to use its colours; one with a Background role sets the background too.
        </p>
      </div>
    </Module>
  );
}
