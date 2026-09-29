// The Design tool's screen (UX pass): the doc bar with the jobs as tabs, the palette always on top,
// one job under it at a time (Build · Check · Preview), and the selected colour in the inspector.
import { useEffect, useMemo, useSyncExternalStore, type CSSProperties } from 'react';
import { isTextField } from '../../shell/core/keys.ts';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { toast } from '../../ui/index.ts';
import { DocBar, type DocTab } from '../common/DocBar.tsx';
import { useSettled } from '../common/settled.ts';
import { addSwatch, eyedrop, newPalette, type Doc } from './actions.ts';
import { Build } from './Build.tsx';
import { Checks } from './Checks.tsx';
import { named, plural, type DesignTab } from './doc.ts';
import { InContext } from './InContext.tsx';
import { Inspector } from './Inspector.tsx';
import { results } from './results.ts';
import { takeText } from './sources.ts';
import { SwatchRow } from './SwatchRow.tsx';
import { hot, patchView, useView } from './view-state.ts';
import s from './View.module.css';

const TABS: DocTab<DesignTab>[] = [
  { value: 'build', label: 'Build', icon: 'star_shine' },
  { value: 'check', label: 'Check', icon: 'fact_check' },
  { value: 'preview', label: 'Preview', icon: 'web' },
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
  // each palette opens its checks on its own first problem
  const source = useSyncExternalStore(doc.subscribe, () => doc.source()?.itemId ?? null);
  useEffect(() => patchView({ check: null }), [source]);
  const empty = d.swatches.length === 0;
  // Build is where a palette starts: with no colours, Check and Preview have nothing to show
  useEffect(() => void (empty && patchView({ tab: 'build' })), [empty]);
  const tab = empty ? 'build' : v.tab;
  const toLookAt = results(settled.swatches, settled.ramps, v.flagL, v.flagE).toLookAt;
  const tabs = TABS.map((t) => {
    if (t.value === 'build') return t;
    if (empty) return { ...t, off: 'Add colours first: Build makes them' };
    return t.value === 'check' && toLookAt ? { ...t, badge: toLookAt } : t;
  });
  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={s.work}>
        <DocBar
          tool="design"
          doc={doc}
          count={plural(d.swatches.length, 'swatch', 'swatches')}
          onNew={() => void newPalette()}
          tabs={{ options: tabs, value: tab, onChange: (next) => patchView({ tab: next }) }}
          onPick={() => void eyedrop(doc)}
          add={{ label: 'Add swatch', tooltip: 'Add the selected hue at the lightness the palette lacks most', run: () => addSwatch(doc) }}
          empty="Add a colour first: an empty palette has nothing to send"
          exportPalette={{ tool: 'design', swatches: d.swatches, named: (list) => named(list, doc.get().ramps), format: v.format, onFormat: (format) => patchView({ format }) }}
        />
        <SwatchRow doc={doc} d={d} v={v} />
        {/* Build and Preview stay mounted, so each keeps its state when switched */}
        <div className={s.pane} hidden={tab !== 'build'}>
          <Build d={d} v={v} />
        </div>
        {/* mounted only while it shows: with no check chosen it opens on the first that fails, each visit */}
        {tab === 'check' && (
          <div className={s.pane}>
            <Checks key={source} doc={doc} d={settled} v={v} />
          </div>
        )}
        <div className={s.pane} hidden={tab !== 'preview'}>
          <InContext swatches={shown} hidden={tab !== 'preview'} />
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
      </aside>
    </div>
  );
}
