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
import {
  activeSet,
  activeSetId,
  criteria,
  manualEdges,
  mustInclude,
  pinnedFirst,
  pinnedLast,
  selectedId,
  setGeneratedTracklist,
  settings,
  tracklist,
} from '../stores'

/**
 * Cmd+Z wiring (issue 2; widened by v12 WS14): snapshots the ACTIVE set's
 * tracks (+ generated flag), the selection, and the behavioural settings +
 * criteria on every change, unless the change came from an undo/redo itself.
 * Settings-only changes are DEBOUNCED (a slider drag lands as one step, not
 * fifty) and the chrome fields — theme, uiMode, advancedOpen — stay out of
 * the tuning entirely: undo never flips the theme or slams easy mode. The
 * stack resets on set switches and library replacement — undo never
 * resurrects one set's tracks into another.
 */

const TUNING_DEBOUNCE_MS = 350

interface Pins {
  mustInclude: string[]
  pinnedFirst: string | null
  pinnedLast: string | null
}

function pinsOf($mustInclude: string[], $first: string | null, $last: string | null): string {
  return JSON.stringify({ mustInclude: $mustInclude, pinnedFirst: $first, pinnedLast: $last })
}

let stack: UndoStack = initStack({
  trackIds: [],
  generated: false,
  selectedId: null,
  tuning: '{}',
  marks: '[]',
  pins: pinsOf([], null, null),
})
let applying = false
let pending: UndoSnapshot | null = null
let pendingTimer: ReturnType<typeof setTimeout> | undefined

function tuningOf($settings: AppSettings, $criteria: CriteriaConfig): string {
  const behavioural: Partial<AppSettings> = { ...$settings }
  delete behavioural.theme
  delete behavioural.uiMode
  delete behavioural.advancedOpen
  return JSON.stringify({ settings: behavioural, criteria: $criteria })
}

function currentSnapshot(): UndoSnapshot {
  const set = get(activeSet)
  return {
    trackIds: set.trackIds,
    generated: set.generated,
    selectedId: get(selectedId),
    tuning: tuningOf(get(settings), get(criteria)),
    marks: JSON.stringify(get(manualEdges)),
    pins: pinsOf(get(mustInclude), get(pinnedFirst), get(pinnedLast)),
  }
}

function applySnapshot(snapshot: UndoSnapshot): void {
  applying = true
  try {
    if (snapshot.generated) setGeneratedTracklist(snapshot.trackIds)
    else tracklist.set(snapshot.trackIds)
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
    const pins = JSON.parse(snapshot.pins) as Pins
    mustInclude.set(pins.mustInclude)
    pinnedFirst.set(pins.pinnedFirst)
    pinnedLast.set(pins.pinnedLast)
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
    [activeSet, selectedId, settings, criteria, manualEdges, mustInclude, pinnedFirst, pinnedLast],
    ([
      $set,
      $selected,
      $settings,
      $criteria,
      $manualEdges,
      $mustInclude,
      $pinnedFirst,
      $pinnedLast,
    ]): UndoSnapshot => {
      return {
        trackIds: $set.trackIds,
        generated: $set.generated,
        selectedId: $selected,
        tuning: tuningOf($settings, $criteria),
        marks: JSON.stringify($manualEdges),
        pins: pinsOf($mustInclude, $pinnedFirst, $pinnedLast),
      }
    },
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
