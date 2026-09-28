import { createDocController } from '../../../shared/doc.ts';
import type { DocController, DocSource } from '../../../shared/doc-api.ts';
import { same } from '../../../shared/history.ts';
import type { ToolId } from '../../../shared/types.ts';
import type { ToolDefinition } from '../tool.ts';
import { guardSync, reportError } from './errors.ts';

// Per-tool bookkeeping behind the ShellState mirror. One Runtime per registered tool; Start empty
// replaces it with a fresh one.

export type Linked = NonNullable<DocSource>;

export type Runtime = {
  def: ToolDefinition<any>;
  doc: DocController<any>;
  /** the last committed document (restores included); a snapshot, never the live gesture */
  data: unknown;
  /**
   * The source to use now for an item this tool has linked, keyed by item id ('' = unlinked):
   * itself with the newest stamp, or what a first commit, fork or id change turned it into.
   * Writes queue as snapshots, so they resolve their item through this when they run.
   */
  links: Map<string, Linked>;
  /** items another tool took from this one (OPEN IN <tool>) until Take back */
  lostTo: Map<string, ToolId>;
  /** items changed on disk since this tool last read or wrote them: writing paused */
  paused: Set<string>;
  /** the last write's error: a persistent status-bar warning until a write succeeds */
  failed: string | null;
  /** writes run one at a time, in order */
  queue: Promise<void>;
  pending: number;
  /** view state (zoom, tabs, panel sizes), saved in workspace state.json, never in history */
  view: unknown;
  /** the last workspace state written, so an unchanged one isn't written again */
  saved: string;
  crashes: number;
  detach(): void;
};

const runtimes = new Map<ToolId, Runtime>();

export const rtOf = (id: ToolId): Runtime | undefined => runtimes.get(id);
export const allRuntimes = (): Runtime[] => [...runtimes.values()];
export const docRuntimes = (): Runtime[] => allRuntimes().filter((r) => r.def.itemKind);
export const setRuntime = (r: Runtime): void => void runtimes.set(r.def.id, r);

/** item ids no longer in the Library (deleted, moved outside, pending delete, another Library folder) */
export const missing = new Set<string>();

export function makeRuntime(def: ToolDefinition<any>): Runtime {
  const doc = createDocController<unknown>(def.id, def.createEmptyDoc());
  return {
    def,
    doc,
    data: doc.get(),
    links: new Map(),
    lostTo: new Map(),
    paused: new Set(),
    failed: null,
    queue: Promise.resolve(),
    pending: 0,
    view: undefined,
    saved: '',
    crashes: 0,
    detach: () => {},
  };
}

export const isEmptyDoc = (r: Runtime, data: unknown): boolean =>
  guardSync(`${r.def.label} couldn't check its document`, () => (r.def.isEmpty ? r.def.isEmpty(data) : same(data, r.def.createEmptyDoc()))) ?? false;

/** queue a job behind the tool's earlier writes; one that throws is reported and never stalls the queue */
export function enqueue(r: Runtime, job: () => Promise<void>): Promise<void> {
  r.pending++;
  const run = r.queue.then(job).catch((e) => reportError(`${r.def.label} couldn't save`, e));
  r.queue = run.then(() => void r.pending--);
  return r.queue;
}

/** every write queued so far, including ones queued while waiting */
export async function idle(r: Runtime): Promise<void> {
  while (r.pending > 0) await r.queue;
}

/** End an open gesture the way pointer-up would (spec §8: blur, tool hide, lost capture, before a receive). */
export function endGesture(r: Runtime | undefined): void {
  if (r?.doc.inGesture()) r.doc.commit('Edit');
}
