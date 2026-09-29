// The Illustration tool's screen (spec §2): the ramps, then Light | Paint under them, with the
// inspector (the selected colour, Light, Export) on the right.
import { useEffect, useSyncExternalStore, type CSSProperties } from 'react';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { cx } from '../../ui/cx.ts';
import { toast } from '../../ui/index.ts';
import { DocBar } from '../common/DocBar.tsx';
import { ExportPalette } from '../common/ExportPalette.tsx';
import { plural } from '../common/names.ts';
import { addBase, eyedrop, newPalette, type Doc } from './actions.ts';
import { named } from './doc.ts';
import { LightInspector, StepInspector } from './Inspector.tsx';
import { LightPane } from './LightPane.tsx';
import { PaintPane } from './PaintPane.tsx';
import { takeImage } from './proposals.ts';
import { Ramps } from './Ramps.tsx';
import { hot, patchView, useView, type IllustrationView } from './view-state.ts';
import s from './View.module.css';

const LOWER: { value: IllustrationView['lower']; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'paint', label: 'Paint' },
];
const INSPECTOR = { min: 340, max: 460, reset: 380 };

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const v = useView();
  // a fix can remove the row under the pointer, which then never reports leaving
  useEffect(() => void (hot.get().length && hot.set([])), [d.swatches]);
  const empty = d.swatches.length === 0;
  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={cx(s.work, empty && s.empty)}>
        <DocBar
          tool="illustration"
          doc={doc}
          count={plural(d.ramps.length, 'ramp')}
          onNew={() => void newPalette()}
          lower={{ options: LOWER, value: v.lower, onChange: (lower) => patchView({ lower }) }}
          onPick={() => void eyedrop(doc)}
          add={{ label: 'Add base', tooltip: 'A new ramp, from a hue well away from the others', run: () => addBase(doc) }}
          empty="Add a base colour first: an empty palette has nothing to send"
        />
        <Ramps doc={doc} d={d} v={v} />
        {/* both stay mounted, so each keeps its state (the painting, the light) when switched */}
        <div className={s.lower}>
          {empty && <p className={s.later}>The lit preview, the checks and the paint canvas show here once the palette has colours.</p>}
          <div className={s.pane} hidden={empty || v.lower !== 'light'}>
            <LightPane doc={doc} d={d} v={v} hidden={empty || !active || v.lower !== 'light'} />
          </div>
          <div className={s.pane} hidden={empty || v.lower !== 'paint'}>
            <PaintPane doc={doc} d={d} v={v} hidden={empty || !active || v.lower !== 'paint'} />
          </div>
        </div>
        <ResizeHandle value={v.inspector} min={INSPECTOR.min} max={INSPECTOR.max} reset={INSPECTOR.reset} label="Inspector width" edge="left" onChange={(w) => patchView({ inspector: w })} />
      </div>
      <aside className={s.insp} aria-label="Inspector">
        <StepInspector doc={doc} d={d} v={v} />
        <LightInspector doc={doc} d={d} v={v} />
        <ExportPalette tool="illustration" dock={false} swatches={d.swatches} named={() => named(doc.get())} format={v.format} onFormat={(format) => patchView({ format })} />
      </aside>
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
