// "Has the painting been written?" as a promise, for the smoke run: a check that waits for the save
// itself instead of a guess at how long a save takes. A save is the debounce, the engine's snapshot
// and the write, and the write waits on the disk, which can stall for seconds.

export type SaveState = {
  /** a change is waiting for its save to start (the debounce, or the lift of a stroke) */
  unsaved(): boolean;
  /** the saves queued so far, one after another */
  saving(): Promise<void>;
};

/**
 * Resolves true once nothing waits and no save is under way, false if that hasn't happened within
 * `ms`: a save that hangs says so, it isn't waited out.
 */
export async function settledWithin(s: SaveState, ms: number, tickMs = 25): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<false>((r) => (timer = setTimeout(r, ms, false)));
  try {
    for (;;) {
      const queued = s.saving();
      if (!(await Promise.race([queued.then(() => true), limit]))) return false;
      if (!s.unsaved() && s.saving() === queued) return true;
      if (!(await Promise.race([new Promise<true>((r) => setTimeout(r, tickMs, true)), limit]))) return false;
    }
  } finally {
    clearTimeout(timer);
  }
}
