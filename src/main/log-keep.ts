// How long the daily logs (userData/logs/<YYYY-MM-DD>.log) are kept. Pure, so a test reaches it
// without Electron.

/** the day a log file is named for, as local midnight; null for any other file */
const dayOf = (name: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})\.log$/.exec(name);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
};

/** the log files older than `keepDays` days before `now` (today's and the last days' stay) */
export function staleLogs(names: string[], now: Date, keepDays: number): string[] {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - keepDays).getTime();
  return names.filter((n) => {
    const day = dayOf(n);
    return day !== null && day < cutoff;
  });
}
