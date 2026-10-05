// The paint canvas (spec §3.3, engine spec 2026-09-29): a scratch pad where paints mix as paint,
// watercolour or gouache, on the GPU painting engine (./paint). Layout (the Paint tab): the toolbox at
// the left edge, a row of options over the paper; the well and the tubes are drawn into the tab's right
// column (the Mixer) through `mixer`. The engine and its input are untouched.
// Its painting is a PNG workspace asset per Library item. Its undo is its own (the last strokes and
// Clear), never the document's. What shows under the brush is final: nothing changes after the lift.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { cssColor, toHex, toOklch, type Oklch } from '../../../shared/color/index.ts';
import type { Pigment } from '../../../shared/paint/pigments.ts';
import { ConfirmInline, Icon, InspectorGroup, toast } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { brushWidth, toSample, WIDTH, type PaintingState, type PointerSample } from './paint/index.ts';
import { HEIGHT } from './paint/types.ts';
import { addToWell, loadHint, SIZE, sourcesOf, WELL_MAX, type PaintSettings, type PaletteSet } from './paint-sources.ts';
import { PaintBar } from './PaintBar.tsx';
import { Tray, Well } from './PaintTray.tsx';
import { Toolbox } from './Toolbox.tsx';
import { useBrush } from './useBrush.ts';
import { useCanvasKeys } from './useCanvasKeys.ts';
import { useEngine } from './useEngine.ts';
import { usePainting } from './usePainting.ts';
import s from './PaintCanvas.module.css';

export type PaintCanvasProps = {
  /** the open Library item: its painting is kept under this id. Null until the document is saved. */
  itemId: string | null;
  /** the Paint tab isn't showing: the engine waits for its first showing, and the keys are off */
  hidden: boolean;
  /** the pigments ticked as owned, in tray order */
  pigments: Pigment[];
  /** palette colours, offered in the tray too: a set per ramp, named */
  sets: PaletteSet[];
  settings: PaintSettings;
  onSettings(patch: Partial<PaintSettings>): void;
  /** item id → its painting, a workspace asset url (dt://asset/illustration/<sha256>.png) */
  paintings: Record<string, string>;
  onPaintings(next: Record<string, string>): void;
  /** Pick: the colour under the cursor, for the palette's proposals */
  onPick(oklch: Oklch): void;
  /** the inspector's Mixer slot: the well and the tubes are drawn there; null until it exists */
  mixer: HTMLElement | null;
  /** the palette's selected colour: what the well's distance (dE) is measured to */
  target: Oklch | null;
};

const BLANK: PaintingState = { depth: 0, redoDepth: 0, lastIsClear: false, blank: true };
/** after a lift the ring waits until the pointer moves this far, so it never sits on the fresh paint */
const RING_SLOP = 2;
const oklchOf = ([r, g, b]: [number, number, number]) => toOklch({ mode: 'rgb', r, g, b });

type Stroke = { id: number; onKey(e: globalThis.KeyboardEvent): void };

