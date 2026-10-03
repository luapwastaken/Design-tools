import { inSrgb, parseHex, toHex, type Oklch } from '../../shared/color/index.ts';
import { fromHex } from '../../shared/color/picker.ts';
import { cx } from './cx.ts';
import { HexField } from './HexField.tsx';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';
import { usePickerColour } from './pickerModels.ts';
import { PickerNumbers, PickerSliders } from './PickerNumbers.tsx';
import { Gamut, PickerOklch } from './PickerOklch.tsx';
import { PickerSquare } from './PickerSquare.tsx';
import { PickerStyles, usePickerModel, usePickerStyle } from './PickerStyles.tsx';
import { PickerWheel } from './PickerWheel.tsx';
import type { NumberGesture } from './scrub.ts';
import { toast } from './toast.ts';
import s from './Picker.module.css';

/** A colour control's gesture: every drag is one begin/change/commit; `fromKey` steps may coalesce (spec §8). */
export type ColourGesture = Omit<NumberGesture, 'onChange'> & { onChange(v: Oklch): void };
/** the gesture without its change, which each part makes in its own terms */
export type Gesture = Omit<NumberGesture, 'onChange'>;

export type PickerProps = {
  value: Oklch;
  /** Value lock (OKLCH style): plane and track drags keep L. Typed values still change it (spec §5). */
  lockL?: boolean;
  /** Hue lock (OKLCH style): the hue track doesn't drag. */
  lockH?: boolean;
  /** draws the lock buttons on the L and H rows; the parent keeps the locks */
  onLock?(which: 'L' | 'H', on: boolean): void;
  /** the style switch at the top (a ColorField's popover); an inspector puts <PickerStyles> in its header instead */
  styles?: boolean;
  className?: string;
} & ColourGesture;

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

/**
 * The colour picker, in the app-wide style: Square, Wheel, Sliders or OKLCH. Colours stay OKLCH;
 * the first three work in sRGB, where a colour outside it shows clipped and changes only when edited.
 */
export function Picker(p: PickerProps) {
  const { value, className } = p;
  const style = usePickerStyle();
  const model = usePickerModel();
  const colour = usePickerColour(value, p.onChange);
  const g = { onBegin: p.onBegin, onCommit: p.onCommit, onCancel: p.onCancel };
  const hsb = { hsb: colour.hsb, onHsb: colour.setHsb, ...g };
  const srgb = style !== 'oklch';

  return (
    <div className={cx(s.picker, className)} data-picker={style}>
      {p.styles !== false && <PickerStyles className={s.styles} />}
      {style === 'square' && <PickerSquare {...hsb} />}
      {style === 'wheel' && <PickerWheel {...hsb} />}
      {(style === 'square' || style === 'wheel') && <PickerNumbers model={model} channels={colour.channels(model)} {...g} />}
      {style === 'sliders' && <PickerSliders model={model} channels={colour.channels(model)} {...g} />}
      {style === 'oklch' && (
        <PickerOklch value={value} channels={colour.channels('oklch')} lockL={p.lockL} lockH={p.lockH} onLock={p.onLock} {...g} onChange={p.onChange} />
      )}
      {srgb && model === 'cmyk' && <p className={s.note}>≈ Estimate from sRGB, no ICC profile</p>}
      <HexRow value={value} {...g} onChange={p.onChange} />
      {!srgb && <Gamut value={value} />}
      {srgb && !inSrgb(value) && (
        <p className={s.outside}>
          <Icon name="warning" size={14} />
          Outside sRGB: shown clipped, and kept until you change it
        </p>
      )}
    </div>
  );
}

function HexRow({ value, ...g }: { value: Oklch } & ColourGesture) {
  const hex = toHex(value);
  const pick = async () => {
    const got = await pickFromScreen();
    if (!got || got === hex) return;
    g.onBegin?.();
    g.onChange(fromHex(got, value[2]));
    g.onCommit?.();
  };
  const copy = () => {
    const text = hex.toUpperCase();
    void navigator.clipboard.writeText(text).then(
      () => toast.show({ icon: 'content_copy', message: <>Copied <b>{text}</b></> }),
      () => toast.show({ kind: 'error', message: "Couldn't copy to the clipboard." }),
    );
  };
  return (
    <div className={s.hexRow}>
      <HexField value={value} className={s.hex} {...g} />
      {EyeDropper && <IconButton icon="colorize" label="Eyedropper" onClick={() => void pick()} />}
      <IconButton icon="content_copy" label="Copy hex" onClick={copy} />
    </div>
  );
}
