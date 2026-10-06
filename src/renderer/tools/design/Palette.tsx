// The Palette section: the colours as big swatches (name and hex under, role tag and lock badge on
// the chip). Click selects, drag reorders, "+ Add colour" last. Proposals sit in the row marked
// periwinkle with Keep and a cross each; Keep all and Discard all are in the header.
import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react';
import { cmykEstimate, cssColor, inSrgb, rgb255, toHex, type Oklch } from '../../../shared/color/index.ts';
import { ROLES } from '../../../shared/palette/roles.ts';
import type { Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Button, Icon, IconButton, menu, Select, Tooltip, type MenuAnchor, type MenuItem } from '../../ui/index.ts';
import { fmtC, fmtH, fmtL } from '../common/names.ts';
import { GreyscaleButton } from '../common/Greyscale.tsx';
import { Section } from '../common/Section.tsx';
import { SURROUNDS, surroundOf } from '../common/surround.ts';
import { addProposals, addSwatch, armDelete, clickSelect, completeNow, copyColourOf, duplicate, missingRoles, select, selection, setRole, toggleLocked, type Doc } from './actions.ts';
import { inkOn, simulated } from './artboard.ts';
import { DeleteConfirm } from './DeleteConfirm.tsx';
import { displayName, listNames, moveIds, namesOf, plural, type ChipData, type DesignDoc, type DesignView, mapSwatch } from './doc.ts';
import { Empty } from './Empty.tsx';
import type { OpenPop } from './Popovers.tsx';
import { clearProposals, proposals, toggleLock, type Proposal } from './proposals.ts';
import { armed, hot, patchView } from './view-state.ts';
import s from './Palette.module.css';

/** internal reorders carry this type (spec 9), so OS files dropped here still go to onFiles */
const REORDER_MIME = 'application/x-designtools-reorder';

const SIM_NAME = { normal: 'Normal', protan: 'Protan', deutan: 'Deutan', tritan: 'Tritan', achromat: 'Achromat' } as const;

const SURROUND_OPTIONS = SURROUNDS.map((o) => ({ value: o.value, label: o.value === 'grey' ? '18% grey' : o.label }));
const CHIP_DATA: { value: ChipData; label: string }[] = [
  { value: 'hex', label: 'Hex only' },
  { value: 'lch', label: 'Hex + L C H' },
  { value: 'table', label: 'Table: RGB, ≈CMYK' },
];

const paint = (shown: Oklch) => ({ '--c': cssColor(shown), '--ink-c': inkOn(shown) }) as React.CSSProperties;

