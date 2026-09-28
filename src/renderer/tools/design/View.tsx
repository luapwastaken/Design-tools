// The Design tool's screen (spec §2): swatch row on its surround, then Checks | In context, with the
// inspector (swatch, Build, Export) on the right. One screen, no tabs.
import { useEffect, useMemo, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react';
import type { ItemKind } from '../../../shared/types.ts';
import { shell, useShell } from '../../shell/core/index.ts';
import { isTextField } from '../../shell/core/keys.ts';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { cx } from '../../ui/cx.ts';
import { Button, IconButton, menu, Segmented, toast, UndoRedo, type MenuItem } from '../../ui/index.ts';
import { addSwatch, eyedrop, newPalette, type Doc } from './actions.ts';
import { Build } from './Build.tsx';
import { Checks } from './Checks.tsx';
import { named, plural, type DesignDoc, type DesignView } from './doc.ts';
import { Export } from './Export.tsx';
import { InContext } from './InContext.tsx';
import { Inspector } from './Inspector.tsx';
import { useSettled } from './settled.ts';
import { takeText } from './sources.ts';
import { SwatchRow } from './SwatchRow.tsx';
import { hot, patchView, useView } from './view-state.ts';
import s from './View.module.css';

const LOWER: { value: DesignView['lower']; label: string }[] = [
  { value: 'checks', label: 'Checks' },
  { value: 'context', label: 'In context' },
];
const INSPECTOR = { min: 340, max: 460, reset: 380 };
const CAN_PICK = 'EyeDropper' in globalThis;

/** Ctrl+V with no text field focused: colour codes become proposals (images go through onFiles) */
function usePaste(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || isTextField(document.activeElement as HTMLElement | null) || e.clipboardData?.files.length) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;
      e.preventDefault();
      if (!takeText(text).found) toast.show({ icon: 'content_paste', message: 'The clipboard holds no colour codes this can read.' });
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  }, [active]);
}

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const settled = useSettled(doc);
  const v = useView();
  usePaste(active);
  // a fix can remove the row under the pointer, which then never reports leaving
  useEffect(() => void (hot.get().length && hot.set([])), [d.swatches]);
  // blank names filled in, as the checks' sentences name them
  const shown = useMemo(() => named(settled.swatches), [settled.swatches]);
  const empty = d.swatches.length === 0;
  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={cx(s.work, empty && s.empty)}>
        <DocBar doc={doc} d={d} v={v} />
        <SwatchRow doc={doc} d={d} v={v} />
        {/* both stay mounted, so each keeps its state when switched (spec §6.3) */}
        <div className={s.lower}>
          {empty && <p className={s.later}>Checks and the website preview show here once the palette has colours.</p>}
          <div className={s.pane} hidden={empty || v.lower !== 'checks'}>
            <Checks doc={doc} d={settled} v={v} />
          </div>
          <div className={s.pane} hidden={empty || v.lower !== 'context'}>
            <InContext swatches={shown} hidden={v.lower !== 'context'} />
          </div>
        </div>
        <ResizeHandle
          value={v.inspector}
          min={INSPECTOR.min}
          max={INSPECTOR.max}
          reset={INSPECTOR.reset}
          label="Inspector width"
          edge="left"
          onChange={(w) => patchView({ inspector: w })}
        />
      </div>
      <aside className={s.insp} aria-label="Inspector">
        <Inspector doc={doc} d={d} v={v} />
        <Build d={d} v={v} />
        <Export d={d} v={v} />
      </aside>
    </div>
  );
}

function DocBar({ doc, d, v }: { doc: Doc; d: DesignDoc; v: DesignView }) {
  const name = useShell((st) => st.docNames.design) ?? 'Untitled';
  const collection = useSyncExternalStore(doc.subscribe, () => doc.source()?.collection ?? null);
  const sendKind = useSyncExternalStore(doc.subscribe, () => shell.sendKind('design'));
  return (
    <div className={s.docbar}>
      <h1 className={s.title}>{name}</h1>
      {collection !== null && (
        <>
          <span className={cx('lbl', s.where)}>{collection || 'Library'}</span>
          <span className={cx('lbl', s.where)}>/</span>
        </>
      )}
      <span className={cx('lbl', s.count)}>{plural(d.swatches.length, 'swatch', 'swatches')}</span>
      <IconButton icon="note_add" label="New palette" shortcut="Ctrl+N" size="sm" onClick={() => void newPalette()} />
      <span className={s.grow} />
      <Segmented options={LOWER} value={v.lower} onChange={(lower) => patchView({ lower })} fit className={s.lowerSwitch} />
      <span className={s.sep} />
      <UndoRedo doc={doc} />
      {CAN_PICK && (
        <>
          <span className={s.sep} />
          <IconButton icon="colorize" label="Pick a colour from the screen" shortcut="I" onClick={() => void eyedrop(doc)} />
        </>
      )}
      <span className={s.sep} />
      <Button icon="add" onClick={() => addSwatch(doc)} tooltip="Add the selected hue at the lightness the palette lacks most">
        <span className={s.addText}>Add swatch</span>
      </Button>
      <SendTo kind={sendKind} />
    </div>
  );
}

/** the palette to another tool (spec §7.4) */
function SendTo({ kind }: { kind: ItemKind | null }) {
  const open = (e: MouseEvent<HTMLButtonElement>) => {
    if (!kind) return;
    const items: MenuItem[] = shell
      .targetsFor(kind)
      .filter((t) => t.tool.id !== 'design')
      .map(({ tool, use }) => ({ label: tool.label, icon: tool.icon, hint: use.label, onSelect: () => void shell.sendDoc('design', tool.id) }));
    // detail 0: opened from the keyboard, so start on the first row
    menu.open(e.currentTarget.getBoundingClientRect(), items.length ? items : [{ label: 'No other tool takes a palette yet', disabled: true }], {
      owner: e.currentTarget,
      initial: e.detail === 0 ? 0 : undefined,
    });
  };
  return (
    <Button icon="send" disabled={!kind} onClick={open} tooltip={kind ? undefined : 'Add a colour first: an empty palette has nothing to send'}>
      Send to
    </Button>
  );
}
