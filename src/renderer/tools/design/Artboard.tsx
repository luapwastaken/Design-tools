// The palette as the artboard (SPEC 3): full-height columns edge to edge on the pasteboard, "+" on
// the seams, proposals as periwinkle-marked columns at the end (nothing else moves when they come),
// and the armed Delete's confirm floating over the foot.
import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from 'react';
import { ROLES } from '../../../shared/palette/roles.ts';
import type { Swatch } from '../../../shared/types.ts';
import { Button, Icon, menu, Tooltip, type MenuAnchor, type MenuItem } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { addProposals, addSwatch, armDelete, clickSelect, copyHex, duplicate, insertBetween, select, selection, setRole, toggleLocked, type Doc } from './actions.ts';
import { badgeFor, simulated } from './artboard.ts';
import { Column, GhostColumn } from './Column.tsx';
import { DeleteConfirm } from './DeleteConfirm.tsx';
import { displayName, moveIds, namesOf, plural, type DesignDoc, type DesignView, mapSwatch } from './doc.ts';
import { clearProposals, proposals, toggleLock } from './proposals.ts';
import { armed, hot } from './view-state.ts';
import s from './Artboard.module.css';

/** internal reorders carry this type (spec 9), so OS files dropped here still go to onFiles */
const REORDER_MIME = 'application/x-designtools-reorder';

export type PopKind = 'image' | 'logo' | 'paste' | 'colour' | 'gradient';
export type OpenPop = (kind: PopKind, anchor: HTMLElement, ends?: { from: string; to: string }) => void;

