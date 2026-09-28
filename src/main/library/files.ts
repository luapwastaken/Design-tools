// Library file writes. No mkdir on purpose: a write into a folder that just vanished must fail,
// not resurrect the folder.
import { randomUUID } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { FileStamp } from '../../shared/types.ts';
import { isMissing, renameRetry } from '../fsx.ts';

/** Fill a hidden temp file beside `path`, then rename it over `path` (retrying while Windows holds it). */
export async function atomically(path: string, fill: (tmp: string) => Promise<unknown>): Promise<void> {
  const tmp = join(dirname(path), `.${basename(path)}.${randomUUID().slice(0, 8)}.tmp`);
  try {
    await fill(tmp);
    await renameRetry(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** null when the file is gone */
export async function stampOf(path: string): Promise<FileStamp | null> {
  try {
    const s = await stat(path);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch (e) {
    if (isMissing(e)) return null;
    throw e;
  }
}

export const sameStamp = (a: FileStamp | null | undefined, b: FileStamp | null | undefined) =>
  !!a && !!b && a.mtimeMs === b.mtimeMs && a.size === b.size;
