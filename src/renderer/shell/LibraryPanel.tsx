import { useEffect, useRef, useState, type DragEvent, type FocusEvent, type KeyboardEvent } from 'react';
import { IMAGE_EXTS, PALETTE_IMPORT_EXTS, type Collection, type ItemKind, type LibraryItemRef } from '../../shared/types.ts';
import { Button, EmptyState, Icon, IconButton, ITEM_MIME, menu, Module, Progress, Segmented, TextInput, Tooltip, type MenuAnchor, type MenuItem } from '../ui/index.ts';
import { shell, useShell } from './core/index.ts';
import { ipc } from './core/ipc.ts';
import { collectionLabel, itemMenu } from './library/actions.ts';
import { CollectionSection, fixedCollection } from './library/CollectionSection.tsx';
import { ItemEntry, type RowMode } from './library/ItemEntry.tsx';
import s from './LibraryPanel.module.css';

type Filter = 'all' | 'palette' | 'logo' | 'pattern' | 'image';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'palette', label: 'Palettes' },
  { value: 'logo', label: 'Logos' },
  { value: 'pattern', label: 'Patterns' },
  { value: 'image', label: 'Images' },
];
// a narrow Library (down to 240px) can't fit the words; the tooltip carries them
const SHORT: Record<Filter, string> = { all: 'All', palette: 'Pal', logo: 'Logo', pattern: 'Pat', image: 'Img' };
const FILTERS_SHORT = FILTERS.map((f) => ({ ...f, label: SHORT[f.value], tip: f.value === 'all' ? undefined : f.label }));
const matches = (f: Filter, k: ItemKind) => f === 'all' || f === k || (f === 'image' && k === 'svg');

const ACCEPT = [...PALETTE_IMPORT_EXTS, ...IMAGE_EXTS, 'svg'].map((e) => `.${e}`).join(',');
const SCRATCH = 'Scratch';
/** everything the arrow keys walk: rows, collection headers, files not imported */
const NAV = '[role="option"], [data-nav]';
const ROW_ID = /^lib-row-(\d+)$/;

