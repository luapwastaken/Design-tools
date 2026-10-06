// The Illustration tool's screen: sections, not a canvas and an inspector. Ramps (left, full height),
// the Selected ramp (top right), the Colour picker (bottom left of the right column) and a tabbed
// section (Ramp settings | Light & preview | Check values | Paint, Alt+1-4). A new tab is one more
// entry in TABS. Paint stays mounted while another tab shows, so it keeps its engine and its painting.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { isTextField } from '../../shell/core/keys.ts';
import { Button } from '../../ui/index.ts';
import { DocBar } from '../common/DocBar.tsx';
import { ExportPalette } from '../common/ExportPalette.tsx';
import { NotesModule } from '../common/Notes.tsx';
import { plural } from '../common/names.ts';
import { TabbedSection, type SectionTab } from '../common/Section.tsx';
import { newPalette, type Doc } from './actions.ts';
import { CheckTab } from './Check.tsx';
import { useChecks, type Checks } from './CheckPane.tsx';
import { named, type IllustrationDoc } from './doc.ts';
import { LightTab } from './Light.tsx';
import { Palette } from './Palette.tsx';
import { PaintPane } from './PaintPane.tsx';
import { PickerSection } from './PickerSection.tsx';
import { sourcePop } from './proposals.ts';
import { SelectedRamp } from './Ramps.tsx';
import { RampSettings } from './RampSettings.tsx';
import { pasteColours } from './starts.ts';
import { hot, patchView, SIZES, useView, type IllustrationView } from './view-state.ts';
import s from './View.module.css';

type Tab = IllustrationView['tab'];
type Ctx = { doc: Doc; d: IllustrationDoc; v: IllustrationView; checks: Checks; empty: boolean; source: string | null; paint: HTMLElement };

/** the tabs, in order: adding a feature is one more entry here (Alt+N in index.ts follows the order) */
const TABS: { id: Tab; label: string; needsColour?: boolean; when?(c: Ctx): boolean; badge?(c: Ctx): number; render(c: Ctx): React.ReactNode }[] = [
  { id: 'settings', label: 'Ramp settings', render: (c) => <RampSettings doc={c.doc} d={c.d} v={c.v} /> },
  { id: 'light', label: 'Light & preview', needsColour: true, render: (c) => <LightTab doc={c.doc} d={c.d} v={c.v} /> },
  // mounted only while it shows
  { id: 'check', label: 'Check values', needsColour: true, badge: (c) => c.checks.problems, render: (c) => <CheckTab key={c.source} doc={c.doc} d={c.d} v={c.v} checks={c.checks} /> },
  { id: 'paint', label: 'Paint', render: (c) => <PaintSlot host={c.paint} /> },
  // only while the file has notes (an imported palette's warnings); clearing them closes it
  { id: 'notes', label: 'Notes', when: (c) => !!c.d.notes, render: (c) => <NotesModule doc={c.doc} /> },
];

/** the paint pane lives in a DOM node of its own; the Paint tab holds it while it shows, so the engine is never torn down */
function PaintSlot({ host }: { host: HTMLElement }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    slot.current!.append(host);
    return () => host.remove();
  }, [host]);
  return <div ref={slot} className={s.slot} />;
}

/** Ctrl+V with no text field focused: codes become ramps (one at once, several under the Add colour popover); images go through onFiles */
function usePaste(doc: Doc, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || isTextField(document.activeElement as HTMLElement | null) || e.clipboardData?.files.length) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;
      e.preventDefault();
      pasteColours(doc, text);
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  }, [doc, active]);
}

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  usePaste(doc, active);
  // a popover belongs to the tool that opened it
  useEffect(() => void (!active && sourcePop.set(null)), [active]);
  const v = useView();
  const checks = useChecks(doc, v);
  const [paint] = useState(() => Object.assign(document.createElement('div'), { className: s.host }));
  // a fix can remove the row under the pointer, which then never reports leaving
  useEffect(() => void (hot.get().length && hot.set([])), [d.swatches]);
  const source = useSyncExternalStore(doc.subscribe, () => doc.source()?.itemId ?? null);
  const empty = d.swatches.length === 0;
  // Light and Check have nothing to show without a colour; Paint doesn't need the palette (the tubes work alone)
  const ctx: Ctx = { doc, d, v, checks, empty, source, paint };
  const tabs: SectionTab[] = TABS.filter((t) => !t.when || t.when(ctx)).map((t) => ({
    id: t.id,
    label: t.label,
    badge: !empty && t.badge ? t.badge(ctx) : undefined,
    disabled: empty && t.needsColour ? 'Add a colour first' : undefined,
    render: () => t.render(ctx),
  }));
  const tab = (tabs.find((t) => t.id === v.tab && !t.disabled) ?? tabs[0]).id as Tab;
  return (
    <div className={s.view}>
      <DocBar
        tool="illustration"
        doc={doc}
        switcher={{ kind: 'palette' }}
        meta={plural(d.ramps.length, 'ramp')}
        actions={
          <Button icon="note_add" shortcut="Ctrl+N" tooltip="New palette" onClick={() => void newPalette(doc)}>
            New
          </Button>
        }
        send={{ empty: 'Add a colour first: an empty palette has nothing to send' }}
        exportButton={<ExportPalette tool="illustration" swatches={d.swatches} named={() => named(doc.get())} format={v.format} onFormat={(format) => patchView({ format })} />}
      />
      <div className={s.main} style={{ '--ramps-w': `${v.rampsWidth}px`, '--ramp-h': `${v.rampHeight}px`, '--picker-w': `${v.pickerWidth}px` } as CSSProperties}>
        <div className={s.cell}>
          <Palette doc={doc} d={d} v={v} />
          <ResizeHandle label="Ramps width" value={v.rampsWidth} min={SIZES.rampsWidth[0]} max={SIZES.rampsWidth[1]} reset={SIZES.rampsWidth[2]} onChange={(rampsWidth) => patchView({ rampsWidth })} />
        </div>
        <div className={s.right}>
          <div className={s.cell}>
            <SelectedRamp doc={doc} d={d} v={v} />
            <ResizeHandle edge="bottom" label="Selected ramp height" value={v.rampHeight} min={SIZES.rampHeight[0]} max={SIZES.rampHeight[1]} reset={SIZES.rampHeight[2]} onChange={(rampHeight) => patchView({ rampHeight })} />
          </div>
          <div className={s.lower}>
            <div className={s.cell}>
              <PickerSection doc={doc} d={d} v={v} />
              <ResizeHandle label="Colour picker width" value={v.pickerWidth} min={SIZES.pickerWidth[0]} max={SIZES.pickerWidth[1]} reset={SIZES.pickerWidth[2]} onChange={(pickerWidth) => patchView({ pickerWidth })} />
            </div>
            <TabbedSection tabs={tabs} value={tab} onChange={(id) => patchView({ tab: id as Tab })} bodyClassName={tab === 'paint' ? s.flush : undefined} />
          </div>
        </div>
      </div>
      {createPortal(<PaintPane doc={doc} d={d} v={v} hidden={!active || tab !== 'paint'} />, paint)}
    </div>
  );
}
