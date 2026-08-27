import { migrateColumns } from './columns'
import { DEFAULT_CRITERIA, demandedCount, type CriteriaConfig } from './combos'
import { migrateFilters, type LibraryFilters } from './filter'
import { normalizeKey } from './keys'
import { PANEL_FILTER_KEYS, PANEL_FILTERS } from './marks'
import { energyFromComments, type ManualEdge, type Playlist, type Track } from './model'
import { TRACK_PROPERTIES } from './properties'
import {
  freshFirstSet,
  MAX_SETS,
  newSetId,
  ordinalSetName,
  shortenLegacySetName,
  uniqueSetName,
  type TrackSet,
} from './sets'
import { DEFAULT_SETTINGS, type AppSettings } from './settings'
import { sanitizeAnalysis, type AnalysisSidecar } from './analysis'

/**
 * A saved project: the whole app state as one JSON document. Used both for
 * explicit save/load (a .json file the user keeps) and localStorage autosave.
 * Version history: v1 (no filters/settings, criteria had a rating criterion),
 * v2 (filters + settings + colour axis; rating became a filter),
 * v3 (multiple named sets replace the single tracklist — issue 18),
 * v4 (filters carry a per-property range map — v11 issue 1),
 * v5 (manual edges — planning annotations, v12 WS9),
 * v6 (v14: text filter kind split into alpha/contains/colour/quality, so old
 *  stored text ranges are dropped on load — WS2; per-criterion `demanded`
 *  flags — WS4; per-track `isVinyl` dropped — WS1; `slotSpreadFactor` clamp
 *  widened to 0–2 — WS7; `manualEdgeWeight` setting — WS5),
 * v7 (F5: filters `keyRing` string enum → `keyRings` {minor,major} toggle
 *  pair; quality range `{quality}` → `{qualities: []}`, where an empty array
 *  is the "both-off" state — old shapes migrate on load),
 * v8 (v23: ★ Starred, 🔗 Combos and 🎵 Keys become permanent left-panel
 *  pseudo-rows — a save older than v8 back-fills all three into
 *  `settings.visibleFilters` on load, since v8+ is trusted verbatim a
 *  deliberate hide made afterwards sticks),
 * v9 (Energy joins Key/BPM/Genre/Year as a 5th combo criterion — a save
 *  older than v9 has no `criteria.energy`; migrateCriteria fills it from
 *  DEFAULT_CRITERIA.energy, so an old save gains the field enabled with
 *  the default 2-step tolerance rather than failing to evaluate it),
 * v10 (v25: ☰ Constellation joins ★ Starred/🔗 Combos/♪ Keys as a fourth
 *  permanent left-panel pseudo-row — a save older than v10 back-fills it
 *  into `settings.visibleFilters` on load, same as v8's three-row
 *  back-fill; `filters.marks.constellationOnly` needs no migration since
 *  marks are always reset to both/all-off on load regardless of version).
 */
export interface Project {
  version: 10
  libraryName: string
  tracks: Track[]
  criteria: CriteriaConfig
  filters: LibraryFilters
  settings: AppSettings
  /** Named sets; always at least one. */
  sets: TrackSet[]
  /** User-marked "these mix well" pairs (v12 WS9) — planning, never a log. */
  manualEdges: ManualEdge[]
  /** Which set is being edited; always one of `sets`. */
  activeSetId: string
  /** Playlists from the source library (Rekordbox XML); [] elsewhere. */
  playlists: Playlist[]
  radialAxis: 'bpm' | 'rating' | 'year' | 'energy'
  colorAxis: 'auto' | 'bpm' | 'rating' | 'year' | 'energy'
  /**
   * Audio-analysis results, keyed by file path (v33 WS1). Fills metadata
   * Rekordbox left null; never overwrites what Rekordbox supplied. Additive,
   * so the schema stays at 10 — see the note in `parseProject`.
   */
  analysis: AnalysisSidecar | null
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2)
}

