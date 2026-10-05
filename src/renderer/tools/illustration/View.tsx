// The Illustration tool's screen (Bone Ember pass): one workspace, four views of one palette.
// The Palette (left) and the Inspector (right) are constant; the doc bar's modes (Alt+1-4) change
// the centre: Ramps (the swatch board and curves), Light (the lit object), Check (greyscale and
// vision boards) and Paint (the paper). The selected ramp and step carry through all of them.
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import type { IconName } from '../../shell/tool.ts';
import { IconButton, toast } from '../../ui/index.ts';
import { DocBar, DocTabs, type DocTab } from '../common/DocBar.tsx';
import { ExportPalette } from '../common/ExportPalette.tsx';
import { InspectorColumn } from '../common/InspectorColumn.tsx';
import { plural } from '../common/names.ts';
import { NotesModule } from '../common/Notes.tsx';
import { newPalette, type Doc } from './actions.ts';
import { CheckMode, ChecksGroup } from './Check.tsx';
import { useChecks } from './CheckPane.tsx';
import { named } from './doc.ts';
import { Groups } from './Inspector.tsx';
import { LightMode } from './Light.tsx';
import { Palette } from './Palette.tsx';
import { PaintPane } from './PaintPane.tsx';
import { takeImage } from './proposals.ts';
import { Ramps } from './Ramps.tsx';
import { HowItWorks, Start } from './Start.tsx';
import { hot, patchView, useView, type IllustrationView } from './view-state.ts';
import s from './View.module.css';

type Mode = IllustrationView['tab'];
const MODES: { value: Mode; label: string; icon: IconName }[] = [
  { value: 'ramps', label: 'Ramps', icon: 'layers' },
  { value: 'light', label: 'Light', icon: 'wb_sunny' },
  { value: 'check', label: 'Check', icon: 'fact_check' },
  { value: 'paint', label: 'Paint', icon: 'brush' },
];
const INSPECTOR = { min: 340, max: 460, reset: 380 };

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const v = useView();
  const checks = useChecks(doc, v);
  // the well and the tubes are drawn by the paint canvas into this slot of the inspector
  const [mixer, setMixer] = useState<HTMLElement | null>(null);
  // a fix can remove the row under the pointer, which then never reports leaving
  useEffect(() => void (hot.get().length && hot.set([])), [d.swatches]);
  // as in Design: each palette (and a relaunch) opens its checks on its own first problem
  const source = useSyncExternalStore(doc.subscribe, () => doc.source()?.itemId ?? null);
  useEffect(() => patchView({ check: null }), [source]);
  const empty = d.swatches.length === 0;
  // Light and Check have nothing to show without a colour; Paint doesn't need the palette (the tubes work alone)
  const mode: Mode = empty && (v.tab === 'light' || v.tab === 'check') ? 'ramps' : v.tab;
  const tabs: DocTab<Mode>[] = MODES.map((m) => ({
    ...m,
    ...(empty && (m.value === 'light' || m.value === 'check') ? { off: 'Add a base colour first' } : {}),
    ...(m.value === 'check' && checks.problems && !empty ? { badge: checks.problems } : {}),
  }));
  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={s.work}>
        <DocBar
          tool="illustration"
          doc={doc}
          meta={plural(d.ramps.length, 'ramp')}
          actions={<IconButton icon="note_add" label="New palette" shortcut="Ctrl+N" size="sm" onClick={() => void newPalette()} />}
          modes={<DocTabs options={tabs} value={mode} onChange={(tab: Mode) => patchView({ tab })} />}
          send={{ empty: 'Add a base colour first: an empty palette has nothing to send' }}
          exportButton={<ExportPalette tool="illustration" swatches={d.swatches} named={() => named(doc.get())} format={v.format} onFormat={(format) => patchView({ format })} />}
        />
        <div className={s.main}>
          <Palette doc={doc} d={d} v={v} />
          <div className={s.canvas}>
            {empty && mode !== 'paint' && <Start doc={doc} />}
            {!empty && mode === 'ramps' && <Ramps doc={doc} d={d} v={v} />}
            {!empty && mode === 'light' && <LightMode doc={doc} d={d} v={v} />}
            {/* mounted only while it shows: with no check chosen it opens on the first that fails, each visit */}
            {!empty && mode === 'check' && <CheckMode key={source} doc={doc} d={d} v={v} checks={checks} />}
            {/* Paint stays mounted, so it keeps its engine and its painting when another mode shows */}
            <div className={s.pane} hidden={mode !== 'paint'}>
              <PaintPane doc={doc} d={d} v={v} hidden={!active || mode !== 'paint'} mixer={mixer} />
            </div>
          </div>
        </div>
        <ResizeHandle value={v.inspector} min={INSPECTOR.min} max={INSPECTOR.max} reset={INSPECTOR.reset} label="Inspector width" edge="left" onChange={(w) => patchView({ inspector: w })} />
      </div>
      <InspectorColumn>
        {empty && mode !== 'paint' && <HowItWorks />}
        {/* Paint's Mixer: the well, the tubes and Mix it are drawn into this slot */}
        <div ref={setMixer} className={s.mixer} hidden={mode !== 'paint'} />
        {!empty && <Groups doc={doc} d={d} v={{ ...v, tab: mode }} lead={mode === 'check' ? <ChecksGroup doc={doc} v={v} checks={checks} /> : null} />}
        <NotesModule doc={doc} />
      </InspectorColumn>
      {/* the empty state's "Pick from an image" */}
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
