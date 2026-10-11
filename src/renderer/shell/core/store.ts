import { useRef, useSyncExternalStore } from 'react';
import type { ShellState } from '../shell-api.ts';
import { remembered } from './session.ts';

// The shell's view state: one immutable object, replaced on every change. Views read it only
// through useShell(select).

let state: ShellState = {
  ready: false,
  active: 'design',
  tools: [],
  mounted: [],
  libraryOpen: remembered().library,
  settingsOpen: false,
  shortcutsOpen: false,
  settings: null,
  library: null,
  owners: {},
  docStates: {},
  docNames: {},
  crashed: {},
  statusWarning: null,
  busy: 0,
};
const listeners = new Set<() => void>();

export const getState = (): ShellState => state;

export function setState(patch: Partial<ShellState>): void {
  const keys = Object.keys(patch) as (keyof ShellState)[];
  if (keys.every((k) => Object.is(state[k], patch[k]))) return;
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/**
 * A slice of the shell state. A selector may build a fresh object or array: a result shallowly
 * equal to the last one is returned as the same reference, so the view doesn't re-render.
 */
export function useShell<T>(select: (s: ShellState) => T): T {
  const memo = useRef<{ s: ShellState; select: (s: ShellState) => T; value: T } | null>(null);
  return useSyncExternalStore(subscribe, () => {
    const m = memo.current;
    if (m && m.s === state && m.select === select) return m.value;
    const next = select(state);
    const value = m && shallowEqual(m.value, next) ? m.value : next;
    memo.current = { s: state, select, value };
    return value;
  });
}

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
