<script lang="ts">
  import { get } from 'svelte/store'
  import { libraryExtents, type LibraryFilters } from '../core/filter'
  import { filters, library, libraryGenres, visibleLibrary } from '../stores'

  type RangeField = 'bpm' | 'year' | 'rating'

  // Local min/max fields, seeded from the library's actual extremes (remark 8)
  // or from an active filter. Only user edits write to the filters store, so
  // loaded projects keep their saved ranges.
  let inputs = $state({
    bpm: { min: '', max: '' },
    year: { min: '', max: '' },
    rating: { min: '', max: '' },
  })

  let seededFor: unknown = null
  $effect(() => {
    const lib = $library
    if (lib === seededFor) return
    seededFor = lib
    const extents = libraryExtents(lib)
    const active = get(filters)
    for (const field of ['bpm', 'year', 'rating'] as RangeField[]) {
      const range = active[field] ?? extents[field]
      inputs[field] = {
        min: range === null ? '' : String(range[0]),
        max: range === null ? '' : String(range[1]),
      }
    }
  })

  function commit(field: RangeField) {
    const { min, max } = inputs[field]
    // An emptied side falls back to the library extreme (keeps JSON-safe
    // finite bounds); both sides empty = not filtering.
    const extent = libraryExtents(get(library))[field]
    const range: LibraryFilters[RangeField] =
      min === '' && max === ''
        ? null
        : [
            min === '' ? (extent?.[0] ?? 0) : Number(min),
            max === '' ? (extent?.[1] ?? 9999) : Number(max),
          ]
    filters.update((f) => ({ ...f, [field]: range }))
  }

  function toggleGenre(genre: string, on: boolean) {
    filters.update((f) => {
      const current = f.genres ?? $libraryGenres
      const next = on
        ? current.includes(genre)
          ? current
          : [...current, genre]
        : current.filter((g) => g !== genre)
      // All genres selected = no filter.
      return { ...f, genres: next.length >= $libraryGenres.length ? null : next }
    })
  }

  function setAllGenres(on: boolean) {
    filters.update((f) => ({ ...f, genres: on ? null : [] }))
  }

  const activeGenres = $derived(new Set($filters.genres ?? $libraryGenres))
  const genreSummary = $derived(
    $filters.genres === null ? 'all' : `${$filters.genres.length}/${$libraryGenres.length}`,
  )
</script>

<details>
  <summary class="micro-label">
    Filters
    <span class="summary-count">{$visibleLibrary.length} of {$library.length} tracks</span>
  </summary>

  <div class="filter-row">
    <span class="filter-label">BPM</span>
    <input
      type="number"
      placeholder="min"
      min="0"
      bind:value={inputs.bpm.min}
      oninput={() => commit('bpm')}
    />
    <span class="dash">–</span>
    <input
      type="number"
      placeholder="max"
      min="0"
      bind:value={inputs.bpm.max}
      oninput={() => commit('bpm')}
    />
  </div>
  <div class="filter-row">
    <span class="filter-label">Year</span>
    <input
      type="number"
      placeholder="min"
      min="0"
      bind:value={inputs.year.min}
      oninput={() => commit('year')}
    />
    <span class="dash">–</span>
    <input
      type="number"
      placeholder="max"
      min="0"
      bind:value={inputs.year.max}
      oninput={() => commit('year')}
    />
  </div>
  <div class="filter-row">
    <span class="filter-label">Rating</span>
    <input
      type="number"
      placeholder="min"
      min="0"
      max="5"
      bind:value={inputs.rating.min}
      oninput={() => commit('rating')}
    />
    <span class="dash">–</span>
    <input
      type="number"
      placeholder="max"
      min="0"
      max="5"
      bind:value={inputs.rating.max}
      oninput={() => commit('rating')}
    />
  </div>

  <details class="genres">
    <summary class="micro-label">Genres <span class="summary-count">{genreSummary}</span></summary>
    <div class="genre-actions">
      <button onclick={() => setAllGenres(true)}>All</button>
      <button onclick={() => setAllGenres(false)}>None</button>
    </div>
    <ul>
      {#each $libraryGenres as genre (genre)}
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
