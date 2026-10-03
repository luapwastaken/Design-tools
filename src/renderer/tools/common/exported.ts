/** the file an export made last, kept in a tool's view so it can be found again */
export type ExportRecord = { name: string; path: string; at: number };

/** a saved record, or null when what was saved isn't one */
export function recordOf(v: unknown): ExportRecord | null {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  return typeof r.name === 'string' && typeof r.path === 'string' && typeof r.at === 'number' ? { name: r.name, path: r.path, at: r.at } : null;
}
