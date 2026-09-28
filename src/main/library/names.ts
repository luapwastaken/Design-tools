// File names for Library items and collections (spec §6.1). Windows rules, applied everywhere.
import { readdir } from 'node:fs/promises';
import { isMissing } from '../fsx.ts';

const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f]/g;
/** device names Windows reserves, with or without an extension ("CON", "com1.txt") */
const RESERVED = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3])(?=\s*(\.|$))/i;

/**
 * A name Windows accepts: forbidden characters become "-", trailing dots and spaces go, reserved
 * device names get "_". Leading dots go too: the scan skips dotfiles as hidden.
 */
export function safeName(name: string): string {
  const s = name.replace(FORBIDDEN, '-').replace(/[. ]+$/, '').replace(/^\.+/, '');
  return s.trim() === '' ? 'Untitled' : s.replace(RESERVED, '$1_');
}

/** `base`, or "base 2", "base 3"… so that `name + suffix` is free in `dir` (ignoring case). */
export async function uniqueName(dir: string, base: string, suffix: string): Promise<string> {
  const taken = new Set(
    (await readdir(dir).catch((e) => (isMissing(e) ? [] : Promise.reject(e)))).map((n) => n.toLowerCase()),
  );
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!taken.has(`${name}${suffix}`.toLowerCase())) return name;
  }
}
