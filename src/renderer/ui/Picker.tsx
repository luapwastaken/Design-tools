import type { KeyboardEvent } from 'react';
import { inSrgb, parseHex, READOUT_TOL, toHex, toSrgbGamut, type Oklch } from '../../shared/color/index.ts';
import { fromHex } from '../../shared/color/picker.ts';
import { isTextField } from '../shell/core/keys.ts';
import { cx } from './cx.ts';
import { CopyAs } from './CopyAs.tsx';
import { HexField } from './HexField.tsx';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';
import { usePickerColour } from './pickerModels.ts';
import { PickerNumbers, PickerSliders } from './PickerNumbers.tsx';
import { Gamut, PickerOklch, SrgbFix } from './PickerOklch.tsx';
import { PickerSquare } from './PickerSquare.tsx';
import { PickerHold, type Match } from './PickerHold.tsx';
import { PickerStyles, toggleValueLock, usePickerModel, usePickerStyle } from './PickerStyles.tsx';
import { PickerWheel } from './PickerWheel.tsx';
import type { NumberGesture } from './scrub.ts';
import s from './Picker.module.css';

/** A colour control's gesture: every drag is one begin/change/commit; `fromKey` steps may coalesce (spec §8). */
export type ColourGesture = Omit<NumberGesture, 'onChange'> & { onChange(v: Oklch): void };
/** the gesture without its change, which each part makes in its own terms */
export type Gesture = Omit<NumberGesture, 'onChange'>;

export type PickerProps = {
  value: Oklch;
  /** the style switch at the top (a ColorField's popover); an inspector puts <PickerStyles> in its header instead */
  styles?: boolean;
  /** the palette's other colours, for the hold row's Match menu (the colour tools) */
  match?: Match[];
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
 * V toggles Hold value while focus is in it (the colour tools also take V from anywhere else).
 */
export function Picker(p: PickerProps) {
  const { value, className } = p;
  const style = usePickerStyle();
  const g = { onBegin: p.onBegin, onCommit: p.onCommit, onCancel: p.onCancel };
  const colour = usePickerColour(value, p.onChange);
  const srgb = style !== 'oklch';
  /** the colour sRGB shows for one outside it, as the colour: one undo step */
  const useSrgb = () => {
    g.onBegin?.();
    p.onChange(toSrgbGamut(value));
    g.onCommit?.();
  };
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
        </div>
      )}
      <PickerBody value={value} colour={colour} match={p.match} {...g} />
      <HexRow value={value} {...g} onChange={p.onChange} />
      {!srgb && <Gamut value={value} target={colour.target} onUse={useSrgb} />}
      {srgb && !inSrgb(value, READOUT_TOL) && (
        <>
          <p className={s.outside}>
            <Icon name="warning" size={14} />
            Outside sRGB: shown clipped, and kept until you change it
          </p>
          <SrgbFix value={value} onUse={useSrgb} />
        </>
      )}
    </div>
  );
}

/**
 * The picker's style, whichever it is, with the hold row (Hold value, Value, Hold hue, Match): shared by
 * the Picker and the Design inspector (which puts its own rows around it). `numbers` is the model row
 * under Square and Wheel.
 */
export function PickerBody({ value, colour, numbers = true, match, ...gesture }: { value: Oklch; colour: ReturnType<typeof usePickerColour>; numbers?: boolean; match?: Match[] } & Gesture) {
  const g = { ...gesture, onBegin: () => (colour.begin(), gesture.onBegin?.()) };
  const style = usePickerStyle();
  const model = usePickerModel();
  const srgb = style !== 'oklch';
  return (
    <>
      {style === 'square' && <PickerSquare area={colour.area(model)} {...g} />}
      {style === 'wheel' && <PickerWheel area={colour.area(model, true)} {...g} />}
      {numbers && (style === 'square' || style === 'wheel') && <PickerNumbers model={model} channels={colour.channels(model)} {...g} />}
      {style === 'sliders' && <PickerSliders model={model} channels={colour.channels(model)} {...g} />}
      {style === 'oklch' && <PickerOklch value={value} channels={colour.channels('oklch')} target={colour.target} chroma={colour.chroma} onSlide={colour.slide} onMax={colour.max} {...g} onChange={colour.retarget} />}
      <PickerHold value={value} colour={colour} match={match} {...g} />
      {srgb && model === 'cmyk' && (style === 'sliders' || numbers) && <p className={s.note}>≈ Estimate from sRGB, no ICC profile{style !== 'sliders' && '. Four inks have no flat plane, so the area stays saturation by brightness'}</p>}
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
  return (
    <div className={s.hexRow}>
      <HexField value={value} steered className={s.hex} {...g} />
      {EyeDropper && <IconButton icon="colorize" label="Eyedropper" onClick={() => void pick()} />}
      <CopyAs value={value} />
    </div>
  );
}