/** A non-null, non-array object — the shape every hand-edited sub-record must have. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Coerce a stored value to a finite number, else fall back to `fallback`. The
 * optional bounds pick one of the two out-of-range policies the persisted
 * knobs need:
 * - `mode: 'clamp'` — an in-range-or-clampable value survives, pulled to the
 *   nearest bound (slotSpreadFactor, edgeOpacity, suggestRandomness, …).
 * - `mode: 'reject'` — only an already-in-range value survives; anything
 *   outside resets to `fallback`, never clamped (manualEdgeWeight).
 * With no bounds it is a plain finite-or-default guard (jitterSeed).
 */
function finiteOr(
  value: unknown,
  fallback: number,
  bounds?: { min: number; max: number; mode: 'clamp' | 'reject' },
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (bounds === undefined) return value
  if (bounds.mode === 'clamp') return Math.max(bounds.min, Math.min(bounds.max, value))
  return value < bounds.min || value > bounds.max ? fallback : value
}

/** Upgrade a v1 criteria object: drop rating, add genre method/threshold. */
function migrateCriteria(raw: Record<string, unknown>): CriteriaConfig {
  const defaults = structuredClone(DEFAULT_CRITERIA)
  const genre = (raw.genre ?? {}) as Partial<CriteriaConfig['genre']>
  // Saves from before the split carried a single advancedMoves toggle
  // covering both the +2 and +7-semitone moves — fan it out to both flags.
  const key = (raw.key ?? {}) as Partial<CriteriaConfig['key']> & { advancedMoves?: boolean }
  // v14 (WS4): `demanded` locks a criterion as mandatory. The whitelist reads
  // it explicitly with `=== true` coercion so a non-boolean in a hand-edited
  // save (or its absence in an old one) becomes a clean false, never leaks.
  const bpm = (raw.bpm ?? {}) as Partial<CriteriaConfig['bpm']>
  const energy = (raw.energy ?? {}) as Partial<CriteriaConfig['energy']>
  const year = (raw.year ?? {}) as Partial<CriteriaConfig['year']>
  const criteria: CriteriaConfig = {
    key: {
      enabled: key.enabled ?? defaults.key.enabled,
      plusTwo: key.plusTwo ?? key.advancedMoves ?? defaults.key.plusTwo,
      plusSeven: key.plusSeven ?? key.advancedMoves ?? defaults.key.plusSeven,
      vinylMode: key.vinylMode ?? defaults.key.vinylMode,
      demanded: key.demanded === true,
    },
    bpm: {
      enabled: bpm.enabled ?? defaults.bpm.enabled,
      maxPercent: bpm.maxPercent ?? defaults.bpm.maxPercent,
      unitTime: bpm.unitTime ?? defaults.bpm.unitTime,
      halfDouble: bpm.halfDouble ?? defaults.bpm.halfDouble,
      twoThirds: bpm.twoThirds ?? defaults.bpm.twoThirds,
      demanded: bpm.demanded === true,
    },
    energy: {
      enabled: energy.enabled ?? defaults.energy.enabled,
      maxSteps: energy.maxSteps ?? defaults.energy.maxSteps,
      demanded: energy.demanded === true,
    },
    genre: {
      enabled: genre.enabled ?? defaults.genre.enabled,
      method: genre.method ?? defaults.genre.method,
      // Projects saved before mutual top-k existed keep their threshold
      // semantics untouched; only fresh configs default to 'topk'.
      mode: genre.mode ?? (genre.threshold !== undefined ? 'threshold' : defaults.genre.mode),
      k: genre.k ?? defaults.genre.k,
      threshold: genre.threshold ?? defaults.genre.threshold,
      demanded: genre.demanded === true,
    },
    year: {
      enabled: year.enabled ?? defaults.year.enabled,
      maxYears: year.maxYears ?? defaults.year.maxYears,
      demanded: year.demanded === true,
    },
    threshold: typeof raw.threshold === 'number' ? raw.threshold : defaults.threshold,
  }
  // 0 is a deliberate "require nothing" since v11 (issue 2a).
  criteria.threshold = Math.max(0, Math.min(5, criteria.threshold))
  // v14 C2: a demanded criterion is mandatory, so the threshold can never sit
  // below the demanded count — floor it after the clamp.
  criteria.threshold = Math.max(criteria.threshold, demandedCount(criteria))
  return criteria
}

