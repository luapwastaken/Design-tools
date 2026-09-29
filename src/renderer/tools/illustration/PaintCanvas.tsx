// The paint canvas (spec §3.3, plan unit C): a scratch pad where paints mix as paint, wet
// (watercolour) or dry (gouache), with Paint, Smudge and Pick, a pigment tray and a mixing well.
// Layout (UX pass): one tool bar over the paper (tools, medium, brush, size, load, undo, clear),
// the tray under it with the well first.
// Its painting is a PNG workspace asset per Library item, saved a moment after each stroke
// settles. Its undo is its own (the last strokes), never the document's.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { cssColor, toHex, toOklch, type Oklch } from '../../../shared/color/index.ts';
import type { Pigment } from '../../../shared/paint/pigments.ts';
import { decodeImage } from '../../lib/load.ts';
import { shell } from '../../shell/core/index.ts';
import { ConfirmInline, IconButton, Segmented, Slider, toast, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import { CANVAS_H, CANVAS_W, PaintSim, type Loaded } from './paint-sim.ts';
import { addToWell, LOAD, loadedOf, SIZE, sourcesOf, WELL_MAX, wellMix, type PaintSettings, type PaintTool, type PaletteSet } from './paint-sources.ts';
import { Tray, Well } from './PaintTray.tsx';
import s from './PaintCanvas.module.css';

export type PaintCanvasProps = {
  /** the open Library item: its painting is kept under this id. Null until the document is saved. */
  itemId: string | null;
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
};

const TOOL = 'illustration';
const SAVE_MS = 1000;
/** a lifted stroke settles off-screen, about this much work a frame, so the UI keeps 60fps */
const SETTLE_MS = 8;

const TOOLS: { value: PaintTool; label: string; icon: 'brush' | 'gesture' | 'colorize'; tip?: string }[] = [
  { value: 'paint', label: 'Paint', icon: 'brush' },
  { value: 'smudge', label: 'Smudge', icon: 'gesture', tip: 'Smudge: push the paint around' },
  { value: 'pick', label: 'Pick', icon: 'colorize', tip: 'Pick: the colour under the cursor goes to the proposals. Alt-click picks while painting.' },
];
const MEDIA: { value: PaintSettings['medium']; label: string; tip: string }[] = [
  { value: 'wet', label: 'Wet', tip: 'Wet: watercolour. Transparent; as you lift the brush the wash bleeds and dries with a darker edge.' },
  { value: 'dry', label: 'Dry', tip: 'Dry: gouache. Opaque and matte; a brush low on paint drags dry.' },
];

type Brush = { id: string; loaded: Loaded; oklch: Oklch; name: string };

export function PaintCanvas(p: PaintCanvasProps) {
  const v = p.settings;
  const live = useRef(p);
  live.current = p;
  const sim = useMemo(() => new PaintSim(), []);
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);
  const wellEl = useRef<HTMLDivElement>(null);
  const clearBtn = useRef<HTMLButtonElement>(null);
  const [depth, setDepth] = useState(0);
  const [painted, setPainted] = useState(false);
  const [armed, setArmed] = useState(false);
  const [over, setOver] = useState(false);
  const [scale, setScale] = useState(0.5);

  const sources = useMemo(() => sourcesOf(p.pigments, p.sets), [p.pigments, p.sets]);
  const mix = useMemo(() => wellMix(v.well, sources), [v.well, sources]);
  const brush = useMemo((): Brush | null => {
    if (v.paint === 'well' && mix) return { id: 'well', loaded: mix.loaded, oklch: mix.oklch, name: 'Well mix' };
    // a paint no longer in the tray (unticked, or a swatch that went): the first one there is
    const src = sources.find((x) => x.id === v.paint) ?? sources[0];
    return src ? { id: src.id, loaded: loadedOf(src.pigment), oklch: src.pigment.oklch, name: src.name } : null;
  }, [v.paint, sources, mix]);
  const brushRef = useRef(brush);
  brushRef.current = brush;

  const paint = usePainter(sim, canvas);
  const save = usePainting(sim, p.itemId, live, paint.snapshot, () => {
    setDepth(0);
    setPainted(!sim.blank);
    paint.kick();
  });

  const afterChange = () => {
    setDepth(sim.depth);
    setPainted(!sim.blank);
    save.soon();
    paint.kick();
  };

  // ── the canvas under the pointer ──
  const stroke = useRef<{ id: number; onKey(e: globalThis.KeyboardEvent): void } | null>(null);
  const clearToast = useRef<string | null>(null);
  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * CANVAS_W) / r.width, y: ((e.clientY - r.top) * CANVAS_H) / r.height };
  };
  const pressure = (e: globalThis.PointerEvent) => (e.pointerType === 'pen' ? e.pressure : 1);

  const endStroke = (keep: boolean) => {
    const st = stroke.current;
    if (!st) return;
    stroke.current = null;
    removeEventListener('keydown', st.onKey, true);
    if (canvas.current?.hasPointerCapture(st.id)) canvas.current.releasePointerCapture(st.id);
    if (keep) sim.end();
    else sim.cancel();
    afterChange();
  };
  useEffect(() => () => endStroke(true), []);

  const pickAt = (x: number, y: number) => {
    const [r, g, b] = sim.pick(x, y);
    live.current.onPick(toOklch({ mode: 'rgb', r, g, b }));
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || stroke.current || save.loading) return;
    const { x, y } = at(e);
    if (v.tool === 'pick' || e.altKey) return pickAt(x, y);
    const b = brushRef.current;
    if (!b) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const onKey = (k: globalThis.KeyboardEvent) => {
      if (k.key !== 'Escape') return;
      k.preventDefault();
      k.stopPropagation();
      endStroke(false);
    };
    addEventListener('keydown', onKey, true);
    stroke.current = { id: e.pointerId, onKey };
    // painting on after a Clear: its toast's Undo would take this stroke with it
    if (clearToast.current) toast.dismiss(clearToast.current);
    sim.begin({ tool: v.tool === 'smudge' ? 'smudge' : 'paint', medium: v.medium, size: v.size, load: v.load / 100, loaded: b.loaded }, x, y, pressure(e.nativeEvent));
    paint.kick();
  };

  const moveRing = (e: PointerEvent<HTMLCanvasElement>) => {
    const vr = view.current!.getBoundingClientRect();
    ring.current!.style.transform = `translate(${e.clientX - vr.left}px, ${e.clientY - vr.top}px)`;
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    moveRing(e);
    if (v.tool === 'pick' && readout.current) {
      // a live readout, written straight to the DOM: no render per pointer move
      const { x, y } = at(e);
      const [r, g, b] = sim.pick(x, y);
      const under = toOklch({ mode: 'rgb', r, g, b });
      readout.current.textContent = toHex(under).toUpperCase();
      readout.current.style.setProperty('--under', cssColor(under));
    }
    if (stroke.current?.id !== e.pointerId) return;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const q = at(ev);
      sim.to(q.x, q.y, pressure(ev));
    }
    paint.kick();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    // on the paper, undo is the painting's: a painter's reflex Ctrl+Z must never rewrite the palette.
    // The palette's own keys (delete, duplicate, step along a ramp) wait until focus leaves it.
    if (mod && (k === 'z' || k === 'y')) {
      e.preventDefault();
      if (k === 'z' && !e.shiftKey && depth) undo();
      return;
    }
    if (k === 'delete' || k === 'backspace' || k.startsWith('arrow') || (mod && k === 'd')) return e.preventDefault();
    if (e.key !== '[' && e.key !== ']') return;
    e.preventDefault();
    const next = e.key === ']' ? Math.max(v.size + 1, Math.round(v.size * 1.2)) : Math.min(v.size - 1, Math.round(v.size / 1.2));
    p.onSettings({ size: Math.min(SIZE.max, Math.max(SIZE.min, next)) });
  };

  useEffect(() => {
    const el = canvas.current!;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / CANVAS_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── undo and clear ──
  const undo = () => {
    sim.undo();
    afterChange();
    if (clearToast.current && !sim.lastIsClear) toast.dismiss(clearToast.current);
  };
  const clear = () => {
    setArmed(false);
    sim.clear(true);
    afterChange();
    clearBtn.current?.focus({ preventScroll: true });
    clearToast.current = toast.show({
      icon: 'delete_sweep',
      message: 'Painting cleared.',
      undo: () => {
        if (sim.lastIsClear) undo();
      },
      when: () => sim.lastIsClear,
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

  const ringSize = Math.max(6, v.size * scale);
  return (
    <section className={s.paint} aria-label="Paint canvas">
      {/* in groups, so a narrow bar wraps between them rather than through them */}
      <header className={s.head}>
        <span className={s.group}>
          <Segmented options={TOOLS} value={v.tool} onChange={(tool) => p.onSettings({ tool })} fit />
          <Segmented options={MEDIA} value={v.medium} onChange={(medium) => p.onSettings({ medium })} mono fit />
        </span>
        <span className={s.grow} />
        {v.tool === 'pick' ? (
          <span className={s.readout}>
            <span className="lbl">Under</span>
            <span ref={readout} className={s.under}>
              Point at the paper
            </span>
          </span>
        ) : (
          <span className={s.readout}>
            <span className="lbl">Brush</span>
            <i className={s.brushChip} style={brush ? { background: cssColor(brush.oklch) } : undefined} />
            <Tooltip overflowOnly>
              <span className={s.brushName}>{brush?.name ?? 'Tick a paint you own to load the brush'}</span>
            </Tooltip>
          </span>
        )}
        <span className={s.group}>
          <span className={s.sep} />
          <Slider label="Size" value={v.size} min={SIZE.min} max={SIZE.max} unit="px" fieldWidth={64} className={s.slider} onChange={(size) => p.onSettings({ size })} />
          <Slider
            label={v.tool === 'smudge' ? 'Strength' : 'Load'}
            value={v.load}
            min={LOAD.min}
            max={LOAD.max}
            unit="%"
            fieldWidth={64}
            className={s.slider}
            onChange={(load) => p.onSettings({ load })}
          />
          <span className={s.sep} />
          <IconButton icon="undo" label="Undo on the canvas: the last strokes, or a Clear" size="sm" disabled={!depth} onClick={undo} />
          <IconButton ref={clearBtn} icon="delete_sweep" label="Clear the painting" size="sm" disabled={!painted} onClick={() => setArmed(true)} />
        </span>
      </header>

      <div ref={view} className={cx(s.view, v.tool === 'pick' && s.picking)} style={{ '--ring': `${ringSize}px` } as CSSProperties}>
        <canvas
          ref={canvas}
          width={CANVAS_W}
          height={CANVAS_H}
          className={s.canvas}
          tabIndex={0}
          aria-label="Painting. Drag to paint; the [ and ] keys change the brush size; Ctrl+Z undoes a stroke."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => endStroke(true)}
          onLostPointerCapture={() => endStroke(true)}
          onPointerEnter={(e) => {
            moveRing(e);
            ring.current!.hidden = false;
          }}
          onPointerLeave={() => {
            ring.current!.hidden = true;
          }}
          onKeyDown={onKeyDown}
        />
        <div ref={ring} className={s.ring} hidden aria-hidden="true">
          <i />
        </div>
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

      <div className={s.trayRow}>
        <Well
          ref={wellEl}
          well={v.well}
          sources={sources}
          mix={mix?.oklch ?? null}
          loaded={brush?.id === 'well'}
          over={over}
          onChange={(well) => p.onSettings({ well })}
          onEmpty={emptyWell}
          onLoad={() => load('well')}
        />
        <Tray sources={sources} current={brush?.id ?? ''} onLoad={load} onAddToWell={intoWell} well={wellEl} onOver={setOver} />
      </div>
    </section>
  );
}

/**
 * Draws the simulation into the canvas: a stroke as it's painted, then, once the lifted stroke has
 * settled (a few frames of work, off-screen), the settled wash in one go.
 */
function usePainter(sim: PaintSim, canvas: RefObject<HTMLCanvasElement | null>) {
  const st = useRef({ raf: 0, ctx: null as CanvasRenderingContext2D | null, img: null as ImageData | null });

  const draw = (budgetMs: number) => {
    const { ctx, img } = st.current;
    const d = ctx && img ? sim.frame(budgetMs) : null;
    if (!d) return;
    sim.render(img!.data, d);
    ctx!.putImageData(img!, 0, 0, d.x0, d.y0, d.x1 - d.x0 + 1, d.y1 - d.y0 + 1);
  };
  const tick = () => {
    st.current.raf = 0;
    draw(SETTLE_MS);
    if (sim.wet || sim.stroking) kick();
  };
  const kick = () => {
    if (!st.current.raf) st.current.raf = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const ctx = canvas.current!.getContext('2d', { alpha: false })!;
    const img = ctx.createImageData(CANVAS_W, CANVAS_H);
    img.data.fill(255);
    Object.assign(st.current, { ctx, img });
    draw(Infinity);
    return () => cancelAnimationFrame(st.current.raf);
  }, []);

  return {
    kick,
    /** the whole painting, copied (a stroke still settling settles first) */
    snapshot(): ImageData {
      draw(Infinity);
      return new ImageData(new Uint8ClampedArray(st.current.img!.data), CANVAS_W, CANVAS_H);
    },
  };
}

/**
 * The painting as a workspace asset per Library item: loaded when the item changes, saved a
 * second after the last stroke once it has settled. A document with no item yet
 * keeps its painting in memory and saves it under the item its first commit makes, and one that
 * moves to another item (a fork, a rename) keeps the painting on screen and saves it there.
 */
function usePainting(
  sim: PaintSim,
  itemId: string | null,
  props: RefObject<PaintCanvasProps>,
  snapshot: () => ImageData,
  onLoaded: () => void,
) {
  const owner = useRef<string | null | undefined>(undefined);
  /** a relink the shell announced: the item id about to change, and to what */
  const carried = useRef<{ from: string; to: string } | null>(null);
  const unsaved = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** saves run one after another, so a quit waits for one already under way and an older one never lands last */
  const saving = useRef<Promise<void>>(Promise.resolve());
  const [loading, setLoading] = useState(false);

  const store = async (id: string, out: OffscreenCanvas | null) => {
    let url: string | null = null;
    if (out) {
      try {
        const blob = await out.convertToBlob({ type: 'image/png' });
        url = (await window.api.invoke('workspace.putAsset', TOOL, await blob.arrayBuffer(), 'png')).url;
      } catch (e) {
        if (owner.current === id) unsaved.current = true;
        toast.show({ kind: 'error', message: `The painting couldn't be saved: ${e instanceof Error ? e.message : String(e)}` });
        return;
      }
    }
    const { paintings, onPaintings } = props.current;
    if (!url && !(id in paintings)) return;
    const { [id]: _, ...rest } = paintings;
    onPaintings(url ? { ...rest, [id]: url } : rest);
  };

  const write = (id: string | null): Promise<void> => {
    if (!id || !unsaved.current) return saving.current;
    unsaved.current = false;
    // copied now: the canvas may change (another item) while this waits and encodes
    const out = sim.blank ? null : new OffscreenCanvas(CANVAS_W, CANVAS_H);
    out?.getContext('2d')!.putImageData(snapshot(), 0, 0);
    return (saving.current = saving.current.then(() => store(id, out)));
  };

  const trySave = () => {
    if (sim.wet || sim.stroking) timer.current = setTimeout(trySave, 300);
    else void write(owner.current ?? null);
  };

  useEffect(
    () =>
      shell.onRelink(TOOL, (from, to) => {
        if (owner.current === from) carried.current = { from, to };
      }),
    [],
  );

  useEffect(() => {
    const prev = owner.current;
    if (prev === itemId) return;
    owner.current = itemId;
    clearTimeout(timer.current);
    // the document just got its item, or moved to another (a fork, a rename): the painting on
    // screen is its painting, saved under the new id
    const moved = !!prev && carried.current?.from === prev && carried.current.to === itemId;
    carried.current = null;
    if (moved || (prev === null && itemId && !props.current.paintings[itemId])) {
      if (moved && !sim.blank) unsaved.current = true;
      if (unsaved.current) trySave();
      return;
    }
    void write(prev ?? null);
    sim.clear(false);
    onLoaded();
    const url = itemId ? props.current.paintings[itemId] : undefined;
    if (!url) return;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`status ${res.status}`);
        const bmp = await decodeImage(await res.blob(), 'The painting');
        const ctx = new OffscreenCanvas(CANVAS_W, CANVAS_H).getContext('2d')!;
        ctx.drawImage(bmp, 0, 0, CANVAS_W, CANVAS_H);
        bmp.close();
        if (owner.current === itemId) sim.load(ctx.getImageData(0, 0, CANVAS_W, CANVAS_H).data);
      } catch (e) {
        toast.show({ kind: 'error', message: `This palette's painting couldn't be read, so the canvas starts blank. (${e instanceof Error ? e.message : String(e)})` });
      } finally {
        if (owner.current === itemId) {
          setLoading(false);
          onLoaded();
        }
      }
    })();
  }, [itemId]);

  useEffect(() => {
    // every save writes a new file: the ones no palette points at any more go (the service keeps
    // anything under a minute old, and whatever a quarantined workspace refers to)
    const keep = Object.values(props.current.paintings).flatMap((url) => /[0-9a-f]{64}/.exec(url) ?? []);
    void window.api.invoke('workspace.gcAssets', TOOL, keep).catch(() => {});
    // a quit inside the save's delay keeps the last strokes (one still settling settles first)
    const off = shell.beforeClose(() => {
      clearTimeout(timer.current);
      return write(owner.current ?? null);
    });
    return () => {
      off();
      clearTimeout(timer.current);
      void write(owner.current ?? null);
    };
  }, []);

  return {
    loading,
    /** a stroke, an undo or a clear changed the painting */
    soon() {
      unsaved.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(trySave, SAVE_MS);
    },
  };
}
