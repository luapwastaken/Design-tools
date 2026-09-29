// The Halftone tool's screen (spec §2): the page in the Viewport, the inspector (Output size, Screen,
// Inks, Coverage, Paper, Tone, Print feel, Export) on the right. The screen is made in a worker from
// the document; the view, the meters and the exports all read that one result.
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { ResizeHandle } from '../../shell/ResizeHandle.tsx';
import { Icon } from '../../ui/index.ts';
import type { Doc } from './actions.ts';
import { HalftoneCanvas } from './Canvas.tsx';
import { ExportModule } from './Export.tsx';
import { FeelModule } from './Feel.tsx';
import { HalftoneBar } from './HalftoneBar.tsx';
import { InksModule, type PlateOf } from './Inks.tsx';
import { Meters, type InkCoverage } from './Meters.tsx';
import { OutputModule } from './Output.tsx';
import { PaperModule } from './Paper.tsx';
import { ScreenModule } from './Screen.tsx';
import { ready, releaseScreening, screen, Superseded, totals, type Screened } from './screening.ts';
import { Start } from './Start.tsx';
import { ToneModule } from './Tone.tsx';
import { patchView, status, useView } from './view-state.ts';
import s from './View.module.css';

const INSPECTOR = { min: 340, max: 460, reset: 380 };

/**
 * The screen for the document as it is now, made while the tool shows; the last one stays up while
 * the next is made, and goes when a setting can't be screened (nothing stale is shown or exported).
 */
function useScreen(d: ReturnType<Doc['get']>, active: boolean) {
  const [screened, setScreened] = useState<Screened | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!active || !d.source) {
      setBusy(false);
      setError(null);
      return;
    }
    // a change the screen doesn't depend on (a colour, the paper, what shows) redraws without waiting
    const now = ready(d);
    if (now) {
      setScreened(now);
      setBusy(false);
      setError(null);
      return;
    }
    let live = true;
    setBusy(true);
    screen(d).then(
      (s) => {
        if (!live) return;
        setScreened(s);
        setBusy(false);
        setError(null);
      },
      (e: unknown) => {
        if (e instanceof Superseded || !live) return;
        setBusy(false);
        setScreened(null);
        setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => void (live = false);
  }, [d, active]);
  // a hidden tool frees the worker's plates and the decoded image (foundation spec §4)
  useEffect(() => {
    if (active) return;
    releaseScreening();
    setScreened(null);
  }, [active]);
  return { screened: d.source ? screened : null, busy, error };
}

export function View({ doc, active }: { doc: Doc; active: boolean }) {
  const d = useSyncExternalStore(doc.subscribe, doc.get);
  const v = useView();
  const { screened, busy, error: screenError } = useScreen(d, active);
  const [drawError, setDrawError] = useState<string | null>(null);
  const error = screenError ?? drawError;
  // the meters' totals follow only what shows (an angle drag leaves them be)
  const shownKey = d.inks.map((i) => `${i.id}:${i.visible}`).join();
  const sum = useMemo(() => (screened ? totals(screened, d) : null), [screened, shownKey]);
  const fm = d.screen.shape === 'stochastic';

  useEffect(() => {
    status.set(d.source ? { dots: sum?.dots ?? 0, fm: fm ? d.size.dpi : null, ms: screened?.ms ?? 0, busy: !error && (busy || !screened), error: !!error } : null);
  }, [sum, screened, busy, error, fm, d.source, d.size.dpi]);

  const plates = useMemo(() => new Map(screened?.inks.map((k) => [k.id, { data: k.plate, w: screened.plate.w, h: screened.plate.h }])), [screened]);
  const plateOf: PlateOf = (id) => plates.get(id) ?? null;
  const coverage: InkCoverage[] = d.inks.map((ink) => {
    const at = screened?.inks.findIndex((k) => k.id === ink.id) ?? -1;
    const st = at >= 0 && sum ? sum.stats[at] : null;
    return { id: ink.id, label: ink.process ? ink.process.toUpperCase() : ink.name, colour: ink.colour, mean: st?.mean ?? null, peak: st?.peak ?? null, hidden: !ink.visible };
  });

  return (
    <div className={s.view} style={{ '--insp': `${v.inspector}px` } as CSSProperties}>
      <div className={s.work}>
        <HalftoneBar doc={doc} d={d} v={v} />
        {d.source ? (
          <div className={s.stage}>
            <HalftoneCanvas d={d} v={v} screened={screened} dots={sum?.dots ?? 0} stats={sum?.stats ?? null} busy={busy} active={active} onDrawError={setDrawError} />
            {error && (
              <p className={s.error} role="alert">
                <Icon name="error" size={16} />
                {error}
              </p>
            )}
          </div>
        ) : (
          <Start doc={doc} />
        )}
        <ResizeHandle value={v.inspector} min={INSPECTOR.min} max={INSPECTOR.max} reset={INSPECTOR.reset} label="Inspector width" edge="left" onChange={(w) => patchView({ inspector: w })} />
      </div>
      <aside className={s.insp} aria-label="Inspector">
        <OutputModule doc={doc} d={d} />
        <ScreenModule doc={doc} d={d} />
        <InksModule doc={doc} d={d} plateOf={plateOf} />
        {d.source && <Meters inks={coverage} maxInk={sum?.maxInk ?? null} />}
        <PaperModule doc={doc} d={d} />
        <ToneModule doc={doc} d={d} hist={screened?.hist ?? null} />
        <FeelModule doc={doc} d={d} />
        <ExportModule d={d} v={v} screened={screened} error={screenError} />
      </aside>
    </div>
  );
}
