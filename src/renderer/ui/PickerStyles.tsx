import type { PickerModel, PickerPlane, PickerStyle } from '../../shared/types.ts';
import { setPicker } from '../shell/core/settings.ts';
import { getState, useShell } from '../shell/core/store.ts';
import type { IconName } from '../shell/tool.ts';
import { useRef } from 'react';
import { cx } from './cx.ts';
import { Segmented } from './Segmented.tsx';
import { useSize } from './useSize.ts';
import s from './Picker.module.css';

// The picker style and model are one app-wide setting (spec: colour UX pass): every picker follows
// a switch made in any of them, or in Settings.

export const PICKER_STYLE_OPTIONS: { value: PickerStyle; label: string; icon: IconName }[] = [
  { value: 'square', label: 'Square', icon: 'crop_square' },
  { value: 'wheel', label: 'Wheel', icon: 'donut_large' },
  { value: 'sliders', label: 'Sliders', icon: 'tune' },
  { value: 'oklch', label: 'OKLCH', icon: 'change_history' },
];
const ICONS = PICKER_STYLE_OPTIONS.map((o) => ({ ...o, label: '', tip: o.label }));
/** the width a labelled switch needs: below it the four icons stand in, with their names as tooltips */
const LABELLED_FROM = 300;

export const usePickerStyle = (): PickerStyle => useShell((st) => st.settings?.pickerStyle ?? 'square');
export const usePickerModel = (): PickerModel => useShell((st) => st.settings?.pickerModel ?? 'hsb');
export const usePickerPlane = (): PickerPlane => useShell((st) => st.settings?.pickerPlane ?? 'lc');

/** the value lock and the hue lock are app-wide too: one switch holds in every picker (V toggles the value lock in the colour tools) */
export const useValueLock = (): boolean => useShell((st) => st.settings?.valueLock === true);
export const useHueLock = (): boolean => useShell((st) => st.settings?.hueLock === true);
export const toggleValueLock = () => void setPicker({ valueLock: getState().settings?.valueLock !== true });
export const toggleHueLock = () => void setPicker({ hueLock: getState().settings?.hueLock !== true });

export const setPickerStyle = (pickerStyle: PickerStyle) => void setPicker({ pickerStyle });
export const setPickerPlane = (pickerPlane: PickerPlane) => void setPicker({ pickerPlane });
export const setPickerModel = (pickerModel: PickerModel) => void setPicker({ pickerModel });

/**
 * The style switch: Square, Wheel, Sliders, OKLCH, named where its row is 300px or wider and as four icons
 * (named by tooltips) below that. `labelled` decides it where the row sizes itself to the switch (a header).
 */
export function PickerStyles({ className, labelled }: { className?: string; labelled?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const size = useSize(box);
  const named = labelled ?? (size !== null && size.w >= LABELLED_FROM);
  return (
    <div ref={box} className={cx(s.styleBox, labelled !== undefined && s.styleFit)}>
      <Segmented options={named ? PICKER_STYLE_OPTIONS : ICONS} value={usePickerStyle()} fit onChange={setPickerStyle} className={cx(!named && s.icons, className)} />
    </div>
  );
}
