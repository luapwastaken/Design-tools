import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { ItemKind, LibraryItemRef } from '../../shared/types.ts';
import { cx } from './cx.ts';
import { useFit } from './fit.ts';
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
  /** the active tool's use label when it accepts this item: INKS, AS SHAPE (one that only repeats the kind lights the kind instead) */
  accepted?: string;
  /**
   * tool label when the item is open in a tool (spec §6.4): OPEN IN <TOOL>, or just OPEN when that
   * tool is the active one (`openHere`) or the row is too narrow; the tooltip then names it
   */
  openIn?: string;
  openHere?: boolean;
  /** why a double-click does nothing here (spec §6.4); the row's tooltip */
  note?: string;
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
};

/** One Library item (brief §7 states). Click selects, double-click or Enter opens, right-click or More opens the menu. */
export function LibraryItemRow(p: LibraryItemRowProps) {
  const { item, thumb, selected, accepted, openIn, openHere, note, dragData, meta, anchor, actions } = p;
  const [dragging, setDragging] = useState(false);
  // a use label that only repeats the kind (PALETTE · PALETTE) isn't shown: the lit kind says it
  const use = accepted?.toUpperCase() === KIND[item.kind].toUpperCase() ? undefined : accepted;
  // Too narrow for the whole meta line: the size goes first, then the use label (the lit kind still
  // says the tool takes it), then OPEN IN <TOOL> shortens to OPEN. Only then is the kind cut.
  const box = useRef<HTMLSpanElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const level = useFit(box, line, 5, `${meta}|${use}|${openIn}|${openHere}`);
  const longTag = !!openIn && !openHere && level < 3;
  const row = (
    <div
      id={p.id}
      role="option"
      aria-selected={!!selected}
      tabIndex={p.tabIndex ?? -1}
      className={cx(s.item, selected && s.sel, anchor && s.anchor, dragging && s.dragging)}
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
        <span className={s.top}>
          <Tooltip content={item.name} overflowOnly disabled={!!note}>
            <span className={s.name}>{item.name}</span>
          </Tooltip>
          {/* on the name line, so the meta line keeps its width. Mouse-only: they never take focus,
              and the row's menu carries the same commands */}
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
        </span>
        <span ref={box} className={cx(s.meta, accepted && s.lit)}>
          <span ref={line} className={cx(s.line, level === 4 && s.squeeze)}>
            <span className={s.kind}>
              {KIND[item.kind]}
              {meta && level < 1 && ` ${meta}`}
            </span>
            {use && level < 2 && <span className={s.keep}>&nbsp;· {use}</span>}
            {openIn && (
              <Tooltip content={`Open in ${openIn}`} disabled={longTag}>
                <span className={cx(s.keep, s.open)}>{longTag ? `Open in ${openIn}` : 'Open'}</span>
              </Tooltip>
            )}
          </span>
        </span>
      </span>
    </div>
  );
  return note ? <Tooltip content={note}>{row}</Tooltip> : row;
}
