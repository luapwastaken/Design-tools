// The Logo tool's screen (spec §2): the lockup being edited large on its surround with the other
// lockups under it, or the sheet of every lockup × version; the inspector (Parts, Lockups,
// Proportions, Versions, Clearspace, Small sizes, Export) on the right.
import { useEffect, useRef, useSyncExternalStore, type CSSProperties } from 'react';
import { isTextField } from '../../shell/core/keys.ts';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { Module, Segmented, Select } from '../../ui/index.ts';
import { InspectorColumn } from '../common/InspectorColumn.tsx';
import { editedKind, takeMarkup, type Doc } from './actions.ts';
import { KIND_LABEL, KIND_WHERE, lockupOf, shownLockups, shownVersions, VERSION_LABEL, VERSIONS, type LogoDoc } from './doc.ts';
import { ExportModule } from './Export.tsx';
import { ClearspaceModule, LockupsModule, ProportionsModule, VersionsModule } from './Inspector.tsx';
import { LogoBar } from './LogoBar.tsx';
import { Parts } from './Parts.tsx';
import { Sheet } from './Sheet.tsx';
import { SmallSizes } from './SmallSizes.tsx';
import { Stage } from './Stage.tsx';
import { Start } from './Start.tsx';
import { Strip } from './Strip.tsx';
import { SURROUNDS } from './surround.ts';
import { patchView, useView } from './view-state.ts';
import s from './View.module.css';

const INSPECTOR = { min: 340, max: 460, reset: 380 };

/** every version can be looked at; the ones the sheet and Export all leave out say so */
const versionOptions = (d: LogoDoc) => VERSIONS.map((value) => ({ value, label: d.versions.includes(value) ? VERSION_LABEL[value] : `${VERSION_LABEL[value]} (off)` }));

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

  const title = empty ? 'Parts' : sheet ? 'Sheet' : lockup ? KIND_LABEL[lockup.kind] : 'Lockups';
  const sub = empty
    ? 'An icon and a wordmark'
    : sheet
      ? `${shownLockups(d).length} lockups × ${shownVersions(d).length} versions`
      : lockup
        ? KIND_WHERE[lockup.kind]
        : 'All off';

  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={s.work}>
        <LogoBar doc={doc} d={d} v={v} />
        <Module
          title={title}
          sub={sub}
          flush
          className={s.stage}
          actions={
            !empty && (
              <span className={s.switches}>
                {!sheet && lockup && <Select label="Version" options={versionOptions(d)} value={v.version} onChange={(version) => patchView({ version })} className={s.version} />}
                <Segmented options={SURROUNDS} value={v.surround} onChange={(surround) => patchView({ surround })} fit />
              </span>
            )
          }
        >
          {empty ? (
            <Start doc={doc} />
          ) : sheet ? (
            <Sheet d={d} v={v} />
          ) : lockup ? (
            <div className={s.edit}>
              <Stage doc={doc} d={d} v={v} lockup={lockup} />
              <Strip doc={doc} d={settled} v={v} edited={lockup.kind} />
            </div>
          ) : (
            <p className={s.none}>Every lockup is off. Turn one on in Lockups.</p>
          )}
        </Module>
        <ResizeHandle value={v.inspector} min={INSPECTOR.min} max={INSPECTOR.max} reset={INSPECTOR.reset} label="Inspector width" edge="left" onChange={(w) => patchView({ inspector: w })} />
      </div>
      <InspectorColumn>
        <Parts doc={doc} d={d} />
        {!empty && (
          <>
            <LockupsModule doc={doc} d={d} edited={kind} />
            <ProportionsModule doc={doc} d={d} lockup={lockup} />
            <VersionsModule doc={doc} d={d} />
            <ClearspaceModule doc={doc} d={d} />
            <SmallSizes d={settled} v={v} lockup={kind && lockupOf(settled, kind)} />
            <ExportModule doc={doc} d={settled} v={v} lockup={kind && lockupOf(settled, kind)} />
          </>
        )}
      </InspectorColumn>
    </div>
  );
}
