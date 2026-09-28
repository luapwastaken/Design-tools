// Per-tool working state under userData (spec §7.1, §7.2): workspace/<tool>/{state.json, state.prev.json,
// crashed/, assets/} and presets/<tool>.json. Pure Node, so tests run it against a temp folder.
import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolId, WorkspaceState } from '../shared/types.ts';
import { inOrder, isMissing, renameRetry, writeAtomic } from './fsx.ts';

const TOOL = /^[a-z][a-z0-9-]{0,31}$/;
const ASSET = /^[0-9a-f]{64}\.[a-z0-9]{1,8}$/;
const ASSET_GRACE_MS = 60_000;

export type Workspace = ReturnType<typeof createWorkspace>;

export function createWorkspace(userData: string) {
  const checked = (tool: string) => {
    if (!TOOL.test(tool)) throw new Error(`Unknown tool "${tool}"`);
    return tool;
  };
  const toolDir = (tool: string) => join(userData, 'workspace', checked(tool));
  const presetsPath = (tool: string) => join(userData, 'presets', `${checked(tool)}.json`);
  const statePaths = (tool: string) => {
    const dir = toolDir(tool);
    return { state: join(dir, 'state.json'), prev: join(dir, 'state.prev.json') };
  };

  return {
    async load(tool: ToolId): Promise<WorkspaceState | null> {
      const { state, prev } = statePaths(tool);
      for (const file of [state, prev]) {
        try {
          return JSON.parse(await readFile(file, 'utf8')) as WorkspaceState;
        } catch {
          // missing or damaged: try the previous good copy
        }
      }
      return null;
    },

    save(tool: ToolId, value: WorkspaceState): Promise<void> {
      const { state, prev } = statePaths(tool);
      return inOrder(state, () =>
        writeAtomic(state, JSON.stringify(value), async () => {
          try {
            await renameRetry(state, prev);
          } catch (e) {
            if (!isMissing(e)) throw e;
          }
        }),
      );
    },

    /** keep the broken document in crashed/<time>.json and clear the state, so the next start is empty */
    quarantine(tool: ToolId, raw: unknown): Promise<string> {
      const { state, prev } = statePaths(tool);
      const file = join(toolDir(tool), 'crashed', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      return inOrder(state, async () => {
        await writeAtomic(file, JSON.stringify(raw ?? null, null, 2));
        await rm(state, { force: true });
        await rm(prev, { force: true });
        return file;
      });
    },

    async putAsset(tool: ToolId, bytes: ArrayBuffer | Uint8Array, ext: string): Promise<{ hash: string; url: string }> {
      const e = ext.replace(/^\./, '').toLowerCase();
      if (!/^[a-z0-9]{1,8}$/.test(e)) throw new Error(`Unsupported file type ".${ext}"`);
      const buf = Buffer.from(bytes as ArrayBuffer);
      const hash = createHash('sha256').update(buf).digest('hex');
      const file = join(toolDir(tool), 'assets', `${hash}.${e}`);
      await inOrder(file, async () => {
        // a repeat refreshes the mtime, so a gc running now treats it as new
        if (await stat(file).catch(() => null)) await utimes(file, new Date(), new Date());
        else await writeAtomic(file, buf);
      });
      return { hash, url: `dt://asset/${tool}/${hash}.${e}` };
    },

    /** Skips in-flight temp files and anything put in the last minute: the caller's `keep` may predate it. */
    async gcAssets(tool: ToolId, keep: string[]): Promise<number> {
      const dir = join(toolDir(tool), 'assets');
      const kept = new Set(keep);
      const cutoff = Date.now() - ASSET_GRACE_MS;
      let names: string[];
      try {
        names = await readdir(dir);
      } catch (e) {
        if (isMissing(e)) return 0;
        throw e;
      }
      const dropped = await Promise.all(
        names
          .filter((n) => ASSET.test(n) && !kept.has(n.split('.')[0]))
          .map((n) => {
            const file = join(dir, n);
            return inOrder(file, async () => {
              const s = await stat(file).catch(() => null);
              if (!s || s.mtimeMs > cutoff) return false;
              await rm(file, { force: true });
              return true;
            });
          }),
      );
      return dropped.filter(Boolean).length;
    },

    /** absolute path of an asset file for dt://asset/<tool>/<name>, or null when the name isn't one */
    assetPath(tool: string, name: string): string | null {
      return TOOL.test(tool) && ASSET.test(name) ? join(toolDir(tool), 'assets', name) : null;
    },

    async presetsLoad(tool: ToolId): Promise<unknown[]> {
      const file = presetsPath(tool);
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch (e) {
        if (isMissing(e)) return [];
        throw e;
      }
      try {
        const list: unknown = JSON.parse(text);
        if (Array.isArray(list)) return list;
      } catch {}
      throw new Error("Saved presets couldn't be read. The file is damaged.");
    },

    presetsSave(tool: ToolId, presets: unknown[]): Promise<void> {
      const file = presetsPath(tool);
      return inOrder(file, () => writeAtomic(file, JSON.stringify(presets, null, 2)));
    },
  };
}
