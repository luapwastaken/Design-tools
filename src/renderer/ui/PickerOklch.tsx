import { cssColor, inP3, inSrgb, READOUT_TOL, toHex, toSrgbGamut, type Oklch } from '../../shared/color/index.ts';
import { maxChroma } from '../../shared/color/picker.ts';
import { holdValue } from '../../shared/color/value.ts';
import { Button } from './Button.tsx';
import { cx } from './cx.ts';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';
import type { Gesture } from './Picker.tsx';
import { PickerChannel, channelProps } from './PickerChannel.tsx';
import { HUE_HELD, VALUE_HELD } from './PickerHold.tsx';
import type { Channel } from './pickerModels.ts';
import { PickerPlane } from './PickerPlane.tsx';
import { useHueLock } from './PickerStyles.tsx';
import s from './Picker.module.css';

type Props = {
  value: Oklch;
  channels: Channel[];
  /** the value held while the value lock is on (see PickerPlane) */
  target: number | null;
  /** the chroma the lock remembers */
  chroma: number | null;
  onSlide(o: Oklch): void;
  /** jump to the most chroma sRGB has here (at the held value, with the lock on) */
  onMax(): void;
  onChange(v: Oklch): void;
} & Gesture;

/** The OKLCH style: lightness by chroma at the hue, then L, C and H (the holds are the hold row's, under the picker). */
export function PickerOklch({ value, channels, target, chroma, onSlide, onMax, onChange, ...g }: Props) {
  const hueHeld = useHueLock();
  const max = () => {
    g.onBegin?.();
    onMax();
    g.onCommit?.();
  };
  const aside = [<span />, <IconButton icon="last_page" label="Most chroma sRGB has here" size="sm" onClick={max} />, <span />];
  return (
    <>
      <PickerPlane value={value} target={target} chroma={chroma} onSlide={onSlide} {...g} onChange={onChange} />
      <div className={s.chans}>
        {channels.map((ch, i) => (
          <PickerChannel key={ch.label} {...channelProps(ch)} locked={ch.carrier ? VALUE_HELD : i === 2 && hueHeld ? HUE_HELD : undefined} aside={aside[i]} {...g} />
        ))}
      </div>
    </>
  );
}

const signed = (v: number) => `${v < -5e-4 ? '-' : '+'}${Math.abs(v).toFixed(3)}`;

/** the colour sRGB shows for one outside it, and the button that makes it the colour (one undo step: the caller's gesture) */
export function SrgbFix({ value, onUse, className }: { value: Oklch; onUse(): void; className?: string }) {
  const mapped = toSrgbGamut(value);
  return (
    <div className={cx(s.fix, className)} data-srgb-fix="">
      <span className="lbl">sRGB colour</span>
      <span className={s.gv}>
        <i className={s.swatch} data-colour="" style={{ background: cssColor(mapped) }} />
        {toHex(mapped).toUpperCase()}
      </span>
      <Button size="xs" variant="secondary" onClick={onUse}>
        Use sRGB colour
      </Button>
    </div>
  );
}

/** sRGB and P3 membership (a colour rounded to 4 decimals still counts as sRGB), and how much chroma sRGB still has room for at this L and hue. */
export function Gamut({ value, target, onUse }: { value: Oklch; target?: number | null; onUse(): void }) {
  const [l, c, h] = value;
  const inside = inSrgb(value, READOUT_TOL);
  return (
    <div className={s.gam}>
      <div>
        <span className="lbl">sRGB</span>
        <span className={s.gv}>
          <Icon name={inside ? 'check' : 'warning'} size={14} />
          {inside ? 'In gamut' : inP3(value, READOUT_TOL) ? 'Outside · in P3' : 'Outside P3'}
        </span>
      </div>
      {target != null ? (
        <div>
          <span className="lbl">Most chroma at this value</span>
          <span className={s.gv}>{holdValue(target, 0.5, h)[1].toFixed(3)}</span>
        </div>
      ) : (
        <div>
          <span className="lbl">Chroma headroom</span>
          <span className={s.gv}>{signed(maxChroma(l, h, 'srgb') - c)}</span>
        </div>
      )}
      {!inside && <SrgbFix value={value} onUse={onUse} className={s.use} />}
    </div>
  );
}
