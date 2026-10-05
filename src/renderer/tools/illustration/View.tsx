// The Illustration tool's screen (UX pass): the doc bar with its jobs as tabs, the ramps always on
// top, one job below them at a time (Light, Check, Paint), and the selected colour on the right.
import { useEffect, useSyncExternalStore, type CSSProperties } from 'react';
import type { IconName } from '../../shell/tool.ts';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { cx } from '../../ui/cx.ts';
import { Button, IconButton, toast } from '../../ui/index.ts';
import { DocBar, DocTabs } from '../common/DocBar.tsx';
import { ExportPalette } from '../common/ExportPalette.tsx';
import { plural } from '../common/names.ts';
import { InspectorColumn } from '../common/InspectorColumn.tsx';
import { NotesModule } from '../common/Notes.tsx';
import { addBase, eyedrop, newPalette, type Doc } from './actions.ts';
import { CheckPane, useChecks } from './CheckPane.tsx';
import { named } from './doc.ts';
import { StepInspector } from './Inspector.tsx';
import { LightPane } from './LightPane.tsx';
import { PaintPane } from './PaintPane.tsx';
import { takeImage } from './proposals.ts';
import { Ramps } from './Ramps.tsx';
import { hot, patchView, useView, type IllustrationView } from './view-state.ts';
import s from './View.module.css';

type Tab = IllustrationView['tab'];
const TABS: { value: Tab; label: string; icon: IconName }[] = [
  { value: 'light', label: 'Light', icon: 'wb_sunny' },
  { value: 'check', label: 'Check', icon: 'fact_check' },
  { value: 'paint', label: 'Paint', icon: 'brush' },
];
const INSPECTOR = { min: 340, max: 460, reset: 380 };
const CAN_PICK = 'EyeDropper' in globalThis;

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const v = useView();
  const checks = useChecks(doc, v);
  // a fix can remove the row under the pointer, which then never reports leaving
  useEffect(() => void (hot.get().length && hot.set([])), [d.swatches]);
  // as in Design: each palette (and a relaunch) opens its checks on its own first problem
  const source = useSyncExternalStore(doc.subscribe, () => doc.source()?.itemId ?? null);
  useEffect(() => patchView({ check: null }), [source]);
  const empty = d.swatches.length === 0;
  const shows = (tab: Tab) => !empty && v.tab === tab;
  const tabs = TABS.map((t) => (t.value === 'check' && checks.problems ? { ...t, badge: checks.problems } : t));
  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={cx(s.work, empty && s.empty)}>
        <DocBar
          tool="illustration"
          doc={doc}
          meta={plural(d.ramps.length, 'ramp')}
          actions={
            <>
              <IconButton icon="note_add" label="New palette" shortcut="Ctrl+N" size="sm" onClick={() => void newPalette()} />
              {CAN_PICK && <IconButton icon="colorize" label="Pick a colour from the screen" shortcut="I" size="sm" onClick={() => void eyedrop(doc)} />}
              <Button icon="add" onClick={() => addBase(doc)} tooltip="A new ramp, from a hue well away from the others">
                Add base
              </Button>
            </>
          }
          modes={<DocTabs options={tabs} value={v.tab} onChange={(tab: Tab) => patchView({ tab })} />}
          send={{ empty: 'Add a base colour first: an empty palette has nothing to send' }}
          exportButton={<ExportPalette tool="illustration" swatches={d.swatches} named={() => named(doc.get())} format={v.format} onFormat={(format) => patchView({ format })} />}
        />
        <Ramps doc={doc} d={d} v={v} />
        {/* Light and Paint stay mounted, so each keeps its state (the painting, the light) when switched */}
        <div className={s.lower}>
          {empty && <p className={s.later}>The lit preview, the checks and the paint canvas show here once the palette has colours.</p>}
          <div className={s.pane} hidden={!shows('light')}>
            <LightPane doc={doc} d={d} v={v} hidden={!active || !shows('light')} />
          </div>
          {/* mounted only while it shows: with no check chosen it opens on the first that fails, each visit */}
          {shows('check') && (
            <div className={s.pane}>
              <CheckPane key={source} doc={doc} v={v} checks={checks} />
            </div>
          )}
          <div className={s.pane} hidden={!shows('paint')}>
            <PaintPane doc={doc} d={d} v={v} hidden={!active || !shows('paint')} />
          </div>
        </div>
        <ResizeHandle value={v.inspector} min={INSPECTOR.min} max={INSPECTOR.max} reset={INSPECTOR.reset} label="Inspector width" edge="left" onChange={(w) => patchView({ inspector: w })} />
      </div>
      <InspectorColumn>
        <StepInspector doc={doc} d={d} v={v} />
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
