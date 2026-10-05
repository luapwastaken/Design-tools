// One column of the artboard: a swatch drawn as a full-height field of its colour, its facts at the
// foot in the ink that reads on it. Everything around the colour is neutral (brief 4).
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { cmykEstimate, cssColor, inSrgb, rgb255, toHex, type Oklch } from '../../../shared/color/index.ts';
import type { Swatch } from '../../../shared/types.ts';
import { cx } from '../../ui/cx.ts';
import { Button, Icon, Tooltip } from '../../ui/index.ts';
import type { IconName } from '../../shell/tool.ts';
import { inkOn, type Badge } from './artboard.ts';
import { displayName } from './doc.ts';
import type { Proposal } from './proposals.ts';
import s from './Column.module.css';

const lch = (o: Oklch) => `L ${Math.round(o[0] * 100)}  C ${o[1].toFixed(2)}  H ${Math.round(o[2]) % 360}`;

/** the colour, its ink, and the soft ink the secondary lines take */
const paint = (shown: Oklch): CSSProperties => ({ '--c': cssColor(shown), '--ink-c': inkOn(shown) }) as CSSProperties;

function Readouts({ oklch, full }: { oklch: Oklch; full: boolean }) {
  return (
    <>
      <span className={s.hex}>
        {toHex(oklch).toUpperCase()}
        {!inSrgb(oklch) && (
          <Tooltip content="Outside sRGB: the hex is the nearest colour a screen shows">
            <span className={s.gamut}>
              <Icon name="warning" size={14} />
            </span>
          </Tooltip>
        )}
      </span>
      <span className={s.lch}>{lch(oklch)}</span>
      {full && (
        <>
          <span className={s.lch}>RGB {rgb255(oklch).join(' ')}</span>
          <span className={s.lch}>{`≈CMYK ${cmykEstimate(oklch).join(' ')}`}</span>
        </>
      )}
    </>
  );
}

/** A plate on the colour, in the on-content tokens, so it reads on a near-white column too */
function Plate({ icon, label, shortcut, onClick, on, danger }: { icon: IconName; label: string; shortcut?: string; onClick(e: MouseEvent<HTMLButtonElement>): void; on?: boolean; danger?: boolean }) {
  return (
    <Tooltip content={label} shortcut={shortcut} side="right">
      <button type="button" className={cx(s.plate, on && s.on, danger && s.danger)} aria-label={label} aria-pressed={on} tabIndex={-1} onClick={(e) => (e.stopPropagation(), onClick(e))}>
        <Icon name={icon} size={16} fill={on} />
      </button>
    </Tooltip>
  );
}

export type ColumnProps = {
  swatch: Swatch;
  /** its name as the palette shows it (a blank one filled in) */
  name: string;
  /** the colour on screen: the swatch's own, or what Simulate shows */
  shown: Oklch;
  index: number;
  full: boolean;
  selected: boolean;
  anchor: boolean;
  hot: boolean;
  locked: boolean;
  dragging: boolean;
  insert: 'before' | 'after' | undefined;
  focusable: boolean;
  badge: Badge | null;
  onSelect(e: MouseEvent): void;
  onMenu(at: DOMRect | { x: number; y: number }, fromKey: boolean): void;
  onDragStart(e: DragEvent): void;
  onDragEnd(): void;
  onRole(anchor: HTMLElement): void;
  onLock(): void;
  onCopy(): void;
  onDelete(): void;
  onRename(name: string): void;
  /** the "+" on the seam after this column (not on the last) */
  seam?: ReactNode;
};

