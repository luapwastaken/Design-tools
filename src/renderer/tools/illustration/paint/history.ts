// The painting's undo and redo bookkeeping (plan §4.5), pure so the tests drive it. Each step holds
// one copy of its rect: the rect as it was before the step while the step is done, and as it was
// after while it is undone; the engine swaps the copy's contents on undo and redo. Steps past the
// count or the byte cap go, the oldest first; a new step drops everything undone. Every copy that
// goes is released exactly once.
import type { Rect } from './types.ts';

export type StepKind = 'stroke' | 'clear';
export type HistoryStep<C extends { release(): void }> = {
  kind: StepKind;
  rect: Rect;
  bytes: number;
  copy: C;
  /** whether the painting was blank before and after the step */
  blank: [boolean, boolean];
};

export class History<C extends { release(): void }> {
  readonly steps: number;
  readonly maxBytes: number;
  #done: HistoryStep<C>[] = [];
  #undone: HistoryStep<C>[] = [];

  constructor(o: { steps: number; bytes: number }) {
    this.steps = o.steps;
    this.maxBytes = o.bytes;
  }

  get depth(): number {
    return this.#done.length;
  }
  get redoDepth(): number {
    return this.#undone.length;
  }
  get lastIsClear(): boolean {
    return this.#done.at(-1)?.kind === 'clear';
  }
  get bytes(): number {
    return [...this.#done, ...this.#undone].reduce((t, s) => t + s.bytes, 0);
  }

  push(step: HistoryStep<C>): void {
    for (const s of this.#undone.splice(0)) s.copy.release();
    this.#done.push(step);
    while (this.#done.length > this.steps || (this.#done.length > 1 && this.bytes > this.maxBytes)) this.#done.shift()!.copy.release();
  }

  /** the step to take back; the caller swaps its copy with the painting */
  undo(): HistoryStep<C> | null {
    const s = this.#done.pop();
    if (!s) return null;
    this.#undone.push(s);
    return s;
  }

  redo(): HistoryStep<C> | null {
    const s = this.#undone.pop();
    if (!s) return null;
    this.#done.push(s);
    return s;
  }

  /** forgets everything (another painting loaded, a graphics reset) */
  reset(): void {
    for (const s of [...this.#done.splice(0), ...this.#undone.splice(0)]) s.copy.release();
  }
}
