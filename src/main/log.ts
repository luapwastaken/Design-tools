import { app } from 'electron';
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { staleLogs } from './log-keep.ts';

export type LogLevel = 'info' | 'warn' | 'error';

/** Append one entry to userData/logs/<local date>.log. Never throws: logging must not break anything. */
export function log(level: LogLevel, message: string, details?: string): void {
  const now = new Date();
  const text = `${now.toISOString()} ${level.toUpperCase()} ${message}${details ? `\n  ${details.replace(/\n/g, '\n  ')}` : ''}`;
  if (!app.isPackaged || level !== 'info') console[level === 'info' ? 'log' : level](text);
  try {
    const dir = join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    appendFileSync(join(dir, `${day}.log`), text + '\n');
  } catch {
    // disk full or unwritable: the console line above is all we can do
  }
}

/** how many days of logs stay */
const KEEP_DAYS = 14;

/** once at start-up: the days before the last two weeks go */
export function trimLogs(): void {
  try {
    const dir = join(app.getPath('userData'), 'logs');
    for (const name of staleLogs(readdirSync(dir), new Date(), KEEP_DAYS)) rmSync(join(dir, name), { force: true });
  } catch {
    // no logs yet, or a folder that can't be read: nothing to trim
  }
}

export const errorText = (e: unknown) => (e instanceof Error ? (e.stack ?? e.message) : String(e));

const pad = (n: number) => String(n).padStart(2, '0');
