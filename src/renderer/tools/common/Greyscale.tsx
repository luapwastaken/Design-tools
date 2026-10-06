import { shell, useShell } from '../../shell/core/index.ts';
import { IconButton } from '../../ui/index.ts';

/** G in both colour tools: the app-wide greyscale view (the GreyView in the shell does the greying) */
export const toggleGreyscale = (): Promise<void> => shell.setPicker({ greyscale: !shell.getState().settings?.greyscale });

/** the palette section's greyscale button: latched while the view is on */
export function GreyscaleButton() {
  const on = useShell((st) => st.settings?.greyscale === true);
  return <IconButton icon="contrast" label="Greyscale" shortcut="G" size="sm" latched={on} onClick={() => void toggleGreyscale()} />;
}
