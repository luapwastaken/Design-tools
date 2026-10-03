// The ramps (spec §2, UX pass): one compact row per base colour, highlight to deep shadow on the
// neutral surround, a value strip under each. Bases line up in one column, so the rows read as one
// chart, and the surround runs down the rows as one band. No header: the surround is the corner button.
import { useEffect, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import type { LibraryItemRef } from '../../../shared/types.ts';
import { shell, useShell } from '../../shell/core/index.ts';
import { ipc } from '../../shell/core/ipc.ts';
import { cx } from '../../ui/cx.ts';
import { Button, EmptyState, IconButton, menu, toast, type MenuItem } from '../../ui/index.ts';
import { plural } from '../common/names.ts';
import { SURROUNDS, surroundOf } from '../common/surround.ts';
import { addBase, addProposals, move, newPalette, reorder, select, selected, type Doc } from './actions.ts';
import { fromPayload, looseOf, makeRamps, rampOf, stepsOf, type IllustrationDoc } from './doc.ts';
import { clearProposals, proposals } from './proposals.ts';
import { GhostRow, LooseRow, RampRow, REORDER_MIME } from './RampRow.tsx';
import { armed, hot, patchView, type IllustrationView } from './view-state.ts';
import s from './Ramps.module.css';

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** the step columns every row shares: from the lightest step any ramp has to the darkest */
function span(d: IllustrationDoc): { lo: number; hi: number } {
  const steps = d.swatches.filter((w) => w.group !== undefined && w.step !== undefined).map((w) => w.step!);
  return { lo: Math.min(0, ...steps), hi: Math.max(0, ...steps) };
}

export function Ramps({ doc, d, v }: { doc: Doc; d: IllustrationDoc; v: IllustrationView }) {
  const ghosts = proposals.use();
  const lit = hot.use();
  const armedId = armed.use();
  const sel = selected(d, v.selected);
  const [drag, setDrag] = useState<{ id: string; at: number | null } | null>(null);
  // the confirm belongs to the ramp (or loose colour) it was armed on
  const at = sel && rampOf(d, sel.group) ? sel.group : sel?.id;
  useEffect(() => armed.set(null), [at]);
  // a new or picked ramp may sit below the fold: bring its row into view
  useEffect(() => {
    if (at) document.querySelector(`[data-tool="illustration"] [data-row="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);
  // a new set of proposals lands under the last ramp, maybe below the fold: bring it into view
  const firstGhost = ghosts?.items[0]?.id;
  useEffect(() => {
    if (firstGhost) document.querySelector('[data-tool="illustration"] [data-ghost-row]')?.scrollIntoView({ block: 'nearest' });
  }, [firstGhost]);

  const loose = looseOf(d);
  const { lo, hi } = span(d);
  const cols = hi - lo + 1;
  const surround = surroundOf(v.surround, d.swatches);
  const empty = !d.swatches.length && !ghosts;

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!drag || !e.dataTransfer.types.includes(REORDER_MIME)) return; // files: the shell routes them to onFiles
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const row = (e.target as Element).closest<HTMLElement>('[data-index]');
    if (!row) return;
    const r = row.getBoundingClientRect();
    const at = Number(row.dataset.index) + (e.clientY > r.top + r.height / 2 ? 1 : 0);
    if (at !== drag.at) setDrag({ ...drag, at });
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!drag || !e.dataTransfer.types.includes(REORDER_MIME)) return;
    e.preventDefault();
    if (drag.at !== null) reorder(doc, drag.id, drag.at);
    setDrag(null);
  };
  const insertOf = (i: number): 'before' | 'after' | undefined => {
    const at = drag?.at;
    if (at === null || at === undefined) return undefined;
    if (at === i) return 'before';
    return at === d.ramps.length && i === d.ramps.length - 1 ? 'after' : undefined;
  };

  const openView = (e: MouseEvent<HTMLButtonElement>) =>
    menu.open(
      e.currentTarget.getBoundingClientRect(),
      [{ header: 'Surround' }, ...SURROUNDS.map((o) => ({ label: o.tip, checked: v.surround === o.value, onSelect: () => patchView({ surround: o.value }) }))],
      { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined },
    );

  if (empty)
    return (
      <section className={cx(s.ramps, s.start)} aria-label="Ramps">
        <Start doc={doc} />
      </section>
    );
  return (
    <section className={s.ramps} aria-label="Ramps">
      <div className={s.tools}>
        <IconButton icon="tune" label="View: what the ramps sit on" size="sm" onContent onClick={openView} />
      </div>
      <div
        role="listbox"
        aria-label="Ramps"
        className={s.list}
        style={{ '--surround': surround } as CSSProperties}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragLeave={(e) => drag && !e.currentTarget.contains(e.relatedTarget as Node) && setDrag({ ...drag, at: null })}
        onKeyDown={(e) => {
          // on a step, up and down go to the next ramp as well (left and right also work from anywhere: the tool's shortcuts)
          const by = ARROWS[e.key];
          if (!by || !(e.target as Element).closest('[data-step]')) return;
          e.preventDefault();
          move(doc, by[0], by[1]);
        }}
      >
        {d.ramps.map((r, i) => (
          <RampRow
            key={r.id}
            doc={doc}
            d={d}
            r={r}
            index={i}
            steps={stepsOf(d, r.id)}
            lo={lo}
            cols={cols}
            sel={sel}
            lit={lit}
            armed={armedId === r.id}
            dragging={drag?.id === r.id}
            insert={insertOf(i)}
            onDragStart={() => setDrag({ id: r.id, at: null })}
            onDragEnd={() => setDrag(null)}
          />
        ))}
        {loose.length > 0 && <LooseRow doc={doc} d={d} list={loose} cols={cols} sel={sel} lit={lit} armed={armedId} />}
        {ghosts && (
          <GhostRow
            label={ghosts.label}
            items={ghosts.items}
            cols={cols}
            onAdd={(p) => addProposals(doc, [p])}
            footer={
              <>
                <span className={s.from}>
                  {ghosts.label} · {plural(ghosts.items.length, 'colour')}
                </span>
                <Button size="xs" icon="add" onClick={() => addProposals(doc, ghosts.items)}>
                  Add all
                </Button>
                <Button size="xs" variant="ghost" onClick={clearProposals}>
                  Clear
                </Button>
              </>
            }
          />
        )}
      </div>
    </section>
  );
}

/** the empty state (plan unit V): its three ways in */
function Start({ doc }: { doc: Doc }) {
  const library = useShell((st) => st.library);
  const fromPalette = (e: MouseEvent<HTMLButtonElement>) => {
    const items: MenuItem[] = (library?.collections ?? []).flatMap((c) => {
      const palettes = c.items.filter((i) => i.kind === 'palette');
      return palettes.length ? [{ header: c.name || 'Library root' }, ...palettes.map((ref) => ({ label: ref.name, icon: 'palette' as const, onSelect: () => void openPalette(doc, ref) }))] : [];
    });
    menu.open(e.currentTarget.getBoundingClientRect(), items.length ? items : [{ label: 'The Library has no palettes yet', disabled: true }], { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined });
  };
  return (
    <EmptyState
      icon="brush"
      title="Add a base colour"
      detail={
        <>
          Each base colour grows a ramp from highlight to deep shadow, lit by a light and a shadow colour you choose. You can also drop an image here to pick colours from it.
          <span className={s.actions}>
            <Button icon="add" onClick={() => addBase(doc)}>
              Add a base colour
            </Button>
            <Button icon="palette" onClick={fromPalette}>
              Make ramps from a palette
            </Button>
            <Button icon="add_photo_alternate" onClick={() => document.querySelector<HTMLInputElement>('[data-illustration-image]')?.click()}>
              Pick from an image
            </Button>
          </span>
        </>
      }
    />
  );
}

/**
 * A palette from the Library, made into ramps as a new palette in Scratch ("<name> ramps"): the
 * source stays as it is for every tool that uses it. One that is already all ramps just opens.
 */
async function openPalette(doc: Doc, ref: LibraryItemRef): Promise<void> {
  const item = await ipc.invoke('library.read', ref.id).catch((e: unknown) => {
    toast.show({ kind: 'error', message: `${ref.name} couldn't be read: ${e instanceof Error ? e.message : String(e)}` });
    return null;
  });
  if (item?.kind !== 'palette') return;
  const from = fromPayload(item.payload);
  const ids = looseOf(from).map((w) => w.id);
  if (!ids.length) return void shell.openItem(ref);
  await newPalette(`${ref.name} ramps`);
  doc.transact(`Make ramps from ${ref.name}`, () => makeRamps(from, ids));
  select(ids[0]);
}