/** The docked Library (spec §6.4): search, kind filter, collections, rows with thumbnails, drag and drop. */
export function LibraryPanel({ narrow }: { narrow: boolean }) {
  const library = useShell((st) => st.library);
  const owners = useShell((st) => st.owners);
  useShell((st) => st.active); // the accepted labels follow the active tool

  const [query, setQuery] = useState('');
  const [searchKey, setSearchKey] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [armed, setArmed] = useState<{ id: string; mode: NonNullable<RowMode> } | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [renamingCollection, setRenamingCollection] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ to: string; files: boolean } | null>(null);
  const dragged = useRef<LibraryItemRef | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const importTo = useRef(SCRATCH);
  const focusNext = useRef<string | null>(null);

  const ok = library?.ok === true;
  const collections = ok ? library.collections : [];
  const q = query.trim().toLowerCase();
  const searching = q !== '' || filter !== 'all';
  const sections = collections
    .map((c) => ({ c, items: c.items.filter((it) => matches(filter, it.kind) && (!q || it.name.toLowerCase().includes(q))) }))
    // the root shows only when files sit there; filtering hides collections with no matches
    .filter(({ c, items }) => items.length > 0 || (!searching && c.name !== ''));
  const flat = sections.flatMap(({ c, items }) => (folded.has(c.name) ? [] : items));
  const at = new Map(flat.map((it, i) => [it.id, i]));
  const stop = (selected !== null && at.has(selected) ? selected : flat[0]?.id) ?? null;
  const total = collections.reduce((n, c) => n + c.items.length, 0);
  const ignored = collections.reduce((n, c) => n + c.ignored, 0);
  const named = collections.filter((c) => c.name !== '').length;

  // focus lands back on a row after its confirm or rename closes, or on the next row after a delete
  useEffect(() => {
    const id = focusNext.current;
    focusNext.current = null;
    const i = id === null ? undefined : at.get(id);
    if (i !== undefined) document.getElementById(`lib-row-${i}`)?.focus();
  });

  const arm = (it: LibraryItemRef, mode: NonNullable<RowMode>) => {
    setSelected(it.id);
    setArmed({ id: it.id, mode });
  };
  const armMove = (it: LibraryItemRef, to: string) => arm(it, { t: 'move', to, toLocked: collections.some((c) => c.name === to && c.locked) });

  const confirm = (it: LibraryItemRef) => {
    const mode = armed?.mode;
    setArmed(null);
    if (mode?.t === 'delete') {
      const i = at.get(it.id) ?? 0;
      const next = flat[i + 1] ?? flat[i - 1];
      if (next) {
        setSelected(next.id);
        focusNext.current = next.id;
      }
      void shell.deleteItem(it);
    } else if (mode?.t === 'move') {
      focusNext.current = it.id;
      void shell.moveItem(it, mode.to);
    }
  };
  const settle = (it: LibraryItemRef) => {
    setArmed(null);
    focusNext.current = it.id;
  };

  const pickFiles = (to: string) => {
    importTo.current = to;
    fileInput.current?.click();
  };
  const clearSearch = () => {
    setQuery('');
    setSearchKey((k) => k + 1);
  };

  const rowKeys = (it: LibraryItemRef) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'F2') arm(it, { t: 'rename' });
    else if (e.key === 'Delete') arm(it, { t: 'delete' });
    else if (e.ctrlKey && e.key.toLowerCase() === 'd') void shell.duplicateItem(it);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onListKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (e.defaultPrevented || (!step && e.key !== 'Home' && e.key !== 'End')) return;
    const els = [...e.currentTarget.querySelectorAll<HTMLElement>(NAV)];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return; // a field inside the list keeps its keys
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? els.length - 1 : i + step;
    if (!els[to]) return;
    e.preventDefault();
    els[to].focus();
  };
  // selection follows focus, however it arrived
  const rowOf = (el: Element | null) => {
    const m = el && ROW_ID.exec(el.id);
    return m ? flat[Number(m[1])] : undefined;
  };
  const onListFocus = (e: FocusEvent<HTMLDivElement>) => {
    const it = rowOf(e.target);
    if (it) setSelected(it.id);
  };

  const collectionMenu = (c: Collection) => (anchor: MenuAnchor) => {
    const own: MenuItem[] = fixedCollection(c.name)
      ? []
      : [
          { label: 'Rename', icon: 'edit', onSelect: () => setRenamingCollection(c.name) },
          { label: c.locked ? 'Unlock' : 'Lock', icon: c.locked ? 'lock_open' : 'lock', onSelect: () => void shell.setCollectionLocked(c.name, !c.locked) },
          'separator',
        ];
    menu.open(anchor, [...own, { label: 'Import files…', icon: 'upload_file', onSelect: () => pickFiles(c.name) }]);
  };

  // ── drag and drop: OS files import into the collection under the pointer (else Scratch);
  //    a dragged row arms a move onto another collection (spec §6.3) ──
  const dropTarget = (e: DragEvent): { to: string; files: boolean } | null => {
    const section = (e.target as Element).closest<HTMLElement>('[data-collection]')?.dataset.collection;
    if (e.dataTransfer.types.includes('Files')) return ok ? { to: section ?? SCRATCH, files: true } : null;
    const from = dragged.current;
    return from && section && section !== from.collection ? { to: section, files: false } : null;
  };
  const carries = (e: DragEvent) => e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(ITEM_MIME);
  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (!carries(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const t = dropTarget(e);
    e.dataTransfer.dropEffect = !t ? 'none' : t.files ? 'copy' : 'move';
    if (t?.to !== drop?.to || t?.files !== drop?.files) setDrop(t);
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    if (!carries(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const t = dropTarget(e);
    setDrop(null);
    if (t?.files) {
      const paths = [...e.dataTransfer.files].map((f) => ipc.pathForFile(f)).filter(Boolean);
      if (paths.length) void shell.importFiles(paths, t.to);
    } else if (t && dragged.current) armMove(dragged.current, t.to);
  };

  const footer = drop ? (
    <span className={s.hint}>
      <Icon name={drop.files ? 'input' : 'drive_file_move'} size={16} />
      {drop.files ? `Drop to add to ${collectionLabel(drop.to)}` : `Drop to move to ${drop.to}`}
    </span>
  ) : (
    library && (
      <>
        <Icon name="folder" size={16} />
        <Tooltip content={library.root} overflowOnly>
          <span className={s.path}>
            <bdi>{library.root}</bdi>
          </span>
        </Tooltip>
        {ok && (
          <Tooltip content={ignored ? "Plus files the Library can't use and folders more than one level deep" : undefined} disabled={!ignored}>
            <span className={s.counts}>
              {total === 1 ? '1 item' : `${total} items`}
              {ignored > 0 && ` · ${ignored} ignored`}
            </span>
          </Tooltip>
        )}
      </>
    )
  );

  return (
    <aside
      className={s.panel}
      aria-label="Library"
      data-region="library"
      onDragOver={onDragOver}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDrop(null)}
      onDrop={onDrop}
    >
      <Module
        title="Library"
        sub={ok ? (named === 1 ? '1 collection' : `${named} collections`) : undefined}
        flush
        className={s.mod}
        footer={footer}
        actions={
          <>
            <IconButton icon="upload_file" label="Import files" size="sm" disabled={!ok} onClick={() => pickFiles(SCRATCH)} />
            <IconButton icon="create_new_folder" label="New collection" size="sm" disabled={!ok} onClick={() => setCreating(true)} />
            <IconButton icon="left_panel_close" label="Close Library" shortcut="Ctrl+L" size="sm" onClick={() => shell.toggleLibrary(false)} />
          </>
        }
      >
        <div className={s.inner}>
          {!library ? (
            <div className={s.pad}>
              <Progress label="Reading the Library" value={null} />
            </div>
          ) : !ok ? (
            <div className={s.pad}>
              <EmptyState
                icon="folder_off"
                title="Can't open the Library folder"
                detail={
                  <>
                    <span className={s.mono}>{library.root}</span>
                    <br />
                    {library.error ?? 'It may have been moved, renamed or disconnected.'} Tools keep working, and their documents stay open.
                  </>
                }
                action={{ label: 'Choose folder', icon: 'folder_open', onClick: () => void shell.chooseLibraryRoot() }}
              />
            </div>
          ) : (
            <>
              <div className={s.tools}>
                {/* Esc clears; the field itself only reverts, so it's remounted empty */}
                <div
                  onKeyDown={(e) => {
                    if (e.key !== 'Escape' || !query || e.defaultPrevented) return;
                    e.preventDefault();
                    e.stopPropagation();
                    clearSearch();
                  }}
                >
                  <TextInput
                    key={searchKey}
                    value={query}
                    icon="search"
                    placeholder={total === 1 ? 'Search 1 item' : `Search ${total} items`}
                    autoFocus={searchKey > 0}
                    onChange={setQuery}
                    onCommit={setQuery}
                    end={query && <IconButton icon="close" label="Clear search" size="xs" onClick={clearSearch} />}
                  />
                </div>
                <Segmented<Filter> options={narrow ? FILTERS_SHORT : FILTERS} value={filter} onChange={setFilter} mono className={s.kinds} />
              </div>

              <div
                role="listbox"
                aria-label="Library items"
                className={s.list}
                onKeyDown={onListKeys}
                onFocus={onListFocus}
                onDragStart={(e) => (dragged.current = rowOf((e.target as Element).closest('[role="option"]')) ?? null)}
                onDragEnd={() => {
                  dragged.current = null;
                  setDrop(null);
                }}
              >
                {creating && (
                  <div className={s.create}>
                    <TextInput
                      value=""
                      label="New"
                      placeholder="Collection name"
                      autoFocus
                      validate={(v) => (v.trim() ? null : 'Give it a name.')}
                      onCommit={(v) => {
                        setCreating(false);
                        void shell.createCollection(v.trim());
                      }}
                      onCancel={() => setCreating(false)}
                    />
                  </div>
                )}

                {ok && total === 0 && (
                  <div className={s.pad}>
                    <EmptyState
                      icon="add_photo_alternate"
                      title="Nothing in the Library yet"
                      detail="Drop .ase, .aco or .gpl palettes, images or SVGs here. They go into Scratch."
                      action={{ label: 'Import files', icon: 'upload_file', onClick: () => pickFiles(SCRATCH) }}
                    />
                  </div>
                )}
                {searching && total > 0 && sections.length === 0 && (
                  <div className={s.none}>
                    <span>Nothing matches.</span>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        clearSearch();
                        setFilter('all');
                      }}
                    >
                      Show everything
                    </Button>
                  </div>
                )}

                {sections.map(({ c, items }, n) => (
                  <CollectionSection
                    key={c.name}
                    c={c}
                    count={items.length}
                    expanded={!folded.has(c.name)}
                    onToggle={(open) =>
                      setFolded((f) => {
                        const next = new Set(f);
                        if (open) next.delete(c.name);
                        else next.add(c.name);
                        return next;
                      })
                    }
                    dropping={drop?.to === c.name}
                    renaming={renamingCollection === c.name}
                    onRenamed={(name) => {
                      setRenamingCollection(null);
                      if (name && name !== c.name) void shell.renameCollection(c.name, name);
                    }}
                    onMenu={collectionMenu(c)}
                    tabStop={stop === null && n === 0}
                    showNotImported={!searching}
                  >
                    {items.length === 0 && total > 0 ? (
                      <p className={s.emptyCollection}>Empty. Drop files here to add them.</p>
                    ) : (
                      items.map((it) => (
                        <ItemEntry
                          key={it.id}
                          item={it}
                          domId={`lib-row-${at.get(it.id)}`}
                          mode={armed?.id === it.id ? armed.mode : null}
                          selected={selected === it.id}
                          tabStop={stop === it.id}
                          owner={owners[it.id]}
                          accepted={shell.acceptedLabel(it.kind)}
                          narrow={narrow}
                          onSelect={() => setSelected(it.id)}
                          onMenu={(anchor, opts) => {
                            setSelected(it.id);
                            menu.open(
                              anchor,
                              itemMenu(it, library!, {
                                rename: () => arm(it, { t: 'rename' }),
                                move: (to) => armMove(it, to),
                                remove: () => arm(it, { t: 'delete' }),
                              }),
                              opts,
                            );
                          }}
                          onKeyDown={rowKeys(it)}
                          onRenamed={(name) => {
                            settle(it);
                            if (name && name !== it.name) void shell.renameItem(it, name);
                          }}
                          onConfirm={() => confirm(it)}
                          onKeep={() => settle(it)}
                        />
                      ))
                    )}
                  </CollectionSection>
                ))}
              </div>
            </>
          )}
        </div>
      </Module>
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        onChange={(e) => {
          const paths = [...(e.currentTarget.files ?? [])].map((f) => ipc.pathForFile(f)).filter(Boolean);
          e.currentTarget.value = '';
          if (paths.length) void shell.importFiles(paths, importTo.current);
        }}
      />
    </aside>
  );
}