export function PaintCanvas(p: PaintCanvasProps) {
  const v = p.settings;
  const live = useRef(p);
  live.current = p;
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const where = useRef<HTMLSpanElement>(null);
  const wellEl = useRef<HTMLDivElement>(null);
  const clearBtn = useRef<HTMLButtonElement>(null);
  const [painting, setPainting] = useState(BLANK);
  const [armed, setArmed] = useState(false);
  const [over, setOver] = useState(false);

  const sources = useMemo(() => sourcesOf(p.pigments, p.sets), [p.pigments, p.sets]);
  const { brush, mix } = useBrush(v, sources, p.onSettings);
  const brushRef = useRef(brush);
  brushRef.current = brush;

  const started = useEngine(!p.hidden, canvas);
  const engine = started.t === 'ready' ? started.engine : null;
  const save = usePainting(engine, p.itemId, live);
  const clearToast = useRef<string | null>(null);

  useEffect(() => {
    if (!engine) return;
    setPainting(engine.state);
    const offChange = engine.on('change', (kind, state) => {
      setPainting(state);
      if (kind === 'restored') toast.show({ icon: 'restart_alt', message: 'The graphics card was reset. The painting is back, without its undo history.' });
      // a load (another palette, a relaunch) and a restore are the painting as saved
      else if (kind !== 'load') save.soon();
      toast.refresh();
    });
    const offError = engine.on('error', (e) => toast.show({ kind: 'error', message: `The stroke couldn't be painted, so it ended there: ${e.message}` }));
    return () => {
      offChange();
      offError();
    };
  }, [engine]);

  // ── the brush's ring and the cursor dot ──
  const scale = () => (canvas.current?.clientWidth ?? 0) / WIDTH;
  const lift = useRef<{ x: number; y: number } | null>(null);
  const sizeRing = (px: number) => ring.current?.style.setProperty('--ring', `${Math.max(6, px * scale())}px`);
  const hoverRing = () => sizeRing(brushWidth(v.brushes[v.medium], v.size, 1));
  useEffect(hoverRing, [v.brushes, v.medium, v.size]);
  const moveCursor = (e: PointerEvent<HTMLElement>) => {
    const c = cursor.current!;
    // a finger has no cursor; Pick shows the crosshair instead
    c.hidden = e.pointerType === 'touch' || v.tool === 'pick';
    const vr = view.current!.getBoundingClientRect();
    c.style.transform = `translate(${e.clientX - vr.left}px, ${e.clientY - vr.top}px)`;
    const pr = canvas.current!.getBoundingClientRect();
    if (where.current) {
      const [px, py] = [Math.round(((e.clientX - pr.left) * WIDTH) / pr.width), Math.round(((e.clientY - pr.top) * HEIGHT) / pr.height)];
      where.current.textContent = px >= 0 && py >= 0 && px < WIDTH && py < HEIGHT ? `X ${px}  Y ${py}` : '';
    }
    const l = lift.current;
    if (l && Math.hypot(e.clientX - l.x, e.clientY - l.y) >= RING_SLOP) {
      lift.current = null;
      ring.current!.hidden = false;
    }
  };

  // ── the stroke ──
  const stroke = useRef<Stroke | null>(null);
  const endStroke = (keep: boolean, last?: PointerSample) => {
    const st = stroke.current;
    if (!st) return;
    stroke.current = null;
    removeEventListener('keydown', st.onKey, true);
    if (canvas.current?.hasPointerCapture(st.id)) canvas.current.releasePointerCapture(st.id);
    if (keep) engine?.end(last);
    else engine?.cancel();
    hoverRing();
  };
  useEffect(() => () => endStroke(true), []);

  const pickAt = (at: PointerSample) => {
    void engine?.pick(at.x, at.y).then((rgb) => live.current.onPick(oklchOf(rgb)));
  };
  /** Pick's live readout: only the latest answer is written */
  const asked = useRef(0);
  const readUnder = (at: PointerSample) => {
    const n = ++asked.current;
    void engine?.pick(at.x, at.y).then((rgb) => {
      const el = readout.current;
      if (n !== asked.current || !el) return;
      const under = oklchOf(rgb);
      el.textContent = toHex(under).toUpperCase();
      el.style.setProperty('--under', cssColor(under));
    });
  };

  // the paper and the pasteboard around it take the pointer, so a stroke can start off the paper and
  // paint cleanly to its edge; the notes and the Clear confirmation on top do not. The paper's box is
  // read at every event: the layout can move under a stroke (Ctrl+L, the inspector, a proposals row).
  const paper = (e: PointerEvent<HTMLElement>) => e.target === canvas.current;
  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    const cv = canvas.current!;
    if (e.button !== 0 || !engine || stroke.current || save.loading || (!paper(e) && e.target !== e.currentTarget)) return;
    const first = toSample(e.nativeEvent, cv.getBoundingClientRect());
    if (v.tool === 'pick' || e.altKey) return paper(e) ? pickAt(first) : undefined;
    const smudge = v.tool === 'smudge';
    const b = brushRef.current;
    if (!smudge && !b) return void toast.show({ icon: 'brush', message: loadHint(!sources.length) });
    if (!paper(e)) cv.focus({ preventScroll: true });
    cv.setPointerCapture(e.pointerId);
    const onKey = (k: globalThis.KeyboardEvent) => {
      if (k.key !== 'Escape') return;
      k.preventDefault();
      k.stopPropagation();
      endStroke(false);
    };
    addEventListener('keydown', onKey, true);
    stroke.current = { id: e.pointerId, onKey };
    lift.current = null;
    ring.current!.hidden = false;
    // painting on after a Clear: its toast's Undo would take this stroke with it
    if (clearToast.current) toast.dismiss(clearToast.current);
    engine.begin({ tool: smudge ? 'smudge' : 'paint', medium: v.medium, brush: v.brushes[v.medium], size: v.size, load: v.load / 100, loaded: smudge ? null : b!.loaded }, first);
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    moveCursor(e);
    const st = stroke.current;
    const box = canvas.current!.getBoundingClientRect();
    if (v.tool === 'pick' && !st) return paper(e) ? readUnder(toSample(e.nativeEvent, box)) : undefined;
    if (!engine || st?.id !== e.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    engine.move((events.length ? events : [e.nativeEvent]).map((ev) => toSample(ev, box)));
    if (engine.liveWidth > 0) sizeRing(engine.liveWidth);
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const st = stroke.current;
    if (st?.id !== e.pointerId) return;
    endStroke(true, toSample(e.nativeEvent, canvas.current!.getBoundingClientRect()));
    // the ring leaves the fresh paint in view until the pointer moves on
    ring.current!.hidden = true;
    lift.current = { x: e.clientX, y: e.clientY };
  };

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const k = e.key.toLowerCase();
    // the palette's own keys (delete, duplicate, step along a ramp) wait until focus leaves the paper
    if (k === 'delete' || k === 'backspace' || k.startsWith('arrow') || ((e.ctrlKey || e.metaKey) && k === 'd')) return e.preventDefault();
    if (e.key !== '[' && e.key !== ']') return;
    e.preventDefault();
    const next = e.key === ']' ? Math.max(v.size + 1, Math.round(v.size * 1.2)) : Math.min(v.size - 1, Math.round(v.size / 1.2));
    p.onSettings({ size: Math.min(SIZE.max, Math.max(SIZE.min, next)) });
  };

  // ── undo, redo and clear ──
  const undo = () => {
    if (!engine || engine.stroking) return;
    engine.undo();
    if (clearToast.current && !engine.state.lastIsClear) toast.dismiss(clearToast.current);
  };
  const redo = () => {
    if (engine && !engine.stroking) engine.redo();
  };
  useCanvasKeys(!p.hidden, view, canvas, { undo, redo });
  const clear = () => {
    setArmed(false);
    if (!engine) return;
    engine.clear();
    clearBtn.current?.focus({ preventScroll: true });
    clearToast.current = toast.show({
      icon: 'delete_sweep',
      message: 'Painting cleared.',
      undo: () => {
        if (engine.state.lastIsClear) undo();
      },
      when: () => engine.state.lastIsClear,
      onClose: () => {
        clearToast.current = null;
      },
    });
  };

  // ── tray and well ──
  const load = (id: string) => p.onSettings({ paint: id, ...(v.tool === 'pick' ? { tool: 'paint' } : {}) });
  const emptyWell = () => {
    const was = v.well;
    p.onSettings({ well: [] });
    toast.show({
      icon: 'delete_sweep',
      message: `Emptied the well (${was.length === 1 ? '1 paint' : `${was.length} paints`}).`,
      undo: () => live.current.onSettings({ well: was }),
      when: () => !live.current.settings.well.length,
    });
  };
  const intoWell = (id: string) => {
    const well = addToWell(v.well, id);
    if (well) p.onSettings({ well });
    else toast.show({ icon: 'palette', message: `The well holds ${WELL_MAX} paints. Take one out to add another.` });
  };

  const tubes = useMemo(() => sources.filter((x) => !x.swatch), [sources]);
  const ready = !!engine && !save.loading;
  return (
    <section className={s.paint} aria-label="Paint canvas">
      <Toolbox tool={v.tool} onTool={(tool) => p.onSettings({ tool })} colour={brush?.oklch ?? null} />
      <div className={s.col}>
        <PaintBar
          v={v}
          onSettings={p.onSettings}
          brush={brush}
          emptyTray={!sources.length}
          readout={readout}
          painting={painting}
          ready={ready}
          onClear={() => setArmed(true)}
          clearBtn={clearBtn}
          onUndo={undo}
          onRedo={redo}
        />
        <div
          ref={view}
          className={cx(s.view, v.tool === 'pick' && s.picking, !ready && s.waiting)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onLostPointerCapture={() => endStroke(true)}
          onPointerEnter={(e) => {
            moveCursor(e);
            hoverRing();
          }}
          onPointerLeave={() => {
            cursor.current!.hidden = true;
            if (where.current) where.current.textContent = '';
          }}
        >
          <canvas
            ref={canvas}
            className={s.canvas}
            tabIndex={0}
            aria-label="Painting. Drag to paint; [ and ] change the brush size; Ctrl+Z undoes a stroke, Ctrl+Y redoes it."
            aria-disabled={!ready || undefined}
            onKeyDown={onKeyDown}
          />
          <div ref={cursor} className={s.cursor} hidden aria-hidden="true">
            <i ref={ring} className={s.ring} data-ring="" />
            <i className={s.dot} />
          </div>
          {started.t === 'starting' && started.slow && (
            <span className={s.note} role="status">
              Getting the paper ready
            </span>
          )}
          {started.t === 'failed' && (
            <p className={cx(s.note, s.failed)} role="alert">
              <Icon name="error" size={16} />
              {`The canvas couldn't start: ${started.message}`}
            </p>
          )}
          {armed && (
            <div className={s.confirm}>
              <ConfirmInline
                icon="delete_sweep"
                title="Clear the painting?"
                detail="The canvas goes back to blank paper. Undo brings the painting back."
                confirmLabel="Clear"
                danger
                onConfirm={clear}
                onKeep={() => {
                  setArmed(false);
                  clearBtn.current?.focus({ preventScroll: true });
                }}
              />
            </div>
          )}
        </div>
        <div className={s.foot}>
          <span className={s.paperSize}>
            Paper <b>{WIDTH} x {HEIGHT} px</b>
          </span>
          <span ref={where} className={s.where} />
          <span className={s.keys}>[ ] size · hold Alt to pick</span>
        </div>
      </div>
      {p.mixer &&
        createPortal(
          <>
            <InspectorGroup id="illustration.brush" title="Brush paint" meta={brush ? (brush.id === 'well' ? 'well loaded' : 'loaded') : 'empty'}>
              <Well
                ref={wellEl}
                well={v.well}
                sources={sources}
                mix={mix?.oklch ?? null}
                target={p.target}
                loaded={brush?.id === 'well'}
                over={over}
                onChange={(well) => p.onSettings({ well })}
                onEmpty={emptyWell}
                onLoad={() => load('well')}
              />
            </InspectorGroup>
            <InspectorGroup id="illustration.paints" title="Paints" meta={`${tubes.length} tubes${sources.length > tubes.length ? ` · ${sources.length - tubes.length} colours` : ''}`} sub="click to load the brush, or drag into the well">
              <Tray sources={sources} current={brush?.id ?? ''} onLoad={load} onAddToWell={intoWell} well={wellEl} onOver={setOver} />
            </InspectorGroup>
          </>,
          p.mixer,
        )}
    </section>
  );
}
