import { inP3, inSrgb, type Oklch } from '../../shared/color/index.ts';
import { maxChroma } from '../../shared/color/picker.ts';
import { Icon } from './Icon.tsx';
import { IconButton } from './IconButton.tsx';
import type { Gesture, PickerProps } from './Picker.tsx';
import { PickerChannel } from './PickerChannel.tsx';
import type { Channel } from './pickerModels.ts';
import { PickerPlane } from './PickerPlane.tsx';
import s from './Picker.module.css';

type Props = { value: Oklch; channels: Channel[]; onChange(v: Oklch): void } & Pick<PickerProps, 'lockL' | 'lockH' | 'onLock'> & Gesture;

/** The OKLCH style: lightness by chroma at the hue, then L, C and H, with the value and hue locks on L and H. */
export function PickerOklch({ value, channels, lockL, lockH, onLock, onChange, ...g }: Props) {
  const lock = (which: 'L' | 'H', on: boolean | undefined, label: string) =>
    onLock && <IconButton icon={on ? 'lock' : 'lock_open'} label={label} size="xs" latched={on} onClick={() => onLock(which, !on)} />;
  const aside = [lock('L', lockL, 'Value lock: picker drags keep L'), onLock && <span />, lock('H', lockH, 'Hue lock: picker drags keep H')];
  const locked = [lockL, false, lockH];
  return (
    <>
      <PickerPlane value={value} lockL={lockL} {...g} onChange={onChange} />
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
            locked={locked[i]}
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
export function Gamut({ value }: { value: Oklch }) {
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
      <div>
        <span className="lbl">Chroma headroom</span>
        <span className={s.gv}>{signed(maxChroma(l, h, 'srgb') - c)}</span>
      </div>
    </div>
  );
}
