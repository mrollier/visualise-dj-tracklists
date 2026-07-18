import { tourStep } from '../stores'

/**
 * The guided tour (v12 WS12): a five-step overlay that fires the first time
 * the sample collection loads (and whenever replayed from the status ⓘ).
 * The app stays fully interactive underneath — each step invites doing, not
 * watching. Seen-state persists outside the project autosave so a Reset
 * never re-triggers it.
 */
export const TOUR_SEEN_KEY = 'visualise-dj-tracklists:tour-seen'

export function startTour(): void {
  tourStep.set(0)
}

export function maybeStartTour(): void {
  try {
    if (localStorage.getItem(TOUR_SEEN_KEY) === null) tourStep.set(0)
  } catch {
    // Storage unavailable: no tour bookkeeping, no tour loop either.
  }
}

export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_SEEN_KEY, '1')
  } catch {
    // Best-effort.
  }
}
