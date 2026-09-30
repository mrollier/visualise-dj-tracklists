import { ALL_TRACK_COLUMNS, DEFAULT_HIDDEN_COLUMNS } from './columns'
import { PANEL_FILTER_KEYS, type PanelFilterKey } from './marks'
import type { GenreSource, MetadataSource } from './model'
import { DEFAULT_VISIBLE_FILTERS } from './properties'
import type { TrackSortField } from './trackSort'

/**
 * Preferred BPM trajectory for generated sets: 'any' adds no preference,
 * 'sawtooth' builds up and drops back in cycles.
 */
export type BpmProgression = 'any' | 'steady' | 'rising' | 'falling' | 'sawtooth'

/**
 * Display / behaviour settings, adjustable in the Advanced menu and persisted
 * with the project. Anything that changes *what connects to what* lives in
 * CriteriaConfig or LibraryFilters instead — settings only shape presentation
 * and generation defaults.
 */
export interface AppSettings {
  /** Explicit theme choice; null = follow the system preference. */
  theme: 'light' | 'dark' | null
  /** Node colour scheme (per-theme ramps in scales.ts). */
  colorScheme: 'blue' | 'aqua' | 'violet'
  /**
   * Max angular fan-out of same-key tracks as a 0–2 factor (1 = classic ±4°,
   * 2 = node edge kisses the ±7.5° wedge boundary) — the hard bound of the
   * deterministic slot relaxation.
   */
  slotSpreadFactor: number
  /** Base opacity of suggestion edges. */
  edgeOpacity: number
  /**
   * Also draw the edges AMONG the selected track's neighbours. Off = just
   * the star around the selection; edges never draw without one.
   */
  focusClusterEdges: boolean
  /** Target number of tracks for the suggested-set generator. */
  suggestLength: number
  /** 0 = safest transitions, 1 = adventurous/dissonant sampling. */
  suggestRandomness: number
  /**
   * Steer suggested constellations away from two tracks by the same artist in
   * a row. A preference, not a rule: the generator still takes a same-artist
   * step when nothing else fits, and says so under the set.
   */
  avoidSameArtist: boolean
  /** Preferred BPM trajectory for generated sets. */
  bpmProgression: BpmProgression
  /**
   * How strongly a user-marked combo pulls suggested walks: 0–10,
   * default 5. 0 removes the preference (the marked pair still counts as an
   * edge), 10 lets it dominate every ordinary match.
   */
  manualEdgeWeight: number
  /**
   * The Tracks table's column ORDER — always every column; header drag
   * reorders this list. Visibility lives in hiddenColumns, so a
   * column keeps its position while hidden.
   */
  trackColumns: TrackSortField[]
  /** Columns currently hidden from the Tracks table. */
  hiddenColumns: TrackSortField[]
  /**
   * Which property filters appear in the left panel; the rest are hidden
   * until ticked in the advanced "Track properties" table. Also carries the
   * four permanent panel pseudo-keys ('starred'/'constellation'/'combos'/
   * 'keys') — same show/hide semantics, just not backed by a `TrackProperty`.
   */
  visibleFilters: (TrackSortField | PanelFilterKey)[]
  /**
   * Which advanced-menu sections the user has opened. Empty on first use —
   * every section starts folded; the menu then remembers.
   */
  advancedOpen: string[]
  /**
   * Easy mode: one hard toggle. Easy shows the wheel, Playlists, ✨ and the
   * set panel; criteria, filters, genres, advanced settings and the view/axis
   * controls hide behind their current values. It is not visibility-only,
   * though: easy also COMPUTES with sensible defaults via the effective-store
   * layer (stores.ts). The stored advanced state underneath is never
   * mutated, so toggling back restores it exactly.
   */
  uiMode: 'advanced' | 'easy'
  /**
   * The two side panels' visibility. Both on by default: this is the layout
   * the app has always had, so an older save with neither key resolves to
   * it. The THIRD panel — the audition bar across the top of the central
   * column — has no flag of its own; `audioPreview` below is that flag, since a
   * bar you cannot see is a bar you cannot stop.
   */
  showLeftPanel: boolean
  showRightPanel: boolean
  /**
   * Audio preview: show the two-deck audition bar under the top bar. Off by
   * default. A browser cannot open a file from `Track.location`, so
   * turning this on only reveals the bar — hearing anything additionally
   * needs the user to grant a music folder.
   */
  audioPreview: boolean
  /**
   * Ground truth for a track's key / BPM: Rekordbox's XML attribute, or the
   * Mixed In Key token in Comments. With 'comments', a track whose comment
   * has no parsable token keeps its Rekordbox value — flipping the setting
   * never blanks metadata. Energy has no source setting: it is always read
   * from Comments, because Rekordbox produces none.
   */
  keySource: MetadataSource
  bpmSource: MetadataSource
  /**
   * Genre ground truth: the collection's own field, or the analysis
   * sidecar's Discogs400 style prediction. Same never-blank rule as key and
   * BPM — with 'analysis', a track with no prediction, or one scoring below
   * `genreThreshold`, keeps the genre it already had.
   */
  genreSource: GenreSource
  /**
   * How sure a style prediction must be to be read, 0–1. Measured over the
   * 2046-track run behind this feature: at 0.3, 64% of the labels the library
   * already carries have a dominant predicted style (42% at 0, 85% at 0.5),
   * and 70% of tracks still get a prediction. It is a setting rather than a
   * constant because that trade is the user's to make.
   */
  genreThreshold: number
  /**
   * Ask the analysis helper to write the `[AxxVxxDxxHxx]` descriptor token
   * into each analysed file's comment tag. Off by default: it modifies
   * audio files on disk, and Rekordbox only sees the result after a Reload
   * Tags — which can overwrite Rekordbox-only fields.
   */
  analysisWriteTags: boolean
}

/**
 * The settings that shape the screen rather than what connects to what: which
 * panels show, the theme, what the menu keeps open. Undo leaves them alone,
 * "Return to default settings" keeps them, and easy mode never overrides them.
 */
export const CHROME_SETTINGS = [
  'theme',
  'uiMode',
  'advancedOpen',
  'audioPreview',
  'showLeftPanel',
  'showRightPanel',
] as const satisfies readonly (keyof AppSettings)[]

/** The chrome fields of `settings`, to lay over another settings object. */
export function chromeOf(
  settings: AppSettings,
): Pick<AppSettings, (typeof CHROME_SETTINGS)[number]> {
  const out: Partial<AppSettings> = {}
  for (const key of CHROME_SETTINGS) Object.assign(out, { [key]: settings[key] })
  return out as Pick<AppSettings, (typeof CHROME_SETTINGS)[number]>
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: null,
  colorScheme: 'blue',
  slotSpreadFactor: 1,
  edgeOpacity: 0.35,
  focusClusterEdges: false,
  suggestLength: 15,
  suggestRandomness: 0.25,
  avoidSameArtist: true,
  bpmProgression: 'any',
  manualEdgeWeight: 5,
  trackColumns: [...ALL_TRACK_COLUMNS],
  hiddenColumns: [...DEFAULT_HIDDEN_COLUMNS],
  visibleFilters: [...DEFAULT_VISIBLE_FILTERS, ...PANEL_FILTER_KEYS],
  advancedOpen: [],
  uiMode: 'advanced',
  showLeftPanel: true,
  showRightPanel: true,
  audioPreview: false,
  keySource: 'rekordbox',
  bpmSource: 'rekordbox',
  genreSource: 'rekordbox',
  genreThreshold: 0.3,
  analysisWriteTags: false,
}