/**
 * Guard one stored track: project files are hand-editable JSON, so nothing
 * in them is trusted. Entries without a string id/title are dropped;
 * wrong-typed optional fields become missing rather than poisoning the app.
 */
function sanitizeTrack(raw: unknown): Track | null {
  if (!isRecord(raw)) return null
  const entry = raw
  // The empty string is the suggestion engine's "no successor" sentinel
  // (suggest.ts), so a track may never carry it as an id — sanitizeSet has
  // rejected it since v3; this is the same rule one layer up.
  if (typeof entry.id !== 'string' || entry.id === '' || typeof entry.title !== 'string')
    return null
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
  return {
    id: entry.id,
    title: entry.title,
    artist: str(entry.artist),
    key: normalizeKey(str(entry.key)),
    bpm: num(entry.bpm),
    genre: str(entry.genre),
    year: num(entry.year),
    rating: num(entry.rating),
    durationSec: num(entry.durationSec),
    album: str(entry.album),
    dateAdded: str(entry.dateAdded),
    location: str(entry.location),
    composer: str(entry.composer),
    grouping: str(entry.grouping),
    kind: str(entry.kind),
    size: num(entry.size),
    discNumber: num(entry.discNumber),
    trackNumber: num(entry.trackNumber),
    bitRate: num(entry.bitRate),
    sampleRate: num(entry.sampleRate),
    comments: str(entry.comments),
    // Older saves carry Comments but no energy — derive it here (v12 WS8) so
    // an existing project gains the field without a re-import.
    energy: num(entry.energy) ?? energyFromComments(str(entry.comments)),
    // v35 descriptors. Only the analysis merge ever sets these, and the merge
    // re-runs from the persisted sidecar on load, so in practice they arrive
    // null here — the lines exist so a save that does carry them survives.
    arousal: num(entry.arousal),
    valence: num(entry.valence),
    danceability: num(entry.danceability),
    happiness: num(entry.happiness),
    playCount: num(entry.playCount),
    remixer: str(entry.remixer),
    label: str(entry.label),
    mix: str(entry.mix),
    colour: str(entry.colour),
    dateModified: str(entry.dateModified),
    lastPlayed: str(entry.lastPlayed),
  }
}

/**
 * Guard one stored set the same way tracks are guarded: wrong-typed entries
 * are dropped or defaulted, unknown track ids pruned per set.
 */
function sanitizeSet(raw: unknown, knownIds: Set<string>, index: number): TrackSet | null {
  if (!isRecord(raw)) return null
  const entry = raw
  const trackIds = Array.isArray(entry.trackIds)
    ? (entry.trackIds as unknown[]).filter(
        (id): id is string => typeof id === 'string' && knownIds.has(id),
      )
    : []
  return {
    id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : newSetId(),
    name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : ordinalSetName(index),
    trackIds,
    generated: entry.generated === true,
  }
}

/**
 * Guard one stored playlist: playlists mirror the source library (Rekordbox
 * XML), so a valid entry needs a non-empty name and a string-only id list.
 * Unknown ids are left intact — they are inert here and pruning them would
 * alter a valid save; only structurally malformed entries are dropped.
 */
function sanitizePlaylist(raw: unknown): Playlist | null {
  if (!isRecord(raw)) return null
  if (typeof raw.name !== 'string' || raw.name === '') return null
  const trackIds = Array.isArray(raw.trackIds)
    ? raw.trackIds.filter((id): id is string => typeof id === 'string')
    : []
  return { name: raw.name, trackIds }
}

