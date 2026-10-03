import type { ToolId } from '../../../shared/types.ts';

// Where Luap was when the window closed: the tool in front and whether the Library is open. A
// per-machine view preference, like the Library's width: where storage is blocked or empty the app
// opens on the first tool with the Library open.

const KEY = 'dt.session';

export type Session = { tool: ToolId | null; library: boolean };

export function remembered(): Session {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Session>;
    return { tool: typeof raw.tool === 'string' ? raw.tool : null, library: raw.library !== false };
  } catch {
    return { tool: null, library: true };
  }
}

export function remember(now: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(now));
  } catch {}
}
