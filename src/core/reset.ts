import { DEFAULT_CRITERIA, type CriteriaConfig } from './combos'
import { DEFAULT_SETTINGS, type AppSettings } from './settings'

/**
 * "Return to default settings" (v9 issue 3): reset everything the Advanced
 * panel owns and nothing else. Filters, playlists, sets and pins are never
 * touched; the theme lives in the top bar and the section-fold memory is UI
 * chrome, so both survive. Audio preview (v28) survives too: silently
 * unlinking someone's music folder is the same class of surprise as flipping
 * their theme. So does which panels are collapsed (v30) — re-opening panels
 * someone deliberately put away is that same surprise again.
 */
export function resetAdvancedSettings(current: AppSettings): AppSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    theme: current.theme,
    advancedOpen: [...current.advancedOpen],
    showLeftPanel: current.showLeftPanel,
    showRightPanel: current.showRightPanel,
    audioPreview: current.audioPreview,
  }
}

/**
 * The criteria fields the Advanced panel controls (genre method/mode/k/
 * threshold, the key move toggles, the BPM metric ratios) go back to their
 * defaults; the combo panel's own knobs (enabled flags, BPM tolerance, year
 * window, N-of-M threshold) stay as they are.
 */
export function resetAdvancedCriteria(current: CriteriaConfig): CriteriaConfig {
  const defaults = structuredClone(DEFAULT_CRITERIA)
  return {
    ...current,
    key: {
      ...current.key,
      plusTwo: defaults.key.plusTwo,
      plusSeven: defaults.key.plusSeven,
      vinylMode: defaults.key.vinylMode,
    },
    bpm: {
      ...current.bpm,
      unitTime: defaults.bpm.unitTime,
      halfDouble: defaults.bpm.halfDouble,
      twoThirds: defaults.bpm.twoThirds,
    },
    genre: {
      ...current.genre,
      method: defaults.genre.method,
      mode: defaults.genre.mode,
      k: defaults.genre.k,
      threshold: defaults.genre.threshold,
    },
  }
}