export function parseProject(json: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Not a valid project file: could not parse JSON')
  }
  if (!isRecord(raw)) {
    throw new Error('Not a valid project file: the document is not an object')
  }
  const p = raw as Record<string, unknown> & { version?: number; tracklist?: unknown }
  if (
    p.version !== 1 &&
    p.version !== 2 &&
    p.version !== 3 &&
    p.version !== 4 &&
    p.version !== 5 &&
    p.version !== 6 &&
    p.version !== 7 &&
    p.version !== 8 &&
    p.version !== 9 &&
    p.version !== 10
  ) {
    throw new Error(`Unsupported project version: ${String(p.version)}`)
  }
  // v23: threaded through to the visibleFilters back-fill below, gating it
  // so a save already at schema 8+ is trusted verbatim — re-reading `raw`
  // there would work too, but this is the value already validated above.
  const version = Number(p.version)
  const hasSetShape = Array.isArray(p.sets) || Array.isArray(p.tracklist)
  if (!Array.isArray(p.tracks) || !hasSetShape || !isRecord(p.criteria)) {
    throw new Error('Not a valid project file: missing tracks, sets or criteria')
  }
  // Both track views key their {#each} on track.id, so a duplicate is not a
  // cosmetic problem: Svelte throws each_key_duplicate and the table and the
  // wheel stop rendering. First entry wins, the rest are dropped.
  const knownIds = new Set<string>()
  const tracks: Track[] = []
  for (const raw of p.tracks as unknown[]) {
    const track = sanitizeTrack(raw)
    if (track === null || knownIds.has(track.id)) continue
    knownIds.add(track.id)
    tracks.push(track)
  }
  // v1/v2 carried one flat tracklist — it becomes the (un-generated) First
  // Set. v3 sets are sanitized per entry; nothing valid left = one empty set.
  let sets: TrackSet[]
  if (Array.isArray(p.sets)) {
    sets = (p.sets as unknown[])
      .map((entry, i) => sanitizeSet(entry, knownIds, i))
      .filter((s): s is TrackSet => s !== null)
  } else {
    const oldList = (p.tracklist as unknown[]).filter(
      (id): id is string => typeof id === 'string' && knownIds.has(id),
    )
    sets = [freshFirstSet(oldList)]
  }
  if (sets.length === 0) sets = [freshFirstSet()]
  // The sets are the suggestion browser (v8 issue 18): a hand-edited save
  // with more than the cap keeps its first MAX_SETS entries.
  sets = sets.slice(0, MAX_SETS)
  // v17: pre-v17 saves carried the noun in the default names ("First
  // Constellation"); strip it so old work matches the new short defaults.
  // v9 (issue 18): saves that already carry duplicate names get the same
  // auto-suffix a rename would — run after the shortening, which can itself
  // create a clash.
  const seenNames: string[] = []
  sets = sets.map((s) => {
    const name = uniqueSetName(shortenLegacySetName(s.name), seenNames)
    seenNames.push(name)
    return name === s.name ? s : { ...s, name }
  })
  const activeSetId =
    typeof p.activeSetId === 'string' && sets.some((s) => s.id === p.activeSetId)
      ? p.activeSetId
      : sets[0].id
  const rawSettings = (p.settings ?? {}) as Partial<AppSettings> & { slotSpreadDeg?: number }
  // v9 (issue 12): trackColumns became the full ordering + a hidden list;
  // older partial lists keep their order and visible set.
  const columns = migrateColumns(rawSettings.trackColumns, rawSettings.hiddenColumns)
  // v7: the same-key spread became a 0–1 factor of the ±7.5° half-slot window;
  // older saves stored degrees (capped at 7.5; pre-v5 allowed 15/20). v14
  // (WS7): the factor slider widened to 0–2. Either source clamps into [0, 2],
  // a non-finite value falling back to the default (never NaN through).
  const slotSpreadDeg = rawSettings.slotSpreadDeg
  const slotSpreadFactor =
    typeof slotSpreadDeg === 'number' && rawSettings.slotSpreadFactor === undefined
      ? finiteOr(slotSpreadDeg / 7.5, DEFAULT_SETTINGS.slotSpreadFactor, {
          min: 0,
          max: 2,
          mode: 'clamp',
        })
      : finiteOr(rawSettings.slotSpreadFactor, DEFAULT_SETTINGS.slotSpreadFactor, {
          min: 0,
          max: 2,
          mode: 'clamp',
        })
  // Every field is rebuilt explicitly from the untrusted save: a value that
  // fails its type/range check resolves to the default rather than leaking
  // through. Because only known keys are ever copied, no stray property can
  // enter — the old spread needed a Reflect.deleteProperty to undo the
  // slotSpreadDeg leak; that is gone. Field order mirrors AppSettings so a
  // valid save still serializes byte-identically.
  const settings: AppSettings = {
    theme:
      rawSettings.theme === 'light' || rawSettings.theme === 'dark' || rawSettings.theme === null
        ? rawSettings.theme
        : DEFAULT_SETTINGS.theme,
    colorScheme:
      rawSettings.colorScheme === 'blue' ||
      rawSettings.colorScheme === 'aqua' ||
      rawSettings.colorScheme === 'violet'
        ? rawSettings.colorScheme
        : DEFAULT_SETTINGS.colorScheme,
    slotSpreadFactor,
    // Dead knob since v9 but persisted: keep any finite stored value.
    jitterSeed: finiteOr(rawSettings.jitterSeed, DEFAULT_SETTINGS.jitterSeed),
    // Slider range 0–0.9 (AdvancedMenu.svelte).
    edgeOpacity: finiteOr(rawSettings.edgeOpacity, DEFAULT_SETTINGS.edgeOpacity, {
      min: 0,
      max: 0.9,
      mode: 'clamp',
    }),
    focusClusterEdges:
      typeof rawSettings.focusClusterEdges === 'boolean'
        ? rawSettings.focusClusterEdges
        : DEFAULT_SETTINGS.focusClusterEdges,
    // Number input 2–99 (AdvancedMenu.svelte); a fractional entry rounds.
    suggestLength: Math.round(
      finiteOr(rawSettings.suggestLength, DEFAULT_SETTINGS.suggestLength, {
        min: 2,
        max: 99,
        mode: 'clamp',
      }),
    ),
    // Slider range 0–1 (AdvancedMenu.svelte).
    suggestRandomness: finiteOr(rawSettings.suggestRandomness, DEFAULT_SETTINGS.suggestRandomness, {
      min: 0,
      max: 1,
      mode: 'clamp',
    }),
    // v31: additive boolean, no version bump — an older save with no key
    // resolves to true, the preference the generator now ships with.
    avoidSameArtist:
      typeof rawSettings.avoidSameArtist === 'boolean'
        ? rawSettings.avoidSameArtist
        : DEFAULT_SETTINGS.avoidSameArtist,
    iconMode:
      rawSettings.iconMode === 'families' ||
      rawSettings.iconMode === 'playlists' ||
      rawSettings.iconMode === 'clusters'
        ? rawSettings.iconMode
        : DEFAULT_SETTINGS.iconMode,
    // Number input 1–8 (AdvancedMenu.svelte); a fractional entry rounds.
    maxGenreClasses: Math.round(
      finiteOr(rawSettings.maxGenreClasses, DEFAULT_SETTINGS.maxGenreClasses, {
        min: 1,
        max: 8,
        mode: 'clamp',
      }),
    ),
    bpmProgression:
      rawSettings.bpmProgression === 'any' ||
      rawSettings.bpmProgression === 'steady' ||
      rawSettings.bpmProgression === 'rising' ||
      rawSettings.bpmProgression === 'falling' ||
      rawSettings.bpmProgression === 'sawtooth'
        ? rawSettings.bpmProgression
        : DEFAULT_SETTINGS.bpmProgression,
    // v14 (WS5): the manual-combo pull is a 0–10 knob; out-of-range resets to
    // the default rather than clamping (reject mode).
    manualEdgeWeight: finiteOr(rawSettings.manualEdgeWeight, DEFAULT_SETTINGS.manualEdgeWeight, {
      min: 0,
      max: 10,
      mode: 'reject',
    }),
    trackColumns: columns.trackColumns,
    hiddenColumns: columns.hiddenColumns,
    // Reconciled against the active filters just below; the placeholder holds
    // the key in its AppSettings-order slot for byte-identical round-trips.
    visibleFilters: [],
    advancedOpen: Array.isArray(rawSettings.advancedOpen)
      ? (rawSettings.advancedOpen as unknown[]).filter((s): s is string => typeof s === 'string')
      : [...DEFAULT_SETTINGS.advancedOpen],
    // v12 (WS4): easy mode — anything but the two literals means an older or
    // mangled save, which stays in the full UI it was written from.
    uiMode:
      rawSettings.uiMode === 'easy' || rawSettings.uiMode === 'advanced'
        ? rawSettings.uiMode
        : DEFAULT_SETTINGS.uiMode,
    // v30: additive booleans, no version bump either — an older save with
    // neither key resolves to true, which is the fixed three-panel layout it
    // was written from.
    showLeftPanel:
      typeof rawSettings.showLeftPanel === 'boolean'
        ? rawSettings.showLeftPanel
        : DEFAULT_SETTINGS.showLeftPanel,
    showRightPanel:
      typeof rawSettings.showRightPanel === 'boolean'
        ? rawSettings.showRightPanel
        : DEFAULT_SETTINGS.showRightPanel,
    // v28: additive boolean, no version bump — an older save with no key
    // resolves to false, which is exactly the wanted "preview off".
    audioPreview:
      typeof rawSettings.audioPreview === 'boolean'
        ? rawSettings.audioPreview
        : DEFAULT_SETTINGS.audioPreview,
    // v36: additive enums, no version bump — an older save with no key
    // resolves to 'rekordbox', which is exactly today's behaviour.
    keySource:
      rawSettings.keySource === 'rekordbox' || rawSettings.keySource === 'comments'
        ? rawSettings.keySource
        : DEFAULT_SETTINGS.keySource,
    bpmSource:
      rawSettings.bpmSource === 'rekordbox' || rawSettings.bpmSource === 'comments'
        ? rawSettings.bpmSource
        : DEFAULT_SETTINGS.bpmSource,
    // v38: additive boolean, no version bump — an older save with no key
    // resolves to false, which is exactly the wanted "never touch files".
    analysisWriteTags:
      typeof rawSettings.analysisWriteTags === 'boolean'
        ? rawSettings.analysisWriteTags
        : DEFAULT_SETTINGS.analysisWriteTags,
  }
  // v11 (issue 1): filters normalize into the per-property map, whatever
  // their vintage; migrateFilters lifts v3 top-level ranges and drops
  // garbage entries.
  const filters = migrateFilters(p.filters)
  // visibleFilters (v10 issue 4b, widened in v11 to every property): saved
  // arrays keep their valid keys; older saves back-fill to the default.
  // [] is a valid "hide every property filter" choice. Either way, an
  // actively filtering property is forced visible — the hide-clears-filter
  // invariant means nothing may filter invisibly.
  // v18 (#3/#8), widened v23 and again v25: the four permanent panel
  // pseudo-keys join the same whitelist — only whether their ROW shows in
  // the panel. Filters
  // carry transient `marks` quick-filters too (LibraryFilters.marks), but
  // that boolean state is always reset on load (see migrateFilters), so it
  // never reaches the force-visible loop below, which stays property-only.
  const validFilterKeys = new Set<string>([
    ...TRACK_PROPERTIES.filter((prop) => prop.filterable).map((prop) => prop.key),
    ...PANEL_FILTER_KEYS,
  ])
  const savedVisible = rawSettings.visibleFilters
  settings.visibleFilters = Array.isArray(savedVisible)
    ? // Deduped as well as whitelisted: FiltersSection keys its {#each} on the
      // property key, so a repeat throws each_key_duplicate and takes the whole
      // left panel down. Every in-app write path already guards with .includes.
      [
        ...new Set(
          savedVisible.filter(
            (k): k is (typeof settings.visibleFilters)[number] =>
              typeof k === 'string' && validFilterKeys.has(k),
          ),
        ),
      ]
    : [...DEFAULT_SETTINGS.visibleFilters]
  for (const prop of TRACK_PROPERTIES) {
    if (filters.properties[prop.key] !== undefined && !settings.visibleFilters.includes(prop.key)) {
      settings.visibleFilters.push(prop.key)
    }
  }
  // v23: saves written before schema 8 predate the permanent pseudo-row
  // group — back-fill the three so an upgrade never silently removes the
  // Keys row. Schema 8+ is trusted verbatim, so a deliberate hide sticks.
  if (version < 8) {
    for (const m of PANEL_FILTERS) {
      if (!settings.visibleFilters.includes(m.key)) settings.visibleFilters.push(m.key)
    }
  }
  // v25: saves written before schema 10 predate the fourth permanent row
  // (☰ Constellation) — a narrower, separate back-fill from the one above,
  // since a save already at v8/v9 has the first three rows but not this
  // one. Schema 10+ is trusted verbatim.
  if (version < 10 && !settings.visibleFilters.includes('constellation')) {
    settings.visibleFilters.push('constellation')
  }
  // Manual edges (v12 WS9): unordered unique pairs between known tracks.
  const manualEdges: ManualEdge[] = []
  {
    const seenPairs = new Set<string>()
    for (const raw of Array.isArray(p.manualEdges) ? (p.manualEdges as unknown[]) : []) {
      if (typeof raw !== 'object' || raw === null) continue
      const entry = raw as Record<string, unknown>
      if (typeof entry.a !== 'string' || typeof entry.b !== 'string') continue
      if (entry.a === entry.b || !knownIds.has(entry.a) || !knownIds.has(entry.b)) continue
      const key = entry.a < entry.b ? `${entry.a}\n${entry.b}` : `${entry.b}\n${entry.a}`
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      const tag = typeof entry.tag === 'string' && entry.tag.trim() !== '' ? entry.tag : undefined
      manualEdges.push(
        tag === undefined ? { a: entry.a, b: entry.b } : { a: entry.a, b: entry.b, tag },
      )
    }
  }

  return {
    version: 10,
    manualEdges,
    libraryName: typeof p.libraryName === 'string' ? p.libraryName : '',
    tracks,
    criteria: migrateCriteria(p.criteria),
    filters,
    settings,
    sets,
    activeSetId,
    playlists: Array.isArray(p.playlists)
      ? p.playlists.map(sanitizePlaylist).filter((pl): pl is Playlist => pl !== null)
      : [],
    radialAxis:
      p.radialAxis === 'rating' || p.radialAxis === 'year' || p.radialAxis === 'energy'
        ? p.radialAxis
        : 'bpm',
    colorAxis:
      p.colorAxis === 'bpm' ||
      p.colorAxis === 'rating' ||
      p.colorAxis === 'year' ||
      p.colorAxis === 'energy'
        ? p.colorAxis
        : 'auto',
    // v33: additive, no version bump — same shape as audioPreview (v28),
    // showLeftPanel/showRightPanel (v30) and avoidSameArtist (v31). An old
    // save has no key, gets null, and behaves exactly as it does today.
    // Bumping would be actively worse: parseProject throws on an unknown
    // version while restoreAutosave deliberately preserves a save it cannot
    // read, so a bundle rollback would brick autosave restore entirely —
    // library, sets and filters included — over one optional field.
    analysis: sanitizeAnalysis(p.analysis),
  }
}
