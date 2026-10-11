// The Design tool's screen: sections, not a canvas and an inspector. The doc bar over a Palette
// section, then the Colour picker beside a tabbed section (Contrast, Check palette, Preview in use,
// Harmonies, Variations). Adding a tab later is one more entry in the array below.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { shell } from '../../shell/core/index.ts';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { isTextField } from '../../shell/core/keys.ts';
import { cx } from '../../ui/cx.ts';
import { Button, IconButton, Kbd, menu, toast } from '../../ui/index.ts';
import { DocBar } from '../common/DocBar.tsx';
import { ExportPalette } from '../common/ExportPalette.tsx';
import { TabbedSection, type SectionTab } from '../common/Section.tsx';
import { useSettled } from '../common/settled.ts';
import { eyedrop, followLocks, giveRoles, hasJobs, lockEdited, newPalette, spaceNow, type Doc } from './actions.ts';
import { CheckTab } from './CheckTab.tsx';
import { ContrastTab } from './ContrastTab.tsx';
import { plural, TAB_LABEL, type DesignDoc, type DesignTab, type DesignView } from './doc.ts';
import { PaletteSection } from './Palette.tsx';
import { PickerSection } from './PickerSection.tsx';
import { DesignPopover, type OpenPop, type PopState } from './Popovers.tsx';
import { PreviewTab } from './PreviewTab.tsx';
import { proposals } from './proposals.ts';
import { results } from './results.ts';
import { takeText } from './sources.ts';
import { HarmoniesTab } from './HarmoniesTab.tsx';
import { VariationsTab } from './VariationsTab.tsx';
import { newSet } from './variation-actions.ts';
import { NotesModule } from '../common/Notes.tsx';
import { hot, PALETTE_H, patchView, PICKER_W, useView } from './view-state.ts';
import type { CSSProperties } from 'react';
import { jobHolders, named } from './doc.ts';
import type { Swatch } from '../../../shared/types.ts';
import s from './View.module.css';

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
      const taken = takeText(text);
      if (!taken.found) toast.show({ icon: 'content_paste', message: 'The clipboard holds no colour codes this can read.' });
      else if (taken.notes.length) toast.show({ icon: 'content_paste', message: `${taken.notes.join('. ')}.` });
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  }, [active]);
}

/**
 * The doc the Colour picker edits through: a role colour changed by hand is locked once the edit is made
 * (the gesture ends, or the one-off change lands), so a reroll never takes it back.
 */
