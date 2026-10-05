import type { ReactNode } from 'react';
import { IconButton } from './IconButton.tsx';
import { NumberField } from './NumberField.tsx';
import { Segmented } from './Segmented.tsx';
import { MAX_SCALE, MIN_SCALE } from './viewport.ts';
import s from './ViewStrip.module.css';

/** The zoom half of the strip: a Viewport hands its own state in; a tool without one leaves `zoom` out. */
export type ZoomControls = {
  /** the zoom as a percentage (the typable field's value) */
  pct: number;
  preset: 'fit' | 'actual' | 'none';
  disabled?: boolean;
  onFit(): void;
  onActual(): void;
  onIn(): void;
  onOut(): void;
  /** a typed zoom, in percent */
  onType(pct: number): void;
  /** the field refused an entry (true) or took one (false) */
  onBad?(bad: boolean): void;
};

export type ViewStripProps = {
  zoom?: ZoomControls;
  /** pressed buttons / Toggles for what the canvas draws on top (Guides, Clearspace, Seams); sits right after the zoom */
  overlays?: ReactNode;
  /** the canvas-background control (a few swatch segments), right-aligned */
  background?: ReactNode;
  /** right-aligned readouts: the pointer, a size, a count (values in <b>) */
  readout?: ReactNode;
};

const PRESETS: { value: 'fit' | 'actual' | 'none'; label: string; tip: string }[] = [
  { value: 'fit', label: 'Fit', tip: 'Fit in view (Ctrl 0)' },
  { value: 'actual', label: '100%', tip: 'Actual size (Ctrl Alt 0)' },
];

/**
 * The 36px strip under every canvas: Fit | 100% | typable zoom | overlays | (right) background |
 * readouts. `Viewport` draws it itself; pass its `overlays`, `background` and `cursor`.
 */
export function ViewStrip({ zoom, overlays, background, readout }: ViewStripProps) {
  const pct = zoom?.pct ?? 100;
  return (
    <div className={s.bar} data-view-strip="">
      {zoom && (
        <>
          <Segmented<'fit' | 'actual' | 'none'> mono fit options={PRESETS} value={zoom.preset} disabled={zoom.disabled} onChange={(v) => (v === 'fit' ? zoom.onFit() : zoom.onActual())} />
          <IconButton icon="zoom_out" label="Zoom out" shortcut="Ctrl+-" disabled={zoom.disabled || pct <= MIN_SCALE * 100} onClick={zoom.onOut} />
          <NumberField
            label="Zoom"
            hideLabel
            value={pct}
            min={MIN_SCALE * 100}
            max={MAX_SCALE * 100}
            precision={pct < 10 ? 2 : pct < 100 ? 1 : 0}
            unit="%"
            width={78}
            className={s.zoom}
            disabled={zoom.disabled}
            onChange={(v) => zoom.onType(v)}
            onError={(m) => zoom.onBad?.(m !== null)}
          />
          <IconButton icon="zoom_in" label="Zoom in" shortcut="Ctrl+=" disabled={zoom.disabled || pct >= MAX_SCALE * 100} onClick={zoom.onIn} />
        </>
      )}
      {overlays}
      <span className={s.grow} />
      {background}
      {readout}
    </div>
  );
}
