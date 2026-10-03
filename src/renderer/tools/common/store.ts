import { useSyncExternalStore } from 'react';

export type Store<T> = {
  get(): T;
  set(next: T): void;
  subscribe(fn: () => void): () => void;
  /** React: the current value, re-rendering on change */
  use(): T;
};

/** A value outside React, shared by the view, the tool definition's hooks and the status slot. */
export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<() => void>();
  const get = () => value;
  const subscribe = (fn: () => void) => {
    subs.add(fn);
    return () => void subs.delete(fn);
  };
  return {
    get,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      subs.forEach((f) => f());
    },
    subscribe,
    use: () => useSyncExternalStore(subscribe, get),
  };
}
