/**
 * A move asks first only when a lock is in it: out of a locked collection (tools can't edit what is in it)
 * or into one. Between two unlocked ones it just happens, and its toast has the Undo.
 */
export const moveNeedsConfirm = (fromLocked: boolean, toLocked: boolean): boolean => fromLocked || toLocked;
