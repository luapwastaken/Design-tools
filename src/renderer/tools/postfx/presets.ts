// Presets (spec §3): a few built-in starting stacks, and your own, saved in presets/postfx.json
// (foundation spec §8: never document state, never in history). Every one is read through
// share.ts's layersFrom, so a preset saved by another version can't break the stack.
import { toast } from '../../ui/index.ts';
import { createStore } from '../common/store.ts';
import type { Layer } from './doc.ts';
import { layersFrom } from './share.ts';

export type Preset = { id: string; name: string; layers: Layer[] };

const TOOL = 'postfx';

type Saved = { list: Preset[]; ready: boolean; error: string | null };

/** your presets, read once when the tool first shows */
export const saved = createStore<Saved>({ list: [], ready: false, error: null });

let loading: Promise<void> | null = null;

export function loadSaved(): Promise<void> {
  return (loading ??= (async () => {
    try {
      const raw = await window.api.invoke('presets.load', TOOL);
      const list: Preset[] = [];
      let broken = 0;
      for (const x of raw) {
        const r = (typeof x === 'object' && x !== null ? x : {}) as Record<string, unknown>;
        try {
          if (typeof r.id !== 'string' || typeof r.name !== 'string') throw new Error();
          list.push({ id: r.id, name: r.name, layers: layersFrom(r.layers, r.name) });
        } catch {
          broken++;
        }
      }
      saved.set({ list, ready: true, error: null });
      if (broken) toast.show({ icon: 'info', message: `${broken === 1 ? 'One saved preset uses' : `${broken} saved presets use`} effects this version doesn’t have, so ${broken === 1 ? 'it is' : 'they are'} left out.` });
    } catch (e) {
      // never written over: saving is off until the file can be read
      saved.set({ list: [], ready: true, error: e instanceof Error ? e.message : String(e) });
    }
  })());
}

const toFile = (p: Preset) => ({ id: p.id, name: p.name, layers: p.layers.map(({ effect, on, opacity, blend, params }) => ({ effect, on, opacity, blend, params })) });

async function write(list: Preset[]): Promise<void> {
  const before = saved.get();
  saved.set({ ...before, list });
  try {
    await window.api.invoke('presets.save', TOOL, list.map(toFile));
  } catch (e) {
    saved.set(before);
    toast.show({ kind: 'error', message: `Couldn’t save the presets: ${e instanceof Error ? e.message : String(e)}` });
    throw e;
  }
}

const canWrite = () => {
  const st = saved.get();
  if (st.error) toast.show({ kind: 'error', message: `${st.error} Your presets are left as they are.` });
  return st.ready && !st.error;
};

/** a name not yet taken: "Grain", then "Grain 2" */
export function freeName(name: string): string {
  const taken = new Set(saved.get().list.map((p) => p.name.toLowerCase()));
  const base = name.trim() || 'My preset';
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

export async function savePreset(name: string, stack: Layer[]): Promise<Preset | null> {
  if (!canWrite()) return null;
  const p: Preset = { id: crypto.randomUUID(), name: freeName(name), layers: stack.map((l) => ({ ...l, params: { ...l.params } })) };
  await write([...saved.get().list, p]).catch(() => null);
  return saved.get().list.includes(p) ? p : null;
}

export async function renamePreset(id: string, name: string): Promise<void> {
  if (!canWrite()) return;
  await write(saved.get().list.map((p) => (p.id === id ? { ...p, name: name.trim() } : p))).catch(() => {});
}

/** after the armed confirm: gone at once, with an Undo toast that puts it back where it was (brief rule 3) */
export async function deletePreset(id: string): Promise<void> {
  if (!canWrite()) return;
  const list = saved.get().list;
  const at = list.findIndex((p) => p.id === id);
  if (at < 0) return;
  const gone = list[at];
  try {
    await write(list.filter((p) => p.id !== id));
  } catch {
    return;
  }
  toast.show({
    icon: 'delete',
    message: `Deleted the ${gone.name} preset.`,
    undo: async () => {
      const now = saved.get().list;
      if (now.some((p) => p.id === gone.id)) return;
      await write([...now.slice(0, at), gone, ...now.slice(at)]);
    },
  });
}
