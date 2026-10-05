// The stack (spec §2): the effects as layers, applied top to bottom, with the selected layer's settings
// open inline under its row. Add from a grouped list with a
// search, reorder by drag or Alt and an arrow, hide, duplicate, and delete with the armed confirm and
// an Undo toast. A video-only effect on a still keeps its row, set back, with a tag saying why it's skipped.
import { Fragment, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { Button, ConfirmInline, Icon, IconButton, InspectorGroup, menu, Tooltip, type MenuAnchor } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { plural } from '../common/names.ts';
import { addEffect, deleteLayer, duplicate, labelOf, moveTo, resetLayer, toggleLayer, type Doc } from './actions.ts';
import { BLENDS, effectOf } from './effects/index.ts';
import { LIMIT, offered, type Layer, type PostFxDoc, type Timeline } from './doc.ts';
import { EffectPicker, VIDEO_ONLY_TIP } from './EffectPicker.tsx';
import { LayerBody } from './Layer.tsx';
import { patchView, useView } from './view-state.ts';
import s from './Stack.module.css';

/** internal reorders carry this type (foundation spec §9), so OS files dropped here still go to onFiles */
const REORDER_MIME = 'application/x-designtools-reorder';

const blendOf = (l: Layer) => BLENDS.find((b) => b.id === l.blend)?.label ?? l.blend;

type Picker = { anchor: DOMRect; owner: HTMLElement | null };

export function StackModule({ doc, d, t }: { doc: Doc; d: PostFxDoc; t: Timeline }) {
  const { selected } = useView();
  const [picker, setPicker] = useState<Picker | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; at: number | null } | null>(null);
  const stack = d.stack;
  const sel = stack.find((l) => l.id === selected) ?? null;
  const full = stack.length >= LIMIT.layers;
  const on = stack.filter((l) => l.on && offered(d, l.effect)).length;

  const focusRow = (id: string | undefined) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-layer="${id}"]`)?.focus());
  const openPicker = (e: MouseEvent<HTMLButtonElement>) => {
    const owner = e.currentTarget;
    setPicker((p) => (p ? null : { anchor: owner.getBoundingClientRect(), owner }));
  };

  const openMenu = (l: Layer, at: MenuAnchor, fromKey: boolean) => {
    patchView({ selected: l.id });
    const i = stack.indexOf(l);
    menu.open(
      at,
      [
        { label: l.on ? 'Hide' : 'Show', icon: l.on ? 'visibility_off' : 'visibility', onSelect: () => toggleLayer(doc, l.id) },
        { label: 'Duplicate', icon: 'content_copy', shortcut: 'Ctrl+D', disabled: full, onSelect: () => duplicate(doc, l.id) },
        { label: 'Move up', icon: 'arrow_upward', shortcut: 'Alt+ArrowUp', disabled: i === 0, onSelect: () => moveTo(doc, l.id, i - 1) },
        { label: 'Move down', icon: 'arrow_downward', shortcut: 'Alt+ArrowDown', disabled: i === stack.length - 1, onSelect: () => moveTo(doc, l.id, i + 2) },
        { label: 'Reset to defaults', icon: 'restart_alt', onSelect: () => resetLayer(doc, l.id) },
        'separator',
        { label: 'Delete', icon: 'delete', shortcut: 'Delete', danger: true, onSelect: () => setArmed(l.id) },
      ],
      { initial: fromKey ? 0 : undefined },
    );
  };

  // one Tab stop: arrows choose, Alt and an arrow move, Delete arms the confirm (brief §6)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!sel || (e.target as Element).closest('[role="alertdialog"], button, [data-layer-body], input, select, textarea')) return;
    const i = stack.indexOf(sel);
    const by = { ArrowUp: -1, ArrowDown: 1, Home: -Infinity, End: Infinity }[e.key];
    if (by !== undefined) {
      e.preventDefault();
      const to = Math.min(stack.length - 1, Math.max(0, i + by));
      if (e.altKey && Number.isFinite(by)) moveTo(doc, sel.id, by > 0 ? to + 1 : to);
      else patchView({ selected: stack[to].id });
      focusRow(e.altKey ? sel.id : stack[to].id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setArmed(sel.id);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      toggleLayer(doc, sel.id);
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      openMenu(sel, (e.target as HTMLElement).getBoundingClientRect(), true);
    }
  };

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
    if (drag.at !== null) moveTo(doc, drag.id, drag.at);
    setDrag(null);
  };

  const video = d.source?.kind === 'video';

  return (
    <InspectorGroup
      id="postfx.effects"
      title="Effects"
      sub="Top to bottom"
      meta={stack.length ? (on === stack.length ? plural(stack.length, 'layer') : `${on} of ${stack.length} on`) : undefined}
      actions={<IconButton icon="add" label={full ? `A stack holds up to ${LIMIT.layers} layers` : 'Add an effect'} size="sm" latched={!!picker} disabled={full} onClick={openPicker} />}
      flush
    >
      {stack.length === 0 ? (
        <div className={s.empty}>
          <p className={s.emptyText}>No effects yet. Add one, or start from a preset below.</p>
          <Button icon="add" onClick={openPicker}>
            Add an effect
          </Button>
        </div>
      ) : (
        <div
          className={s.list}
          role="listbox"
          aria-label="Stack, top to bottom"
          onKeyDown={onKey}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && drag && setDrag({ ...drag, at: null })}
        >
          {stack.map((l, n) => {
            const fx = effectOf(l.effect);
            const skipped = !offered(d, l.effect);
            const insert = drag?.at === n ? 'before' : drag?.at === stack.length && n === stack.length - 1 ? 'after' : undefined;
            if (armed === l.id)
              return (
                <div key={l.id} className={s.confirm}>
                  <ConfirmInline
                    icon="delete"
                    title={`Delete ${labelOf(l)}?`}
                    detail="Its settings go with it. Undo brings it back."
                    confirmLabel="Delete"
                    danger
                    onConfirm={() => {
                      setArmed(null);
                      deleteLayer(doc, l.id);
                      focusRow(stack[n + 1]?.id ?? stack[n - 1]?.id);
                    }}
                    onKeep={() => {
                      setArmed(null);
                      focusRow(l.id);
                    }}
                  />
                </div>
              );
            return (
              <Fragment key={l.id}>
              <div
                role="option"
                aria-selected={l.id === selected}
                aria-label={`${labelOf(l)}${l.on ? '' : ', hidden'}${skipped ? ', video only, skipped' : ''}`}
                tabIndex={l.id === (sel ?? stack[0]).id ? 0 : -1}
                data-layer={l.id}
                data-index={n}
                data-insert={insert}
                className={cx(s.row, l.id === selected && s.on, !l.on && s.hidden, skipped && s.skipped, drag?.id === l.id && s.dragging)}
                onClick={() => patchView({ selected: l.id })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(l, { x: e.clientX, y: e.clientY }, false);
                }}
              >
                <span
                  className={s.grip}
                  draggable
                  aria-hidden="true"
                  onDragStart={(e) => {
                    const row = e.currentTarget.closest('[data-index]');
                    if (row) e.dataTransfer.setDragImage(row, 12, 16);
                    e.dataTransfer.setData(REORDER_MIME, l.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDrag({ id: l.id, at: null });
                  }}
                  onDragEnd={() => setDrag(null)}
                >
                  <Icon name="drag_indicator" size={16} />
                </span>
                <IconButton icon={l.on ? 'visibility' : 'visibility_off'} label={`${l.on ? 'Hide' : 'Show'} ${labelOf(l)}`} size="sm" tabIndex={-1} onClick={() => toggleLayer(doc, l.id)} />
                <span className={s.ident}>
                  <span className={s.name}>
                    <Tooltip content={labelOf(l)} overflowOnly>
                      <span className={s.label}>{labelOf(l)}</span>
                    </Tooltip>
                    {fx?.moving && !skipped && (
                      <Tooltip content="Moves when played: it loops with the timeline">
                        <span className={s.moves}>
                          <Icon name="waves" size={14} />
                        </span>
                      </Tooltip>
                    )}
                  </span>
                  <span className={s.meta}>
                    {skipped ? (
                      <Tooltip content={`${VIDEO_ONLY_TIP} It is skipped until a clip is open.`}>
                        <span className={s.tag}>Video only</span>
                      </Tooltip>
                    ) : (
                      <>
                        {blendOf(l)} · {Math.round(l.opacity * 100)}%
                      </>
                    )}
                  </span>
                </span>
                <IconButton icon="more_horiz" label={`More for ${labelOf(l)}`} size="sm" tabIndex={-1} onClick={(e) => openMenu(l, e.currentTarget.getBoundingClientRect(), e.detail === 0)} />
              </div>
              {l.id === selected && <LayerBody doc={doc} d={d} l={l} t={t} />}
              </Fragment>
            );
          })}
        </div>
      )}
      {picker && <EffectPicker anchor={picker.anchor} owner={picker.owner} video={video} onPick={(id) => addEffect(doc, id)} onClose={() => setPicker(null)} />}
    </InspectorGroup>
  );
}
