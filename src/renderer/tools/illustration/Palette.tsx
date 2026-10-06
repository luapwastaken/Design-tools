// The Palette panel (left, every mode): the scene light, Add colour, one item per ramp as a chip strip, reorder by dragging,
// the hero star; colours in no ramp; and proposed colours in periwinkle.
// Selection here is the selection everywhere: it carries across the modes.
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { cssColor, toHex } from '../../../shared/color/index.ts';
import { greyOf, valueOf } from '../../../shared/color/value.ts';
import { MATERIALS } from '../../../shared/palette/ramp.ts';
import type { RampSpec, Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Button, ConfirmInline, Icon, IconButton, menu, toast, Tooltip, type MenuAnchor } from '../../ui/index.ts';
import { fmtV, plural } from '../common/names.ts';
import { GreyscaleButton } from '../common/Greyscale.tsx';
import { Section } from '../common/Section.tsx';
import { addProposals, arm, deleteLoose, deleteRamp, duplicate, focusStep, move, rampsFromLoose, reorder, select, selected, type Doc } from './actions.ts';
import { brokenSteps, looseOf, nameOf, rampName, regen, revertRamp, setSpec, stepsOf, wordOf, type IllustrationDoc } from './doc.ts';
import { AddColour } from './AddColour.tsx';
import { LightRow } from './LightRow.tsx';
import { openSource } from './starts.ts';
import { Start } from './Start.tsx';
import { clearProposals, proposals, sourcePop } from './proposals.ts';
import { addToWell, paintSettings } from './paint-sources.ts';
import { armed, clicked, getView, hot, patchView, type IllustrationView } from './view-state.ts';
import s from './Palette.module.css';

/** internal reorders carry this type (foundation spec §9), so OS files dropped here still go to onFiles */
export const REORDER_MIME = 'application/x-designtools-reorder';

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** a step chip clicked in Paint with Shift joins the well, as a tray chip's Shift-click did */
function toWell(id: string): void {
  const cur = paintSettings(getView().canvas);
  const well = addToWell(cur.well, `swatch:${id}`);
  if (well) patchView({ canvas: { ...cur, well } });
  else toast.show({ icon: 'palette', message: 'The well holds 4 paints. Take one out to add another.' });
}

