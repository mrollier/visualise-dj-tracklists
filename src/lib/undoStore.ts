import { derived, get } from 'svelte/store'
import { initStack, record, redo, undo, type UndoSnapshot, type UndoStack } from '../core/history'
import { activeSet, activeSetId, selectedId, setGeneratedTracklist, tracklist } from '../stores'

/**
 * Cmd+Z wiring (issue 2): snapshots the ACTIVE set's tracks (+ generated
 * flag) and the selection on every change, unless the change came from an
 * undo/redo itself. The stack resets on set switches and library
 * replacement — undo never resurrects one set's tracks into another.
 */

let stack: UndoStack = initStack({ trackIds: [], generated: false, selectedId: null })
let applying = false

function currentSnapshot(): UndoSnapshot {
  const set = get(activeSet)
  return { trackIds: set.trackIds, generated: set.generated, selectedId: get(selectedId) }
}

function applySnapshot(snapshot: UndoSnapshot): void {
  applying = true
  try {
    if (snapshot.generated) setGeneratedTracklist(snapshot.trackIds)
    else tracklist.set(snapshot.trackIds)
    selectedId.set(snapshot.selectedId)
  } finally {
    applying = false
  }
}

/** Forget all history and re-seed from the current state. */
export function resetUndo(): void {
  stack = initStack(currentSnapshot())
}

export function undoOnce(): void {
  const next = undo(stack)
  if (next === null) return
  stack = next
  applySnapshot(stack.present)
}

export function redoOnce(): void {
  const next = redo(stack)
  if (next === null) return
  stack = next
  applySnapshot(stack.present)
}

/** Subscribe once at app start (like startAutosave). */
export function startUndo(): void {
  resetUndo()
  // A set switch (also fired by library replacement / project load, which
  // mint a fresh set id) resets the stack. Whichever subscriber fires first,
  // the outcome is safe: reset re-seeds from the new state, and a re-record
  // of that same state is a no-op.
  activeSetId.subscribe(() => {
    resetUndo()
  })
  const watched = derived([activeSet, selectedId], ([$set, $selected]): UndoSnapshot => {
    return { trackIds: $set.trackIds, generated: $set.generated, selectedId: $selected }
  })
  watched.subscribe((snapshot) => {
    if (applying) return
    stack = record(stack, snapshot)
  })
}
