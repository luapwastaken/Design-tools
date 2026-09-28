import type { Bridge } from '../../../shared/api.ts';

// Every call from the shell core to main goes through here, so a test or the smoke run can swap in
// a fake bridge with `setPort`.

type Port = Pick<Bridge, 'invoke' | 'on' | 'pathForFile'>;

let port: Port | null = null;
const current = (): Port => port ?? window.api;

export const ipc: Port = {
  invoke: ((name, ...args) => current().invoke(name, ...args)) as Bridge['invoke'],
  on: (name, fn) => current().on(name, fn),
  pathForFile: (file) => current().pathForFile(file),
};

export const setPort = (p: Port | null): void => {
  port = p;
};

/** fire and forget: a log line must never become an error of its own */
export function log(level: 'info' | 'warn' | 'error', message: string, details?: string): void {
  try {
    void ipc.invoke('app.log', level, message, details).catch(() => {});
  } catch {}
}
