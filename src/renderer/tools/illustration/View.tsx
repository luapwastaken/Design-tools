// The Illustration tool's screen: sections, not a canvas and an inspector. Ramps (left, full height),
// the Selected ramp (top right), the Colour picker (bottom left of the right column) and a tabbed
// section (Ramp settings | Light & preview | Check values | Paint, Alt+1-4). A new tab is one more
// entry in TABS. Paint stays mounted while another tab shows, so it keeps its engine and its painting.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton, toast } from '../../ui/index.ts';
import { DocBar } from '../common/DocBar.tsx';
import { ExportPalette } from '../common/ExportPalette.tsx';
import { plural } from '../common/names.ts';
import { TabbedSection, type SectionTab } from '../common/Section.tsx';
import { addBase, newPalette, type Doc } from './actions.ts';
import { CheckTab } from './Check.tsx';
import { useChecks, type Checks } from './CheckPane.tsx';
import { named, type IllustrationDoc } from './doc.ts';
import { LightTab } from './Light.tsx';
import { Palette } from './Palette.tsx';
import { PaintPane } from './PaintPane.tsx';
import { PickerSection } from './PickerSection.tsx';
import { takeImage } from './proposals.ts';
import { SelectedRamp } from './Ramps.tsx';
import { RampSettings } from './RampSettings.tsx';
import { pickImage } from './starts.ts';
import { hot, patchView, useView, type IllustrationView } from './view-state.ts';
import s from './View.module.css';

type Tab = IllustrationView['tab'];
type Ctx = { doc: Doc; d: IllustrationDoc; v: IllustrationView; checks: Checks; empty: boolean; source: string | null; paint: HTMLElement };

/** the tabs, in order: adding a feature is one more entry here (Alt+N in index.ts follows the order) */
const TABS: { id: Tab; label: string; needsColour?: boolean; badge?(c: Ctx): number; render(c: Ctx): React.ReactNode }[] = [
  { id: 'settings', label: 'Ramp settings', render: (c) => <RampSettings doc={c.doc} d={c.d} v={c.v} /> },
  { id: 'light', label: 'Light & preview', needsColour: true, render: (c) => <LightTab doc={c.doc} d={c.d} v={c.v} /> },
  // mounted only while it shows
  { id: 'check', label: 'Check values', needsColour: true, badge: (c) => c.checks.problems, render: (c) => <CheckTab key={c.source} doc={c.doc} d={c.d} v={c.v} checks={c.checks} /> },
  { id: 'paint', label: 'Paint', render: (c) => <PaintSlot host={c.paint} /> },
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

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const v = useView();
  const checks = useChecks(doc, v);
  const [paint] = useState(() => Object.assign(document.createElement('div'), { className: s.host }));
  // a fix can remove the row under the pointer, which then never reports leaving
  useEffect(() => void (hot.get().length && hot.set([])), [d.swatches]);
  const source = useSyncExternalStore(doc.subscribe, () => doc.source()?.itemId ?? null);
  const empty = d.swatches.length === 0;
  // Light and Check have nothing to show without a colour; Paint doesn't need the palette (the tubes work alone)
  const ctx: Ctx = { doc, d, v, checks, empty, source, paint };
  const tabs: SectionTab[] = TABS.map((t) => ({
    id: t.id,
    label: t.label,
    badge: !empty && t.badge ? t.badge(ctx) : undefined,
    disabled: empty && t.needsColour ? 'Add a base colour first' : undefined,
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
          <>
            <Button variant="primary" icon="add" shortcut="Shift+A" onClick={() => addBase(doc)}>
              Add base colour
            </Button>
            <Button icon="add_photo_alternate" onClick={pickImage}>
              From image
            </Button>
            <IconButton icon="note_add" label="New palette" shortcut="Ctrl+N" size="sm" onClick={() => void newPalette()} />
          </>
        }
        send={{ empty: 'Add a base colour first: an empty palette has nothing to send' }}
        exportButton={<ExportPalette tool="illustration" swatches={d.swatches} named={() => named(doc.get())} format={v.format} onFormat={(format) => patchView({ format })} />}
      />
      <div className={s.main}>
        <Palette doc={doc} d={d} v={v} />
        <div className={s.right}>
          <SelectedRamp doc={doc} d={d} v={v} />
          <div className={s.lower}>
            <PickerSection doc={doc} d={d} v={v} />
            <TabbedSection tabs={tabs} value={tab} onChange={(id) => patchView({ tab: id as Tab })} bodyClassName={tab === 'paint' ? s.flush : undefined} />
          </div>
        </div>
      </div>
      {createPortal(<PaintPane doc={doc} d={d} v={v} hidden={!active || tab !== 'paint'} />, paint)}
      {/* "From image" and the empty state's "From an image" */}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"
        hidden
        data-illustration-image=""
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void takeImage(file, file.name.replace(/\.[^.]*$/, '') || 'The image').catch((err: unknown) => toast.show({ kind: 'error', message: err instanceof Error ? err.message : String(err) }));
        }}
      />
    </div>
  );
}
