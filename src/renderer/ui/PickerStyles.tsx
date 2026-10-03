import type { PickerModel, PickerStyle } from '../../shared/types.ts';
import { setPicker } from '../shell/core/settings.ts';
import { useShell } from '../shell/core/store.ts';
import type { IconName } from '../shell/tool.ts';
import { cx } from './cx.ts';
import { Segmented } from './Segmented.tsx';
import s from './Picker.module.css';

// The picker style and model are one app-wide setting (spec: colour UX pass): every picker follows
// a switch made in any of them, or in Settings.

export const PICKER_STYLE_OPTIONS: { value: PickerStyle; label: string; icon: IconName }[] = [
  { value: 'square', label: 'Square', icon: 'crop_square' },
  { value: 'wheel', label: 'Wheel', icon: 'donut_large' },
  { value: 'sliders', label: 'Sliders', icon: 'tune' },
  // named for its plane: OKLCH is also a model in the other three styles' menus
  { value: 'oklch', label: 'OKLCH plane', icon: 'change_history' },
];
const ICONS = PICKER_STYLE_OPTIONS.map((o) => ({ ...o, label: '', tip: o.label }));

export const usePickerStyle = (): PickerStyle => useShell((st) => st.settings?.pickerStyle ?? 'square');
export const usePickerModel = (): PickerModel => useShell((st) => st.settings?.pickerModel ?? 'hsb');

export const setPickerStyle = (pickerStyle: PickerStyle) => void setPicker({ pickerStyle });
export const setPickerModel = (pickerModel: PickerModel) => void setPicker({ pickerModel });

/** The four-icon style switch: Square, Wheel, Sliders, OKLCH plane. */
export function PickerStyles({ className }: { className?: string }) {
  return <Segmented options={ICONS} value={usePickerStyle()} fit onChange={setPickerStyle} className={cx(s.icons, className)} />;
}
