import type { KeyboardEvent, ReactNode } from 'react';
import type { Collection } from '../../../shared/types.ts';
import { Button, Icon, IconButton, TextInput, Tooltip, type MenuAnchor } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { shell } from '../core/index.ts';
import { collectionLabel } from './actions.ts';
import s from './CollectionSection.module.css';

type Props = {
  c: Collection;
  /** items shown after the filter */
  count: number;
  expanded: boolean;
  onToggle(open: boolean): void;
  /** OS files or a dragged item would land here */
  dropping: boolean;
  renaming: boolean;
  onRenamed(name: string | null): void;
  onMenu(at: MenuAnchor): void;
  /** the header holds the list's Tab stop when no row is showing */
  tabStop: boolean;
  showNotImported: boolean;
  children: ReactNode;
};

/** Scratch and the Library root can't be locked or renamed (spec §6). */
export const fixedCollection = (name: string) => name === '' || name === 'Scratch';

/** One collection in the Library: disclosure header with lock and count, its rows, then files not imported yet. */
export function CollectionSection(p: Props) {
  const { c, expanded } = p;
  const label = collectionLabel(c.name);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowLeft' && expanded) p.onToggle(false);
    else if (e.key === 'ArrowRight' && !expanded) p.onToggle(true);
    else return;
    e.preventDefault();
  };

  return (
    <div role="group" aria-label={label} data-collection={c.name} className={cx(s.section, p.dropping && s.dropping)}>
      <div
        className={cx(s.head, c.locked && s.locked)}
        onContextMenu={(e) => {
          e.preventDefault();
          p.onMenu(e.button === 2 ? { x: e.clientX, y: e.clientY } : e.currentTarget.getBoundingClientRect());
        }}
      >
        {p.renaming ? (
          <TextInput
            value={c.name}
            label="Rename"
            autoFocus
            selectOnFocus
            className={s.field}
            validate={(v) => (v.trim() ? null : 'Give it a name.')}
            onCommit={(v) => p.onRenamed(v.trim())}
            onCancel={() => p.onRenamed(null)}
          />
        ) : (
          <button type="button" className={s.name} data-nav tabIndex={p.tabStop ? 0 : -1} aria-expanded={expanded} onClick={() => p.onToggle(!expanded)} onKeyDown={onKeyDown}>
            <Icon name={expanded ? 'keyboard_arrow_down' : 'keyboard_arrow_right'} />
            <Tooltip overflowOnly>
              <span className={s.title}>{label}</span>
            </Tooltip>
          </button>
        )}
        <span className={s.grow} />
        {!fixedCollection(c.name) && (
          <IconButton
            icon={c.locked ? 'lock' : 'lock_open'}
            label={c.locked ? `Unlock ${label}` : `Lock ${label}`}
            size="xs"
            tabIndex={-1}
            className={s.lock}
            onClick={() => void shell.setCollectionLocked(c.name, !c.locked)}
          />
        )}
        <span className={s.count}>{p.count}</span>
      </div>

      {expanded && p.children}

      {expanded && p.showNotImported && c.notImported.length > 0 && (
        <div className={s.pending}>
          <span className={cx('lbl', s.pendingHead)}>Not imported</span>
          {c.notImported.map((f) => (
            <div
              key={f.path}
              role="option"
              aria-selected={false}
              tabIndex={-1}
              className={s.file}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                void shell.importFiles([f.path], c.name);
              }}
            >
              <Icon name="palette" size={16} />
              <Tooltip overflowOnly>
                <span className={s.fileName}>{f.name}</span>
              </Tooltip>
              <Button size="xs" variant="ghost" icon="download" tabIndex={-1} onClick={() => void shell.importFiles([f.path], c.name)}>
                Import
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
