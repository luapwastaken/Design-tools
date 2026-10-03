import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cmykEstimate, cssColor, inSrgb, rgb255, toHex, type Oklch } from '../../../shared/color/index.ts';
import type { Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Button, Icon, IconButton, Tooltip } from '../../ui/index.ts';
import { fmtC, fmtH, fmtL } from '../common/names.ts';
import { displayName } from './doc.ts';
import type { Proposal } from './proposals.ts';
import s from './SwatchChip.module.css';

function Readouts({ oklch, full }: { oklch: Oklch; full: boolean }) {
  const out = !inSrgb(oklch);
  return (
    <>
      {/* each part carries its separator, so a narrow chip wraps between them */}
      <span className={s.data}>
        <span className={s.part}>
          <span className={s.hex}>{toHex(oklch).toUpperCase()}</span>
          {out && (
            <Tooltip content="Outside sRGB: the hex is the nearest colour a screen shows">
              <span className={s.gamut}>
                <Icon name="warning" size={14} />
              </span>
            </Tooltip>
          )}
          ·
        </span>
        <span>L {fmtL(oklch[0])} ·</span>
        <span>{fmtC(oklch[1])} ·</span>
        <span>{fmtH(oklch[2])}</span>
      </span>
      {full && (
        <>
          <span className={s.data}>
            <b>RGB</b> {rgb255(oklch).join(' ')}
          </span>
          <span className={s.data}>
            <b>≈CMYK</b> {cmykEstimate(oklch).join(' ')}
          </span>
        </>
      )}
    </>
  );
}

type ChipProps = {
  swatch: Swatch;
  /** its name as the palette shows it (a blank one filled in) */
  name: string;
  index: number;
  full: boolean;
  selected: boolean;
  anchor: boolean;
  hot: boolean;
  dragging: boolean;
  insert: 'before' | 'after' | undefined;
  focusable: boolean;
  onSelect(e: MouseEvent): void;
  onMenu(at: DOMRect | { x: number; y: number }, fromKey: boolean): void;
  onDragStart(e: DragEvent): void;
  onDragEnd(): void;
  /** the armed Delete confirm: the chip's data rows turn into it (brief §6) */
  confirm?: ReactNode;
};

/** One swatch: its colour, then role, name, Hex and L C H on the card; the Table view adds RGB and ≈CMYK. */
export function SwatchChip(p: ChipProps) {
  const { swatch: w } = p;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    p.onSelect(e as unknown as MouseEvent);
  };
  return (
    <div
      role="option"
      aria-selected={p.selected}
      aria-label={`${p.name}, ${toHex(w.oklch)}${w.role ? `, ${w.role}` : ''}`}
      data-swatch={w.id}
      data-index={p.index}
      data-insert={p.insert}
      tabIndex={p.focusable ? 0 : -1}
      draggable={!p.confirm}
      className={cx(s.chip, p.selected && s.sel, p.anchor && s.anchor, p.hot && s.hot, p.dragging && s.dragging)}
      onClick={p.onSelect}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault();
        // the ContextMenu key and Shift+F10 fire this with button -1
        if (e.button === 2) p.onMenu({ x: e.clientX, y: e.clientY }, false);
        else p.onMenu(e.currentTarget.getBoundingClientRect(), true);
      }}
      onDragStart={p.onDragStart}
      onDragEnd={p.onDragEnd}
    >
      <div className={s.field} style={{ background: cssColor(w.oklch) }}>
        <Tooltip content="Drag to reorder. Ctrl or Shift click to select several.">
          <span className={s.grip}>
            <Icon name="drag_indicator" size={16} />
          </span>
        </Tooltip>
      </div>
      {p.confirm ? (
        // its clicks are the confirm's, not a selection
        <div className={s.confirm} onClick={(e) => e.stopPropagation()}>
          {p.confirm}
        </div>
      ) : (
        <div className={s.meta}>
          <Tooltip content={w.role ?? ''} overflowOnly>
            <span className={cx('lbl', s.role, !w.role && s.unlit)}>{w.role ?? 'No role'}</span>
          </Tooltip>
          <Tooltip content={p.name} overflowOnly>
            <span className={cx(s.name, !w.name.trim() && s.auto)}>{p.name}</span>
          </Tooltip>
          <Readouts oklch={w.oklch} full={p.full} />
          <span className={s.more} onClick={(e) => e.stopPropagation()}>
            <IconButton icon="more_horiz" label="More" size="xs" tabIndex={-1} onClick={(e) => p.onMenu(e.currentTarget.getBoundingClientRect(), e.detail === 0)} />
          </span>
        </div>
      )}
    </div>
  );
}

/** A Build proposal at the end of the row: never in the document until added. */
export function GhostChip({ p, full, lockable, onAdd, onLock }: { p: Proposal; full: boolean; lockable: boolean; onAdd(): void; onLock(): void }) {
  const name = p.name ?? displayName({ name: '', oklch: p.oklch });
  return (
    <div className={cx(s.chip, s.ghost)} data-ghost={p.id}>
      <button type="button" className={s.add} aria-label={`Add ${name}`} onClick={onAdd}>
        <span className={s.field} style={{ background: cssColor(p.oklch) }} />
        <span className={s.meta}>
          <span className="lbl">Proposed</span>
          <span className={cx(s.name, s.auto)}>{name}</span>
          <Readouts oklch={p.oklch} full={full} />
        </span>
      </button>
      <span className={s.acts}>
        <Button size="xs" variant="ghost" icon="add" tabIndex={-1} onClick={onAdd}>
          Add
        </Button>
        {lockable && (
          <Button size="xs" variant="ghost" icon={p.locked ? 'lock' : 'lock_open'} onClick={onLock} tooltip={p.locked ? 'Unlock: a reroll changes it' : 'Lock: a reroll keeps it'}>
            {p.locked ? 'Locked' : 'Lock'}
          </Button>
        )}
      </span>
    </div>
  );
}
