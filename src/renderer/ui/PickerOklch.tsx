import { inP3, inSrgb, type Oklch } from '../../shared/color/index.ts';
import { maxChroma } from '../../shared/color/picker.ts';
import { holdValue } from '../../shared/color/value.ts';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';
import type { Gesture } from './Picker.tsx';
import { PickerChannel } from './PickerChannel.tsx';
import type { Channel } from './pickerModels.ts';
import { PickerPlane } from './PickerPlane.tsx';
import { toggleHueLock, useHueLock } from './PickerStyles.tsx';
import s from './Picker.module.css';

type Props = {
  value: Oklch;
  channels: Channel[];
  /** the value held while the value lock is on (see PickerPlane) */
  target: number | null;
  onSlide(o: Oklch): void;
  onChange(v: Oklch): void;
} & Gesture;

/** The OKLCH style: lightness by chroma at the hue, then L, C and H, with the hue lock on the H row (the value lock is the picker's own switch). */
export function PickerOklch({ value, channels, target, onSlide, onChange, ...g }: Props) {
  const hueLock = useHueLock();
  const aside = [<span />, <span />, <IconButton icon={hueLock ? 'lock' : 'lock_open'} label="Hue lock: drags keep the hue" size="xs" latched={hueLock} onClick={toggleHueLock} />];
  return (
    <>
      <PickerPlane value={value} target={target} onSlide={onSlide} {...g} onChange={onChange} />
      <div className={s.chans}>
        {channels.map((ch, i) => (
          <PickerChannel
            key={ch.label}
            label={ch.label}
            value={ch.value}
            min={ch.min}
            max={ch.max}
            step={ch.step}
            precision={ch.precision}
            unit={ch.unit}
            span={ch.span}
            limit={ch.limit}
            track={ch.track()}
            locked={ch.carrier || (i === 2 && hueLock)}
            aside={aside[i]}
            {...g}
            onChange={ch.set}
          />
        ))}
      </div>
    </>
  );
}

const signed = (v: number) => `${v < -5e-4 ? '-' : '+'}${Math.abs(v).toFixed(3)}`;

/** sRGB and P3 membership, and how much chroma sRGB still has room for at this L and hue. */
export function Gamut({ value, target }: { value: Oklch; target?: number | null }) {
  const [l, c, h] = value;
  return (
    <div className={s.gam}>
      <div>
        <span className="lbl">sRGB</span>
        <span className={s.gv}>
          <Icon name={inSrgb(value) ? 'check' : 'warning'} size={14} />
          {inSrgb(value) ? 'In gamut' : inP3(value) ? 'Outside · in P3' : 'Outside P3'}
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
    </div>
  );
}
