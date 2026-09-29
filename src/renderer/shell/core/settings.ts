import type { Settings } from '../../../shared/types.ts';
import { toast } from '../../ui/toast.ts';
import { ipc } from './ipc.ts';
import { getState, setState } from './store.ts';

export type PickerPrefs = Partial<Pick<Settings, 'pickerStyle' | 'pickerModel'>>;

let latest = 0;

/**
 * The picker style and model, app-wide: every picker follows at once, before main has saved it.
 * Only the newest call's answer is applied, so quick switching never shows an older choice.
 */
export async function setPicker(patch: PickerPrefs): Promise<void> {
  const mine = ++latest;
  const before = getState().settings;
  if (before) setState({ settings: { ...before, ...patch } });
  try {
    const saved = await ipc.invoke('settings.set', patch);
    if (mine === latest) setState({ settings: saved });
  } catch (e) {
    toast.show({ kind: 'error', message: `Couldn't save the picker setting: ${e instanceof Error ? e.message : String(e)}` });
    const now = getState().settings;
    if (mine === latest && before && now) setState({ settings: { ...now, pickerStyle: before.pickerStyle, pickerModel: before.pickerModel } });
  }
}
