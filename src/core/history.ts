/**
 * Undo/redo for set edits, the selection, and — since v12 (WS14, ISSUES.md
 * stub) — the behavioural settings and criteria. Pure and immutable: the
 * store wiring in src/lib/undoStore.ts snapshots the active set's tracks
 * (with its generated flag, so undoing a generator overwrite restores both),
 * the selected track, and a serialised `tuning` string (settings sans the
 * chrome fields theme/uiMode/advancedOpen, plus the combo criteria — string
 * form keeps equality one `===` and cloning free). Deliberately NOT covered:
 * filters, set switching, and library replacement — the latter two reset the
 * stack.
 */
export interface UndoSnapshot {
  trackIds: string[]
  generated: boolean
  selectedId: string | null
  /** JSON of the behavioural settings + criteria; see undoStore.tuningOf. */
  tuning: string
  /** JSON of the manual edges (v12 WS9) — a mark toggle is a work edit. */
  marks: string
}

export interface UndoStack {
  past: UndoSnapshot[]
  present: UndoSnapshot
  future: UndoSnapshot[]
}

const DEFAULT_LIMIT = 100

/** Equality of the WORK parts (tracks, flag, selection) — tuning ignored, so
 * the store layer can tell a settings tweak from a set edit and debounce it. */
export function sameWork(a: UndoSnapshot, b: UndoSnapshot): boolean {
  return (
    a.generated === b.generated &&
    a.selectedId === b.selectedId &&
    a.marks === b.marks &&
    a.trackIds.length === b.trackIds.length &&
    a.trackIds.every((id, i) => id === b.trackIds[i])
  )
}

function sameSnapshot(a: UndoSnapshot, b: UndoSnapshot): boolean {
  return sameWork(a, b) && a.tuning === b.tuning
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
