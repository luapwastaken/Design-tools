import { useEffect, useMemo, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { toHex } from '../../../shared/color/index.ts';
import type { Swatch } from '../../../shared/types.ts';
import { Button, EmptyState, menu, Module, Segmented, toast, type MenuAnchor } from '../../ui/index.ts';
import { SURROUNDS, surroundOf } from '../common/surround.ts';
import { useWidth } from '../common/useWidth.ts';
import { startWith } from './Build.tsx';
import { addProposals, armDelete, clickSelect, duplicate, select, selection, type Doc } from './actions.ts';
import { DeleteConfirm } from './DeleteConfirm.tsx';
import { moveIds, namesOf, plural, type DesignDoc, type DesignView } from './doc.ts';
import { clearProposals, proposals, toggleLock } from './proposals.ts';
import { GhostChip, SwatchChip } from './SwatchChip.tsx';
import { armed, hot, patchView } from './view-state.ts';
import s from './SwatchRow.module.css';

/** internal reorders carry this type (spec §9), so OS files dropped here still go to onFiles */
const REORDER_MIME = 'application/x-designtools-reorder';
const MIN_CHIP = 140;

const DATA: { value: DesignView['chipData']; label: string; tip: string }[] = [
  { value: 'short', label: 'Chips', tip: 'Hex and L C H' },
  { value: 'full', label: 'Table', tip: 'Adds RGB and ≈CMYK rows' },
];

const FIELD = ['min(232px, 22vh)', 'min(100px, 10vh)', '72px'];

export function SwatchRow({ doc, d, v }: { doc: Doc; d: DesignDoc; v: DesignView }) {
  const ghosts = proposals.use();
  const lit = hot.use();
  const sel = selection(d, v);
  const [drag, setDrag] = useState<{ ids: string[]; at: number | null } | null>(null);
  const isArmed = armed.use();
  const names = useMemo(() => namesOf(d), [d.swatches, d.ramps]);
  // the confirm belongs to the swatch it was armed on: another anchor disarms it
  useEffect(() => armed.set(false), [sel[0]]);
  // a new set of proposals lands at the end of the row, maybe below the fold: bring its first into view
  const firstGhost = ghosts?.items[0]?.id;
  useEffect(() => {
    if (firstGhost) document.querySelector(`[data-ghost="${firstGhost}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [firstGhost]);
  const count = d.swatches.length + (ghosts?.items.length ?? 0);
  // how many rows the chips wrap to, so one row can stand tall and several stay compact
  const { ref, width } = useWidth<HTMLDivElement>();
  const rows = Math.max(1, Math.ceil(count / Math.max(1, Math.floor(width / MIN_CHIP))));
  const surround = surroundOf(v.surround, d.swatches);
  const full = v.chipData === 'full';

  const openMenu = (w: Swatch, at: MenuAnchor, fromKey: boolean) => {
    if (!sel.includes(w.id)) select([w.id]);
    const copy = (text: string, what: string) =>
      navigator.clipboard.writeText(text).then(
        () => toast.show({ icon: 'content_copy', message: `Copied ${what}.` }),
        () => toast.show({ kind: 'error', message: `Couldn't copy the ${what}.` }),
      );
    menu.open(
      at,
      [
        { label: 'Duplicate', icon: 'content_copy', shortcut: 'Ctrl+D', onSelect: () => duplicate(doc) },
        { label: 'Copy hex', onSelect: () => void copy(toHex(w.oklch).toUpperCase(), 'hex') },
        'separator',
        { label: sel.length > 1 && sel.includes(w.id) ? `Delete ${sel.length} swatches` : 'Delete', icon: 'delete', shortcut: 'Delete', danger: true, onSelect: () => armDelete(doc) },
      ],
      { initial: fromKey ? 0 : undefined },
    );
  };

  const onChipClick = (w: Swatch) => (e: MouseEvent) => {
    clickSelect(d, w.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    (e.currentTarget as HTMLElement).focus();
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
    const chip = (e.target as Element).closest<HTMLElement>('[data-index]');
    if (!chip) return;
    const r = chip.getBoundingClientRect();
    const at = Number(chip.dataset.index) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
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

  return (
    <Module
      title="Swatches"
      sub="Drag to reorder · Ctrl click for several"
      readout={d.swatches.length ? `${sel.length} of ${d.swatches.length} selected` : undefined}
      scroll
      className={s.mod}
      actions={
        <span className={s.switches}>
          <Segmented options={SURROUNDS} value={v.surround} onChange={(surround) => patchView({ surround })} mono fit />
          <Segmented options={DATA} value={v.chipData} onChange={(chipData) => patchView({ chipData })} mono fit />
        </span>
      }
      footer={
        ghosts && (
          <>
            <span className="lbl">Proposed</span>
            <span className={s.from}>
              {ghosts.label} · {plural(ghosts.items.length, 'colour')}
            </span>
            <span className={s.grow} />
            <Button size="xs" icon="add" onClick={() => addProposals(doc, ghosts.items)}>
              Add all
            </Button>
            <Button size="xs" variant="ghost" onClick={clearProposals}>
              Clear
            </Button>
          </>
        )
      }
    >
      {count === 0 && (
        <EmptyState
          icon="palette"
          title="Start a palette"
          detail={
            <>
              Generate one, paste colour codes, or pull colours from an image. You can also drop an image or SVG here, or open a palette from the Library.
              <span className={s.start}>
                <Button icon="casino" onClick={startWith.generate}>
                  Generate
                </Button>
                <Button icon="content_paste" onClick={startWith.paste}>
                  Paste
                </Button>
                <Button icon="add_photo_alternate" onClick={startWith.image}>
                  From image
                </Button>
              </span>
            </>
          }
        />
      )}
      <div
        ref={ref}
        hidden={count === 0}
        role="listbox"
        aria-label="Swatches"
        aria-multiselectable="true"
        className={s.grid}
        style={{ '--field': FIELD[Math.min(rows, 3) - 1] } as CSSProperties}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragLeave={(e) => drag && !e.currentTarget.contains(e.relatedTarget as Node) && setDrag({ ...drag, at: null })}
      >
        {d.swatches.map((w, i) => (
          <SwatchChip
            key={w.id}
            swatch={w}
            name={names.get(w.id) ?? w.name}
            index={i}
            surround={surround}
            full={full}
            selected={sel.includes(w.id)}
            anchor={sel[0] === w.id}
            hot={lit.includes(w.id)}
            dragging={!!drag?.ids.includes(w.id)}
            insert={insertOf(i)}
            focusable={sel[0] === w.id}
            onSelect={onChipClick(w)}
            onMenu={(at, fromKey) => openMenu(w, at, fromKey)}
            onDragStart={onDragStart(w)}
            onDragEnd={() => setDrag(null)}
            confirm={isArmed && sel[0] === w.id ? <DeleteConfirm doc={doc} d={d} sel={sel} /> : undefined}
          />
        ))}
        {ghosts?.items.map((p) => (
          <GhostChip key={p.id} p={p} surround={surround} full={full} lockable={ghosts.from === 'generate'} onAdd={() => addProposals(doc, [p])} onLock={() => toggleLock(p.id)} />
        ))}
      </div>
    </Module>
  );
}
