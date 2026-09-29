import type { CSSProperties, DragEvent, KeyboardEvent, ReactNode } from 'react';
import { cssColor, toHex } from '../../../shared/color/index.ts';
import { MATERIALS } from '../../../shared/palette/ramp.ts';
import type { RampSpec, Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Button, ConfirmInline, Icon, IconButton, menu, toast, Tooltip, type MenuAnchor } from '../../ui/index.ts';
import { fmtL, plural } from '../common/names.ts';
import { arm, deleteLoose, deleteRamp, duplicate, focusStep, rampsFromLoose, reorder, select, type Doc } from './actions.ts';
import { brokenSteps, nameOf, rampName, regen, revertRamp, setSpec, wordOf, type IllustrationDoc } from './doc.ts';
import type { Proposal } from './proposals.ts';
import { armed } from './view-state.ts';
import s from './Ramps.module.css';

/** internal reorders carry this type (foundation spec §9), so OS files dropped here still go to onFiles */
export const REORDER_MIME = 'application/x-designtools-reorder';

const cells = (cols: number): CSSProperties => ({ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` });

type RowProps = {
  doc: Doc;
  d: IllustrationDoc;
  r: RampSpec;
  index: number;
  steps: Swatch[];
  /** the shared columns: step `lo` sits in the first */
  lo: number;
  cols: number;
  surround: string;
  sel: Swatch | null;
  lit: string[];
  armed: boolean;
  dragging: boolean;
  insert: 'before' | 'after' | undefined;
  onDragStart(): void;
  onDragEnd(): void;
};

/** One ramp: its grip, name and material, the steps on the surround with their values, the hero star. */
export function RampRow(p: RowProps) {
  const { doc, d, r, steps } = p;
  const name = rampName(d, r);
  const broken = new Set(brokenSteps(steps));
  const edited = steps.filter((w) => w.edited).length;
  const material = MATERIALS.find((m) => m.id === r.material)?.label ?? r.material;
  const on = p.sel?.group === r.id;
  // another tool deleted the base: the ramp still knows its colour and can make it again
  const baseless = !steps.some((w) => w.step === 0);

  const openMenu = (at: MenuAnchor, fromKey: boolean) => {
    // the menu's shortcuts act on the selected ramp: make it this one
    if (!on) select(steps.find((w) => w.step === 0)?.id ?? steps[0]?.id ?? null);
    const i = d.ramps.indexOf(r);
    menu.open(
      at,
      [
        { label: 'Duplicate ramp', icon: 'content_copy', shortcut: 'Ctrl+D', onSelect: () => duplicate(doc, r.id) },
        { label: 'Move up', icon: 'arrow_upward', disabled: i === 0, onSelect: () => reorder(doc, r.id, i - 1) },
        { label: 'Move down', icon: 'arrow_downward', disabled: i === d.ramps.length - 1, onSelect: () => reorder(doc, r.id, i + 2) },
        { label: edited ? `Back to generated (${plural(edited, 'edited step')})` : 'Back to generated', icon: 'restart_alt', disabled: !edited, onSelect: () => doc.transact(`Regenerate ${name}`, (x) => revertRamp(x, r.id)) },
        { label: 'Copy hex codes', onSelect: () => void copyHexes(name, steps) },
        'separator',
        { label: 'Delete ramp', icon: 'delete', shortcut: 'Delete', danger: true, onSelect: () => arm(doc, r.id) },
      ],
      { initial: fromKey ? 0 : undefined },
    );
  };

  const onDragStart = (e: DragEvent<HTMLElement>) => {
    const row = e.currentTarget.closest('[data-index]');
    if (row) e.dataTransfer.setDragImage(row, 12, 20);
    e.dataTransfer.setData(REORDER_MIME, r.id);
    e.dataTransfer.effectAllowed = 'move';
    p.onDragStart();
  };

  return (
    <div
      role="group"
      aria-label={`${name} ramp`}
      className={cx(s.row, on && s.on, p.dragging && s.dragging)}
      data-row={r.id}
      data-index={p.index}
      data-insert={p.insert}
      onContextMenu={(e) => {
        if ((e.target as Element).closest('[role="alertdialog"]')) return;
        e.preventDefault();
        openMenu(e.button === 2 ? { x: e.clientX, y: e.clientY } : e.currentTarget.getBoundingClientRect(), e.button !== 2);
      }}
    >
      <span className={s.grip} draggable onDragStart={onDragStart} onDragEnd={p.onDragEnd} aria-hidden="true">
        <Icon name="drag_indicator" size={16} />
      </span>
      <div className={s.ident}>
        <Tooltip content={name} overflowOnly>
          <span className={s.name}>{name}</span>
        </Tooltip>
        <span className={cx('lbl', s.meta)}>
          {material} · {plural(steps.length, 'step')}
        </span>
        {edited > 0 && <span className={cx('lbl', s.meta, s.editedCount)}>{edited} edited by hand</span>}
        {baseless && (
          <Button size="xs" icon="restart_alt" onClick={() => doc.transact(`Rebuild ${name}`, (x) => regen(x, r.id))} tooltip="Another tool removed this ramp's base. Rebuild makes it again from the ramp's own colour." className={s.make}>
            Rebuild base
          </Button>
        )}
        {broken.size > 0 && (
          <Tooltip content="A step is as light as, or lighter than, the one before it. Lightness should fall from highlight to deep shadow; a hand edit, or a base moved past one, breaks it.">
            <span className={s.broken}>
              <Icon name="error" size={14} />
              Value breaks
            </span>
          </Tooltip>
        )}
      </div>
      {p.armed ? (
        <div className={s.confirm}>
          <ConfirmInline
            icon="delete"
            title={`Delete the ${name} ramp?`}
            detail={`${plural(steps.length, 'swatch', 'swatches')}. Undo brings ${steps.length === 1 ? 'it' : 'them'} back.`}
            confirmLabel="Delete"
            danger
            onConfirm={() => deleteRamp(doc, r.id)}
            onKeep={() => {
              armed.set(null);
              focusStep(p.sel?.id);
            }}
          />
        </div>
      ) : (
        <Steps d={d} list={steps} place={(w) => w.step! - p.lo + 1} cols={p.cols} surround={p.surround} sel={p.sel} lit={p.lit} broken={broken} />
      )}
      <div className={s.acts}>
        <IconButton
          icon="star"
          label={r.hero ? 'Hero colour: the other ramps stay quieter. Click to end it' : 'Make this the hero colour'}
          size="sm"
          latched={r.hero}
          onClick={() => doc.transact(r.hero ? `End ${name} as hero` : `Make ${name} the hero`, (x) => setSpec(x, r.id, { hero: !r.hero }))}
        />
        <IconButton icon="more_horiz" label="More" size="sm" onClick={(e) => openMenu(e.currentTarget.getBoundingClientRect(), e.detail === 0)} />
      </div>
    </div>
  );
}

async function copyHexes(name: string, steps: Swatch[]): Promise<void> {
  const text = steps.map((w) => toHex(w.oklch).toUpperCase()).join('\n');
  await navigator.clipboard.writeText(text).then(
    () => toast.show({ icon: 'content_copy', message: `Copied ${name}'s ${plural(steps.length, 'hex code')}.` }),
    () => toast.show({ kind: 'error', message: "Couldn't copy to the clipboard." }),
  );
}

