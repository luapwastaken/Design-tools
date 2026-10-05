// The Logo tool's screen (spec §5): the pasteboard of artboards, one per lockup that's on (or the
// sheet of every lockup x version), the Version switch and Export in the doc bar, and the inspector
// (Parts, Lockups, Proportions, Versions, Clearspace, Small sizes, Export) on the right.
import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { isTextField } from '../../shell/core/keys.ts';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { InspectorGroup, Toggle, ViewStrip } from '../../ui/index.ts';
import { InspectorColumn } from '../common/InspectorColumn.tsx';
import { editedKind, takeMarkup, type Doc } from './actions.ts';
import { Board, Canvas } from './Board.tsx';
import { lockupOf, shownLockups, type LogoDoc } from './doc.ts';
import { ExportGroup, useLogoExport } from './Export.tsx';
import { ClearspaceGroup, LockupsGroup, ProportionsGroup, VersionsGroup } from './Inspector.tsx';
import { LogoBar } from './LogoBar.tsx';
import { Parts } from './Parts.tsx';
import { Sheet } from './Sheet.tsx';
import { SmallSizes } from './SmallSizes.tsx';
import { Start } from './Start.tsx';
import { patchView, useView } from './view-state.ts';
import s from './View.module.css';

const INSPECTOR = { min: 340, max: 460, reset: 380 };

/** Ctrl+V of SVG markup with no text field focused: the first empty part (SVG and PNG files arrive through onFiles) */
function usePaste(doc: Doc, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || isTextField(document.activeElement as HTMLElement | null) || e.clipboardData?.files.length) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!/<svg[\s>]/i.test(text)) return;
      e.preventDefault();
      void takeMarkup(doc, text);
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
  }, [doc, active]);
}

/**
 * The document as it was before the gesture under way, for what redraws every lockup SVG (the strip,
 * the small sizes, the export sizes): a handle or slider drag redraws only the stage and its numbers.
 */
function useSettled(doc: Doc) {
  const held = useRef(doc.get());
  return useSyncExternalStore(doc.subscribe, () => {
    if (!doc.inGesture()) held.current = doc.get();
    return held.current;
  });
}

/**
 * A pair made or broken proposes the lockups afresh (doc.ts withPart), in the order that suits the
 * parts: the edit view goes to the first, the logo's main lockup, rather than the one last edited.
 */
function useMainOnProposal(d: LogoDoc) {
  const pair = !!d.icon && !!d.wordmark;
  const was = useRef(pair);
  useEffect(() => {
    if (was.current === pair) return;
    was.current = pair;
    const main = shownLockups(d)[0];
    if (main) patchView({ lockup: main.kind });
  }, [pair]);
}

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const settled = useSettled(doc);
  const v = useView();
  usePaste(doc, active);
  useMainOnProposal(d);
  const empty = !d.icon && !d.wordmark;
  const kind = editedKind(d, v.lockup);
  const lockup = kind ? lockupOf(d, kind) : null;
  const sheet = v.mode === 'sheet' && !empty;
  const out = useLogoExport(doc, settled, v, kind && lockupOf(settled, kind));

  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={s.work}>
        <LogoBar doc={doc} d={d} v={v} out={out} />
        <div className={s.stage}>
          {empty ? (
            <Start doc={doc} />
          ) : sheet ? (
            <div className={s.sheetStage}>
              <Sheet d={d} v={v} />
              <ViewStrip overlays={<Toggle label="Sheet" checked onChange={() => patchView({ mode: 'edit' })} />} background={<Canvas v={v} />} readout={<span>{shownLockups(d).length} lockups</span>} />
            </div>
          ) : kind ? (
            <Board doc={doc} d={d} v={v} selected={kind} />
          ) : (
            <p className={s.none}>Every lockup is off. Turn one on in Lockups.</p>
          )}
        </div>
        <ResizeHandle value={v.inspector} min={INSPECTOR.min} max={INSPECTOR.max} reset={INSPECTOR.reset} label="Inspector width" edge="left" onChange={(w) => patchView({ inspector: w })} />
      </div>
      <InspectorColumn>
        {empty ? (
          // nothing to set yet: the groups are there, shut, so the shape of the tool shows
          ['Parts', 'Lockups', 'Proportions', 'Versions', 'Clearspace', 'Small sizes', 'Export'].map((title) => <InspectorGroup key={title} title={title} defaultOpen={false} />)
        ) : (
          <>
            <Parts doc={doc} d={d} />
            <LockupsGroup doc={doc} d={d} edited={kind} />
            <ProportionsGroup doc={doc} d={d} lockup={lockup} />
            <VersionsGroup doc={doc} d={d} />
            <ClearspaceGroup doc={doc} d={d} />
            <SmallSizes d={settled} v={v} lockup={kind && lockupOf(settled, kind)} />
            <ExportGroup doc={doc} d={settled} v={v} lockup={kind && lockupOf(settled, kind)} out={out} />
          </>
        )}
      </InspectorColumn>
    </div>
  );
}
