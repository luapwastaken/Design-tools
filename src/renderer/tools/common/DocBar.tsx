import { useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react';
import type { DocController } from '../../../shared/doc-api.ts';
import type { ToolId } from '../../../shared/types.ts';
import { shell, useShell } from '../../shell/core/index.ts';
import type { IconName } from '../../shell/tool.ts';
import { cx } from '../../ui/cx.ts';
import { Button, Icon, IconButton, menu, TextInput, Tooltip, UndoRedo, type MenuItem } from '../../ui/index.ts';
import { ExportPalette, type ExportPaletteProps } from './ExportPalette.tsx';
import { useWidth } from './useWidth.ts';
import s from './DocBar.module.css';

const CAN_PICK = 'EyeDropper' in globalThis;
/**
 * A narrowing bar gives way in this order (after the place, the count and Add's label, in CSS):
 * Send to's label, then the tab names (their icons stay, and the badge): the document's own name
 * matters more than the tab labels, which the icons and tooltips carry, since two palettes are told apart by it.
 */
const SEND_ICON = 740;
const TAB_LABELS_ONLY = 680;
/** the work area is 540 to 560 with the Library open on a 1280 window: there the name keeps 140px or so; from 600 down the bar's gaps tighten too */
const TAB_ICONS_ONLY = 620;
const TIGHT = 600;

/** `off`: why the tab can't open yet (its tooltip) */
export type DocTab<T extends string> = { value: T; label: string; icon: IconName; badge?: number; off?: string };

/** a count past two digits is noise on a tab: the check's own line says how many */
const badgeText = (n: number) => (n > 99 ? '99+' : String(n));

type Props<T extends string> = {
  tool: ToolId;
  doc: DocController<unknown>;
  /** mono caps after the name: "6 swatches", "4 ramps" */
  count: string;
  onNew(): void;
  /** the tool's jobs, in working order (Build · Check · Preview, Light · Check · Paint) */
  tabs: { options: DocTab<T>[]; value: T; onChange(t: T): void };
  onPick(): void;
  add: { label: string; tooltip: string; run(): void };
  /** Send to's tooltip while the palette is empty */
  empty: string;
  exportPalette: ExportPaletteProps;
};

/** A colour tool's document bar: its palette's name and place, New, the jobs as tabs, undo, pick, add, Export, Send to. */
export function DocBar<T extends string>({ tool, doc, count, onNew, tabs, onPick, add, empty, exportPalette }: Props<T>) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const narrow = (below: number) => width > 0 && width < below;
  return (
    <div ref={ref} className={cx(s.docbar, s.jobs, narrow(TIGHT) && s.tight)}>
      <DocHead tool={tool} doc={doc} />
      <span className={cx('lbl', s.count)}>{count}</span>
      <IconButton icon="note_add" label="New palette" shortcut="Ctrl+N" size="sm" onClick={onNew} />
      <Tabs {...tabs} show={narrow(TAB_ICONS_ONLY) ? 'icons' : narrow(TAB_LABELS_ONLY) ? 'labels' : 'both'} />
      <span className={s.grow} />
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
      <ExportPalette {...exportPalette} />
      <SendTo tool={tool} doc={doc} empty={empty} compact={narrow(SEND_ICON)} />
    </div>
  );
}

const STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

/** One Tab stop; the arrows move and choose, past tabs that are off (brief §6). Icons alone: each named by its tooltip. */
function Tabs<T extends string>({ options, value, onChange, show }: Props<T>['tabs'] & { show: 'both' | 'labels' | 'icons' }) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const open = options.filter((o) => !o.off);
    const n = open.length;
    const at = open.findIndex((o) => o.value === value);
    const i = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : e.key in STEP ? (Math.max(at, 0) + STEP[e.key] + n) % n : -1;
    if (i < 0 || !n) return;
    e.preventDefault();
    onChange(open[i].value);
    (e.currentTarget.children[options.indexOf(open[i])] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="tablist" aria-label="Jobs" className={cx(s.tabs, show === 'icons' && s.iconsOnly, show === 'labels' && s.labelsOnly)} onKeyDown={onKeyDown}>
      {options.map((o) => {
        const on = o.value === value;
        const tip = o.off ?? (o.badge ? `${o.label}: ${o.badge} to look at` : o.label);
        return (
          <Tooltip key={o.value} content={tip} disabled={!o.off && show !== 'icons' && !o.badge}>
            <button
              type="button"
              role="tab"
              aria-selected={on}
              aria-label={o.badge ? `${o.label}, ${o.badge} to look at` : o.label}
              tabIndex={on ? 0 : -1}
              disabled={!!o.off}
              className={cx(s.tab, on && s.on)}
              onClick={() => onChange(o.value)}
            >
              {show !== 'labels' && <Icon name={o.icon} fill={on} />}
              {show !== 'icons' && o.label}
              {!!o.badge && <span className={s.badge}>{badgeText(o.badge)}</span>}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
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
  const collection = source ? source.collection : null;
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
      {collection !== null && <span className={cx('lbl', s.where)}>{collection || 'Library'} ·</span>}
    </>
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
