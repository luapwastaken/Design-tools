import type { PickerModel } from '../../shared/types.ts';
import { NumberField } from './NumberField.tsx';
import type { Gesture } from './Picker.tsx';
import { PickerChannel } from './PickerChannel.tsx';
import type { Channel } from './pickerModels.ts';
import { setPickerModel } from './PickerStyles.tsx';
import { Segmented } from './Segmented.tsx';
import { Select } from './Select.tsx';
import s from './Picker.module.css';

type Props = { model: PickerModel; channels: Channel[] } & Gesture;

const MODELS: { value: PickerModel; label: string }[] = [
  { value: 'hsb', label: 'HSB' },
  { value: 'rgb', label: 'RGB' },
  { value: 'hsl', label: 'HSL' },
  { value: 'cmyk', label: '≈CMYK' },
  { value: 'oklch', label: 'OKLCH' },
];

/** Square and Wheel: a model menu, then one field per number of it (Figma's row). */
export function PickerNumbers({ model, channels, ...g }: Props) {
  return (
    <div className={s.nums} data-n={channels.length}>
      <Select options={MODELS} value={model} onChange={setPickerModel} menuWidth={112} />
      {channels.map((ch) => (
        <NumberField key={ch.label} label={ch.label} value={ch.value} min={ch.min} max={ch.max} step={ch.step} precision={ch.precision} unit={ch.unit} wrap={ch.wrap} {...g} onChange={ch.type ?? ch.set} />
      ))}
    </div>
  );
}

const TABS: { value: PickerModel; label: string; tip?: string }[] = [
  { value: 'rgb', label: 'RGB' },
  { value: 'hsb', label: 'HSB' },
  { value: 'hsl', label: 'HSL' },
  { value: 'cmyk', label: 'CMYK', tip: '≈CMYK, an estimate' },
  { value: 'oklch', label: 'OKLCH' },
];

/** The Sliders style: the model, then a gradient slider and its field per number (Illustrator's Color panel). */
export function PickerSliders({ model, channels, ...g }: Props) {
  return (
    <>
      <Segmented mono options={TABS} value={model} onChange={setPickerModel} className={s.tabs} />
      <div className={s.chans}>
        {channels.map((ch) => (
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
            wrap={ch.wrap}
            track={ch.track()}
            locked={ch.carrier}
            {...g}
            onChange={ch.set}
            onType={ch.type}
          />
        ))}
      </div>
    </>
  );
}
