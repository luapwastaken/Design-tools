// Key matching for the keymap (spec §9). Pure, so it is unit tested (test/shell-keys.test.ts).

/** keys are upper case: 'Z', '1', ',', 'DELETE', 'ARROWUP', 'SPACE', 'F6' */
export type Combo = { ctrl: boolean; alt: boolean; shift: boolean; key: string };
export type KeyLike = { key: string; code: string; ctrlKey: boolean; metaKey?: boolean; altKey: boolean; shiftKey: boolean };

const ALIASES: Record<string, string> = { DEL: 'DELETE', ESC: 'ESCAPE', ' ': 'SPACE', SPACEBAR: 'SPACE' };
const MODS = ['ctrl', 'alt', 'shift'];

/** Digits, comma and period by position, since Shift changes the symbol they type (Shift+, is '<' on a US board); letters by the layout, so Ctrl+Z is the Z key on any keyboard. */
export function keyOf(e: Pick<KeyLike, 'key' | 'code'>): string {
  const digit = /^Digit(\d)$/.exec(e.code);
  if (digit) return digit[1];
  if (e.code === 'Comma') return ',';
  if (e.code === 'Period') return '.';
  const k = e.key.toUpperCase();
  return ALIASES[k] ?? k;
}

export const comboOf = (e: KeyLike): Combo => ({ ctrl: e.ctrlKey || !!e.metaKey, alt: e.altKey, shift: e.shiftKey, key: keyOf(e) });

/** 'Ctrl+Alt+0', 'I', 'Shift+Delete', 'Ctrl++'; null when it can't be read */
export function parseCombo(keys: string): Combo | null {
  const parts = keys.split('+');
  let key = parts.pop() ?? '';
  if (key === '' && parts.at(-1) === '') {
    parts.pop(); // 'Ctrl++' splits into ['Ctrl', '', '']
    key = '+';
  }
  const mods = parts.map((p) => p.trim().toLowerCase());
  if (!key.trim() && key !== ' ') return null;
  if (mods.some((m) => !MODS.includes(m))) return null;
  const k = key.length === 1 ? key.toUpperCase() : key.trim().toUpperCase();
  return { ctrl: mods.includes('ctrl'), alt: mods.includes('alt'), shift: mods.includes('shift'), key: ALIASES[k] ?? k };
}

export const sameCombo = (a: Combo, b: Combo): boolean => a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.key === b.key;

export function matches(keys: string, c: Combo): boolean {
  const p = parseCombo(keys);
  return p !== null && sameCombo(p, c);
}

/** a shortcut the keymap fires: it has a run, and is not switched off right now */
export const isLive = (s: { run?: unknown; off?: boolean }): boolean => !!s.run && !s.off;

/** every key that does a shortcut's job: its own, the others that do the same, and the US-only ones */
export const keysOf = (s: { keys: string; also?: string[]; us?: string[] }): string[] => [s.keys, ...(s.also ?? []), ...(s.us ?? [])];

export type ShellKey =
  | { t: 'tool'; n: number }
  | { t: 'library' }
  | { t: 'settings' }
  | { t: 'undo' }
  | { t: 'redo' }
  | { t: 'region'; back: boolean }
  /** Ctrl+E clicks the active tool's Export */
  | { t: 'export' }
  /** Ctrl+F opens the Library and focuses its search */
  | { t: 'search' }
  /** Esc closes Settings; anything else Esc does is taken first by a field, menu, popover or the sheet */
  | { t: 'escape' }
  /** ? opens the sheet of keys, but is a character in a field; F1 opens it anywhere */
  | { t: 'shortcuts'; bare: boolean };

/** The shell's own keys: Ctrl+1..9, Ctrl+L, Ctrl+F, Ctrl+E, Ctrl+comma, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, F6 / Shift+F6, Esc, ? and F1. The sheet lists them from EVERYWHERE below. */
export function shellKey(c: Combo): ShellKey | null {
  if (c.ctrl && !c.alt) {
    if (c.key === 'Z') return { t: c.shift ? 'redo' : 'undo' };
    if (c.shift) return null;
    if (/^[1-9]$/.test(c.key)) return { t: 'tool', n: Number(c.key) };
    if (c.key === 'L') return { t: 'library' };
    if (c.key === 'F') return { t: 'search' };
    if (c.key === 'E') return { t: 'export' };
    if (c.key === ',') return { t: 'settings' };
    if (c.key === 'Y') return { t: 'redo' };
    return null;
  }
  if (!c.ctrl && !c.alt && c.key === 'F6') return { t: 'region', back: c.shift };
  if (!c.ctrl && !c.alt && c.key === 'F1') return { t: 'shortcuts', bare: false };
  if (!c.ctrl && !c.alt && c.key === '?') return { t: 'shortcuts', bare: true };
  if (!c.ctrl && !c.alt && !c.shift && c.key === 'ESCAPE') return { t: 'escape' };
  return null;
}

