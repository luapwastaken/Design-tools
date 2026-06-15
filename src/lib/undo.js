// ── Global undo / redo registry ────────────────────────────────────────────────
//
// One global Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) handler lives in App.jsx. Each tool
// registers its own undo/redo implementation while mounted via useGlobalUndo(); the
// global handler dispatches to whichever tool is currently active. New tools get
// undo/redo keybinds for free just by calling the hook — no per-tool key listeners.

import { useEffect } from 'react'

let _active = null

export function setUndoHandlers(h) { _active = h }
export function clearUndoHandlers(h) { if (_active === h) _active = null }

export function globalUndo() { try { _active?.undo?.() } catch (e) { console.error('[undo]', e) } }
export function globalRedo() { try { _active?.redo?.() } catch (e) { console.error('[redo]', e) } }

// Register a tool's undo/redo for as long as it is mounted. Pass stable function
// references (module-level store fns, or useCallback-wrapped) so re-registration
// only happens when they actually change.
export function useGlobalUndo(undo, redo) {
  useEffect(() => {
    const h = { undo, redo }
    setUndoHandlers(h)
    return () => clearUndoHandlers(h)
  }, [undo, redo])
}
