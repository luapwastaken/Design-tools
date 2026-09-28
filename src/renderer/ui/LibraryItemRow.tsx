import { useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ItemKind, LibraryItemRef } from '../../shared/types.ts';
import { cx } from './cx.ts';
import { IconButton } from './IconButton.tsx';
import type { MenuAnchor, MenuOptions } from './menu.ts';
import { Tooltip } from './Tooltip.tsx';
import s from './LibraryItemRow.module.css';

const KIND: Record<ItemKind, string> = { palette: 'Palette', pattern: 'Pattern', logo: 'Logo', image: 'Image', svg: 'SVG' };

export const ITEM_MIME = 'application/x-designtools-item';

export type LibraryItemRowProps = {
  item: LibraryItemRef;
  /** 44×30 thumbnail content (SwatchStrip, an <img>); the row frames it */
  thumb: ReactNode;
  selected?: boolean;
  /** the active tool's use label when it accepts this item: INKS, AS SHAPE */
  accepted?: string;
  /** tool label when the item is open in a tool */
  openIn?: string;
  onOpen(): void;
  /** right-click, the ContextMenu key, Shift+F10 or More: pass both straight to `menu.open` */
  onMenu(at: MenuAnchor, opts: MenuOptions): void;
  onSelect?(): void;
  /** carried as application/x-designtools-item */
  dragData?: string;
  /** after the kind: swatch count, tile size */
  meta?: string;
  /** the anchor row of a multi-selection */
  anchor?: boolean;
  /**
   * extra buttons before More (Send to): mouse shortcuts to menu commands, so give them
   * `tabIndex={-1}` (the row is one Tab stop, brief §6)
   */
  actions?: ReactNode;
  id?: string;
  tabIndex?: number;
  onKeyDown?(e: KeyboardEvent<HTMLDivElement>): void;
  /** controls board only */
  forceState?: 'hover';
};

/** One Library item (brief §7 states). Click selects, double-click or Enter opens, right-click or More opens the menu. */
export function LibraryItemRow(p: LibraryItemRowProps) {
  const { item, thumb, selected, accepted, openIn, dragData, meta, anchor, actions } = p;
  const [dragging, setDragging] = useState(false);
  return (
    <div
      id={p.id}
      role="option"
      aria-selected={!!selected}
      tabIndex={p.tabIndex ?? -1}
      className={cx(s.item, selected && s.sel, anchor && s.anchor, dragging && s.dragging)}
      data-force={p.forceState}
      draggable={dragData !== undefined}
      onDragStart={(e) => {
        if (dragData === undefined) return;
        e.dataTransfer.setData(ITEM_MIME, dragData);
        e.dataTransfer.effectAllowed = 'copyMove';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      onClick={p.onSelect}
      onDoubleClick={p.onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        // the ContextMenu key and Shift+F10 fire this with button -1 at the row's centre
        if (e.button === 2) p.onMenu({ x: e.clientX, y: e.clientY }, {});
        else p.onMenu(e.currentTarget.getBoundingClientRect(), { initial: 0 });
      }}
      onKeyDown={(e) => {
        p.onKeyDown?.(e);
        if (e.defaultPrevented || e.key !== 'Enter' || e.target !== e.currentTarget) return;
        e.preventDefault();
        p.onOpen();
      }}
    >
      {openIn && <i className={s.led} />}
      <span className={s.thumb}>{thumb}</span>
      <span className={s.text}>
        <Tooltip content={item.name} overflowOnly>
          <span className={s.name}>{item.name}</span>
        </Tooltip>
        <span className={s.meta}>
          <span className={accepted ? s.lit : undefined}>
            {KIND[item.kind]}
            {meta && ` ${meta}`}
            {accepted && ` · ${accepted}`}
          </span>
          {openIn && <span className={s.open}>Open in {openIn}</span>}
        </span>
      </span>
      {/* mouse-only: they never take focus, and the row's menu carries the same commands */}
      <span className={s.actions} aria-hidden="true" onMouseDown={(e) => e.preventDefault()} onDoubleClick={(e) => e.stopPropagation()}>
        {actions}
        <IconButton
          icon="more_horiz"
          label="More"
          size="xs"
          tabIndex={-1}
          onClick={(e) => p.onMenu(e.currentTarget.getBoundingClientRect(), e.detail === 0 ? { initial: 0 } : {})}
        />
      </span>
    </div>
  );
}
