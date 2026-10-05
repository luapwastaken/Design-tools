// The paint canvas's options row (the tool itself is the toolbox's): medium, brush, the loaded paint,
// size and load, the paper's stroke undo and redo, and Clear. One line down to a 724 px section: below 1000 px the paint's
// name goes (the chip keeps it in its tooltip), below 880 px the slider tracks go (the fields and
// their scrubbing labels stay), and below 700 px it may wrap, between groups only.
import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { cssColor } from '../../../shared/color/index.ts';
import { IconButton, NumberField, Segmented, Select, Slider, Tooltip } from '../../ui/index.ts';
import { cx } from '../../ui/cx.ts';
import type { BrushKind, PaintingState } from './paint/index.ts';
import { washColour } from './paint/wash.ts';
import { OptionsField } from '../common/OptionsBar.tsx';
import { BRUSHES, chipTip, LOAD, loadHint, SIZE, type PaintSettings } from './paint-sources.ts';
import type { Brush } from './useBrush.ts';
import s from './PaintCanvas.module.css';

const MEDIA: { value: PaintSettings['medium']; label: string; tip: string }[] = [
  { value: 'wet', label: 'Watercolour', tip: 'Watercolour: transparent washes that glaze over what’s there, darker where a wash ends.' },
  { value: 'dry', label: 'Gouache', tip: 'Gouache: opaque; covers, and mixes with the paint under it.' },
];
const SMUDGE_MEDIUM = 'Smudge pushes whatever paint is there, in either medium.';
const SMUDGE_BRUSH = 'Smudge always drags across the full width, whatever the brush.';

type Fit = 'full' | 'short' | 'compact' | 'wrap';
const fitOf = (w: number): Fit => (w >= 1000 ? 'full' : w >= 880 ? 'short' : w >= 700 ? 'compact' : 'wrap');

export type PaintBarProps = {
  v: PaintSettings;
  onSettings(patch: Partial<PaintSettings>): void;
  brush: Pick<Brush, 'name' | 'oklch' | 'loaded'> | null;
  /** nothing in the tray at all */
  emptyTray: boolean;
  /** Pick's live readout, written straight to the DOM */
  readout: RefObject<HTMLSpanElement | null>;
  painting: PaintingState;
  /** the engine is up: Clear can act */
  ready: boolean;
  onClear(): void;
  clearBtn: RefObject<HTMLButtonElement | null>;
  /** the paper's own stroke undo and redo (never the palette's) */
  onUndo(): void;
  onRedo(): void;
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
  const hint = loadHint(p.emptyTray);
  /** `width`: the field's once the track has gone and its label sits inside it; past 92 the slider is wider too */
  const number = (label: string, width: number, value: number, range: { min: number; max: number }, unit: string, onChange: (x: number) => void) =>
    tracks ? (
      <Slider label={label} value={value} min={range.min} max={range.max} unit={unit} fieldWidth={64} className={cx(s.slider, width > 92 && s.wide)} onChange={onChange} />
    ) : (
      <NumberField label={label} value={value} min={range.min} max={range.max} unit={unit} width={width} className={s.number} onChange={onChange} />
    );

  return (
    <header ref={head} className={s.head} data-fit={fit}>
      <OptionsField label="Medium">
        {smudge ? (
          <Tooltip content={SMUDGE_MEDIUM}>
            <span className={s.mediaOff}>
              <Segmented options={MEDIA} value={v.medium} onChange={(medium) => p.onSettings({ medium })} fit disabled />
            </span>
          </Tooltip>
        ) : (
          <Segmented options={MEDIA} value={v.medium} onChange={(medium) => p.onSettings({ medium })} fit />
        )}
      </OptionsField>
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
          <OptionsField label="Brush">
            {smudge ? (
              <Tooltip content={SMUDGE_BRUSH}>
                <span className={s.mediaOff}>
                  <Select<BrushKind> options={BRUSHES} value={v.brushes[v.medium]} onChange={() => {}} className={s.brushSelect} disabled />
                </span>
              </Tooltip>
            ) : (
              <Select<BrushKind> options={BRUSHES} value={v.brushes[v.medium]} onChange={(b) => p.onSettings({ brushes: { ...v.brushes, [v.medium]: b } })} className={s.brushSelect} />
            )}
          </OptionsField>
          {/* a smudge carries no paint of its own */}
          {!smudge && <OnBrush brush={p.brush} hint={hint} named={fit === 'full'} medium={v.medium} kind={v.brushes[v.medium]} load={v.load} size={v.size} />}
        </span>
      )}
      <span className={s.grow} />
      <span className={s.group}>
        {number('Size', 92, v.size, SIZE, 'px', (size) => p.onSettings({ size }))}
        {number(smudge ? 'Strength' : 'Load', smudge ? 120 : 92, v.load, LOAD, '%', (load) => p.onSettings({ load }))}
      </span>
      <span className={cx(s.group, s.acts)}>
        <IconButton icon="undo" label={`Undo a stroke on the paper, or a Clear${p.painting.depth ? ` (${p.painting.depth} kept)` : ''}`} shortcut="Ctrl+Z" size="sm" disabled={!p.ready || !p.painting.depth} onClick={p.onUndo} />
        <IconButton icon="redo" label="Redo a stroke on the paper" shortcut="Ctrl+Y" size="sm" disabled={!p.ready || !p.painting.redoDepth} onClick={p.onRedo} />
        <IconButton ref={p.clearBtn} icon="delete_sweep" label="Clear the painting" size="sm" disabled={!p.ready || p.painting.blank} onClick={p.onClear} />
      </span>
    </header>
  );
}

/**
 * The loaded paint's chip, and its name while the bar has room (the chip's tooltip has it otherwise).
 * Watercolour shows the wash the Load and Size give on bare paper, as the engine will paint it (halfway
 * along a stroke's run, which thins as it goes: paint/wash.ts), and follows both at once. Gouache covers,
 * and the Dry brush lays streaks and no wash: both show the paint.
 */
function OnBrush({ brush, hint, named, medium, kind, load, size }: { brush: PaintBarProps['brush']; hint: string; named: boolean; medium: PaintSettings['medium']; kind: BrushKind; load: number; size: number }) {
  const wash = medium === 'wet' && kind !== 'dry';
  const colour = useMemo(() => brush && (wash ? washColour(brush.loaded, load / 100, size) : brush.oklch), [brush, wash, load, size]);
  const chip = colour ? { background: cssColor(colour) } : undefined;
  const tip = brush && chipTip(medium, kind, brush.name, brush.oklch, load);
  if (!named) {
    const says = brush ? (tip ?? `On the brush: ${brush.name}.`) : hint;
    return (
      <Tooltip content={says}>
        <i className={s.brushChip} role="img" aria-label={says} style={chip} />
      </Tooltip>
    );
  }
  return (
    <span className={s.readout}>
      <Tooltip content={tip ?? ''} disabled={!tip}>
        <i className={s.brushChip} style={chip} />
      </Tooltip>
      <Tooltip overflowOnly>
        <span className={cx(s.brushName, !brush && s.dim)}>{brush?.name ?? hint}</span>
      </Tooltip>
    </span>
  );
}
