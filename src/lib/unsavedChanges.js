// ── Unsaved-changes tracker ─────────────────────────────────────────────────
// A tiny module-level registry shared by every tool. Tools call markDirty() when
// the user edits something and markSaved() once that work has been saved or
// exported. The combined flag is pushed to the Electron main process so it can
// warn before the window closes (see electron/main.js + preload.js).

import { useEffect, useState } from 'react'

const _dirty = new Set()        // tool ids with unsaved work
const _listeners = new Set()

function _sync() {
  const has = _dirty.size > 0
  try { window.electron?.setUnsavedChanges?.(has) } catch {}
  for (const fn of _listeners) fn(has)
}

// Flag a tool as having unsaved edits.
export function markDirty(toolId) {
  if (!_dirty.has(toolId)) { _dirty.add(toolId); _sync() }
}

// Clear a tool's unsaved flag — call after a save or export.
export function markSaved(toolId) {
  if (_dirty.has(toolId)) { _dirty.delete(toolId); _sync() }
}

export function hasUnsavedChanges() { return _dirty.size > 0 }

export function subscribe(fn) {
  _listeners.add(fn)
  return () => _listeners.delete(fn)
}

// React hook — true when any tool has unsaved changes.
export function useUnsavedChanges() {
  const [has, set] = useState(hasUnsavedChanges())
  useEffect(() => subscribe(set), [])
  return has
}
