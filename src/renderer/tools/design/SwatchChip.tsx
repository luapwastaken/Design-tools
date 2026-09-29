import type { DragEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cmykEstimate, cssColor, inSrgb, rgb255, toHex, type Oklch } from '../../../shared/color/index.ts';
import type { Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Icon, IconButton, Tooltip } from '../../ui/index.ts';
import { fmtC, fmtH, fmtL } from '../common/names.ts';
import { displayName } from './doc.ts';
import type { Proposal } from './proposals.ts';
import s from './SwatchChip.module.css';

function Readouts({ oklch, full }: { oklch: Oklch; full: boolean }) {
  const hex = toHex(oklch);
  const out = !inSrgb(oklch);
  return (
    <>
      <span className={s.hex}>
        {hex.toUpperCase()}
        {out && (
          <Tooltip content="Outside sRGB: the hex is the nearest colour a screen shows">
            <span className={s.gamut}>
              <Icon name="warning" size={14} />
            </span>
          </Tooltip>
        )}
      </span>
      <span className={s.data}>
        <span>L {fmtL(oklch[0])}</span>
        <span>C {fmtC(oklch[1])}</span>
        <span>H {fmtH(oklch[2])}</span>
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
  surround: string;
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

/** One swatch on the surround: name, role, Hex and L C H; the Table view adds RGB and ≈CMYK. */
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
      <div className={s.mat} style={{ background: p.surround }}>
        <div className={s.field} style={{ background: cssColor(w.oklch) }}>
          <Icon name="drag_indicator" size={16} className={s.grip} />
          <span className={s.corner} onClick={(e) => e.stopPropagation()}>
            <IconButton icon="more_horiz" label="More" size="xs" onContent tabIndex={-1} onClick={(e) => p.onMenu(e.currentTarget.getBoundingClientRect(), e.detail === 0)} />
          </span>
        </div>
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
        </div>
      )}
    </div>
  );
}

/** A Build proposal at the end of the row: never in the document until added. */
export function GhostChip({ p, surround, full, lockable, onAdd, onLock }: { p: Proposal; surround: string; full: boolean; lockable: boolean; onAdd(): void; onLock(): void }) {
  const name = p.name ?? displayName({ name: '', oklch: p.oklch });
  return (
    <div className={cx(s.chip, s.ghost, p.locked && s.locked)} data-ghost={p.id}>
      <button type="button" className={s.add} aria-label={`Add ${name}`} onClick={onAdd}>
        <span className={s.mat} style={{ background: surround }}>
          <span className={s.field} style={{ background: cssColor(p.oklch) }} />
        </span>
        <span className={s.meta}>
          <span className="lbl">Proposed</span>
          <span className={cx(s.name, s.auto)}>{name}</span>
          <Readouts oklch={p.oklch} full={full} />
        </span>
      </button>
      <span className={s.corner}>
        {lockable && <IconButton icon={p.locked ? 'lock' : 'lock_open'} label={p.locked ? 'Unlock: reroll changes it' : 'Lock: reroll keeps it'} size="xs" onContent latched={p.locked} onClick={onLock} />}
        <IconButton icon="add" label={`Add ${name}`} size="xs" onContent tabIndex={-1} onClick={onAdd} />
      </span>
    </div>
  );
}
