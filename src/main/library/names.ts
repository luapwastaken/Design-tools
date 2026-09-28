// File names for Library items and collections (spec §6.1). Windows rules, applied everywhere.
import { readdir } from 'node:fs/promises';
import { isMissing } from '../fsx.ts';

const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;
/** device names Windows reserves, with or without an extension ("CON", "com1.txt") */
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(?=\s*(\.|$))/i;

/** a name's longest; the whole path is kept under Windows' 260 as well (uniqueName) */
const MAX_NAME = 120;
/** MAX_PATH less its terminating NUL */
const MAX_PATH = 259;

/** at most `n` UTF-16 units, never splitting a character, and no trailing dots or spaces */
function cut(s: string, n: number): string {
  if (s.length <= n) return s;
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > n) break;
    out += ch;
  }
  return out.replace(/[. ]+$/, '');
}

/**
 * A name Windows accepts: forbidden characters become "-", trailing dots and spaces go, reserved
 * device names get "_", and it is at most 120 characters. Leading dots go too: the scan skips
 * dotfiles as hidden.
 */
export function safeName(name: string): string {
  const s = cut(name.replace(FORBIDDEN, '-').replace(/[. ]+$/, '').replace(/^\.+/, ''), MAX_NAME);
  return s.trim() === '' ? 'Untitled' : s.replace(RESERVED, '$1_');
}

/**
 * `base`, or "base 2", "base 3"… so that `name + suffix` is free in `dir` (ignoring case). `base`
 * is shortened when the whole path would pass 260 characters, which Windows and dt:// can't open.
 */
export async function uniqueName(dir: string, base: string, suffix: string): Promise<string> {
  const taken = new Set(
    (await readdir(dir).catch((e) => (isMissing(e) ? [] : Promise.reject(e)))).map((n) => n.toLowerCase()),
  );
  // room for the separator and a " 99" counter
  const fit = cut(base, Math.max(16, MAX_PATH - dir.length - 1 - suffix.length - 3)) || 'Untitled';
  for (let n = 1; ; n++) {
    const name = n === 1 ? fit : `${fit} ${n}`;
    if (!taken.has(`${name}${suffix}`.toLowerCase())) return name;
  }
}
