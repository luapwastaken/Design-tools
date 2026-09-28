import { app } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

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

export const errorText = (e: unknown) => (e instanceof Error ? (e.stack ?? e.message) : String(e));

const pad = (n: number) => String(n).padStart(2, '0');
