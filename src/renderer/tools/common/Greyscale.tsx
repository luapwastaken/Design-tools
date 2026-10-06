import { shell, useShell } from '../../shell/core/index.ts';
import { Button } from '../../ui/index.ts';

/** G in both colour tools: the app-wide greyscale view (the GreyView in the shell does the greying) */
export const toggleGreyscale = (): Promise<void> => shell.setPicker({ greyscale: !shell.getState().settings?.greyscale });

/** the palette section's greyscale button: named, and latched while the view is on */
export function GreyscaleButton() {
  const on = useShell((st) => st.settings?.greyscale === true);
  return (
    <Button size="xs" icon="contrast" latched={on} tooltip="Show the colours as the greys they become (Rec. 709 value)" shortcut="G" onClick={() => void toggleGreyscale()}>
      Greyscale
    </Button>
  );
}
