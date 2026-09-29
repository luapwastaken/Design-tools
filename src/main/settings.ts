// userData/settings.json, held in memory. Read once at start-up; written only when something changes.
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { PICKER_MODELS, PICKER_STYLES, type Settings } from '../shared/types.ts';
import { inOrder, isMissing, writeAtomic } from './fsx.ts';
import { errorText, log } from './log.ts';

export type SettingsStore = ReturnType<typeof createSettings>;

export function createSettings(userData: string, defaultRoot: string) {
  const file = join(userData, 'settings.json');
  let current = read(file, defaultRoot);

  return {
    get: (): Settings => current,
    /** merge, validate and save; unknown or invalid fields are ignored */
    update(patch: Partial<Settings>): Promise<Settings> {
      return inOrder(file, async () => {
        const next: Settings = { ...current };
        if (patch.theme === 'dark' || patch.theme === 'light') next.theme = patch.theme;
        if (typeof patch.libraryRoot === 'string' && isAbsolute(patch.libraryRoot)) next.libraryRoot = resolve(patch.libraryRoot);
        if (patch.exportFolders) next.exportFolders = { ...current.exportFolders, ...patch.exportFolders };
        if (oneOf(PICKER_STYLES, patch.pickerStyle)) next.pickerStyle = patch.pickerStyle;
        if (oneOf(PICKER_MODELS, patch.pickerModel)) next.pickerModel = patch.pickerModel;
        await writeAtomic(file, JSON.stringify(next, null, 2));
        return (current = next);
      });
    },
  };
}

function read(file: string, defaultRoot: string): Settings {
  let raw: Partial<Settings> = {};
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    if (!isMissing(e)) log('warn', 'settings.json could not be read; using defaults', errorText(e));
  }
  return {
    theme: raw.theme === 'light' ? 'light' : 'dark',
    libraryRoot: typeof raw.libraryRoot === 'string' && isAbsolute(raw.libraryRoot) ? raw.libraryRoot : defaultRoot,
    exportFolders: raw.exportFolders && typeof raw.exportFolders === 'object' ? raw.exportFolders : {},
    pickerStyle: oneOf(PICKER_STYLES, raw.pickerStyle) ? raw.pickerStyle : 'square',
    pickerModel: oneOf(PICKER_MODELS, raw.pickerModel) ? raw.pickerModel : 'hsb',
  };
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => list.includes(v as T);
