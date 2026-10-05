import { useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode, type Ref } from 'react';
import type { DocController } from '../../../shared/doc-api.ts';
import type { ToolId } from '../../../shared/types.ts';
import { shell, useShell } from '../../shell/core/index.ts';
import { cx } from '../../ui/cx.ts';
import { Button, menu, TextInput, Tooltip, UndoRedo, type MenuItem } from '../../ui/index.ts';
import { useWidth } from './useWidth.ts';
import s from './DocBar.module.css';

/** Send to loses its label first; the meta goes in CSS (container query) before that */
const SEND_ICON = 740;

export type DocBarProps = {
  tool: ToolId;
  doc: DocController<unknown>;
  /**
   * The name shown. Omit it for a tool whose document is a Library item: the shell's name for it,
   * click to rename, with the collection after it. Give it for a tool named after its source ("photo.png").
   */
  title?: string;
  /** mono meta after the title: "6 swatches", "786 × 512 px · 300 ppi" */
  meta?: ReactNode;
  /** small tool actions after the meta: IconButtons (New, Open an image), one Button (Surprise me) */
  actions?: ReactNode;
  /** the tool's one view/mode switch, centred: a Segmented with icons (badges go in the Segmented's options) */
  modes?: ReactNode;
  /** Send to's wording (see SendTo); false: the tool hands nothing on */
  send?: { noun?: string; empty: string; tip?: string } | false;
  /** the primary Export: an ExportButton (or ExportPalette). The slot is kept when absent, so Send to never shifts. */
  exportButton?: ReactNode;
};

/**
 * A tool's document bar, the same slots in all seven tools:
 * title + meta + actions | modes (centred) | Undo, Redo | Send to | Export (last).
 */
export function DocBar({ tool, doc, title, meta, actions, modes, send, exportButton }: DocBarProps) {
  const { ref, width } = useWidth<HTMLDivElement>();
  return (
    <div ref={ref} className={s.docbar}>
      <div className={s.left}>
        {title === undefined ? <DocHead tool={tool} doc={doc} /> : <DocTitle>{title}</DocTitle>}
        <DocStatus tool={tool} />
        {meta !== undefined && meta !== null && meta !== false && <span className={s.meta}>{meta}</span>}
        {actions}
      </div>
      <div className={s.modes}>{modes}</div>
      <div className={s.right}>
        <UndoRedo doc={doc} />
        {send !== false && <SendTo tool={tool} doc={doc} noun={send?.noun} empty={send?.empty ?? 'Nothing to send yet'} tip={send?.tip} compact={width > 0 && width < SEND_ICON} />}
        <div className={s.exportSlot}>{exportButton}</div>
      </div>
    </div>
  );
}

/** The primary Export for a DocBar's `exportButton`: bone fill, always labelled. `tooltip` names why it is off. */
export function ExportButton({ onClick, disabled, tooltip, ref }: { onClick?(e: MouseEvent<HTMLButtonElement>): void; disabled?: boolean; tooltip?: string; ref?: Ref<HTMLButtonElement> }) {
  return (
    <Button ref={ref} variant="primary" icon="download" disabled={disabled} onClick={onClick} tooltip={tooltip}>
      Export
    </Button>
  );
}

/**
 * The doc bar's one Export for a tool with several formats: the primary button, opening a menu of them.
 * The formats' sizes and options live in the inspector's Export group; the menu only chooses.
 * `items` is read when it opens, so a disabled row says why from the state at that moment.
 */
export function ExportMenu({ items, disabled, tooltip }: { items(): MenuItem[]; disabled?: boolean; tooltip?: string }) {
  const at = useRef<HTMLButtonElement>(null);
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    const b = at.current;
    if (b) menu.open(b.getBoundingClientRect(), items(), { owner: b, initial: e.detail === 0 ? 0 : undefined });
  };
  return <ExportButton ref={at} disabled={disabled} tooltip={tooltip} onClick={open} />;
}

/**
 * The document's name at the head of a tool's bar; cut off, it shows whole in a tooltip (brief §7).
 * With `onRename` it is a button: a click turns it into the name's field.
 */
export const DocTitle = ({ children, onRename }: { children: string; onRename?: () => void }) =>
  onRename ? (
    <h1 className={s.title}>
      <Tooltip overflowOnly>
        <button type="button" className={s.titleBtn} onClick={onRename}>
          {children}
        </button>
      </Tooltip>
    </h1>
  ) : (
    <Tooltip overflowOnly>
      <h1 className={s.title}>{children}</h1>
    </Tooltip>
  );

/** The head of a bar for a tool whose document is a Library item: its name, then the collection it sits in. */
export function DocHead({ tool, doc }: { tool: ToolId; doc: DocController<unknown> }) {
  const name = useShell((st) => st.docNames[tool]) ?? 'Untitled';
  const source = useSyncExternalStore(doc.subscribe, () => doc.source());
  // the Library's rename, from the bar: the item the document is, once it has one
  const ref = useShell((st) => (source ? st.library?.collections.flatMap((c) => c.items).find((x) => x.id === source.itemId) : undefined));
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      {renaming && ref ? (
        <TextInput
          value={ref.name}
          autoFocus
          selectOnFocus
          className={s.rename}
          validate={(v) => (v.trim() ? null : 'Give it a name.')}
          onCommit={(v) => {
            setRenaming(false);
            if (v.trim() !== ref.name) void shell.renameItem(ref, v.trim());
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <DocTitle onRename={ref ? () => setRenaming(true) : undefined}>{name}</DocTitle>
      )}
    </>
  );
}

/** Where the document stands, quiet sentence case after the title ("Scratch · saved 03:46"); trouble gets its actions. */
export function DocStatus({ tool }: { tool: ToolId }) {
  useShell((st) => st.docStates[tool]);
  useShell((st) => st.owners);
  const r = shell.readout(tool);
  if (!r.text) return null;
  return (
    <span className={s.status} data-tone={r.tone} role="status">
      <span className={s.statusText}>{r.text}</span>
      {r.actions.map((a) => (
        <Button key={a.label} size="xs" onClick={a.run}>
          {a.label}
        </Button>
      ))}
    </span>
  );
}

/**
 * A tool's item to another tool (foundation spec §7.4). `empty`: why it's off while the document is;
 * `noun`: what it sends; `tip`: what it hands on, when that isn't plain; `compact`: the icon alone.
 */
export function SendTo({ tool, doc, empty, noun = 'palette', tip, compact }: { tool: ToolId; doc: DocController<unknown>; empty: string; noun?: string; tip?: string; compact?: boolean }) {
  const kind = useSyncExternalStore(doc.subscribe, () => shell.sendKind(tool));
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    if (!kind) return;
    const items: MenuItem[] = shell
      .targetsFor(kind, tool)
      .filter((t) => t.tool.id !== tool)
      .map(({ tool: to, use }) => ({ label: to.label, icon: to.icon, hint: use.label, onSelect: () => void shell.sendDoc(tool, to.id) }));
    // detail 0: opened from the keyboard, so start on the first row
    menu.open(e.currentTarget.getBoundingClientRect(), items.length ? items : [{ label: `No other tool takes a ${noun} yet`, disabled: true }], {
      owner: e.currentTarget,
      initial: e.detail === 0 ? 0 : undefined,
    });
  };
  return (
    <Button icon="send" disabled={!kind} onClick={open} tooltip={kind ? (tip ?? (compact ? 'Send to' : undefined)) : empty}>
      <span className={cx(compact && s.hidden)}>Send to</span>
    </Button>
  );
}
