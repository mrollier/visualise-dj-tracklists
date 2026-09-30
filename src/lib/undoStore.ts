import { derived, get } from 'svelte/store'
import type { CriteriaConfig } from '../core/combos'
import {
  initStack,
  record,
  redo,
  sameWork,
  undo,
  type UndoSnapshot,
  type UndoStack,
} from '../core/history'
import type { ManualEdge } from '../core/model'
import type { AppSettings } from '../core/settings'
import type { TrackSet } from '../core/sets'
import {
  activeSet,
  activeSetId,
  criteria,
  manualEdges,
  patchActiveSet,
  selectedId,
  settings,
} from '../stores'

/**
 * Cmd+Z wiring: snapshots the ACTIVE set's tracks (+ generated flag) and
 * marks, the selection, the manual edges, and the behavioural settings +
 * criteria on every change, unless the change came from an undo/redo itself.
 * Settings-only changes are DEBOUNCED (a slider drag lands as one step, not
 * fifty) and the chrome fields — theme, uiMode, advancedOpen — stay out of
 * the tuning entirely: undo never flips the theme or slams easy mode. The
 * stack resets on set switches and library replacement — undo never
 * resurrects one set's tracks into another.
 */

const TUNING_DEBOUNCE_MS = 350

type Pins = Pick<TrackSet, 'mustInclude' | 'pinnedFirst' | 'pinnedLast'>

function pinsOf({ mustInclude, pinnedFirst, pinnedLast }: Pins): string {
  return JSON.stringify({ mustInclude, pinnedFirst, pinnedLast })
}

let stack: UndoStack = initStack({
  trackIds: [],
  generated: false,
  selectedId: null,
  tuning: '{}',
  marks: '[]',
  pins: pinsOf({ mustInclude: [], pinnedFirst: null, pinnedLast: null }),
})
let applying = false
let pending: UndoSnapshot | null = null
let pendingTimer: ReturnType<typeof setTimeout> | undefined

function tuningOf($settings: AppSettings, $criteria: CriteriaConfig): string {
  const behavioural: Partial<AppSettings> = { ...$settings }
  delete behavioural.theme
  delete behavioural.uiMode
  delete behavioural.advancedOpen
  // v28: undoing this would tear down a live AudioContext and stop the
  // music as a side effect of a Cmd+Z pressed for something else.
  delete behavioural.audioPreview
  // v30: same argument for the furniture. A Cmd+Z pressed for a set edit has
  // no business re-opening a panel the user put away.
  delete behavioural.showLeftPanel
  delete behavioural.showRightPanel
  return JSON.stringify({ settings: behavioural, criteria: $criteria })
}

function snapshotOf(
  set: TrackSet,
  selected: string | null,
  $settings: AppSettings,
  $criteria: CriteriaConfig,
  edges: ManualEdge[],
): UndoSnapshot {
  return {
    trackIds: set.trackIds,
    generated: set.generated,
    selectedId: selected,
    tuning: tuningOf($settings, $criteria),
    marks: JSON.stringify(edges),
    pins: pinsOf(set),
  }
}

function currentSnapshot(): UndoSnapshot {
  return snapshotOf(get(activeSet), get(selectedId), get(settings), get(criteria), get(manualEdges))
}

function applySnapshot(snapshot: UndoSnapshot): void {
  applying = true
  try {
    // Tracks and marks live on the set: one write restores them together.
    patchActiveSet({
      trackIds: snapshot.trackIds,
      generated: snapshot.generated,
      ...(JSON.parse(snapshot.pins) as Pins),
    })
    selectedId.set(snapshot.selectedId)
    const parsed = JSON.parse(snapshot.tuning) as {
      settings?: Partial<AppSettings>
      criteria?: CriteriaConfig
    }
    if (parsed.settings !== undefined) {
      // The chrome fields keep their live values — they were never captured.
      settings.update((s) => ({ ...s, ...parsed.settings }))
    }
    if (parsed.criteria !== undefined) criteria.set(parsed.criteria)
    manualEdges.set(JSON.parse(snapshot.marks) as ManualEdge[])
  } finally {
    applying = false
  }
}

function flushPending(): void {
  clearTimeout(pendingTimer)
  if (pending !== null) {
    stack = record(stack, pending)
    pending = null
  }
}

/** Forget all history and re-seed from the current state. */
export function resetUndo(): void {
  clearTimeout(pendingTimer)
  pending = null
  stack = initStack(currentSnapshot())
}

export function undoOnce(): void {
  flushPending()
  const next = undo(stack)
  if (next === null) return
  stack = next
  applySnapshot(stack.present)
}

export function redoOnce(): void {
  flushPending()
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
  const watched = derived(
    [activeSet, selectedId, settings, criteria, manualEdges],
    ([$set, $selected, $settings, $criteria, $manualEdges]) =>
      snapshotOf($set, $selected, $settings, $criteria, $manualEdges),
  )
  watched.subscribe((snapshot) => {
    if (applying) return
    if (sameWork(stack.present, snapshot) && stack.present.tuning === snapshot.tuning) return
    if (sameWork(stack.present, snapshot)) {
      // Only the tuning moved: coalesce a burst (slider drag, spinner hold)
      // into one undo step, recorded when the burst goes quiet.
      pending = snapshot
      clearTimeout(pendingTimer)
      pendingTimer = setTimeout(flushPending, TUNING_DEBOUNCE_MS)
    } else {
      // A real edit: any tweak just before it becomes its own step first,
      // preserving order.
      flushPending()
      stack = record(stack, snapshot)
    }
  })
}
