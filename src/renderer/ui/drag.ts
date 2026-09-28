import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { clamp } from './scrub.ts';

/** Where the pointer is on the element, 0..1 on each axis. */
export type At = { x: number; y: number; shift: boolean };

type Drag = { id: number; el: Element; rect: DOMRect; onKey(e: KeyboardEvent): void };

/**
 * A press-and-drag on an area (the picker plane, a channel track) as ONE gesture: begin and a
 * first change on press, a change per move, commit on release or lost capture; Esc cancels.
 */
export function useDrag(o: {
  disabled?: boolean;
  onBegin?(): void;
  onMove(at: At): void;
  onCommit?(): void;
  onCancel?(): void;
}) {
  const live = useRef(o);
  live.current = o;
  const drag = useRef<Drag | null>(null);
  const [active, setActive] = useState(false);

  const at = (d: Drag, e: PointerEvent<Element>): At => ({
    x: clamp((e.clientX - d.rect.left) / d.rect.width, 0, 1),
    y: clamp((e.clientY - d.rect.top) / d.rect.height, 0, 1),
    shift: e.shiftKey,
  });

  const end = (commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    removeEventListener('keydown', d.onKey, true);
    if (d.el.hasPointerCapture(d.id)) d.el.releasePointerCapture(d.id);
    setActive(false);
    if (commit) live.current.onCommit?.();
    else live.current.onCancel?.();
  };

  // unmounting mid-drag commits what's there rather than leaving the gesture (and its Esc) open
  useEffect(() => () => end(true), []);

  return {
    active,
    handlers: {
      onPointerDown(e: PointerEvent<HTMLElement>) {
        if (live.current.disabled || e.button !== 0 || drag.current) return;
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        const onKey = (k: KeyboardEvent) => {
          if (k.key !== 'Escape') return;
          k.preventDefault();
          k.stopPropagation();
          end(false);
        };
        addEventListener('keydown', onKey, true);
        // the area doesn't move during a drag, so its rect is read once
        const d = (drag.current = { id: e.pointerId, el, rect: el.getBoundingClientRect(), onKey });
        setActive(true);
        live.current.onBegin?.();
        live.current.onMove(at(d, e));
      },
      onPointerMove(e: PointerEvent<HTMLElement>) {
        const d = drag.current;
        if (d && d.id === e.pointerId) live.current.onMove(at(d, e));
      },
      onPointerUp: () => end(true),
      onLostPointerCapture: () => end(true),
    },
  };
}
