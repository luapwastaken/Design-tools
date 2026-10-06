import type { KeyboardEvent } from 'react';
import { inSrgb, parseHex, toHex, type Oklch } from '../../shared/color/index.ts';
import { fromHex } from '../../shared/color/picker.ts';
import { valueOf } from '../../shared/color/value.ts';
import { isTextField } from '../shell/core/keys.ts';
import { cx } from './cx.ts';
import { HexField } from './HexField.tsx';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';
import { usePickerColour } from './pickerModels.ts';
import { PickerNumbers, PickerSliders } from './PickerNumbers.tsx';
import { Gamut, PickerOklch } from './PickerOklch.tsx';
import { PickerSquare } from './PickerSquare.tsx';
import { PickerStyles, toggleValueLock, usePickerModel, usePickerStyle, ValueLock } from './PickerStyles.tsx';
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
  /** the style switch and the value lock at the top (a ColorField's popover); an inspector puts <PickerStyles> and <ValueLock> in its header instead */
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
 * V toggles the value lock while focus is in it (the colour tools also take V from anywhere else).
 */
export function Picker(p: PickerProps) {
  const { value, className } = p;
  const style = usePickerStyle();
  const g = { onBegin: p.onBegin, onCommit: p.onCommit, onCancel: p.onCancel };
  const colour = usePickerColour(value, p.onChange);
  const srgb = style !== 'oklch';
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.code !== 'KeyV' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.defaultPrevented || isTextField(e.target as HTMLElement)) return;
    e.preventDefault(); // so the tool's own V doesn't toggle it again
    toggleValueLock();
  };

  return (
    <div className={cx(s.picker, className)} data-picker={style} onKeyDown={onKeyDown}>
      {p.styles !== false && (
        <div className={s.top}>
          <PickerStyles />
          <ValueLock />
        </div>
      )}
      <PickerBody value={value} colour={colour} {...g} />
      <HexRow value={value} {...g} onChange={p.onChange} />
      {!srgb && <Gamut value={value} target={colour.target} />}
      {srgb && !inSrgb(value) && (
        <p className={s.outside}>
          <Icon name="warning" size={14} />
          Outside sRGB: shown clipped, and kept until you change it
        </p>
      )}
    </div>
  );
}

/**
 * The picker's style, whichever it is, with the value lock's readout: shared by the Picker and the
 * Design inspector (which puts its own rows around it). `numbers` is the model row under Square and Wheel.
 */
export function PickerBody({ value, colour, numbers = true, ...gesture }: { value: Oklch; colour: ReturnType<typeof usePickerColour>; numbers?: boolean } & Gesture) {
  const g = { ...gesture, onBegin: () => (colour.begin(), gesture.onBegin?.()) };
  const style = usePickerStyle();
  const model = usePickerModel();
  const hsb = { hsb: colour.hsb, onHsb: colour.setHsb, contour: colour.contour(), ...g };
  const srgb = style !== 'oklch';
  return (
    <>
      {style === 'square' && <PickerSquare {...hsb} hueTrack={colour.hueTrack()} />}
      {style === 'wheel' && <PickerWheel {...hsb} />}
      {numbers && (style === 'square' || style === 'wheel') && <PickerNumbers model={model} channels={colour.channels(model)} {...g} />}
      {style === 'sliders' && <PickerSliders model={model} channels={colour.channels(model)} {...g} />}
      {style === 'oklch' && <PickerOklch value={value} channels={colour.channels('oklch')} target={colour.target} onSlide={colour.slide} {...g} onChange={colour.retarget} />}
      {colour.locked && (
        <p className={s.held}>
          <span className="lbl">Value</span>
          <b>{(valueOf(value) * 100).toFixed(1)}</b>
          {colour.target === null && <span>nothing to hold at black or white</span>}
        </p>
      )}
      {srgb && model === 'cmyk' && (style === 'sliders' || numbers) && <p className={s.note}>≈ Estimate from sRGB, no ICC profile</p>}
    </>
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