type StepsProps = {
  d: IllustrationDoc;
  list: Swatch[];
  /** the 1-based column each swatch sits in */
  place(w: Swatch, i: number): number;
  cols: number;
  surround: string;
  sel: Swatch | null;
  lit: string[];
  broken?: Set<string>;
};

/** Colours on the surround, each over its value in greyscale, with its lightness below. */
function Steps({ d, list, place, cols, surround, sel, lit, broken }: StepsProps) {
  const onKeyDown = (w: Swatch) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    select(w.id);
  };
  return (
    <div className={s.steps}>
      <div className={s.mat} style={{ ...cells(cols), background: surround }}>
        {list.map((w, i) => {
          // a step named by hand still says where it sits
          const word = w.name.trim() ? wordOf(d, w) : null;
          const label = `${nameOf(d, w)}${word ? ` · ${word}` : ''} · L ${fmtL(w.oklch[0])}${w.edited ? ' · edited by hand' : ''}`;
          return (
            <Tooltip key={w.id} content={label}>
              <button
                type="button"
                role="option"
                aria-selected={sel?.id === w.id}
                aria-label={`${nameOf(d, w)}, ${toHex(w.oklch)}${w.edited ? ', edited' : ''}`}
                data-step={w.id}
                tabIndex={sel?.id === w.id ? 0 : -1}
                className={cx(s.step, sel?.id === w.id && s.sel, lit.includes(w.id) && s.hot, w.edited && s.edited, broken?.has(w.id) && s.broken)}
                style={{ gridColumn: place(w, i) }}
                onClick={(e) => {
                  select(w.id);
                  e.currentTarget.focus();
                }}
                onKeyDown={onKeyDown(w)}
              >
                <i className={s.colour} style={{ background: cssColor(w.oklch) }} />
                <i className={s.value} style={{ background: cssColor([w.oklch[0], 0, 0]) }} />
              </button>
            </Tooltip>
          );
        })}
      </div>
      <div className={s.nums} style={cells(cols)} aria-hidden="true">
        {list.map((w, i) => (
          <span key={w.id} className={cx(w.step === 0 && s.base, sel?.id === w.id && s.selNum)} style={{ gridColumn: place(w, i) }}>
            {fmtL(w.oklch[0])}
          </span>
        ))}
      </div>
    </div>
  );
}

