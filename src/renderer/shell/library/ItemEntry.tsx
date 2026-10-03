import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { LibraryItemRef, ToolId } from '../../../shared/types.ts';
import { Button, ConfirmInline, LibraryItemRow, TextInput, menu, type MenuAnchor, type MenuOptions } from '../../ui/index.ts';
import { shell } from '../core/index.ts';
import { cantOpen } from '../core/routing.ts';
import { collectionLabel, formatBytes, KIND_WORD, ownerNote, sendToItems } from './actions.ts';
import { swatchWord, useItemInfo } from './item-info.ts';
import { Thumb } from './Thumb.tsx';
import s from './ItemEntry.module.css';

/** What a row is doing: showing, renaming inline, or armed for delete or move (brief §6). */
export type RowMode = null | { t: 'rename' } | { t: 'delete' } | { t: 'move'; to: string; toLocked: boolean };

type Props = {
  item: LibraryItemRef;
  domId: string;
  mode: RowMode;
  selected: boolean;
  tabStop: boolean;
  owner?: ToolId;
  accepted: string | null;
  /** a narrow Library: Send to stays in the row's menu only, so the row's labels keep their room */
  narrow: boolean;
  onSelect(): void;
  onMenu(at: MenuAnchor, opts: MenuOptions): void;
  onKeyDown(e: KeyboardEvent<HTMLDivElement>): void;
  /** the new name, or null when renaming was cancelled */
  onRenamed(name: string | null): void;
  onConfirm(): void;
  onKeep(): void;
};

export function ItemEntry(p: Props) {
  const { item, mode, owner } = p;
  const info = useItemInfo(item);
  // a row near the list's edge grows into a card or a field: keep all of it in view
  const box = useRef<HTMLDivElement>(null);
  // braces: scrollIntoView returns a Promise in this Chromium, which React would call as a cleanup
  useEffect(() => {
    box.current?.scrollIntoView({ block: 'nearest' });
  }, [mode?.t]);

  if (mode?.t === 'rename') {
    return (
      <div ref={box} className={s.rename}>
        <span className={s.thumb}>
          <Thumb item={item} />
        </span>
        <TextInput
          value={item.name}
          autoFocus
          selectOnFocus
          className={s.field}
          validate={(v) => (v.trim() ? null : 'Give it a name.')}
          onCommit={(v) => p.onRenamed(v.trim())}
          onCancel={() => p.onRenamed(null)}
        />
      </div>
    );
  }

  if (mode?.t === 'delete' || mode?.t === 'move') {
    const word = KIND_WORD[item.kind];
    const size = item.kind === 'palette' && info?.meta ? `${swatchWord(Number(info.meta))}.` : `${formatBytes(item.size)}.`;
    const del = mode.t === 'delete';
    return (
      <div ref={box} className={s.armed}>
        <ConfirmInline
          icon={del ? 'delete' : 'drive_file_move'}
          title={del ? `Delete ${word} “${item.name}”?` : `Move “${item.name}” to ${mode.to}?`}
          detail={
            del
              ? `${size} Goes to the Recycle Bin when this closes.${item.locked ? ` ${collectionLabel(item.collection)} is locked, which stops tools editing it, not this.` : ''}${ownerNote(owner, true)}`
              : `From ${collectionLabel(item.collection)}.${mode.toLocked ? ` ${mode.to} is locked.` : ''}${ownerNote(owner, mode.toLocked)}`
          }
          confirmLabel={del ? 'Delete' : 'Move'}
          danger={del}
          onConfirm={p.onConfirm}
          onKeep={p.onKeep}
        />
      </div>
    );
  }

  const targets = sendToItems(item);
  return (
    <LibraryItemRow
      id={p.domId}
      item={item}
      thumb={<Thumb item={item} />}
      meta={info?.meta}
      selected={p.selected}
      accepted={p.accepted ?? undefined}
      openIn={owner && shell.tool(owner).label}
      openHere={owner === shell.getState().active}
      note={shell.openTarget(item.kind) ? undefined : cantOpen(item.kind, shell.targetsFor(item.kind).map((t) => t.tool.label))}
      tabIndex={p.tabStop ? 0 : -1}
      dragData={item.id}
      onSelect={p.onSelect}
      onOpen={() => void shell.openItem(item)}
      onMenu={p.onMenu}
      onKeyDown={p.onKeyDown}
      actions={
        targets.length > 0 &&
        !p.narrow && (
          <Button
            size="xs"
            variant={p.selected ? 'secondary' : 'ghost'}
            iconEnd="chevron_right"
            tabIndex={-1}
            onClick={(e) => menu.open(e.currentTarget.getBoundingClientRect(), targets, { initial: e.detail === 0 ? 0 : undefined })}
          >
            Send to
          </Button>
        )
      }
    />
  );
}