export function Artboard({ doc, d, v, onPop }: { doc: Doc; d: DesignDoc; v: DesignView; onPop: OpenPop }) {
  const ghosts = proposals.use();
  const lit = hot.use();
  const isArmed = armed.use();
  const sel = selection(d, v);
  const [drag, setDrag] = useState<{ ids: string[]; at: number | null } | null>(null);
  const names = useMemo(() => namesOf(d), [d.swatches, d.ramps]);
  const shownList = useMemo(() => d.swatches.map((w) => ({ ...w, name: names.get(w.id) ?? w.name })), [d.swatches, names]);
  // the confirm belongs to the swatch it was armed on: another anchor disarms it
  useEffect(() => armed.set(false), [sel[0]]);
  // a new set of proposals lands at the end of the board, maybe past the fold: bring its first into view
  const firstGhost = ghosts?.items[0]?.id;
  useEffect(() => {
    if (firstGhost) document.querySelector(`[data-ghost="${firstGhost}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [firstGhost]);
  const full = v.chipData === 'full';

  const openMenu = (w: Swatch, at: MenuAnchor, fromKey: boolean) => {
    if (!sel.includes(w.id)) select([w.id]);
    menu.open(
      at,
      [
        { label: 'Duplicate', icon: 'content_copy', shortcut: 'Ctrl+D', onSelect: () => duplicate(doc) },
        { label: 'Copy hex', shortcut: 'C', onSelect: () => copyHex(w) },
        { label: v.locked.includes(w.id) ? 'Unlock' : 'Lock', icon: v.locked.includes(w.id) ? 'lock_open' : 'lock', shortcut: 'L', onSelect: () => toggleLocked(doc) },
        { label: 'Role', submenu: roleItems(w) },
        'separator',
        { label: sel.length > 1 && sel.includes(w.id) ? `Delete ${sel.length} swatches` : 'Delete', icon: 'delete', shortcut: 'Delete', danger: true, onSelect: () => armDelete(doc) },
      ],
      { initial: fromKey ? 0 : undefined },
    );
  };

  /** the seven jobs, each saying who holds it now; a held one moves to this swatch */
  const roleItems = (w: Swatch): MenuItem[] => [
    ...ROLES.map((r) => {
      const owner = d.swatches.find((x) => x.role === r && x.id !== w.id);
      return { label: r, checked: w.role === r, hint: owner ? displayName(owner) : undefined, onSelect: () => setRole(doc, w.id, r) } satisfies MenuItem;
    }),
    'separator',
    { label: 'No role', checked: w.role === null, onSelect: () => setRole(doc, w.id, null) },
  ];
  const openRole = (w: Swatch, el: HTMLElement) => menu.open(el.getBoundingClientRect(), roleItems(w), { owner: el });

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

  const seam = (w: Swatch, i: number) => {
    const next = d.swatches[i + 1];
    if (!next) return null;
    const label = 'Insert a colour between';
    return (
      <span className={s.seam}>
        <Tooltip content={`${label} (Alt: several steps)`} side="right">
          <button
            type="button"
            className={s.plus}
            aria-label={`${label} ${displayName(w)} and ${displayName(next)}`}
            tabIndex={-1}
            onClick={(e: MouseEvent<HTMLButtonElement>) => {
              e.stopPropagation();
              if (e.altKey) onPop('gradient', e.currentTarget, { from: w.id, to: next.id });
              else insertBetween(doc, w.id);
            }}
          >
            <Icon name="add" size={16} />
          </button>
        </Tooltip>
      </span>
    );
  };

  return (
    <div className={s.board}>
      <div
        role="listbox"
        aria-label="Swatches"
        aria-multiselectable="true"
        className={s.cols}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragLeave={(e) => drag && !e.currentTarget.contains(e.relatedTarget as Node) && setDrag({ ...drag, at: null })}
      >
        {d.swatches.map((w, i) => (
          <Column
            key={w.id}
            swatch={w}
            name={names.get(w.id) ?? w.name}
            shown={simulated(w.oklch, v.sim)}
            index={i}
            full={full}
            selected={sel.includes(w.id)}
            anchor={sel[0] === w.id}
            hot={lit.includes(w.id)}
            locked={v.locked.includes(w.id)}
            dragging={!!drag?.ids.includes(w.id)}
            insert={insertOf(i)}
            focusable={sel[0] === w.id}
            badge={badgeFor(w, shownList)}
            onSelect={(e) => clickSelect(d, w.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })}
            onMenu={(at, fromKey) => openMenu(w, at, fromKey)}
            onDragStart={onDragStart(w)}
            onDragEnd={() => setDrag(null)}
            onRole={(el) => (select([w.id]), openRole(w, el))}
            onLock={() => (select([w.id]), toggleLocked(doc))}
            onCopy={() => copyHex(w)}
            onDelete={() => (select([w.id]), armDelete(doc))}
            onRename={(name) => doc.transact(`Rename ${displayName(w)}`, (x) => mapSwatch(x, w.id, (y) => ({ ...y, name })))}
            seam={seam(w, i)}
          />
        ))}
        {ghosts?.items.map((p) => (
          <GhostColumn key={p.id} p={p} shown={simulated(p.oklch, v.sim)} full={full} lockable={ghosts.from === 'generate'} onAdd={() => addProposals(doc, [p])} onLock={() => toggleLock(p.id)} />
        ))}
        {d.swatches.length > 0 && (
          <Tooltip content="Add a colour at the lightness the palette lacks most">
            <button type="button" className={s.end} aria-label="Add a swatch" onClick={() => addSwatch(doc)}>
              <Icon name="add" size={20} />
            </button>
          </Tooltip>
        )}
      </div>
      {ghosts && (
        <div className={s.keepBar} role="group" aria-label="Proposals">
          <span className={s.from}>
            <b>{plural(ghosts.items.length, 'colour')} proposed</b> {ghosts.label}
          </span>
          <Button size="xs" variant="primary" icon="add" shortcut="A" onClick={() => addProposals(doc, ghosts.items)}>
            Keep all
          </Button>
          <Button size="xs" shortcut="Escape" onClick={clearProposals}>
            Discard
          </Button>
        </div>
      )}
      {isArmed && (
        <div className={cx(s.confirm, ghosts && s.high)}>
          <DeleteConfirm doc={doc} d={d} sel={sel} />
        </div>
      )}
    </div>
  );
}