/** One row of the sheet's Everywhere column. `listedOnly`: the Viewport, the Library or the browser runs it, not shellKey. */
export type EverywhereRow = { keys: string; to?: string; also?: string[]; us?: string[]; label: string; group: string; when?: string; listedOnly?: true; /** stands for Ctrl+1..9; appRows words it from the tools there are */ goTo?: true };

/** What works in every tool, in the order the sheet shows it. Beside shellKey so a key and its row change together (test/shell-keys.test.ts checks they agree). */
export const EVERYWHERE: EverywhereRow[] = [
  { group: 'Tools and panels', keys: 'Ctrl+1', to: 'Ctrl+9', label: 'Go to a tool', goTo: true },
  { group: 'Tools and panels', keys: 'Ctrl+L', label: 'Show or hide the Library' },
  { group: 'Tools and panels', keys: 'Ctrl+F', label: 'Search the Library' },
  { group: 'Tools and panels', keys: 'Ctrl+,', label: 'Open or close Settings' },
  { group: 'Tools and panels', keys: 'Escape', label: 'Close Settings' },
  { group: 'Tools and panels', keys: '?', also: ['F1'], label: 'This sheet' },
  { group: 'Tools and panels', keys: 'F6', label: 'Move to the next area' },
  { group: 'Tools and panels', keys: 'Shift+F6', label: 'Move to the previous area' },
  { group: 'Copy and export', keys: 'Ctrl+E', label: 'Export' },
  { group: 'Undo', keys: 'Ctrl+Z', label: 'Undo' },
  { group: 'Undo', keys: 'Ctrl+Y', also: ['Ctrl+Shift+Z'], label: 'Redo' },
  { group: 'Zoom and pan', keys: 'Ctrl+0', label: 'Zoom to fit', when: 'Pattern, Logo, Dither, Halftone, Post FX', listedOnly: true },
  { group: 'Zoom and pan', keys: 'Shift+0', us: ['Ctrl+Alt+0'], label: 'Zoom to 100%', when: 'Pattern, Logo, Dither, Halftone, Post FX', listedOnly: true },
  { group: 'Zoom and pan', keys: 'Ctrl++', also: ['Ctrl+-'], us: ['Ctrl+='], label: 'Zoom in or out', when: 'Pattern, Logo, Dither, Halftone, Post FX', listedOnly: true },
  { group: 'Zoom and pan', keys: 'Space', label: 'Hold and drag to pan', when: 'Pattern, Logo, Dither, Halftone, Post FX', listedOnly: true },
  { group: 'Library', keys: 'Enter', label: 'Open the item', when: 'Library row focused', listedOnly: true },
  { group: 'Library', keys: 'F2', label: 'Rename', when: 'Library row focused', listedOnly: true },
  { group: 'Library', keys: 'Ctrl+D', label: 'Duplicate', when: 'Library row focused', listedOnly: true },
  { group: 'Library', keys: 'Delete', label: 'Delete (asks first)', when: 'Library row focused', listedOnly: true },
];

/** keys a text field keeps for editing, even with Ctrl held */
const EDITING = new Set(['A', 'C', 'V', 'X', 'Z', 'Y', 'BACKSPACE', 'DELETE', 'HOME', 'END', 'ARROWLEFT', 'ARROWRIGHT', 'ARROWUP', 'ARROWDOWN']);

/**
 * May a tool shortcut fire? Tab is never a tool's (focus only). In a text field, bare keys, Space
 * and the field's own editing keys belong to the field (spec §9).
 */
export function toolMayTake(c: Combo, inTextField: boolean): boolean {
  if (c.key === 'TAB') return false;
  if (!inTextField) return true;
  return (c.ctrl || c.alt) && !EDITING.has(c.key);
}

export type FieldLike = { tagName: string; type?: string; isContentEditable?: boolean; dataset?: Record<string, string | undefined> };

const TEXT_INPUTS = new Set(['text', 'search', 'email', 'url', 'tel', 'password']);

export function isTextField(el: FieldLike | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && TEXT_INPUTS.has((el.type || 'text').toLowerCase());
}

/**
 * Ctrl+Z goes to the field itself (spec §8 step 1): our fields mark an uncommitted edit with
 * data-dirty; a textarea or contenteditable, which has no such mark, always keeps its native undo.
 */
export function fieldOwnsUndo(el: FieldLike | null | undefined): boolean {
  if (!el || !isTextField(el)) return false;
  return el.tagName !== 'INPUT' || el.dataset?.dirty === 'true';
}
