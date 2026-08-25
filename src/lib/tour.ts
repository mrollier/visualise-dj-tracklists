import { get, writable } from 'svelte/store'
import { EASY_CRITERIA } from '../core/combos'
import type { Project } from '../core/persist'
import type { AppSettings } from '../core/settings'
import { applyProject, currentProject, loadSampleCollection } from './persistence'
import { criteria, library, rightPanel, settings, tourStep, viewMode } from '../stores'

/**
 * The guided tour (v12 WS12; rebuilt v16 #12): a spotlight coachmark walk
 * through the whole app. It runs on a controlled demo state — the Classic
 * pack with just Key + BPM criteria — so every step reads simply. On a replay
 * it first snapshots the user's real work, and the last step offers to restore
 * it. Seen-state persists outside the project autosave so a Reset never
 * re-triggers it.
 */
const TOUR_SEEN_KEY = 'visualise-dj-tracklists:tour-seen'

/**
 * The project captured when the tour was replayed over real work, so the
 * end-of-tour "return to my work" choice can restore it. Null on first-run —
 * nothing preceded the tour, so there is nothing to go back to.
 */
export const tourSnapshot = writable<Project | null>(null)

/**
 * The three panel switches as they stood before the tour (v29 #9, widened in
 * v30). The tour turns all three on, since every step points at something
 * inside one of them, and puts them back at the end — a guided tour has no
 * business leaving a default-off feature on, or re-opening a panel someone
 * deliberately put away.
 */
type PanelSwitches = Pick<AppSettings, 'audioPreview' | 'showLeftPanel' | 'showRightPanel'>
let panelsBefore: PanelSwitches | null = null

/**
 * Put the app in the reproducible teaching view: Key + BPM criteria only (so
 * combos read simply), the wheel centre view, the constellation panel (not
 * advanced), full mode, and all three panels showing — so every element a step
 * points at is on screen. Ephemeral view state (viewMode/rightPanel) isn't
 * part of the snapshot, so it isn't restored; the library/criteria/filters/
 * sets are, and the panel switches are put back by `endTour`.
 */
function enterDemoView(): void {
  criteria.set(structuredClone(EASY_CRITERIA))
  viewMode.set('wheel')
  rightPanel.set('set')
  const { audioPreview, showLeftPanel, showRightPanel } = get(settings)
  panelsBefore = { audioPreview, showLeftPanel, showRightPanel }
  settings.update((s) => ({
    ...s,
    uiMode: 'advanced',
    audioPreview: true,
    showLeftPanel: true,
    showRightPanel: true,
  }))
}

/** Load the Classic demo (auto-selected) and drop into the demo view. */
function loadDemoState(): void {
  loadSampleCollection()
  enterDemoView()
}

/** Replay from Advanced / the header: snapshot the current work first (so the
 *  tour's end can offer to restore it), then drop into the demo state. */
export function startTour(): void {
  // Re-entrant call = the snapshot is overwritten with the demo and the
  // user's real library is gone. The replay button stays clickable during the
  // tour (the backdrop is pointer-events: none), so this is reachable.
  if (get(tourStep) !== null) return
  tourSnapshot.set(get(library).length > 0 ? currentProject() : null)
  loadDemoState()
  tourStep.set(0)
}

/** First-ever sample load: the sample is already loaded by the caller, so just
 *  enter the demo view. Nothing to snapshot or restore. */
export function maybeStartTour(): void {
  try {
    if (localStorage.getItem(TOUR_SEEN_KEY) !== null) return
  } catch {
    // Storage unavailable: no tour bookkeeping, no tour either.
    return
  }
  tourSnapshot.set(null)
  enterDemoView()
  tourStep.set(0)
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1')
  } catch {
    // Best-effort.
  }
}

/** End the tour. On a replay, optionally restore the snapshot taken at start;
 *  either way, mark it seen and clear the snapshot. */
export function endTour(restore: boolean): void {
  markTourSeen()
  const snap = get(tourSnapshot)
  const restored = restore && snap !== null
  if (restored) applyProject(snap)
  // Put the three panel switches back where the tour found them. `applyProject`
  // does it already on the "return to my work" exit, since settings are part of
  // the snapshot — but the other exit leaves the demo state standing, and a
  // first-run tour has no snapshot at all. An explicit switch-off during the
  // tour is left alone: only a switch the tour itself still has turned on is
  // reverted.
  const before = panelsBefore
  if (!restored && before !== null) {
    settings.update((s) => ({
      ...s,
      audioPreview: s.audioPreview ? before.audioPreview : s.audioPreview,
      showLeftPanel: s.showLeftPanel ? before.showLeftPanel : s.showLeftPanel,
      showRightPanel: s.showRightPanel ? before.showRightPanel : s.showRightPanel,
    }))
  }
  panelsBefore = null
  tourSnapshot.set(null)
  tourStep.set(null)
}
