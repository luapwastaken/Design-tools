import { useSyncExternalStore, type MouseEvent } from 'react';
import type { DocController } from '../../../shared/doc-api.ts';
import type { ToolId } from '../../../shared/types.ts';
import { shell, useShell } from '../../shell/core/index.ts';
import { cx } from '../../ui/cx.ts';
import { Button, IconButton, menu, Segmented, UndoRedo, type MenuItem, type SegmentedProps } from '../../ui/index.ts';
import s from './DocBar.module.css';

const CAN_PICK = 'EyeDropper' in globalThis;

type Props<L extends string> = {
  tool: ToolId;
  doc: DocController<unknown>;
  /** mono caps after the name: "6 swatches", "4 ramps" */
  count: string;
  onNew(): void;
  /** the work area's switch (Checks | In context, Light | Paint) */
  lower: Pick<SegmentedProps<L>, 'options' | 'value' | 'onChange'>;
  onPick(): void;
  add: { label: string; tooltip: string; run(): void };
  /** Send to's tooltip while the palette is empty */
  empty: string;
};

/** A colour tool's document bar: its palette's name and place, New, the lower switch, undo, pick, add, Send to. */
export function DocBar<L extends string>({ tool, doc, count, onNew, lower, onPick, add, empty }: Props<L>) {
  const name = useShell((st) => st.docNames[tool]) ?? 'Untitled';
  const collection = useSyncExternalStore(doc.subscribe, () => doc.source()?.collection ?? null);
  return (
    <div className={s.docbar}>
      <h1 className={s.title}>{name}</h1>
      {collection !== null && (
        <>
          <span className={cx('lbl', s.where)}>{collection || 'Library'}</span>
          <span className={cx('lbl', s.where)}>/</span>
        </>
      )}
      <span className={cx('lbl', s.count)}>{count}</span>
      <IconButton icon="note_add" label="New palette" shortcut="Ctrl+N" size="sm" onClick={onNew} />
      <span className={s.grow} />
      <Segmented {...lower} fit className={s.lowerSwitch} />
      <span className={s.sep} />
      <UndoRedo doc={doc} />
      {CAN_PICK && (
        <>
          <span className={s.sep} />
          <IconButton icon="colorize" label="Pick a colour from the screen" shortcut="I" onClick={onPick} />
        </>
      )}
      <span className={s.sep} />
      <Button icon="add" onClick={add.run} tooltip={add.tooltip}>
        <span className={s.addText}>{add.label}</span>
      </Button>
      <SendTo tool={tool} doc={doc} empty={empty} />
    </div>
  );
}

/** A tool's item to another tool (foundation spec §7.4). `empty`: why it's off while the document is; `noun`: what it sends. */
export function SendTo({ tool, doc, empty, noun = 'palette' }: { tool: ToolId; doc: DocController<unknown>; empty: string; noun?: string }) {
  const kind = useSyncExternalStore(doc.subscribe, () => shell.sendKind(tool));
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    if (!kind) return;
    const items: MenuItem[] = shell
      .targetsFor(kind)
      .filter((t) => t.tool.id !== tool)
      .map(({ tool: to, use }) => ({ label: to.label, icon: to.icon, hint: use.label, onSelect: () => void shell.sendDoc(tool, to.id) }));
    // detail 0: opened from the keyboard, so start on the first row
    menu.open(e.currentTarget.getBoundingClientRect(), items.length ? items : [{ label: `No other tool takes a ${noun} yet`, disabled: true }], {
      owner: e.currentTarget,
      initial: e.detail === 0 ? 0 : undefined,
    });
  };
  return (
    <Button icon="send" disabled={!kind} onClick={open} tooltip={kind ? undefined : empty}>
      Send to
    </Button>
  );
}
