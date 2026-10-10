import { useMemo } from 'react';
import type { Oklch } from '../../shared/color/index.ts';
import { colourToKelvin, KELVIN, kelvinToColour, kelvinWordsOf } from '../../shared/color/kelvin.ts';
import { NumberField } from './NumberField.tsx';
import type { ColourGesture } from './Picker.tsx';
import s from './KelvinField.module.css';

/**
 * A light colour as a colour temperature (plan #10): type or drag 2700 and the colour becomes what a
 * 2700 K light gives at the colour's own lightness. Under it, what the colour reads as: "about 3200 K",
 * or "off the blackbody line" for one (a pink, a green) no temperature makes. Any light colour can use it.
 */
export function KelvinField({ value, onBegin, onChange, onCommit, onCancel }: { value: Oklch } & ColourGesture) {
  const read = useMemo(() => colourToKelvin(value), [value]);
  const { k, off } = read;
  return (
    <div className={s.kelvin}>
      <NumberField label="Kelvin" hideLabel value={k} min={KELVIN.min} max={KELVIN.max} step={50} precision={0} unit="K" width={96} onBegin={onBegin} onChange={(v) => onChange(kelvinToColour(v, value[0]))} onCommit={onCommit} onCancel={onCancel} />
      <span className={s.words} data-off={off || undefined}>
        {kelvinWordsOf(read)}
      </span>
    </div>
  );
}