export function Palette({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const ghosts = proposals.use();
  const lit = hot.use();
  const armedId = armed.use();
  const sel = selected(d, v.selected);
  const [drag, setDrag] = useState<{ id: string; at: number | null } | null>(null);
  const loose = looseOf(d);
  // the confirm belongs to the ramp (or loose colour) it was armed on
  const at = sel && d.ramps.some((r) => r.id === sel.group) ? sel.group : sel?.id;
  useEffect(() => armed.set(null), [at]);
  // a new or picked ramp may sit below the fold: bring its item into view
  useEffect(() => {
    if (at) document.querySelector(`[data-tool="illustration"] [data-row="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);
  const firstGhost = ghosts?.items[0]?.id;
  useEffect(() => {
    // while a source's popover shows them, a scroll would close it (a press or scroll outside does)
    if (firstGhost && !sourcePop.get()) document.querySelector('[data-tool="illustration"] [data-ghost-row]')?.scrollIntoView({ block: 'nearest' });
  }, [firstGhost]);

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!drag || !e.dataTransfer.types.includes(REORDER_MIME)) return; // files: the shell routes them to onFiles
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = (e.target as Element).closest<HTMLElement>('[data-index]');
    if (!row) return;
    const r = row.getBoundingClientRect();
    const next = Number(row.dataset.index) + (e.clientY > r.top + r.height / 2 ? 1 : 0);
    if (next !== drag.at) setDrag({ ...drag, at: next });
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!drag || !e.dataTransfer.types.includes(REORDER_MIME)) return;
    e.preventDefault();
    if (drag.at !== null) reorder(doc, drag.id, drag.at);
    setDrag(null);
  };
  const insertOf = (i: number): 'before' | 'after' | undefined => {
    const t = drag?.at;
    if (t === null || t === undefined) return undefined;
    if (t === i) return 'before';
    return t === d.ramps.length && i === d.ramps.length - 1 ? 'after' : undefined;
  };

  return (
    <Section
      title="Ramps"
      sub={d.ramps.length ? String(d.ramps.length) : undefined}
      className={s.palette}
      bodyClassName={s.pbody}
      actions={d.swatches.length > 0 ? <GreyscaleButton /> : undefined}
    >
      <LightRow doc={doc} d={d} v={v} />
      <AddColour doc={doc} d={d} />
      <div
        role="listbox"
        aria-label="Ramps"
        className={s.list}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragLeave={(e) => drag && !e.currentTarget.contains(e.relatedTarget as Node) && setDrag({ ...drag, at: null })}
        onKeyDown={(e: KeyboardEvent) => {
          // on a step, up and down go to the next ramp as well (left and right also work from anywhere: the tool's shortcuts)
          const by = ARROWS[e.key];
          if (!by || !(e.target as Element).closest('[data-step]')) return;
          e.preventDefault();
          move(doc, by[0], by[1]);
        }}
      >
        {!d.swatches.length && <Start doc={doc} />}
        {d.ramps.map((r, i) => (
          <RampItem
            key={r.id}
            doc={doc}
            d={d}
            v={v}
            r={r}
            index={i}
            sel={sel}
            lit={lit}
            armed={armedId === r.id}
            dragging={drag?.id === r.id}
            insert={insertOf(i)}
            onDragStart={() => setDrag({ id: r.id, at: null })}
            onDragEnd={() => setDrag(null)}
          />
        ))}
        {loose.length > 0 && <LooseItem doc={doc} d={d} v={v} list={loose} sel={sel} lit={lit} armed={armedId} />}
        {ghosts && (
          <section className={s.ghosts} aria-label={`Proposed: ${ghosts.label}`} data-ghost-row="">
            <h3 className={s.ghostHead}>
              <Icon name="wand_stars" size={14} />
              {ghosts.label}
            </h3>
            <div className={s.ghostChips}>
              {ghosts.items.map((it) => (
                <Tooltip key={it.id} content={`Add ${toHex(it.oklch).toUpperCase()} as a ramp`}>
                  <button type="button" className={s.ghost} data-ghost={it.id} aria-label={`Add ${toHex(it.oklch)} as a ramp`} onClick={() => addProposals(doc, [it])}>
                    <i data-colour style={{ background: cssColor(it.oklch) }} />
                  </button>
                </Tooltip>
              ))}
            </div>
            <p className={s.fine}>Click one to make its ramp. Colours you pick on the paint canvas land here too.</p>
            <div className={s.ghostFoot}>
              <Button size="xs" icon="add" onClick={() => addProposals(doc, ghosts.items)}>
                Add all
              </Button>
              <Button size="xs" variant="ghost" onClick={clearProposals}>
                Clear
              </Button>
            </div>
          </section>
        )}
      </div>
      <button type="button" className={s.drop} onClick={() => openSource(doc, 'image')}>
        <Icon name="add_photo_alternate" size={16} />
        <span>Drop an image anywhere to pick colours from it.</span>
      </button>
    </Section>
  );
}

type ItemProps = {
  doc: Doc;
  d: IllustrationDoc;
  v: IllustrationView;
  r: RampSpec;
  index: number;
  sel: Swatch | null;
  lit: string[];
  armed: boolean;
  dragging: boolean;
  insert: 'before' | 'after' | undefined;
  onDragStart(): void;
  onDragEnd(): void;
};

/** One ramp: name, material, hero star and its menu; the chips under them (taller while selected). */
function RampItem(p: ItemProps) {
  const { doc, d, r } = p;
  const steps = stepsOf(d, r.id);
  const name = rampName(d, r);
  const broken = new Set(brokenSteps(steps));
  const edited = steps.filter((w) => w.edited).length;
  const material = MATERIALS.find((m) => m.id === r.material)?.label ?? r.material;
  const on = p.sel?.group === r.id;
  const baseless = !steps.some((w) => w.step === 0);
  const baseId = steps.find((w) => w.step === 0)?.id ?? steps[0]?.id ?? null;

  const openMenu = (at: MenuAnchor, fromKey: boolean) => {
    // the menu's shortcuts act on the selected ramp: make it this one
    if (!on) select(baseId);
    const i = d.ramps.indexOf(r);
    menu.open(
      at,
      [
        { label: r.hero ? 'End as hero colour' : 'Make hero colour', icon: 'star', shortcut: 'H', onSelect: () => doc.transact(r.hero ? `End ${name} as hero` : `Make ${name} the hero`, (x) => setSpec(x, r.id, { hero: !r.hero })) },
        { label: 'Duplicate ramp', icon: 'content_copy', shortcut: 'Ctrl+D', onSelect: () => duplicate(doc, r.id) },
        { label: 'Move up', icon: 'arrow_upward', disabled: i === 0, onSelect: () => reorder(doc, r.id, i - 1) },
        { label: 'Move down', icon: 'arrow_downward', disabled: i === d.ramps.length - 1, onSelect: () => reorder(doc, r.id, i + 2) },
        { label: edited ? `Back to generated (${plural(edited, 'edited step')})` : 'Back to generated', icon: 'restart_alt', disabled: !edited, onSelect: () => doc.transact(`Regenerate ${name}`, (x) => revertRamp(x, r.id)) },
        { label: 'Copy hex codes', onSelect: () => void copyHexes(name, steps) },
        // another tool removed the base: the ramp still knows its colour and can make it again
        { label: 'Rebuild base', icon: 'restart_alt', disabled: !baseless, onSelect: () => doc.transact(`Rebuild ${name}`, (x) => regen(x, r.id)) },
        'separator',
        { label: 'Delete ramp', icon: 'delete', shortcut: 'Delete', danger: true, onSelect: () => arm(doc, r.id) },
      ],
      { initial: fromKey ? 0 : undefined },
    );
  };

  const onDragStart = (e: DragEvent<HTMLElement>) => {
    const row = e.currentTarget.closest('[data-index]');
    if (row) e.dataTransfer.setDragImage(row, 12, 16);
    e.dataTransfer.setData(REORDER_MIME, r.id);
    e.dataTransfer.effectAllowed = 'move';
    p.onDragStart();
  };

  return (
    <div
      role="group"
      aria-label={`${name} ramp`}
      className={cx(s.item, on && s.on, p.dragging && s.dragging)}
      data-row={r.id}
      data-index={p.index}
      data-insert={p.insert}
      onContextMenu={(e) => {
        if ((e.target as Element).closest('[role="alertdialog"]')) return;
        e.preventDefault();
        openMenu(e.button === 2 ? { x: e.clientX, y: e.clientY } : e.currentTarget.getBoundingClientRect(), e.button !== 2);
      }}
    >
      <div className={s.top} draggable onDragStart={onDragStart} onDragEnd={p.onDragEnd}>
        <Tooltip content={name} overflowOnly>
          <button type="button" className={s.name} onClick={() => select(baseId)}>
            {name}
          </button>
        </Tooltip>
        <Tooltip content={edited ? `${plural(edited, 'step')} edited by hand: the ramp leaves ${edited === 1 ? 'it' : 'them'} when it changes` : ''} disabled={!edited}>
          <span className={s.meta}>
            {material} · {plural(steps.length, 'step')}
            {edited > 0 && <span className={s.editedCount}> · {edited} edited</span>}
          </span>
        </Tooltip>
        {broken.size > 0 && (
          <Tooltip content="A step is as light as, or lighter than, the one before it. Value should fall from highlight to deep shadow; a hand edit, or a base moved past one, breaks it.">
            <span className={s.broken}>
              <Icon name="error" size={14} />
              Value breaks
            </span>
          </Tooltip>
        )}
        <span className={s.grow} />
        <IconButton
          icon="star"
          label={r.hero ? 'Hero colour: the other ramps stay quieter. Click to end it' : 'Make this the hero colour'}
          size="xs"
          latched={r.hero}
          onClick={() => doc.transact(r.hero ? `End ${name} as hero` : `Make ${name} the hero`, (x) => setSpec(x, r.id, { hero: !r.hero }))}
        />
        <IconButton icon="more_horiz" label="More" size="xs" onClick={(e) => openMenu(e.currentTarget.getBoundingClientRect(), e.detail === 0)} />
      </div>
      {p.armed ? (
        <div className={s.confirm}>
          <ConfirmInline
            compact
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
        <Chips doc={doc} d={d} v={p.v} list={steps} sel={p.sel} lit={p.lit} broken={broken} tall={on} />
      )}
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

type ChipsProps = { doc: Doc; d: IllustrationDoc; v: IllustrationView; list: Swatch[]; sel: Swatch | null; lit: string[]; broken?: Set<string>; tall: boolean };

/** a step dragged from here lands in the Paint tab's well (pointer drag, the tray's own way); the click that ends a drag is not a click */
const SLOP = 4;
function useChipDrag() {
  const drag = useRef<{ id: string; x: number; y: number; moving: boolean } | null>(null);
  const dragged = useRef(false);
  const ghost = useRef<HTMLSpanElement>(null);
  const end = (drop: boolean, e?: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (ghost.current) ghost.current.hidden = true;
    dragged.current = d.moving;
    if (!drop || !d.moving || !e) return;
    const r = document.querySelector('[data-tool="illustration"] [role="group"][aria-label="Mixing well"]')?.getBoundingClientRect();
    if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) toWell(d.id);
  };
  const props = (w: Swatch, colour: string) => ({
    onPointerDown(e: PointerEvent<HTMLButtonElement>) {
      if (e.button !== 0 || getView().tab !== 'paint') return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragged.current = false;
      drag.current = { id: w.id, x: e.clientX, y: e.clientY, moving: false };
      if (ghost.current) ghost.current.style.background = colour;
    },
    onPointerMove(e: PointerEvent<HTMLButtonElement>) {
      const d = drag.current;
      if (!d || (!d.moving && Math.hypot(e.clientX - d.x, e.clientY - d.y) < SLOP)) return;
      d.moving = true;
      const g = ghost.current!;
      g.hidden = false;
      g.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => end(true, e),
    onLostPointerCapture: () => end(false),
  });
  const wasDragged = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };
  return { props, ghost, wasDragged };
}

/** the steps as chips on one line, each over its value in greyscale: the neutral ring marks the selected one, clear of its colour */
function Chips({ d, v, list, sel, lit, broken, tall }: ChipsProps) {
  const dnd = useChipDrag();
  const onKeyDown = (w: Swatch) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    select(w.id);
    clicked.set({ id: w.id, at: performance.now() });
  };
  return (
    <div className={cx(s.chips, tall && s.tall)}>
      {list.map((w) => {
        const word = w.name.trim() ? wordOf(d, w) : null;
        const label = `${nameOf(d, w)}${word ? ` · ${word}` : ''} · V ${fmtV(w.oklch)}${w.edited ? ' · edited by hand' : ''}`;
        return (
          <Tooltip key={w.id} content={label}>
            <button
              type="button"
              role="option"
              aria-selected={sel?.id === w.id}
              aria-label={`${nameOf(d, w)}, ${toHex(w.oklch)}${w.edited ? ', edited' : ''}`}
              data-step={w.id}
              tabIndex={sel?.id === w.id ? 0 : -1}
              className={cx(s.chip, sel?.id === w.id && s.sel, lit.includes(w.id) && s.hot, w.edited && s.edited, broken?.has(w.id) && s.broken, w.step === 0 && s.base)}
              {...dnd.props(w, cssColor(w.oklch))}
              onClick={(e) => {
                if (dnd.wasDragged()) return;
                select(w.id);
                if (v.tab === 'paint' && e.shiftKey) toWell(w.id);
                else clicked.set({ id: w.id, at: performance.now() });
                e.currentTarget.focus();
              }}
              onKeyDown={onKeyDown(w)}
            >
              <i className={s.colour} data-colour style={{ background: cssColor(w.oklch) }} />
              <i className={s.value} style={{ background: cssColor(greyOf(valueOf(w.oklch))) }} />
            </button>
          </Tooltip>
        );
      })}
      <span ref={dnd.ghost} className={s.ghostDrag} data-colour hidden aria-hidden="true" />
    </div>
  );
}

type LooseProps = { doc: Doc; d: IllustrationDoc; v: IllustrationView; list: Swatch[]; sel: Swatch | null; lit: string[]; armed: string | null };

/** colours in no ramp (a flat palette opened here): each can become a ramp, or go */
function LooseItem({ doc, d, v, list, sel, lit, armed: armedId }: LooseProps) {
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
      className={cx(s.item, s.loose, mine && s.on)}
      data-row={mine?.id ?? list[0].id}
      onContextMenu={(e) => {
        if ((e.target as Element).closest('[role="alertdialog"]')) return;
        e.preventDefault();
        const w = list.find((x) => x.id === (e.target as Element).closest<HTMLElement>('[data-step]')?.dataset.step);
        openMenu(e.button === 2 ? { x: e.clientX, y: e.clientY } : e.currentTarget.getBoundingClientRect(), e.button !== 2, w);
      }}
    >
      <div className={s.top}>
        <span className={s.name}>Loose</span>
        <span className={s.meta}>{plural(list.length, 'colour')}</span>
        <span className={s.grow} />
        <Button size="xs" icon="auto_awesome_motion" onClick={() => rampsFromLoose(doc)} tooltip="Each colour becomes the base of a ramp">
          Make ramps
        </Button>
        <IconButton icon="more_horiz" label="More" size="xs" onClick={(e) => openMenu(e.currentTarget.getBoundingClientRect(), e.detail === 0)} />
      </div>
      {gone ? (
        <div className={s.confirm}>
          <ConfirmInline
            compact
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
        <Chips doc={doc} d={d} v={v} list={list} sel={sel} lit={lit} tall={!!mine} />
      )}
    </div>
  );
}
