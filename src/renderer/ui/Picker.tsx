import { useState } from 'react';
import { cmykEstimate, cssColor, inP3, inSrgb, parseHex, toHex, type Oklch } from '../../shared/color/index.ts';
import { fromCmyk, fromHex, fromRgb255, maxChroma, rgb255, type Cmyk, type Rgb255 } from '../../shared/color/picker.ts';
import { cx } from './cx.ts';
import { HexField } from './HexField.tsx';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';
import { NumberField } from './NumberField.tsx';
import { PickerChannel } from './PickerChannel.tsx';
import { axisAt, PickerPlane } from './PickerPlane.tsx';
import type { NumberGesture } from './scrub.ts';
import { Segmented } from './Segmented.tsx';
import { toast } from './toast.ts';
import s from './Picker.module.css';

/** A colour control's gesture: every drag is one begin/change/commit; `fromKey` steps may coalesce (spec §8). */
export type ColourGesture = Omit<NumberGesture, 'onChange'> & { onChange(v: Oklch): void };
export type PickerMode = 'oklch' | 'rgb' | 'cmyk';

export type PickerProps = {
  value: Oklch;
  /** with `onMode`, the parent owns the view switch and draws <PickerModes> (in its module header); without, the picker draws its own */
  mode?: PickerMode;
  onMode?(m: PickerMode): void;
  /** Value lock: plane and track drags keep L. Typed values still change it (spec §5). */
  lockL?: boolean;
  /** Hue lock: the hue track doesn't drag. */
  lockH?: boolean;
  // an RGB or ≈CMYK track moves L and hue together, so under either lock those tracks hold too
  className?: string;
} & ColourGesture;

const MODES: { value: PickerMode; label: string; tip?: string }[] = [
  { value: 'oklch', label: 'OKLCH' },
  { value: 'rgb', label: 'RGB' },
  { value: 'cmyk', label: 'CMYK', tip: '≈CMYK, an estimate' },
];

export function PickerModes({ value, onChange, className }: { value: PickerMode; onChange(m: PickerMode): void; className?: string }) {
  return <Segmented mono fit options={MODES} value={value} onChange={onChange} className={className} />;
}

type EyeDropperApi = { open(): Promise<{ sRGBHex: string }> };
const EyeDropper = (globalThis as { EyeDropper?: new () => EyeDropperApi }).EyeDropper;

/** A colour from anywhere on screen through the native eyedropper; null when cancelled or unsupported. */
export async function pickFromScreen(): Promise<string | null> {
  if (!EyeDropper) return null;
  try {
    return parseHex((await new EyeDropper().open()).sRGBHex);
  } catch {
    return null; // Esc
  }
}

/** n CSS stops along t = 0..1 */
const stops = (n: number, at: (t: number) => Oklch) => Array.from({ length: n }, (_, i) => cssColor(at(i / (n - 1)))).join(', ');
/** a channel that is linear in sRGB needs only its two ends */
const srgbTrack = (a: Oklch, b: Oklch) => `linear-gradient(90deg in srgb, ${cssColor(a)}, ${cssColor(b)})`;
const signed = (v: number) => `${v < -5e-4 ? '-' : '+'}${Math.abs(v).toFixed(3)}`;

/**
 * The colour picker (spec §2, plan unit F): the L-by-C plane at the current hue, channel tracks
 * with typable fields (OKLCH, RGB or ≈CMYK), the hex, the eyedropper and the gamut readouts.
 */