export function PaletteSection({ doc, d, v, onPop }: { doc: Doc; d: DesignDoc; v: DesignView; onPop: OpenPop }) {
  const ghosts = proposals.use();
  const lit = hot.use();
  const isArmed = armed.use();
  const sel = selection(d, v);
  const [drag, setDrag] = useState<{ ids: string[]; at: number | null } | null>(null);
  const names = useMemo(() => namesOf(d), [d.swatches, d.ramps]);
  // the confirm belongs to the swatch it was armed on: another anchor disarms it
  useEffect(() => armed.set(false), [sel[0]]);
  // a new set of proposals lands at the end of the row, maybe past the fold: bring its first into view
  const firstGhost = ghosts?.items[0]?.id;
  useEffect(() => {
    if (firstGhost) document.querySelector(`[data-ghost="${firstGhost}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [firstGhost]);

  const roleItems = (w: Swatch): MenuItem[] => [
    ...ROLES.map((r) => {
      const owner = d.swatches.find((x) => x.role === r && x.id !== w.id);
      return { label: r, checked: w.role === r, hint: owner ? displayName(owner) : undefined, onSelect: () => setRole(doc, w.id, r) } satisfies MenuItem;
    }),
    'separator',
    { label: 'No role', checked: w.role === null, onSelect: () => setRole(doc, w.id, null) },
  ];
  const openRole = (w: Swatch, el: HTMLElement) => menu.open(el.getBoundingClientRect(), roleItems(w), { owner: el });
  const openMenu = (w: Swatch, at: MenuAnchor, fromKey: boolean) => {
    if (!sel.includes(w.id)) select([w.id]);
    menu.open(
      at,
      [
        { label: 'Duplicate', icon: 'content_copy', shortcut: 'Ctrl+D', onSelect: () => duplicate(doc) },
        { label: 'Copy colour', shortcut: 'C', onSelect: () => copyColourOf(w) },
        { label: v.locked.includes(w.id) ? 'Unlock' : 'Lock', icon: v.locked.includes(w.id) ? 'lock_open' : 'lock', shortcut: 'L', onSelect: () => toggleLocked(doc) },
        { label: 'Role', submenu: roleItems(w) },
        'separator',
        { label: sel.length > 1 && sel.includes(w.id) ? `Delete ${sel.length} swatches` : 'Delete', icon: 'delete', shortcut: 'Delete', danger: true, onSelect: () => armDelete(doc) },
      ],
      { initial: fromKey ? 0 : undefined },
    );
  };

  const onDragStart = (w: Swatch) => (e: DragEvent) => {
    const ids = sel.includes(w.id) ? d.swatches.filter((x) => sel.includes(x.id)).map((x) => x.id) : [w.id];
    e.dataTransfer.setData(REORDER_MIME, ids.join(','));
    e.dataTransfer.effectAllowed = 'move';
    setDrag({ ids, at: null });
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!drag || !e.dataTransfer.types.includes(REORDER_MIME)) return; // files: the shell routes them to onFiles
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const col = (e.target as Element).closest<HTMLElement>('[data-index]');
    if (!col) return;
    const r = col.getBoundingClientRect();
    const at = Number(col.dataset.index) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
    if (at !== drag.at) setDrag({ ...drag, at });
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!drag || !e.dataTransfer.types.includes(REORDER_MIME)) return;
    e.preventDefault();
    if (drag.at !== null) doc.transact(drag.ids.length === 1 ? 'Reorder swatch' : `Reorder ${drag.ids.length} swatches`, (x) => moveIds(x, drag.ids, drag.at!));
    setDrag(null);
  };
  const insertOf = (i: number): 'before' | 'after' | undefined => {
    const at = drag?.at;
    if (at === null || at === undefined) return undefined;
    if (at === i) return 'before';
    return at === d.swatches.length && i === d.swatches.length - 1 ? 'after' : undefined;
  };

  const empty = d.swatches.length === 0 && !ghosts;
  const locked = d.swatches.filter((w) => v.locked.includes(w.id)).length;
  const missing = missingRoles(d.swatches);
  const sub = empty ? undefined : (
    <>
      {plural(d.swatches.length, 'colour')} · click one to edit it · drag to reorder
      {sel.length > 1 && <> · {sel.length} selected</>}
      {v.sim !== 'normal' && <span className={s.sim}> · Simulating {SIM_NAME[v.sim]}</span>}
    </>
  );
  return (
    <Section
      title="Palette"
      sub={sub}
      className={s.section}
      bodyClassName={s.body}
      actions={
        <>
          {!empty && (
            <>
              <Select label="Surround" options={SURROUND_OPTIONS.map((o) => ({ ...o, swatch: surroundOf(o.value, d.swatches) }))} value={v.surround} onChange={(surround) => patchView({ surround })} className={s.ctl} />
              <Select label="Show" options={CHIP_DATA} value={v.chipData} onChange={(chipData) => patchView({ chipData })} className={s.ctl} />
              <GreyscaleButton />
            </>
          )}
          {ghosts ? (
          <>
            <span className={s.from}>
              <b>{plural(ghosts.items.length, 'colour')} proposed</b> {ghosts.label}
            </span>
            <Button size="xs" variant="primary" icon="add" shortcut="A" onClick={() => addProposals(doc, ghosts.items, true)}>
              Keep all
            </Button>
            <Button size="xs" shortcut="Escape" onClick={clearProposals}>
              Discard all
            </Button>
          </>
        ) : (
          <>
            {v.sim !== 'normal' && (
              <Button size="xs" onClick={() => patchView({ sim: 'normal' })} tooltip="Show the palette as it is again">
                Stop simulating
              </Button>
            )}
            {missing.length > 0 && (
              <Button size="xs" icon="star_shine" onClick={() => completeNow(doc)} tooltip={`Propose the missing roles, ${listNames(missing)}, made to suit the colours you have`}>
                Complete the palette: {missing.length > 3 ? `${missing.length} roles missing` : listNames(missing)}
              </Button>
            )}
            {!empty && <span className={s.hint}>{locked ? `${plural(locked, 'colour')} locked: ` : ''}Locked colours stay when you reroll</span>}
          </>
        )}
        </>
      }
    >
      <div className={s.stage} data-colour={!empty && v.surround !== 'plain' ? '' : undefined} style={empty ? undefined : { background: surroundOf(v.surround, d.swatches) }}>
      {empty ? (
        <Empty doc={doc} v={v} onPop={onPop} />
      ) : (
        <div
          role="listbox"
          aria-label="Swatches"
          aria-multiselectable="true"
          className={s.row}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragLeave={(e) => drag && !e.currentTarget.contains(e.relatedTarget as Node) && setDrag({ ...drag, at: null })}
        >
          {d.swatches.map((w, i) => (
            <Tile
              key={w.id}
              swatch={w}
              name={names.get(w.id) ?? w.name}
              shown={simulated(w.oklch, v.sim)}
              index={i}
              selected={sel.includes(w.id)}
              anchor={sel[0] === w.id}
              hot={lit.includes(w.id)}
              locked={v.locked.includes(w.id)}
              dragging={!!drag?.ids.includes(w.id)}
              data={v.chipData}
              insert={insertOf(i)}
              onSelect={(e) => clickSelect(d, w.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
              onMenu={(at, fromKey) => openMenu(w, at, fromKey)}
              onDragStart={onDragStart(w)}
              onDragEnd={() => setDrag(null)}
              onRole={(el) => (select([w.id]), openRole(w, el))}
              onLock={() => (select([w.id]), toggleLocked(doc))}
              onRename={() => document.querySelector<HTMLInputElement>('[data-design-name]')?.focus()}
            />
          ))}
          {ghosts?.items.map((p) => (
            <Ghost key={p.id} p={p} data={v.chipData} shown={simulated(p.oklch, v.sim)} lockable={ghosts.from === 'generate'} onAdd={() => addProposals(doc, [p])} onDiscard={() => dropOne(p)} onLock={() => toggleLock(p.id)} />
          ))}
          <Tooltip content="Add a colour at the value the palette lacks most">
            <button type="button" className={s.add} aria-label="Add a swatch" onClick={() => addSwatch(doc)}>
              <Icon name="add" size={20} />
              <span>Add colour</span>
            </button>
          </Tooltip>
        </div>
      )}
      </div>
      {isArmed && (
        <div className={s.confirm}>
          <DeleteConfirm doc={doc} d={d} sel={sel} />
        </div>
      )}
    </Section>
  );
}

/** one proposal off the row without keeping it (the set shrinks; the last one clears it) */
function dropOne(p: Proposal): void {
  const cur = proposals.get();
  if (!cur) return;
  const items = cur.items.filter((x) => x.id !== p.id);
  proposals.set(items.length ? { ...cur, items } : null);
}

type TileProps = {
  swatch: Swatch;
  name: string;
  shown: Oklch;
  index: number;
  selected: boolean;
  anchor: boolean;
  hot: boolean;
  locked: boolean;
  dragging: boolean;
  data: ChipData;
  insert: 'before' | 'after' | undefined;
  onSelect(e: MouseEvent): void;
  onMenu(at: DOMRect | { x: number; y: number }, fromKey: boolean): void;
  onDragStart(e: DragEvent): void;
  onDragEnd(): void;
  onRole(anchor: HTMLElement): void;
  onLock(): void;
  onRename(): void;
};

function Tile(p: TileProps) {
  const { swatch: w } = p;
  return (
    <div
      role="option"
      aria-selected={p.selected}
      aria-label={`${p.name}, ${toHex(w.oklch)}${w.role ? `, ${w.role}` : ''}${p.locked ? ', locked' : ''}`}
      data-swatch={w.id}
      data-index={p.index}
      data-insert={p.insert}
      tabIndex={p.anchor ? 0 : -1}
      draggable
      className={cx(s.sw, p.selected && s.sel, p.anchor && s.anchor, p.hot && s.hot, p.dragging && s.dragging)}
      style={paint(p.shown)}
      onClick={(e) => {
        p.onSelect(e);
        e.currentTarget.focus();
      }}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter') {
          e.preventDefault();
          p.onRename();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        // the ContextMenu key and Shift+F10 fire this with button -1
        if (e.button === 2) p.onMenu({ x: e.clientX, y: e.clientY }, false);
        else p.onMenu(e.currentTarget.getBoundingClientRect(), true);
      }}
      onDragStart={p.onDragStart}
      onDragEnd={p.onDragEnd}
    >
      <div className={s.chip} data-colour>
        <span className={s.more} onClick={(e) => e.stopPropagation()}>
          <IconButton icon="more_horiz" label="More" size="xs" onContent tabIndex={-1} onClick={(e) => p.onMenu(e.currentTarget.getBoundingClientRect(), e.detail === 0)} />
        </span>
        <button
          type="button"
          className={cx(s.tag, !w.role && s.none)}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            p.onRole(e.currentTarget);
          }}
        >
          {w.role ?? '+ Role'}
        </button>
        <Tooltip content={p.locked ? 'Unlock' : 'Lock: a re-roll and Delete leave it'} shortcut="L" side="below">
          <button
            type="button"
            className={cx(s.lock, p.locked && s.on)}
            aria-label={p.locked ? 'Unlock' : 'Lock'}
            aria-pressed={p.locked}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              p.onLock();
            }}
          >
            <Icon name={p.locked ? 'lock' : 'lock_open'} size={14} fill={p.locked} />
          </button>
        </Tooltip>
      </div>
      <Foot name={p.name} oklch={w.oklch} auto={!w.name.trim()} data={p.data} />
    </div>
  );
}

function Foot({ name, oklch, auto, data }: { name: string; oklch: Oklch; auto?: boolean; data: ChipData }) {
  return (
    <div className={s.foot}>
      <div className={s.line}>
        <Tooltip content={name} overflowOnly>
          <span className={cx(s.name, auto && s.auto)}>{name}</span>
        </Tooltip>
        <span className={s.hex}>
          {!inSrgb(oklch) && (
            <Tooltip content="Outside sRGB: the hex is the nearest colour a screen shows">
              <span className={s.gamut}>
                <Icon name="warning" size={14} />
              </span>
            </Tooltip>
          )}
          {toHex(oklch).toUpperCase()}
        </span>
      </div>
      {data !== 'hex' && (
        <span className={s.data}>
          <span>L {fmtL(oklch[0])}</span>
          <span>C {fmtC(oklch[1])}</span>
          <span>H {fmtH(oklch[2])}</span>
        </span>
      )}
      {data === 'table' && (
        <>
          <span className={s.data}>
            <b>RGB</b> {rgb255(oklch).join(' ')}
          </span>
          <span className={s.data}>
            <b>≈CMYK</b> {cmykEstimate(oklch).join(' ')}
          </span>
        </>
      )}
    </div>
  );
}

/** A proposal: a swatch in the machine's marking (periwinkle bar and tag), not in the palette yet. */
function Ghost({ p, shown, data, lockable, onAdd, onDiscard, onLock }: { p: Proposal; data: ChipData; shown: Oklch; lockable: boolean; onAdd(): void; onDiscard(): void; onLock(): void }) {
  const name = p.name ?? displayName({ name: '', oklch: p.oklch });
  return (
    <div className={cx(s.sw, s.ghost)} style={paint(shown)} data-ghost={p.id}>
      <div className={s.chip} data-colour>
        <span className={s.tags}>
          <span className={s.proposed}>Proposed</span>
          {p.role && <span className={s.proposed}>{p.role}</span>}
        </span>
        {lockable && (
          <Tooltip content={p.locked ? 'Unlock: a re-roll changes it' : 'Lock: a re-roll keeps it'} shortcut="L" side="below">
            <button type="button" className={cx(s.lock, p.locked && s.on)} aria-label={p.locked ? 'Unlock' : 'Lock'} aria-pressed={p.locked} onClick={onLock}>
              <Icon name={p.locked ? 'lock' : 'lock_open'} size={14} fill={p.locked} />
            </button>
          </Tooltip>
        )}
      </div>
      <Foot name={name} oklch={p.oklch} auto data={data} />
      <div className={s.keep}>
        <Button size="xs" variant="primary" icon="add" onClick={onAdd} tooltip={`Keep ${name}`}>
          Keep
        </Button>
        <IconButton icon="close" label={`Discard ${name}`} size="sm" onClick={onDiscard} />
      </div>
    </div>
  );
}
