import { createDocController } from '../../../shared/doc.ts';
import type { ToolId } from '../../../shared/types.ts';
import { toast } from '../../ui/index.ts';
import { registeredTools } from '../registry.ts';
import type { Shell } from '../shell-api.ts';
import type { ToolDefinition } from '../tool.ts';
import { installCloseHandshake } from './close.ts';
import { reloadTool, reportCrash, restoreAll, startEmpty } from './docs.ts';
import { installErrorHandlers, reportError } from './errors.ts';
import { installInput } from './input.ts';
import { ipc } from './ipc.ts';
import { installKeymap } from './keymap.ts';
import * as library from './library.ts';
import { reconcile, retry, setView } from './persist.ts';
import { ACTION_LABELS, type ReadoutAction, readoutOf } from './readout.ts';
import { targetsFor } from './routing.ts';
import { rtOf } from './runtime.ts';
import * as send from './send.ts';
import { getState, setState, subscribe } from './store.ts';

// The shell's logic (unit S-core). Views read state through useShell(select) and act through
// `shell` (contract: shell/shell-api.ts). Importing this module starts the shell.

export { useShell } from './store.ts';

// Before start-up finishes (and in a build with no tools) views still render: unknown ids get an
// inert stand-in rather than a throw.
const standInDoc = createDocController<null>('design', null);
const standIn = (id: ToolId): ToolDefinition<null> => ({
  id,
  label: '',
  group: 'dev',
  icon: 'block',
  shortcut: 0,
  docVersion: 0,
  createEmptyDoc: () => null,
  accepts: {},
  receive: async () => null,
  View: () => null,
});

const ACTIONS: Record<ReadoutAction, (id: ToolId) => unknown> = {
  'take-back': send.takeBack,
  reload: send.reloadFromDisk,
  'keep-copy': send.keepMineAsCopy,
  retry: (id) => {
    const r = rtOf(id);
    if (r) retry(r);
  },
};

export const shell: Shell = {
  getState,
  subscribe,

  tool: (id) => rtOf(id)?.def ?? standIn(id),
  doc: (id) => rtOf(id)?.doc ?? standInDoc,
  readout(id) {
    const r = readoutOf(getState().docStates[id], (t) => rtOf(t)?.def.label ?? t);
    return { ...r, actions: r.actions.map((a) => ({ label: ACTION_LABELS[a], run: () => void ACTIONS[a](id) })) };
  },

  setActive: send.setActive,
  toggleLibrary: (open) => setState({ libraryOpen: open ?? !getState().libraryOpen }),
  openSettings: (open) => setState({ settingsOpen: open ?? !getState().settingsOpen }),
  setTheme: library.setTheme,
  chooseLibraryRoot: library.chooseLibraryRoot,

  targetsFor: (kind) => targetsFor(kind, getState().tools),
  acceptedLabel: (kind) => rtOf(getState().active)?.def.accepts[kind]?.label ?? null,
  openTarget: send.openTargetFor,
  openItem: send.openItem,
  sendItem: send.sendItem,
  sendDoc: send.sendDoc,
  sendKind: send.sendKind,
  deleteItem: library.deleteItem,
  moveItem: library.moveItem,
  renameItem: library.renameItem,
  duplicateItem: library.duplicateItem,
  revealItem: library.revealItem,
  importFiles: library.importFiles,
  createCollection: library.createCollection,
  renameCollection: library.renameCollection,
  setCollectionLocked: library.setCollectionLocked,

  takeBack: send.takeBack,
  reloadFromDisk: send.reloadFromDisk,
  keepMineAsCopy: send.keepMineAsCopy,

  reportCrash,
  reloadTool,
  startEmpty: (id) => startEmpty(id),
  view: (id) => rtOf(id)?.view,
  setView(id, view) {
    const r = rtOf(id);
    if (r) setView(r, view);
  },

  runBusy: send.runBusy,
};

/** Spec §4 start-up: every controller is created and restored before `ready` lets the UI take input. */
async function start(): Promise<void> {
  installErrorHandlers();
  installKeymap();
  installInput();
  installCloseHandshake();
  ipc.on('library.changed', (index) => {
    setState({ library: index });
    reconcile();
  });
  ipc.on('app.notice', (n) => toast.show(n.level === 'error' ? { kind: 'error', message: n.message } : { icon: n.level === 'warn' ? 'warning' : 'info', message: n.message }));
  try {
    const [info, settings, index] = await Promise.all([ipc.invoke('app.info'), ipc.invoke('settings.get'), ipc.invoke('library.index')]);
    // an index event may have arrived meanwhile: keep the newest
    setState({ settings, library: getState().library ?? index, isPackaged: info.isPackaged });
    const tools = await restoreAll(await registeredTools(info.isPackaged, !!window.api?.smokeRun));
    setState({ tools });
    const active = tools[0]?.id ?? getState().active;
    setState({ ready: true, active, mounted: tools.length ? [active] : [] });
  } catch (e) {
    reportError("The app couldn't start", e);
  }
}

let started: Promise<void> | null = null;
/** idempotent (StrictMode, a second import) */
export const startShell = (): Promise<void> => (started ??= start());

if (typeof window !== 'undefined' && window.api) void startShell();
