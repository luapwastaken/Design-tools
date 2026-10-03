import { toast } from '../../ui/index.ts';
import { log } from './ipc.ts';

// Global error handlers and the wrapper around every call into a tool hook (spec §4): a throw
// becomes a toast and a log line, never a dead shell.

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
export const errorDetails = (e: unknown): string => (e instanceof Error ? (e.stack ?? e.message) : String(e));

// Chromium reports these when a ResizeObserver callback resizes what it observes; nothing is lost
const BENIGN = /^ResizeObserver loop/;
const REPEAT_MS = 2000;
let last = { message: '', at: 0 };

/**
 * A toast (error kind, stays until dismissed) and a log line; the same message twice within 2s shows
 * once. `plain`: the error is already a sentence for Luap (a file that wouldn't open), so the toast
 * says just that, as the tools' own toasts do; the log keeps what was being done.
 */
export function reportError(what: string, e: unknown, plain = false): void {
  const message = plain ? errorText(e) : `${what}: ${errorText(e)}`;
  log('error', `${what}: ${errorText(e)}`, errorDetails(e));
  const now = Date.now();
  if (message === last.message && now - last.at < REPEAT_MS) return;
  last = { message, at: now };
  toast.show({ kind: 'error', message });
}

/** run a tool hook; undefined when it threw (the toast has already said why) */
export async function guard<T>(what: string, fn: () => T | Promise<T>, plain = false): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    reportError(what, e, plain);
    return undefined;
  }
}

export function guardSync<T>(what: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    reportError(what, e);
    return undefined;
  }
}

export function installErrorHandlers(): void {
  addEventListener('error', (e) => {
    if (BENIGN.test(e.message)) return;
    reportError('Something went wrong', e.error ?? e.message);
  });
  addEventListener('unhandledrejection', (e) => reportError('Something went wrong', e.reason));
}
