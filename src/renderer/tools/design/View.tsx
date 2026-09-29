// The Design tool's screen (spec §2): swatch row on its surround, then Checks | In context, with the
// inspector (swatch, Build, Export) on the right. One screen, no tabs.
import { useEffect, useMemo, useSyncExternalStore, type CSSProperties } from 'react';
import { isTextField } from '../../shell/core/keys.ts';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { cx } from '../../ui/cx.ts';
import { toast } from '../../ui/index.ts';
import { DocBar } from '../common/DocBar.tsx';
import { ExportPalette } from '../common/ExportPalette.tsx';
import { useSettled } from '../common/settled.ts';
import { addSwatch, eyedrop, newPalette, type Doc } from './actions.ts';
import { Build } from './Build.tsx';
import { Checks } from './Checks.tsx';
import { named, plural, type DesignView } from './doc.ts';
import { InContext } from './InContext.tsx';
import { Inspector } from './Inspector.tsx';
import { takeText } from './sources.ts';
import { SwatchRow } from './SwatchRow.tsx';
import { hot, patchView, useView } from './view-state.ts';
import s from './View.module.css';

const LOWER: { value: DesignView['lower']; label: string }[] = [
  { value: 'checks', label: 'Checks' },
  { value: 'context', label: 'In context' },
];
const INSPECTOR = { min: 340, max: 460, reset: 380 };

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
  const shown = useMemo(() => named(settled.swatches, settled.ramps), [settled.swatches, settled.ramps]);
  const empty = d.swatches.length === 0;
  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={cx(s.work, empty && s.empty)}>
        <DocBar
          tool="design"
          doc={doc}
          count={plural(d.swatches.length, 'swatch', 'swatches')}
          onNew={() => void newPalette()}
          lower={{ options: LOWER, value: v.lower, onChange: (lower) => patchView({ lower }) }}
          onPick={() => void eyedrop(doc)}
          add={{ label: 'Add swatch', tooltip: 'Add the selected hue at the lightness the palette lacks most', run: () => addSwatch(doc) }}
          empty="Add a colour first: an empty palette has nothing to send"
        />
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
        <ExportPalette tool="design" swatches={d.swatches} named={(list) => named(list, doc.get().ramps)} format={v.format} onFormat={(format) => patchView({ format })} />
      </aside>
    </div>
  );
}
