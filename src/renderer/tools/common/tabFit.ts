/**
 * Which tabs of a strip show and which fold into its "More" menu. `widths` are the tabs' own
 * widths, `avail` the strip's, `more` the width of the More button, `gap` the space between tabs.
 * Everything shows if it fits; otherwise the first tabs that fit beside More do, and the tab you
 * are on (`current`, an index or -1) always shows, taking the place of the last one that fit.
 */
export function foldedTabs(widths: number[], current: number, avail: number, more: number, gap: number): boolean[] {
  const row = (ws: number[]) => ws.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, ws.length - 1);
  if (row(widths) <= avail) return widths.map(() => false);
  const room = avail - more - gap;
  const shown = new Set<number>();
  let used = 0;
  for (let i = 0; i < widths.length; i++) {
    const next = used + widths[i] + (shown.size ? gap : 0);
    if (next > room) break;
    shown.add(i);
    used = next;
  }
  if (current >= 0 && !shown.has(current)) {
    // make room for it by dropping tabs from the end of the ones showing
    const keep = [...shown].sort((a, b) => a - b);
    while (keep.length && row([...keep.map((i) => widths[i]), widths[current]]) > room) keep.pop();
    shown.clear();
    keep.forEach((i) => shown.add(i));
    shown.add(current);
  }
  return widths.map((_, i) => !shown.has(i));
}
