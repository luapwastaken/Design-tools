// The paints you own (spec §5.4: the 14 generic pigments, plus your own by colour and name), behind
// an "N paints" button in Mix it. View state, not the document: it is your paint box, the same for
// every palette.
import { useRef, useState } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { customPigment, PIGMENTS, type CustomPigment, type Pigment } from '../../../shared/paint/pigments.ts';
import { cx } from '../../ui/cx.ts';
import { Button, ColorField, ConfirmInline, Icon, IconButton, Popover, TextInput, toast, Tooltip } from '../../ui/index.ts';
import { displayName } from '../common/names.ts';
import { paintSettings } from './paint-sources.ts';
import { getView, patchView, type IllustrationView } from './view-state.ts';
import s from './Paint.module.css';

/** the paints recipes and the canvas may use, in the box's order */
export const ownedPaints = (v: IllustrationView): Pigment[] => [...PIGMENTS, ...v.custom].filter((p) => v.owned.includes(p.id));

/** The "14 paints" button and the paint box it opens. */
export function PaintsButton({ v }: { v: IllustrationView }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const ticked = ownedPaints(v).length;
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus({ preventScroll: true });
  };
  return (
    <>
      <Button ref={btn} size="xs" icon="palette" onClick={() => setOpen(!open)} tooltip="The paints you own: recipes and the tray use only these">
        {ticked === 1 ? '1 paint' : `${ticked} paints`}
      </Button>
      {open && btn.current && (
        <Popover anchor={btn.current} label="Your paints" align="end" focus='[role="checkbox"]' onClose={close} className={s.pop}>
          <Box v={v} />
        </Popover>
      )}
    </>
  );
}

function Box({ v }: { v: IllustrationView }) {
  const all: Pigment[] = [...PIGMENTS, ...v.custom];
  const owned = new Set(v.owned);
  const ticked = all.filter((p) => owned.has(p.id)).length;
  const [armed, setArmed] = useState<string | null>(null);
  const onBrush = paintSettings(v.canvas).paint;

  const toggle = (id: string) => patchView({ owned: owned.has(id) ? v.owned.filter((x) => x !== id) : [...v.owned, id] });
  const remove = (p: CustomPigment) => {
    setArmed(null);
    const at = v.custom.indexOf(p);
    const was = owned.has(p.id);
    patchView({ custom: v.custom.filter((x) => x !== p), owned: v.owned.filter((x) => x !== p.id) });
    toast.show({
      icon: 'delete',
      message: `Removed ${p.name} from your paints.`,
      undo: () => {
        const cur = getView();
        patchView({ custom: [...cur.custom.slice(0, at), p, ...cur.custom.slice(at)], owned: was ? [...cur.owned, p.id] : cur.owned });
      },
    });
  };

  return (
    <>
      <div className={s.popHead}>
        <span className={s.popTitle}>Your paints</span>
        <span className={s.popCount}>
          {ticked} of {all.length} ticked
        </span>
        <Button size="xs" variant="ghost" disabled={ticked === all.length} onClick={() => tickAll(all)}>
          Tick all
        </Button>
      </div>
      <div className={s.plist} role="group" aria-label="Paints you own">
        {all.map((p) =>
          armed === p.id && 'custom' in p ? (
            <div key={p.id} className={s.armed}>
              <ConfirmInline
                compact
                icon="delete"
                title={`Remove ${p.name}?`}
                detail="From your paints. Undo brings it back."
                confirmLabel="Remove"
                danger
                onConfirm={() => remove(p as CustomPigment)}
                onKeep={() => setArmed(null)}
              />
            </div>
          ) : (
            <div key={p.id} className={s.prow}>
              <button
                type="button"
                role="checkbox"
                aria-checked={owned.has(p.id)}
                aria-description={p.id === onBrush ? 'On the brush' : undefined}
                className={cx(s.tick, owned.has(p.id) && s.ticked)}
                onClick={() => toggle(p.id)}
              >
                <Icon name={owned.has(p.id) ? 'check_box' : 'check_box_outline_blank'} size={16} fill={owned.has(p.id)} />
                <i className={s.pchip} style={{ background: cssColor(p.oklch) }} />
                <span className={s.pname}>{p.name}</span>
                {p.id === onBrush && (
                  <Tooltip content="On the brush">
                    <span className={s.onBrush}>
                      <Icon name="brush" size={14} />
                    </span>
                  </Tooltip>
                )}
              </button>
              {'custom' in p && <IconButton icon="delete" label={`Remove ${p.name}`} size="xs" onClick={() => setArmed(p.id)} />}
            </div>
          ),
        )}
      </div>
      <AddPaint />
    </>
  );
}

/** every paint ticked; the box as it was comes back from the toast (the recipes lean on it) */
function tickAll(all: Pigment[]): void {
  const was = getView().owned;
  const owned = all.map((p) => p.id);
  patchView({ owned });
  toast.show({
    icon: 'check_box',
    message: `Ticked all ${all.length} paints.`,
    undo: () => patchView({ owned: was }),
    when: () => getView().owned === owned,
  });
}

/** your own paint, by colour and name; it starts ticked */
function AddPaint() {
  const [oklch, setOklch] = useState<Oklch>([0.55, 0.12, 30]);
  const [name, setName] = useState('');
  const start = useRef(oklch);
  const add = () => {
    const p = customPigment(name.trim() || displayName({ name: '', oklch }), oklch);
    const v = getView();
    patchView({ custom: [...v.custom, p], owned: [...v.owned, p.id] });
    setName('');
  };
  return (
    <div className={s.add}>
      <span className="lbl">Add your own</span>
      <div className={s.addRow}>
        <ColorField
          value={oklch}
          className={s.addColour}
          onBegin={() => (start.current = oklch)}
          onChange={setOklch}
          onCancel={() => setOklch(start.current)}
        />
        <TextInput value={name} placeholder={displayName({ name: '', oklch })} onChange={setName} onCommit={setName} className={s.addName} />
        <Button icon="add" onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}
