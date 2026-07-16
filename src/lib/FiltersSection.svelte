<script lang="ts">
  import { get } from 'svelte/store'
  import { clampRange, libraryExtents, wholeExtent, type LibraryFilters } from '../core/filter'
  import { filters, library, scopedGenres, playlistScopedLibrary, visibleLibrary } from '../stores'

  type RangeField = 'bpm' | 'year' | 'rating'
  type RangeSide = 'min' | 'max'

  const RANGE_ROWS: { field: RangeField; label: string }[] = [
    { field: 'bpm', label: 'BPM' },
    { field: 'year', label: 'Year' },
    { field: 'rating', label: 'Rating' },
  ]

  // Local min/max fields, seeded from the playlist selection's actual
  // extremes or from an active filter. Only user edits (and playlist
  // toggles, which reset the ranges) write to the filters store, so loaded
  // projects keep their saved ranges.
  let inputs = $state({
    bpm: { min: '', max: '' },
    year: { min: '', max: '' },
    rating: { min: '', max: '' },
  })

  // Extents of the playlist-scoped library: the defaults follow the
  // playlists you work in, not the whole collection.
  const scopedExtents = $derived(libraryExtents($playlistScopedLibrary))

  let seededForLibrary: unknown = null
  let seededForPlaylists: unknown = null
  $effect(() => {
    const lib = $library
    const selection = $filters.playlists
    if (lib !== seededForLibrary) {
      // Fresh library (import or project load): show the saved filter when
      // the project carries one, else the selection's whole-number extremes.
      // Never writes to the store here.
      seededForLibrary = lib
      seededForPlaylists = selection
      const active = get(filters)
      for (const { field } of RANGE_ROWS) {
        const range = active[field] ?? whole(scopedExtents[field])
        inputs[field] = {
          min: range === null ? '' : String(range[0]),
          max: range === null ? '' : String(range[1]),
        }
      }
      return
    }
    // Toggling playlists resets every range to the new selection's extremes
    // (deliberate: stale ranges from another playlist would silently hide
    // tracks — the user asked for this reset).
    if (selection !== seededForPlaylists) {
      seededForPlaylists = selection
      for (const { field } of RANGE_ROWS) resetRange(field)
    }
  })

  function whole(extent: [number, number] | null): [number, number] | null {
    return extent === null ? null : wholeExtent(extent)
  }

  /**
   * Push the boxes into the store, clamped so min never exceeds max. The
   * store always receives the clamped range; the boxes themselves are only
   * rewritten on change (blur/enter), so clamping never fights mid-typing.
   */
  function commit(field: RangeField, edited: RangeSide, reflect = false) {
    const { min, max } = inputs[field]
    // An emptied side falls back to the selection extreme (keeps JSON-safe
    // finite bounds); both sides empty = not filtering.
    const extent = scopedExtents[field]
    let range: LibraryFilters[RangeField] = null
    if (min !== '' || max !== '') {
      range = clampRange(
        [
          min === '' ? (extent?.[0] ?? 0) : Number(min),
          max === '' ? (extent?.[1] ?? 9999) : Number(max),
        ],
        edited,
      )
      if (reflect) inputs[field] = { min: String(range[0]), max: String(range[1]) }
    }
    filters.update((f) => ({ ...f, [field]: range }))
  }

  /** Reset a range to the whole numbers just outside the selection's extremes. */
  function resetRange(field: RangeField) {
    const range = whole(scopedExtents[field])
    inputs[field] = {
      min: range === null ? '' : String(range[0]),
      max: range === null ? '' : String(range[1]),
    }
    filters.update((f) => ({ ...f, [field]: range }))
  }

  function toggleGenre(genre: string, on: boolean) {
    filters.update((f) => {
      const current = f.genres ?? $scopedGenres
      const next = on
        ? current.includes(genre)
          ? current
          : [...current, genre]
        : current.filter((g) => g !== genre)
      // All genres selected = no filter.
      return { ...f, genres: next.length >= $scopedGenres.length ? null : next }
    })
  }

  function setAllGenres(on: boolean) {
    filters.update((f) => ({ ...f, genres: on ? null : [] }))
  }

  const activeGenres = $derived(new Set($filters.genres ?? $scopedGenres))
  const genreSummary = $derived(
    $filters.genres === null ? 'all' : `${$filters.genres.length}/${$scopedGenres.length}`,
  )
</script>

<details>
  <summary class="micro-label">
    Filters
    <!-- Visible over the SELECTED PLAYLISTS' total (issue 8): the filter's
         effect is judged against what the playlists put on the table. -->
    <span class="summary-count"
      >{$visibleLibrary.length} of {$playlistScopedLibrary.length} tracks</span
    >
  </summary>

  {#each RANGE_ROWS as { field, label } (field)}
    <div class="filter-row">
      <span class="filter-label">{label}</span>
      <input
        type="number"
        placeholder="min"
        min="0"
        max={inputs[field].max === '' ? (field === 'rating' ? '5' : undefined) : inputs[field].max}
        bind:value={inputs[field].min}
        oninput={() => commit(field, 'min')}
        onchange={() => commit(field, 'min', true)}
      />
      <span class="dash">–</span>
      <input
        type="number"
        placeholder="max"
        min={inputs[field].min === '' ? '0' : inputs[field].min}
        max={field === 'rating' ? '5' : undefined}
        bind:value={inputs[field].max}
        oninput={() => commit(field, 'max')}
        onchange={() => commit(field, 'max', true)}
      />
      <button
        class="range-reset"
        title="Reset to the selection's range"
        aria-label="Reset {label} range"
        onclick={() => resetRange(field)}>↺</button
      >
    </div>
  {/each}

  <details class="genres">
    <summary class="micro-label">Genres <span class="summary-count">{genreSummary}</span></summary>
    <div class="genre-actions">
      <button onclick={() => setAllGenres(true)}>All</button>
      <button onclick={() => setAllGenres(false)}>None</button>
    </div>
    <ul>
      {#each $scopedGenres as genre (genre)}
        <li>
          <label>
            <input
              type="checkbox"
              checked={activeGenres.has(genre)}
              onchange={(e) => toggleGenre(genre, e.currentTarget.checked)}
            />
            {genre}
          </label>
        </li>
      {/each}
    </ul>
  </details>
</details>

<style>
  summary {
    cursor: pointer;
    color: var(--ink-secondary);
    font-weight: 600;
    margin-bottom: 8px;
  }

  .summary-count {
    color: var(--ink-muted);
    font-weight: 400;
    font-size: 12px;
    margin-left: 6px;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 0;
  }

  .filter-label {
    width: 44px;
    color: var(--ink-secondary);
  }

  .filter-row input {
    width: 64px;
    padding: 2px 6px;
  }

  .dash {
    color: var(--ink-muted);
  }

  .range-reset {
    padding: 1px 6px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-muted);
  }

  .range-reset:hover {
    color: var(--ink);
  }

  .genres {
    margin-top: 6px;
  }

  .genre-actions {
    display: flex;
    gap: 6px;
    margin: 4px 0;
  }

  .genre-actions button {
    font-size: 11px;
    padding: 1px 8px;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 180px;
    overflow-y: auto;
  }

  li label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 13px;
  }
</style>
