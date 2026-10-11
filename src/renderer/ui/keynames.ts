// How a key is printed in the UI: shared by Kbd's formatKeys (tooltips, menus) and the shortcuts
// sheet's key caps. Pure, so the sheet's tests can import it.

// Arrows are words here: rule 1 of the brief allows no arrow glyph in a UI string. The sheet's key caps draw them as icons.
/** keyed by the upper-case name parseCombo gives (and the aliases a shortcut string may use) */
export const KEY_NAMES: Record<string, string> = {
  ARROWLEFT: 'Left',
  ARROWRIGHT: 'Right',
  ARROWUP: 'Up',
  ARROWDOWN: 'Down',
  DELETE: 'Del',
  DEL: 'Del',
  ESCAPE: 'Esc',
  ESC: 'Esc',
  ENTER: 'Enter',
  BACKSPACE: 'Backspace',
  TAB: 'Tab',
  SPACE: 'Space',
};

/** 'Ctrl+Shift+Z' to ['Ctrl', 'Shift', 'Z']; 'Ctrl++' to ['Ctrl', '+'] (a '+' key is the one after another '+') */
export function splitKeys(keys: string): string[] {
  const parts = keys.split('+');
  if (parts.length > 1 && parts.at(-1) === '' && parts.at(-2) === '') {
    parts.length -= 2;
    parts.push('+');
  }
  return parts;
}

/** one key as printed: arrows by name, Delete as Del; anything else as it came */
export const keyName = (k: string): string => KEY_NAMES[k.toUpperCase()] ?? k;

/** 'Ctrl+Shift+Z' to 'Ctrl Shift Z', the way keys are printed in the UI (arrows by name). */
export const formatKeys = (keys: string): string => splitKeys(keys).map(keyName).join(' ');
