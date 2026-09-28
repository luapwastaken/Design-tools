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

/** the file a Node error is about, as Luap knows it: our hidden temp file stands for its target */
function fileOf(path: string | undefined): string {
  if (!path) return 'A file';
  const leaf = basename(path);
  return /^\.(.+)\.[0-9a-f]{8}\.tmp$/.exec(leaf)?.[1] ?? leaf;
}

/**
 * A plain sentence for a failed file operation (spec §10.4, §11). Our own errors are plain already;
 * Node's ("EPERM: operation not permitted, rename …") are turned into one, and belong in the log.
 */
export function plainError(e: unknown): { message: string; raw: string | null } {
  const err = e as NodeJS.ErrnoException;
  if (!(err instanceof Error) || !err.code) return { message: err instanceof Error ? err.message : String(e), raw: null };
  const file = fileOf(err.path);
  const raw = err.stack ?? err.message;
  switch (err.code) {
    case 'ENOSPC':
      return { message: 'The disk is full.', raw };
    case 'EBUSY':
    case 'EPERM':
    case 'EACCES':
      return { message: `${file} is open in another program, or the folder is read-only.`, raw };
    case 'ENOENT':
      return { message: `${file} isn't there any more.`, raw };
    case 'ENAMETOOLONG':
      return { message: `The path to ${file} is too long for Windows.`, raw };
    default:
      return { message: `Couldn't change ${file}. Details are in the log.`, raw };
  }
}
