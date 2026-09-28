import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * Which of `levels` renderings of one line fits its box, fullest first: 0 when everything fits, the
 * last when nothing else does (brief §7 overflow: drop whole parts before cutting any). `box` clips
 * and sets the room; `line` holds the content at its natural width (`width: max-content`). Each
 * level's width is measured once per `content`, so a resize re-renders only when the level changes.
 */
export function useFit(box: RefObject<HTMLElement | null>, line: RefObject<HTMLElement | null>, levels: number, content: string): number {
  const [level, setLevel] = useState(0);
  const need = useRef<{ content: string; widths: number[] }>({ content, widths: [] });
  const fit = useRef(() => {});
  fit.current = () => {
    const b = box.current;
    const l = line.current;
    if (!b || !l || !b.clientWidth) return; // not laid out (a closed panel): measured once it shows
    const n = need.current;
    if (n.content !== content) need.current = { content, widths: [] };
    const widths = need.current.widths;
    const last = levels - 1;
    if (level < last) widths[level] = l.offsetWidth;
    let next = last;
    for (let i = 0; i < last; i++) {
      // an unmeasured level is drawn once to measure it
      if (widths[i] === undefined || widths[i] <= b.clientWidth) {
        next = i;
        break;
      }
    }
    if (next !== level) setLevel(next);
  };
  useLayoutEffect(() => fit.current());
  useLayoutEffect(() => {
    const b = box.current;
    if (!b) return;
    const ro = new ResizeObserver(() => fit.current());
    ro.observe(b);
    return () => ro.disconnect();
  }, [box]);
  return level;
}