export function Column(p: ColumnProps) {
  const { swatch: w } = p;
  const [renaming, setRenaming] = useState(false);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.key !== 'Enter') return;
    e.preventDefault();
    setRenaming(true);
  };
  return (
    <div
      role="option"
      aria-selected={p.selected}
      aria-label={`${p.name}, ${toHex(w.oklch)}${w.role ? `, ${w.role}` : ''}${p.locked ? ', locked' : ''}`}
      data-swatch={w.id}
      data-index={p.index}
      data-insert={p.insert}
      tabIndex={p.focusable ? 0 : -1}
      draggable={!renaming}
      className={cx(s.col, p.selected && s.sel, p.anchor && s.anchor, p.hot && s.hot, p.dragging && s.dragging, p.locked && s.locked)}
      style={paint(p.shown)}
      onClick={(e) => {
        p.onSelect(e);
        e.currentTarget.focus();
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        setRenaming(true);
      }}
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
      <div className={s.top}>
        <button
          type="button"
          className={cx(s.role, !w.role && s.none)}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            p.onRole(e.currentTarget);
          }}
        >
          {w.role ?? '+ Role'}
        </button>
        <div className={s.stack}>
          <Plate icon={p.locked ? 'lock' : 'lock_open'} label={p.locked ? 'Unlock' : 'Lock: a re-roll and Delete leave it'} shortcut="L" on={p.locked} onClick={p.onLock} />
          <Plate icon="content_copy" label="Copy hex" shortcut="C" onClick={p.onCopy} />
          <Tooltip content="Drag to reorder" side="right">
            <span className={s.plate} aria-hidden="true">
              <Icon name="drag_indicator" size={16} />
            </span>
          </Tooltip>
          <Plate icon="delete" label="Delete" shortcut="Delete" danger onClick={p.onDelete} />
        </div>
      </div>
      <div className={s.foot}>
        {renaming ? (
          <Rename value={w.name} placeholder={p.name} onDone={(t) => (setRenaming(false), t !== null && p.onRename(t))} />
        ) : (
          <Tooltip content={p.name} overflowOnly>
            <span className={cx(s.name, !w.name.trim() && s.auto)}>{p.name}</span>
          </Tooltip>
        )}
        <Readouts oklch={w.oklch} full={p.full} />
        {p.badge && <BadgeRow b={p.badge} />}
      </div>
      {p.seam}
    </div>
  );
}

function BadgeRow({ b }: { b: Badge }) {
  const name = displayName(b.other);
  return (
    <span className={s.badgeRow}>
      <b className={s.aa}>Aa</b>
      <Tooltip content={`${b.ratio.toFixed(2)}:1 on ${name}${b.guessed ? ' (set roles to choose the pair)' : ''}`}>
        <span className={cx(s.badge, !b.ok && s.fail)}>
          <Icon name={b.ok ? "check" : "priority_high"} size={14} />
          {b.ratio.toFixed(1)} {b.grade}
        </span>
      </Tooltip>
      <span className={s.onName}>on {name}</span>
    </span>
  );
}

/** the name in place (double-click or Enter): Enter or blur keeps it, Esc leaves it. `null`: unchanged. */
function Rename({ value, placeholder, onDone }: { value: string; placeholder: string; onDone(t: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => void ref.current?.select(), []);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const t = ref.current!.value.trim();
    onDone(keep && t !== value ? t : null);
  };
  return (
    <input
      ref={ref}
      type="text"
      className={s.rename}
      defaultValue={value}
      placeholder={placeholder}
      spellCheck={false}
      aria-label="Swatch name"
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
    />
  );
}

/** A proposal: a column in the machine's colour (periwinkle tag and bar), not yet in the palette. */
export function GhostColumn({ p, shown, full, lockable, onAdd, onLock }: { p: Proposal; shown: Oklch; full: boolean; lockable: boolean; onAdd(): void; onLock(): void }) {
  const name = p.name ?? displayName({ name: '', oklch: p.oklch });
  return (
    <div className={cx(s.col, s.ghost, p.locked && s.locked)} style={paint(shown)} data-ghost={p.id}>
      <div className={s.top}>
        <span className={s.proposed}>Proposed</span>
        <div className={s.stack}>
          <Plate icon="add" label={`Keep ${name}`} shortcut="A" onClick={onAdd} />
          {lockable && <Plate icon={p.locked ? 'lock' : 'lock_open'} label={p.locked ? 'Unlock: a re-roll changes it' : 'Lock: a re-roll keeps it'} shortcut="L" on={p.locked} onClick={onLock} />}
        </div>
      </div>
      <div className={s.foot}>
        <span className={cx(s.name, s.auto)}>{name}</span>
        <Readouts oklch={p.oklch} full={full} />
        <Button size="xs" icon="add" onClick={onAdd} className={s.keep}>
          Keep
        </Button>
      </div>
    </div>
  );
}