function useHandEdits(doc: Doc): Doc {
  return useMemo(() => {
    let before: Swatch[] | null = null;
    return {
      ...doc,
      begin() {
        before ??= doc.get().swatches;
        doc.begin();
      },
      commit(label, key) {
        doc.commit(label, key);
        if (before) lockEdited(doc, before);
        before = null;
      },
      cancel() {
        before = null;
        doc.cancel();
      },
      transact(label, fn, key) {
        const was = doc.get().swatches;
        doc.transact(label, fn, key);
        lockEdited(doc, was);
      },
    };
  }, [doc]);
}

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const pickerDoc = useHandEdits(doc);
  const settled = useSettled(doc);
  const v = useView();
  const ghosts = proposals.use();
  const [pop, setPop] = useState<PopState | null>(null);
  usePaste(active);
  // Undo and Redo of a lock change (L) put the locks back
  useEffect(() => followLocks(doc), [doc]);
  // a fix can remove the row under the pointer, which then never reports leaving
  useEffect(() => void (hot.get().length && hot.set([])), [d.swatches]);
  // a popover belongs to the tool that opened it
  useEffect(() => void (!active && setPop(null)), [active]);
  const openPop: OpenPop = (kind, anchor, ends) => setPop({ kind, anchor, ends });
  const empty = d.swatches.length === 0;
  // the other-colours row is extra height for the palette, so it never squeezes the swatches it is about
  const wide = v.tab === 'variations';
  const swapping = !!v.swapRole && jobHolders(d.swatches).some(([role]) => role === v.swapRole);
  const r = results(settled.swatches, settled.ramps, v.flagL, v.flagE, v.locked, v.intended);

  const quiet = (what: string) => <p className={s.quiet}>{what}</p>;
  const when = (render: () => React.ReactNode): (() => React.ReactNode) => () => (empty ? quiet('Add a colour to the palette first.') : render());
  const tabs: SectionTab[] = [
    { id: 'contrast', label: TAB_LABEL.contrast, badge: empty ? 0 : r.failing.length, render: when(() => <ContrastTab doc={doc} d={d} v={v} r={r} />) },
    { id: 'check', label: TAB_LABEL.check, badge: empty ? 0 : r.toLookAt - r.failing.length, render: when(() => <CheckTab doc={doc} d={settled} v={v} r={r} />) },
    { id: 'preview', label: TAB_LABEL.preview, badge: empty ? 0 : r.preview.failing.length, render: when(() => <PreviewTab v={v} r={r} />) },
    { id: 'harmonies', label: TAB_LABEL.harmonies, render: when(() => <HarmoniesTab d={d} v={v} />) },
    { id: 'variations', label: TAB_LABEL.variations, render: when(() => <VariationsTab doc={doc} d={d} v={v} />) },
    // the file's own notes (an import's warnings): a tab only while there are any
    ...(d.notes ? [{ id: 'notes', label: TAB_LABEL.notes, render: () => <NotesModule doc={doc} /> }] : []),
  ].map((t, n) => ({ ...t, shortcut: `Alt+${n + 1}` })); // index.ts's Alt+N follows tabsOf, the same order

  return (
    <div className={s.view} style={{ '--palh': `${v.paletteH}px`, '--pw': `${v.pickerW}px`, '--swaph': swapping ? '136px' : '0px' } as CSSProperties}>
      <DocBar
        tool="design"
        doc={doc}
        meta={plural(d.swatches.length, 'colour')}
        switcher={{ kind: 'palette' }}
        actions={<DesignActions doc={doc} d={d} v={v} onPop={openPop} />}
        send={{ empty: 'Add a colour first: an empty palette has nothing to send' }}
        exportButton={<ExportPalette tool="design" swatches={d.swatches} named={(list) => named(list, doc.get().ramps)} format={v.format} onFormat={(format) => patchView({ format })} />}
      />
      <div className={s.cell}>
        <PaletteSection doc={doc} d={d} v={v} onPop={openPop} />
        <ResizeHandle edge="bottom" label="Palette height" value={v.paletteH} min={PALETTE_H.min} max={PALETTE_H.max} reset={PALETTE_H.reset} onChange={(paletteH) => patchView({ paletteH })} />
      </div>
      <div className={cx(s.bottom, wide && s.wide)}>
        {/* Variations has no use for the picker, so the tab takes its width: six palettes need the room */}
        {!wide && (
          <div className={s.cell}>
            <PickerSection doc={pickerDoc} d={d} v={v} />
            <ResizeHandle edge="right" label="Colour picker width" value={v.pickerW} min={PICKER_W.min} max={PICKER_W.max} reset={PICKER_W.reset} onChange={(pickerW) => patchView({ pickerW })} />
          </div>
        )}
        <TabbedSection tabs={tabs} value={v.tab} onChange={(tab) => patchView({ tab: tab as DesignTab, tabChosen: true })} bodyClassName={s.tabBody} />
      </div>
      {pop && (
        <DesignPopover
          doc={doc}
          pop={pop}
          d={d}
          v={v}
          onClose={(refocus) => {
            setPop(null);
            if (refocus && pop.anchor.isConnected) pop.anchor.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}

/** the doc bar's tool actions: Reroll (Surprise me while the palette is empty, New set on Variations, where Space means that; style and accent on the caret), + Add colours, New */
function DesignActions({ doc, d, v, onPop }: { doc: Doc; d: DesignDoc; v: DesignView; onPop: OpenPop }) {
  const add = useRef<HTMLButtonElement>(null);
  const open = (e: { currentTarget: HTMLButtonElement; detail: number }) => {
    const at = add.current ?? e.currentTarget;
    const pop = (kind: Parameters<OpenPop>[0]) => () => onPop(kind, at);
    menu.open(
      at.getBoundingClientRect(),
      [
        { label: 'From image…', icon: 'image', onSelect: pop('image') },
        { label: 'From logo…', icon: 'web_asset', onSelect: pop('logo') },
        { label: 'Paste codes…', icon: 'content_paste', shortcut: 'Ctrl+V', onSelect: pop('paste') },
        ...(CAN_PICK ? [{ label: 'Pick from screen', icon: 'colorize', shortcut: 'I', onSelect: () => void eyedrop(doc) } as const] : []),
        'separator',
        { label: 'Suggest more colours…', icon: 'star_shine', onSelect: pop('suggest') },
        { label: 'Harmony from a colour…', icon: 'join', onSelect: pop('colour') },
        { label: 'Gradient between two…', icon: 'gradient', disabled: d.swatches.length < 2, onSelect: pop('gradient') },
        'separator',
        { label: 'Open from Library…', icon: 'folder_open', onSelect: () => shell.toggleLibrary(true) },
      ],
      { owner: at, initial: e.detail === 0 ? 0 : undefined },
    );
  };
  const settings = useRef<HTMLButtonElement>(null);
  return (
    <>
      <span className={s.gen}>
        {v.tab === 'variations' && d.swatches.length > 0 ? (
          // the Variations tab's Space makes six new palettes and leaves this one alone: the button says what the key does
          <Button variant="primary" onClick={newSet} shortcut="Space" tooltip="Six new palettes to choose from. The palette you have stays as it is until you use one.">
            New set
            <Kbd>Space</Kbd>
          </Button>
        ) : d.swatches.length && !hasJobs(d.swatches) ? (
          <Button variant="primary" icon="star_shine" onClick={() => giveRoles(doc)} tooltip="No colour has a role yet, so there is nothing to reroll. This suggests Background, Text, Primary and Accent from the colours you have.">
            Give roles
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => spaceNow(doc)}
            shortcut="Space"
            tooltip={d.swatches.length ? 'New colours for every colour with a role that is not locked' : 'A palette from a random colour'}
          >
            {d.swatches.length ? 'Reroll' : 'Surprise me'}
            <Kbd>Space</Kbd>
          </Button>
        )}
        <IconButton ref={settings} icon="keyboard_arrow_down" label="Style and accent" size="sm" onClick={() => settings.current && onPop('style', settings.current)} />
      </span>
      {/* short of room these two lose their words (the bar's container query in View.module.css), never a button */}
      <Button ref={add} icon="add" iconEnd="keyboard_arrow_down" tooltip="Add colours" onClick={open}>
        <span className={s.word}>Add colours</span>
      </Button>
      <Button icon="note_add" shortcut="Ctrl+N" tooltip="New palette: this one closes and stays in the Library" onClick={() => void newPalette(doc)}>
        <span className={s.word}>New</span>
      </Button>
    </>
  );
}
