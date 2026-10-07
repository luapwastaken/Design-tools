import type { PickerModel } from '../../shared/types.ts';
import { NumberField } from './NumberField.tsx';
import type { Gesture } from './Picker.tsx';
import { PickerChannel, channelProps } from './PickerChannel.tsx';
import { HUE_HELD, VALUE_HELD } from './PickerHold.tsx';
import type { Channel } from './pickerModels.ts';
import { setPickerModel, useHueLock } from './PickerStyles.tsx';
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

/** the model menu: in Square and Wheel it picks the model the area shows, and the numbers */
export function PickerModelSelect({ model }: { model: PickerModel }) {
  return <Select options={MODELS} value={model} onChange={setPickerModel} menuWidth={112} />;
}

/** Square and Wheel: a model menu, then one field per number of it (Figma's row). */
export function PickerNumbers({ model, channels, ...g }: Props) {
  return (
    <div className={s.nums} data-n={channels.length}>
      <PickerModelSelect model={model} />
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
  const hueHeld = useHueLock();
  return (
    <>
      <Segmented mono options={TABS} value={model} onChange={setPickerModel} className={s.tabs} />
      <div className={s.chans}>
        {channels.map((ch) => (
          <PickerChannel key={ch.label} {...channelProps(ch)} locked={ch.carrier ? VALUE_HELD : hueHeld && ch.label === 'H' ? HUE_HELD : undefined} {...g} />
        ))}
      </div>
    </>
  );
}
