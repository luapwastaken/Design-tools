// The Design tool's screen (Bone Ember pass): the palette is the artboard. Doc bar (Swatches | In use,
// Export, Send to), the options bar of sources, the stage, the Checks dock under it, and the selected
// swatch's inspector beside it.
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { isTextField } from '../../shell/core/keys.ts';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { Button, IconButton, Kbd, menu, Segmented, toast, ViewStrip } from '../../ui/index.ts';
import { DocBar } from '../common/DocBar.tsx';
import { ExportPalette } from '../common/ExportPalette.tsx';
import { InspectorColumn } from '../common/InspectorColumn.tsx';
import { NotesModule } from '../common/Notes.tsx';
import { useSettled } from '../common/settled.ts';
import { SURROUNDS, surroundOf } from '../common/surround.ts';
import { newPalette, select, type Doc } from './actions.ts';
import { Artboard, type OpenPop } from './Artboard.tsx';
import { simulated } from './artboard.ts';
import { ChecksDock } from './ChecksDock.tsx';
import { named, plural, type DesignStage, type DesignView } from './doc.ts';
import { Empty } from './Empty.tsx';
import { InContext } from './InContext.tsx';
import { Inspector } from './Inspector.tsx';
import { DesignPopover, type PopState } from './Popovers.tsx';
import { proposals } from './proposals.ts';
import { takeText } from './sources.ts';
import { Toolbar } from './Toolbar.tsx';
import { hot, patchView, useView } from './view-state.ts';
import s from './View.module.css';

const STAGES: { value: DesignStage; label: string; icon: 'palette' | 'web'; tip: string }[] = [
  { value: 'swatches', label: 'Swatches', icon: 'palette', tip: 'The palette as an artboard (V)' },
  { value: 'inuse', label: 'In use', icon: 'web', tip: 'The palette on a page, light and dark (V)' },
];
const INSPECTOR = { min: 340, max: 460, reset: 380 };
const SIM_NAME = { normal: 'Normal', protan: 'Protan', deutan: 'Deutan', tritan: 'Tritan', achromat: 'Achromat', greyscale: 'Greyscale value' } as const;

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

/** the stage's corner menu: the pasteboard the palette sits on and how much each column says */
function openView(e: { currentTarget: HTMLElement; detail: number }, v: DesignView) {
  menu.open(
    e.currentTarget.getBoundingClientRect(),
    [
      { header: 'Pasteboard' },
      ...SURROUNDS.map((o) => ({ label: o.tip, checked: v.surround === o.value, onSelect: () => patchView({ surround: o.value }) })),
      'separator',
      { header: 'Column data' },
      { label: 'Hex and L C H', checked: v.chipData === 'short', onSelect: () => patchView({ chipData: 'short' }) },
      { label: 'Table: adds RGB and ≈CMYK', checked: v.chipData === 'full', onSelect: () => patchView({ chipData: 'full' }) },
    ],
    { owner: e.currentTarget, initial: e.detail === 0 ? 0 : undefined },
  );
}

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const settled = useSettled(doc);
  const v = useView();
  const ghosts = proposals.use();
  const [pop, setPop] = useState<PopState | null>(null);
  usePaste(active);
  // a fix can remove the row under the pointer, which then never reports leaving
  useEffect(() => void (hot.get().length && hot.set([])), [d.swatches]);
  // a popover belongs to the tool that opened it
  useEffect(() => void (!active && setPop(null)), [active]);
  // blank names filled in, as the checks' sentences name them; under Simulate, the colours as seen
  const shown = useMemo(() => named(d.swatches, d.ramps).map((w) => (v.sim === 'normal' ? w : { ...w, oklch: simulated(w.oklch, v.sim) })), [d.swatches, d.ramps, v.sim]);
  const empty = d.swatches.length === 0;
  const stage = empty ? 'swatches' : v.stage;
  const openPop: OpenPop = (kind, anchor, ends) => setPop({ kind, anchor, ends });
  const sel = d.swatches.filter((w) => v.selected.includes(w.id)).length;
  const locked = d.swatches.filter((w) => v.locked.includes(w.id)).length;
  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={s.work} data-open={!empty}>
        <DocBar
          tool="design"
          doc={doc}
          meta={plural(d.swatches.length, 'swatch', 'swatches')}
          actions={<IconButton icon="note_add" label="New palette" shortcut="Ctrl+N" size="sm" onClick={() => void newPalette()} />}
          modes={<Segmented fit options={STAGES} value={stage} onChange={(next) => patchView({ stage: next })} />}
          send={{ empty: 'Add a colour first: an empty palette has nothing to send' }}
          exportButton={<ExportPalette tool="design" swatches={d.swatches} named={(list) => named(list, doc.get().ramps)} format={v.format} onFormat={(format) => patchView({ format })} />}
        />
        <Toolbar doc={doc} d={d} v={v} onPop={openPop} />
        <section className={s.stage} aria-label="Palette">
          <div className={s.board} style={{ background: stage === 'swatches' && !(empty && !ghosts) ? surroundOf(v.surround, d.swatches) : undefined }}>
            {stage === 'inuse' ? (
              <div className={s.inuse}>
                <InContext swatches={shown} onSelect={(id) => (select([id]), patchView({ stage: 'swatches' }))} />
              </div>
            ) : empty && !ghosts ? (
              <Empty doc={doc} v={v} onPop={openPop} />
            ) : (
              <Artboard doc={doc} d={d} v={v} onPop={openPop} />
            )}
          </div>
          <ViewStrip
            overlays={
              <span className={s.hints}>
                <Kbd>Space</Kbd> generate <Kbd>L</Kbd> lock <Kbd>I</Kbd> pick <Kbd>V</Kbd> in use
              </span>
            }
            background={<Button size="xs" variant="ghost" icon="tune" iconEnd="keyboard_arrow_down" onClick={(e) => openView(e, v)}>View</Button>}
            readout={
              <span className={s.readout}>
                {v.sim !== 'normal' && <span className={s.sim}>Simulating: {SIM_NAME[v.sim]}</span>}
                {sel > 1 && <span>{sel} of {d.swatches.length} selected</span>}
                {locked > 0 && <span>{locked} locked</span>}
              </span>
            }
          />
        </section>
        {!empty && <ChecksDock doc={doc} d={settled} v={v} />}
        <ResizeHandle value={v.inspector} min={INSPECTOR.min} max={INSPECTOR.max} reset={INSPECTOR.reset} label="Inspector width" edge="left" onChange={(w) => patchView({ inspector: w })} />
      </div>
      <InspectorColumn>
        <Inspector doc={doc} d={d} v={v} />
        <NotesModule doc={doc} />
      </InspectorColumn>
      {pop && (
        <DesignPopover
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