type LooseProps = { doc: Doc; d: IllustrationDoc; list: Swatch[]; cols: number; surround: string; sel: Swatch | null; lit: string[]; armed: string | null };

/** colours in no ramp (a flat palette opened here): each can become a ramp, or go */
export function LooseRow({ doc, d, list, cols, surround, sel, lit, armed: armedId }: LooseProps) {
  const n = Math.max(cols, list.length);
  const mine = list.find((w) => w.id === sel?.id) ?? null;
  const gone = list.find((w) => w.id === armedId);
  const openMenu = (at: MenuAnchor, fromKey: boolean, w = mine ?? list[0]) => {
    if (w !== mine) select(w.id);
    const name = nameOf(d, w);
    menu.open(
      at,
      [
        { label: `Make a ramp from ${name}`, icon: 'auto_awesome_motion', onSelect: () => rampsFromLoose(doc, [w.id]) },
        { label: `Make ramps from all ${list.length}`, icon: 'auto_awesome_motion', disabled: list.length < 2, onSelect: () => rampsFromLoose(doc) },
        'separator',
        { label: `Delete ${name}`, icon: 'delete', shortcut: 'Delete', danger: true, onSelect: () => arm(doc, w.id) },
      ],
      { initial: fromKey ? 0 : undefined },
    );
  };
  return (
    <div
      role="group"
      aria-label="Colours in no ramp"
      className={cx(s.row, s.loose, mine && s.on)}
      data-row={mine?.id ?? list[0].id}
      onContextMenu={(e) => {
        if ((e.target as Element).closest('[role="alertdialog"]')) return;
        e.preventDefault();
        const w = list.find((x) => x.id === (e.target as Element).closest<HTMLElement>('[data-step]')?.dataset.step);
        openMenu(e.button === 2 ? { x: e.clientX, y: e.clientY } : e.currentTarget.getBoundingClientRect(), e.button !== 2, w);
      }}
    >
      <span />
      <div className={s.ident}>
        <span className={s.name}>Not in a ramp</span>
        <span className={cx('lbl', s.meta)}>{plural(list.length, 'colour')}</span>
        <Button size="xs" icon="auto_awesome_motion" onClick={() => rampsFromLoose(doc)} tooltip="Each colour becomes the base of a ramp" className={s.make}>
          Make ramps
        </Button>
      </div>
      {gone ? (
        <div className={s.confirm}>
          <ConfirmInline
            icon="delete"
            title={`Delete ${nameOf(d, gone)}?`}
            detail="A colour in no ramp. Undo brings it back."
            confirmLabel="Delete"
            danger
            onConfirm={() => deleteLoose(doc, gone.id)}
            onKeep={() => {
              armed.set(null);
              focusStep(sel?.id);
            }}
          />
        </div>
      ) : (
        <Steps d={d} list={list} place={(_, i) => i + 1} cols={n} surround={surround} sel={sel} lit={lit} />
      )}
      <div className={s.acts}>
        <IconButton icon="more_horiz" label="More" size="sm" onClick={(e) => openMenu(e.currentTarget.getBoundingClientRect(), e.detail === 0)} />
      </div>
    </div>
  );
}

/** proposals (plan unit V): colours offered as new bases, never in the palette until added */
export function GhostRow({ label, items, cols, surround, onAdd, footer }: { label: string; items: Proposal[]; cols: number; surround: string; onAdd(p: Proposal): void; footer: ReactNode }) {
  return (
    <div role="group" aria-label={`Proposed: ${label}`} className={cx(s.row, s.ghostRow)} data-ghost-row="">
      <span />
      <div className={s.ident}>
        <span className={cx(s.name, s.dim)}>Proposed</span>
        <span className={cx('lbl', s.meta)}>Click one to add it</span>
      </div>
      <div className={s.steps}>
        <div className={s.mat} style={{ ...cells(Math.max(cols, items.length)), background: surround }}>
          {items.map((it) => (
            <Tooltip key={it.id} content={`Add ${toHex(it.oklch).toUpperCase()} as a base colour`}>
              <button type="button" className={cx(s.step, s.ghost)} data-ghost={it.id} aria-label={`Add ${toHex(it.oklch)} as a base colour`} onClick={() => onAdd(it)}>
                <i className={s.colour} style={{ background: cssColor(it.oklch) }} />
              </button>
            </Tooltip>
          ))}
        </div>
        <div className={s.ghostFoot}>{footer}</div>
      </div>
      <span />
    </div>
  );
}
