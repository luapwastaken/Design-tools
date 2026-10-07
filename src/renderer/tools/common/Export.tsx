// What the Export groups of Pattern, Logo, Dither, Halftone and Post FX share, so they read the same:
// the runner (the doc bar's Export calls it; the inspector group only holds the settings), the
// progress with its Cancel, and the Last export line. The runner makes one export, or one copy to the clipboard, count as running work
// from its first render to its last write (the quit check, the status bar), keeps the window at full
// speed, and records the file and says so.
import { useState } from 'react';
import { copyToClipboard, exporting, leaf } from '../../lib/export.ts';
import { ipc } from '../../shell/core/ipc.ts';
import { cx } from '../../ui/cx.ts';
import { Button, IconButton, Progress, toast, Tooltip } from '../../ui/index.ts';
import type { Copying } from '../../../shared/clipboard.ts';
import type { ExportRecord } from './exported.ts';
import s from './Export.module.css';

/** what an export gives back: where it went, and what the toast calls it ("logo.svg", "12 files into brand") */
export type Made = { path: string; label: string };
export type Report = (done: number, detail?: string) => void;
type Busy = { what: string; verb: 'export' | 'copy'; done: number | null; detail?: string; stop?: AbortController };

/** how long the rest should take, from how long the part done took (said once it is a fair guess) */
function left(began: number, done: number): string {
  const spent = (Date.now() - began) / 1000;
  if (spent < 3 || done < 0.02 || done >= 1) return '';
  const sec = Math.round((spent * (1 - done)) / done);
  return ` · about ${sec < 90 ? `${Math.max(5, Math.round(sec / 5) * 5)} s` : `${Math.round(sec / 60)} min`} left`;
}

export type Exporter = ReturnType<typeof useExport>;

/** `record` keeps the last file in the tool's view */
export function useExport(record: (last: ExportRecord) => void) {
  const [busy, setBusy] = useState<Busy | null>(null);

  /**
   * One piece of work from its first render to its last write, a file or the clipboard: running work
   * for the quit check, a failure told in a toast. `what` names the row it belongs to; `stoppable`
   * gives `make` a signal and the progress its Cancel.
   */
  const work = async <T,>(what: string, verb: Busy['verb'], make: (report: Report, b: Busy) => Promise<T>, stoppable = false): Promise<T | null> => {
    const b: Busy = { what, verb, done: null, stop: stoppable ? new AbortController() : undefined };
    const began = Date.now();
    setBusy(b);
    try {
      return await exporting(() => make((done, detail) => setBusy({ ...b, done, detail: detail && `${detail}${left(began, done)}` }), b));
    } catch (e) {
      toast.show({ kind: 'error', message: `Couldn't ${verb === 'copy' ? 'copy' : 'make'} the ${what}: ${e instanceof Error ? e.message : String(e)}` });
      return null;
    } finally {
      setBusy(null);
    }
  };

  /** `what` names the file in the button, the progress and a failure */
  const run = async (what: string, make: (report: Report, b: Busy) => Promise<Made | null>, stoppable = false) => {
    const got = await work(what, 'export', make, stoppable);
    if (!got) return;
    record({ name: got.label, path: got.path, at: Date.now() });
    toast.show({ icon: 'download', message: `Exported ${got.label}.` });
  };

  /** the row's `what`, as for run; `kind` names what is on the clipboard after ("Copied the SVG.") */
  const copy = async (what: string, kind: 'SVG' | 'PNG', make: (report: Report) => Promise<Copying>) => {
    const done = await work(what, 'copy', async (report) => {
      await copyToClipboard(await make(report));
      return true;
    });
    if (done) toast.show({ icon: 'content_copy', message: `Copied the ${kind}.` });
  };

  return {
    busy,
    run,
    /** one file through the save dialog */
    file: (what: string, make: (report: Report) => Promise<string | null>) => run(what, async (report) => {
      const path = await make(report);
      return path ? { path, label: leaf(path) } : null;
    }),
    /** an SVG's markup to the clipboard */
    copySvg: (what: string, make: (report: Report) => Promise<string>) => copy(what, 'SVG', async (report) => ({ kind: 'svg', data: await make(report) })),
    /** a PNG's bytes to the clipboard */
    copyPng: (what: string, make: (report: Report) => Promise<ArrayBuffer>) => copy(what, 'PNG', async (report) => ({ kind: 'png', data: await make(report) })),
  };
}

/**
 * The running export's progress and Cancel: pinned at the top of the inspector, outside its groups, so
 * it stays in view whether or not the Export group is open.
 */
export function ExportProgress({ ex }: { ex: Exporter }) {
  const b = ex.busy;
  if (!b) return null;
  return (
    <div className={s.progress} data-export-progress={b.what}>
      <Progress label={`${b.verb === 'copy' ? 'Copying' : 'Making'} the ${b.what}`} value={b.done} detail={b.detail} onCancel={b.stop && (() => b.stop!.abort())} />
    </div>
  );
}

type CopyProps = {
  ex: Exporter;
  /** the `what` its copySvg or copyPng was given: while it runs the button reads Copying… */
  what: string;
  /** why it can't go, as its tooltip; any text disables it */
  why?: string | null;
  disabled?: boolean;
  onClick(): void;
};

/** Copy: the SVG or PNG goes on the clipboard instead of a file (a secondary button) */
export function CopyButton({ ex, what, why, disabled, onClick }: CopyProps) {
  return (
    <Button icon="content_copy" disabled={disabled || !!why || ex.busy !== null} tooltip={why ?? 'Copy to the clipboard'} onClick={onClick}>
      {ex.busy?.what === what && ex.busy.verb === 'copy' ? 'Copying…' : 'Copy'}
    </Button>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/** the file made last, with a way to its folder */
export function LastExport({ last }: { last: ExportRecord | null }) {
  if (!last) return null;
  return (
    <div className={s.last}>
      <span className="lbl">Last export</span>
      <Tooltip overflowOnly>
        <span className={s.lastName}>{last.name}</span>
      </Tooltip>
      <span className={s.lastAt}>{clock(last.at)}</span>
      <IconButton icon="folder_open" label="Show in Explorer" size="sm" onClick={() => void ipc.invoke('shell.reveal', last.path).catch(() => toast.show({ kind: 'error', message: `${last.name} isn't there any more.` }))} />
    </div>
  );
}