export function Picker(p: PickerProps) {
  const { value, lockL, lockH, className } = p;
  const [own, setOwn] = useState<PickerMode>('oklch');
  const mode = p.onMode ? (p.mode ?? 'oklch') : own;
  // ≈CMYK doesn't round trip (it keeps no grey component), so what you set shows while it still is the colour
  const [held, setHeld] = useState<Cmyk | null>(null);
  const [l, c, h] = value;
  const hex = toHex(value);
  const g = { onBegin: p.onBegin, onCommit: p.onCommit, onCancel: p.onCancel };
  const edgeC = maxChroma(l, h, 'srgb');
  const axis = axisAt(h);

  const oklch = (i: number) => (v: number) => p.onChange(value.map((x, j) => (j === i ? v : x)) as Oklch);
  const rgb = rgb255(value);
  const rgbAt = (i: number, v: number) => rgb.map((x, j) => (j === i ? v : x)) as Rgb255;
  const cmyk = held && toHex(fromCmyk(held, h)) === hex ? held : cmykEstimate(value);
  const cmykAt = (i: number, v: number) => cmyk.map((x, j) => (j === i ? v : x)) as Cmyk;

  const pick = async () => {
    const got = await pickFromScreen();
    if (!got || got === hex) return;
    p.onBegin?.();
    p.onChange(fromHex(got, h));
    p.onCommit?.();
  };
  const copy = () => {
    const text = hex.toUpperCase();
    void navigator.clipboard.writeText(text).then(
      () => toast.show({ icon: 'content_copy', message: <>Copied <b>{text}</b></> }),
      () => toast.show({ kind: 'error', message: "Couldn't copy to the clipboard." }),
    );
  };

  return (
    <div className={cx(s.picker, className)}>
      {!p.onMode && <PickerModes value={own} onChange={setOwn} className={s.modes} />}
      <PickerPlane value={value} lockL={lockL} {...g} onChange={p.onChange} />

      <div className={s.chans}>
        {/* the plane sets L and C: in the other views they still get a field each (hard rule 5) */}
        {mode !== 'oklch' && (
          <div className={s.planeNums}>
            <NumberField label="L" value={l} min={0} max={1} step={0.005} precision={3} size="sm" {...g} onChange={oklch(0)} className={s.planeNum} />
            <NumberField label="C" value={c} min={0} max={0.4} step={0.001} precision={3} size="sm" {...g} onChange={oklch(1)} className={s.planeNum} />
          </div>
        )}
        {mode === 'oklch' && (
          <>
            <PickerChannel
              label="L"
              value={l}
              min={0}
              max={1}
              step={0.005}
              precision={3}
              track={`linear-gradient(90deg in oklch, ${stops(21, (t) => [t, c, h])})`}
              locked={lockL}
              {...g}
              onChange={oklch(0)}
            />
            <PickerChannel
              label="C"
              value={c}
              min={0}
              max={0.4}
              step={0.001}
              span={[0, axis]}
              limit={edgeC / axis}
              track={`linear-gradient(90deg in oklch, ${stops(8, (t) => [l, t * edgeC, h])})`}
              {...g}
              onChange={oklch(1)}
            />
            <PickerChannel
              label="H"
              value={h}
              min={0}
              max={360}
              step={1}
              precision={1}
              unit="°"
              track={`linear-gradient(90deg in oklch, ${stops(25, (t) => [l, c, t * 360])})`}
              locked={lockH}
              {...g}
              onChange={oklch(2)}
            />
          </>
        )}
        {mode === 'rgb' &&
          (['R', 'G', 'B'] as const).map((label, i) => (
            <PickerChannel
              key={label}
              label={label}
              value={rgb[i]}
              min={0}
              max={255}
              step={1}
              track={srgbTrack(fromRgb255(rgbAt(i, 0), h), fromRgb255(rgbAt(i, 255), h))}
              locked={lockL || lockH}
              {...g}
              onChange={(v) => p.onChange(fromRgb255(rgbAt(i, v), h))}
            />
          ))}
        {mode === 'cmyk' && (
          <>
            {(['C', 'M', 'Y', 'K'] as const).map((label, i) => (
              <PickerChannel
                key={label}
                label={label}
                value={cmyk[i]}
                min={0}
                max={100}
                step={1}
                unit="%"
                track={srgbTrack(fromCmyk(cmykAt(i, 0), h), fromCmyk(cmykAt(i, 100), h))}
                locked={lockL || lockH}
                {...g}
                onChange={(v) => {
                  const next = cmykAt(i, v);
                  setHeld(next);
                  p.onChange(fromCmyk(next, h));
                }}
              />
            ))}
            <p className={s.note}>≈ Estimate from sRGB, no ICC profile</p>
          </>
        )}
      </div>

      <div className={s.hexRow}>
        <HexField value={value} className={s.hex} {...g} onChange={p.onChange} />
        {EyeDropper && <IconButton icon="colorize" label="Eyedropper" onClick={() => void pick()} />}
        <IconButton icon="content_copy" label="Copy hex" onClick={copy} />
      </div>

      <div className={s.gam}>
        <div>
          <span className="lbl">sRGB</span>
          <span className={s.gv}>
            <Icon name={inSrgb(value) ? 'check' : 'warning'} size={14} />
            {inSrgb(value) ? 'In gamut' : inP3(value) ? 'Outside · in P3' : 'Outside P3'}
          </span>
        </div>
        <div>
          <span className="lbl">Chroma headroom</span>
          <span className={s.gv}>{signed(edgeC - c)}</span>
        </div>
      </div>
    </div>
  );
}
