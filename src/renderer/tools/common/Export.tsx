// What the Export modules of Pattern, Logo, Dither, Halftone and Post FX share, so they read the same:
// a row (what it makes and its button), the runner, and the Last export line. The runner makes one
// export count as running work from its first render to its last write (the quit check, the status
// bar), keeps the window at full speed, records the file and says so.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { exporting, leaf } from '../../lib/export.ts';
import { ipc } from '../../shell/core/ipc.ts';
import { cx } from '../../ui/cx.ts';
import { Button, IconButton, Progress, toast, Tooltip } from '../../ui/index.ts';
import type { ExportRecord } from './exported.ts';
import s from './Export.module.css';

/** what an export gives back: where it went, and what the toast calls it ("logo.svg", "12 files into brand") */
export type Made = { path: string; label: string };
export type Report = (done: number, detail?: string) => void;
type Busy = { what: string; done: number | null; detail?: string; stop?: AbortController };

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
  const liveRef = useRef<HTMLDivElement>(null);
  // its progress comes into view when it first shows: it sits under the row that was pressed
  const showing = busy !== null && busy.done !== null;
  useEffect(() => {
    if (showing) liveRef.current?.scrollIntoView({ block: 'nearest' });
  }, [showing, busy?.what]);

  /** `what` names the file in the button, the progress and a failure; `stoppable` gives `make` a signal and the progress its Cancel */
  const run = async (what: string, make: (report: Report, b: Busy) => Promise<Made | null>, stoppable = false) => {
    const b: Busy = { what, done: null, stop: stoppable ? new AbortController() : undefined };
    const began = Date.now();
    setBusy(b);
    try {
      const got = await exporting(() => make((done, detail) => setBusy({ ...b, done, detail: detail && `${detail}${left(began, done)}` }), b));
      if (!got) return;
      record({ name: got.label, path: got.path, at: Date.now() });
      toast.show({ icon: 'download', message: `Exported ${got.label}.` });
    } catch (e) {
      toast.show({ kind: 'error', message: `Couldn't make the ${what}: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    run,
    /** one file through the save dialog */
    file: (what: string, make: (report: Report) => Promise<string | null>) => run(what, async (report) => {
      const path = await make(report);
      return path ? { path, label: leaf(path) } : null;
    }),
    /** a row's progress, while its own export runs: spread into its ExportRow */
    live: (what: string): { live?: ReactNode; liveRef?: RefObject<HTMLDivElement | null> } =>
      busy?.what === what && busy.done !== null
        ? { live: <Progress label={`Making the ${what}`} value={busy.done} detail={busy.detail} onCancel={busy.stop && (() => busy.stop!.abort())} />, liveRef }
        : {},
  };
}

export const ExportList = ({ children }: { children: ReactNode }) => <div className={s.list}>{children}</div>;

type RowProps = {
  name: string;
  desc: ReactNode;
  action: ReactNode;
  /** the lead row, in a well, with the module's one primary button */
  main?: boolean;
  /** its own settings, under the name and the button */
  children?: ReactNode;
  live?: ReactNode;
  liveRef?: RefObject<HTMLDivElement | null>;
};

export function ExportRow({ name, desc, action, main, children, live, liveRef }: RowProps) {
  return (
    <div className={cx(s.item, main && s.main)}>
      <div className={s.text}>
        <b className={s.name}>{name}</b>
        <p className={s.desc}>{desc}</p>
      </div>
      {action}
      {children && <div className={s.more}>{children}</div>}
      {live && (
        <div ref={liveRef} className={s.live}>
          {live}
        </div>
      )}
    </div>
  );
}

type ButtonProps = {
  ex: Exporter;
  /** the `what` its run() was given: while it runs the button reads Exporting… */
  what: string;
  /** the lead row's: primary and large */
  lead?: boolean;
  /** it writes a folder */
  folder?: boolean;
  /** why it can't go, as its tooltip; any text disables it */
  why?: string | null;
  disabled?: boolean;
  onClick(): void;
  /** the idle label */
  children?: ReactNode;
};

export function ExportButton({ ex, what, lead, folder, why, disabled, onClick, children = folder ? 'Export…' : 'Export' }: ButtonProps) {
  return (
    <Button
      variant={lead ? 'primary' : 'secondary'}
      size={lead ? 'lg' : 'md'}
      icon={folder ? 'folder_open' : 'download'}
      disabled={disabled || !!why || ex.busy !== null}
      tooltip={why ?? undefined}
      onClick={onClick}
    >
      {ex.busy?.what === what ? 'Exporting…' : children}
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
      <IconButton icon="folder_open" label="Show in Explorer" size="xs" onClick={() => void ipc.invoke('shell.reveal', last.path).catch(() => toast.show({ kind: 'error', message: `${last.name} isn't there any more.` }))} />
    </div>
  );
}
