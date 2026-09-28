// Bounded undo history of immutable entries (spec §8). Generic; shared/doc.ts builds DocController on it.

type Step<T> = { entry: T; label: string; key: string | null; at: number };

/** a push with the same key and label as the top step, within this many ms, replaces it (key repeat) */
export const MERGE_MS = 1000;

export class History<T> {
  /** #steps[0] is the base state; its label is never shown */
  #steps: Step<T>[];
  #index = 0;
  /** the top step was the last thing to happen, so the next push may merge into it */
  #open = false;
  readonly limit: number;

  constructor(base: T, limit = 200) {
    this.#steps = [{ entry: base, label: '', key: null, at: 0 }];
    this.limit = limit;
  }

  current(): T {
    return this.#steps[this.#index].entry;
  }
  /** steps that can be undone */
  depth(): number {
    return this.#index;
  }
  canUndo(): boolean {
    return this.#index > 0;
  }
  canRedo(): boolean {
    return this.#index < this.#steps.length - 1;
  }
  undoLabel(): string | null {
    return this.canUndo() ? this.#steps[this.#index].label : null;
  }
  redoLabel(): string | null {
    return this.canRedo() ? this.#steps[this.#index + 1].label : null;
  }

  /** Add a step after the current one, dropping redo. A keyed repeat replaces the top step instead. */
  push(entry: T, label: string, key: string | null, at: number): void {
    const top = this.#steps[this.#index];
    const age = at - top.at; // negative after the clock steps back: no merge
    // with limit 0 the top is the base (index 0), which has nothing before it to merge against
    if (this.#open && this.#index > 0 && key !== null && key === top.key && label === top.label && age >= 0 && age <= MERGE_MS) {
      if (same(entry, this.#steps[this.#index - 1].entry)) {
        // the repeats cancelled out (up, then down): the step changes nothing, so it goes
        this.#steps.pop();
        this.#index--;
        this.#open = false;
      } else {
        this.#steps[this.#index] = { entry, label, key, at };
      }
      return;
    }
    this.#steps.length = this.#index + 1;
    this.#steps.push({ entry, label, key, at });
    if (this.#steps.length > this.limit + 1) this.#steps.shift();
    this.#index = this.#steps.length - 1;
    this.#open = true;
  }

  undo(): boolean {
    if (!this.canUndo()) return false;
    this.#index--;
    this.#open = false;
    return true;
  }
  redo(): boolean {
    if (!this.canRedo()) return false;
    this.#index++;
    this.#open = false;
    return true;
  }

  /** swap the current entry in place, no step */
  replace(entry: T): void {
    this.#steps[this.#index] = { ...this.#steps[this.#index], entry };
    this.#open = false;
  }

  /** rewrite entries in place (bookkeeping such as a fresher file stamp); not a history event */
  map(fn: (entry: T) => T): void {
    for (const s of this.#steps) s.entry = fn(s.entry);
  }
}

/** Structural equality for JSON-shaped values; shared structure short-circuits on reference. */
export function same(a: unknown, b: unknown): boolean {
  if (a === b || (a !== a && b !== b)) return true; // NaN equals NaN; 0 still equals -0
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const proto = Object.getPrototypeOf(a);
  // anything that isn't a plain object or array (Map, Blob, ...) is only equal to itself
  if (proto !== Object.getPrototypeOf(b) || (proto !== Object.prototype && proto !== Array.prototype)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
