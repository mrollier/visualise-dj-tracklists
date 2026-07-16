/**
 * Undo/redo for set edits and the selection (issue 2). Pure and immutable:
 * the store wiring in src/lib/undoStore.ts snapshots the active set's tracks
 * (with its generated flag, so undoing a generator overwrite restores both)
 * plus the selected track. Deliberately NOT covered: settings, filters,
 * criteria, set switching, and library replacement — those reset the stack.
 */
export interface UndoSnapshot {
  trackIds: string[]
  generated: boolean
  selectedId: string | null
}

export interface UndoStack {
  past: UndoSnapshot[]
  present: UndoSnapshot
  future: UndoSnapshot[]
}

const DEFAULT_LIMIT = 100

function sameSnapshot(a: UndoSnapshot, b: UndoSnapshot): boolean {
  return (
    a.generated === b.generated &&
    a.selectedId === b.selectedId &&
    a.trackIds.length === b.trackIds.length &&
    a.trackIds.every((id, i) => id === b.trackIds[i])
  )
}

export function initStack(present: UndoSnapshot): UndoStack {
  return { past: [], present, future: [] }
}

/** Push a new state; a deep-equal snapshot is a no-op, and redo clears. */
export function record(stack: UndoStack, next: UndoSnapshot, limit = DEFAULT_LIMIT): UndoStack {
  if (sameSnapshot(stack.present, next)) return stack
  const past = [...stack.past, stack.present]
  return { past: past.slice(Math.max(0, past.length - limit)), present: next, future: [] }
}

export function undo(stack: UndoStack): UndoStack | null {
  const previous = stack.past.at(-1)
  if (previous === undefined) return null
  return {
    past: stack.past.slice(0, -1),
    present: previous,
    future: [stack.present, ...stack.future],
  }
}

export function redo(stack: UndoStack): UndoStack | null {
  const [next, ...rest] = stack.future
  if (next === undefined) return null
  return { past: [...stack.past, stack.present], present: next, future: rest }
}
