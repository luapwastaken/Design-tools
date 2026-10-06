import type { PickerModel, PickerStyle } from '../../shared/types.ts';
import { setPicker } from '../shell/core/settings.ts';
import { getState, useShell } from '../shell/core/store.ts';
import type { IconName } from '../shell/tool.ts';
import { cx } from './cx.ts';
import { IconButton } from './IconButton.tsx';
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

/** the value lock and the hue lock are app-wide too: one switch holds in every picker (V toggles the value lock in the colour tools) */
export const useValueLock = (): boolean => useShell((st) => st.settings?.valueLock === true);
export const useHueLock = (): boolean => useShell((st) => st.settings?.hueLock === true);
export const toggleValueLock = () => void setPicker({ valueLock: getState().settings?.valueLock !== true });
export const toggleHueLock = () => void setPicker({ hueLock: getState().settings?.hueLock !== true });

export const setPickerStyle = (pickerStyle: PickerStyle) => void setPicker({ pickerStyle });
export const setPickerModel = (pickerModel: PickerModel) => void setPicker({ pickerModel });

/** The four-icon style switch: Square, Wheel, Sliders, OKLCH plane. */
export function PickerStyles({ className }: { className?: string }) {
  return <Segmented options={ICONS} value={usePickerStyle()} fit onChange={setPickerStyle} className={cx(s.icons, className)} />;
}

/** The value lock's switch, beside the style switch: moving hue or chroma then keeps the colour's grey value. */
export function ValueLock({ className }: { className?: string }) {
  const on = useValueLock();
  return <IconButton icon={on ? 'lock' : 'lock_open'} label="Value lock" shortcut="V" size="sm" latched={on} onClick={toggleValueLock} className={className} />;
}
