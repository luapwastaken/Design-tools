// Small fs helpers for main's own files (settings, workspace, exports). Pure Node, no Electron.
import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, sep } from 'node:path';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const code = (e: unknown) => (e as NodeJS.ErrnoException)?.code;

/** Rename, retrying for about 1s while sync clients, antivirus or Explorer previews hold a file. */
export async function renameRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to);
    } catch (e) {
      if (i >= 10 || !['EBUSY', 'EPERM', 'EACCES'].includes(code(e) ?? '')) throw e;
      await sleep(100);
    }
  }
}

/** Temp file (flushed) in the same folder, then rename over `path`. `before` runs between the two. */
export async function writeAtomic(path: string, data: string | Uint8Array, before?: () => Promise<void>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`;
  try {
    await writeFile(tmp, data, { flush: true });
    await before?.();
    await renameRetry(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

const queues = new Map<string, Promise<unknown>>();
/** Run `fn` after every earlier call with the same key has settled, so writes to one file land in order. */
export function inOrder<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) ?? Promise.resolve()).then(fn, fn);
  const tail = next.catch(() => {});
  queues.set(key, tail);
  void tail.then(() => queues.get(key) === tail && queues.delete(key));
  return next;
}

/** true when `path` is `root` or inside it (both absolute) */
export function isInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

export const isMissing = (e: unknown) => code(e) === 'ENOENT';
