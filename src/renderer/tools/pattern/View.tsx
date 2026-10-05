// The Pattern tool's screen (spec §2): the pattern repeated across the Viewport, with the inspector
// (Shapes, Arrangement, Spacing and size, Rotation and jitter, Colour, Export) on the right.
import { useEffect, useMemo, useSyncExternalStore, type CSSProperties } from 'react';
import { layoutTile } from '../../../shared/pattern/layout.ts';
import { previewSvg } from '../../../shared/pattern/svg.ts';
import { isTextField } from '../../shell/core/keys.ts';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { InspectorColumn } from '../common/InspectorColumn.tsx';
import { addShapes, type Doc } from './actions.ts';
import { PatternCanvas } from './Canvas.tsx';
import { ColourModule } from './Colour.tsx';
import { ExportModule, usePatternExport } from './Export.tsx';
import { ArrangementModule, RotationModule, SpacingModule } from './Layout.tsx';
import { PatternBar } from './PatternBar.tsx';
import { Shapes } from './Shapes.tsx';
import { patchView, useView } from './view-state.ts';
import s from './View.module.css';

const INSPECTOR = { min: 340, max: 460, reset: 380 };

/** Ctrl+V of SVG markup with no text field focused: a new shape (SVG files arrive through onFiles) */
function usePaste(doc: Doc, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || isTextField(document.activeElement as HTMLElement | null) || e.clipboardData?.files.length) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!/<svg[\s>]/i.test(text)) return;
      e.preventDefault();
      void addShapes(doc, [{ svg: text, name: 'Pasted shape' }]);
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  }, [doc, active]);
}

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const v = useView();
  usePaste(doc, active);
  const tile = useMemo(() => layoutTile(d), [d]);
  const out = usePatternExport(doc, d, tile, v);
  const preview = useMemo(() => previewSvg(d, tile), [d.slots, d.background, tile]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of tile.items) m.set(it.slot, (m.get(it.slot) ?? 0) + 1);
    return m;
  }, [tile]);

  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={s.work}>
        <PatternBar doc={doc} d={d} out={out} />
        <PatternCanvas d={d} tile={tile} preview={preview} v={v} active={active} />
        <ResizeHandle value={v.inspector} min={INSPECTOR.min} max={INSPECTOR.max} reset={INSPECTOR.reset} label="Inspector width" edge="left" onChange={(w) => patchView({ inspector: w })} />
      </div>
      <InspectorColumn>
        <Shapes doc={doc} d={d} counts={counts} />
        <ArrangementModule doc={doc} d={d} tile={tile} />
        <SpacingModule doc={doc} d={d} tile={tile} />
        <RotationModule doc={doc} d={d} />
        <ColourModule doc={doc} d={d} />
        <ExportModule doc={doc} d={d} tile={tile} v={v} out={out} />
      </InspectorColumn>
    </div>
  );
}
