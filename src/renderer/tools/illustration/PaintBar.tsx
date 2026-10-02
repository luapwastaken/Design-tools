// The paint canvas's tool bar: tool, medium, brush, the loaded paint, size and load, undo, redo and
// clear. One line down to a 724 px section (1920 with the Library open): below 1000 px the paint's
// name goes (the chip keeps it in its tooltip), below 880 px the slider tracks go (the fields and
// their scrubbing labels stay), and below 700 px it may wrap, between groups only.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { cssColor, type Oklch } from '../../../shared/color/index.ts';
import { IconButton, NumberField, Segmented, Select, Slider, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import type { BrushKind, PaintingState } from './paint/index.ts';
import { BRUSHES, LOAD, SIZE, type PaintSettings, type PaintTool } from './paint-sources.ts';
import s from './PaintCanvas.module.css';

const TOOLS: { value: PaintTool; label: string; icon: 'brush' | 'gesture' | 'colorize'; tip: string }[] = [
  { value: 'paint', label: '', icon: 'brush', tip: 'Paint with the loaded brush' },
  { value: 'smudge', label: '', icon: 'gesture', tip: 'Smudge: push the paint around' },
  { value: 'pick', label: '', icon: 'colorize', tip: 'Pick: the colour under the cursor goes to the proposals. Alt-click picks while painting.' },
];
const MEDIA: { value: PaintSettings['medium']; label: string; tip: string }[] = [
  { value: 'wet', label: 'Watercolour', tip: 'Watercolour: transparent washes that glaze over what’s there, darker where a wash ends.' },
  { value: 'dry', label: 'Gouache', tip: 'Gouache: opaque; covers, and mixes with the paint under it.' },
];
const SMUDGE_MEDIUM = 'Smudge pushes whatever paint is there, in either medium.';

type Fit = 'full' | 'short' | 'compact' | 'wrap';
const fitOf = (w: number): Fit => (w >= 1000 ? 'full' : w >= 880 ? 'short' : w >= 700 ? 'compact' : 'wrap');

export type PaintBarProps = {
  v: PaintSettings;
  onSettings(patch: Partial<PaintSettings>): void;
  brush: { name: string; oklch: Oklch } | null;
  /** nothing in the tray at all */
  emptyTray: boolean;
  /** Pick's live readout, written straight to the DOM */
  readout: RefObject<HTMLSpanElement | null>;
  painting: PaintingState;
  /** the engine is up: undo, redo and clear can act */
  ready: boolean;
  onUndo(): void;
  onRedo(): void;
  onClear(): void;
  clearBtn: RefObject<HTMLButtonElement | null>;
};

export function PaintBar(p: PaintBarProps) {
  const { v } = p;
  const head = useRef<HTMLElement>(null);
  const [fit, setFit] = useState<Fit>('full');
  useLayoutEffect(() => {
    const el = head.current!;
    const ro = new ResizeObserver(() => el.clientWidth && setFit(fitOf(el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const smudge = v.tool === 'smudge';
  const tracks = fit === 'full' || fit === 'short';
  const hint = p.emptyTray ? 'Tick a paint you own to load the brush' : 'Click a paint in the tray to load the brush';
  /** `width`: the field's once the track has gone and its label sits inside it; past 92 the slider is wider too */
  const number = (label: string, width: number, value: number, range: { min: number; max: number }, unit: string, onChange: (x: number) => void) =>
    tracks ? (
      <Slider label={label} value={value} min={range.min} max={range.max} unit={unit} fieldWidth={64} className={cx(s.slider, width > 92 && s.wide)} onChange={onChange} />
    ) : (
      <NumberField label={label} value={value} min={range.min} max={range.max} unit={unit} width={width} className={s.number} onChange={onChange} />
    );

  return (
    <header ref={head} className={s.head} data-fit={fit}>
      <span className={s.group}>
        <Segmented options={TOOLS} value={v.tool} onChange={(tool) => p.onSettings({ tool })} fit className={s.tools} />
        {smudge ? (
          <Tooltip content={SMUDGE_MEDIUM}>
            <span className={s.mediaOff}>
              <Segmented options={MEDIA} value={v.medium} onChange={(medium) => p.onSettings({ medium })} fit disabled />
            </span>
          </Tooltip>
        ) : (
          <Segmented options={MEDIA} value={v.medium} onChange={(medium) => p.onSettings({ medium })} fit />
        )}
      </span>
      {/* Pick holds no brush: the colour under the cursor takes the brush's place */}
      {v.tool === 'pick' ? (
        <span className={cx(s.group, s.brushGroup, s.readout)}>
          <span className="lbl">Under</span>
          <span ref={p.readout} className={s.under}>
            Point at the paper
          </span>
        </span>
      ) : (
        <span className={cx(s.group, s.brushGroup)}>
          <Select<BrushKind> label="Brush" options={BRUSHES} value={v.brushes[v.medium]} onChange={(b) => p.onSettings({ brushes: { ...v.brushes, [v.medium]: b } })} className={s.brushSelect} />
          {/* a smudge carries no paint of its own */}
          {!smudge && <OnBrush brush={p.brush} hint={hint} named={fit === 'full'} />}
        </span>
      )}
      <span className={s.grow} />
      <span className={s.group}>
        {number('Size', 92, v.size, SIZE, 'px', (size) => p.onSettings({ size }))}
        {number(smudge ? 'Strength' : 'Load', smudge ? 120 : 92, v.load, LOAD, '%', (load) => p.onSettings({ load }))}
      </span>
      <span className={cx(s.group, s.acts)}>
        <IconButton icon="undo" label="Undo on the canvas: the last strokes, or a Clear" shortcut="Ctrl+Z" size="sm" disabled={!p.ready || !p.painting.depth} onClick={p.onUndo} />
        <IconButton icon="redo" label="Redo on the canvas" shortcut="Ctrl+Y" size="sm" disabled={!p.ready || !p.painting.redoDepth} onClick={p.onRedo} />
        <IconButton ref={p.clearBtn} icon="delete_sweep" label="Clear the painting" size="sm" disabled={!p.ready || p.painting.blank} onClick={p.onClear} />
      </span>
    </header>
  );
}

/** the loaded paint's chip, and its name while the bar has room (the chip's tooltip has it otherwise) */
function OnBrush({ brush, hint, named }: { brush: PaintBarProps['brush']; hint: string; named: boolean }) {
  const chip = brush ? { background: cssColor(brush.oklch) } : undefined;
  if (!named) {
    const says = brush ? `On the brush: ${brush.name}` : hint;
    return (
      <Tooltip content={says}>
        <i className={s.brushChip} role="img" aria-label={says} style={chip} />
      </Tooltip>
    );
  }
  return (
    <span className={s.readout}>
      <i className={s.brushChip} style={chip} />
      <Tooltip overflowOnly>
        <span className={cx(s.brushName, !brush && s.dim)}>{brush?.name ?? hint}</span>
      </Tooltip>
    </span>
  );
}
