<script lang="ts">
  import { filters, library, libraryGenres, visibleLibrary } from '../stores'

  // Local min/max fields; empty input = unbounded. Converted to LibraryFilters
  // ranges (null when both ends are empty) on every change.
  let bpmMin = $state(''),
    bpmMax = $state(''),
    yearMin = $state(''),
    yearMax = $state(''),
    ratingMin = $state(''),
    ratingMax = $state('')

  function range(min: string, max: string, lo: number, hi: number): [number, number] | null {
    if (min === '' && max === '') return null
    return [min === '' ? lo : Number(min), max === '' ? hi : Number(max)]
  }

  $effect(() => {
    filters.update((f) => ({
      ...f,
      bpm: range(bpmMin, bpmMax, 0, 999),
      year: range(yearMin, yearMax, 0, 9999),
      rating: range(ratingMin, ratingMax, 0, 5),
    }))
  })

  function toggleGenre(genre: string, on: boolean) {
    filters.update((f) => {
      const current = f.genres ?? $libraryGenres
      const next = on ? [...current, genre] : current.filter((g) => g !== genre)
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
    <input type="number" placeholder="min" min="0" bind:value={bpmMin} />
    <span class="dash">–</span>
    <input type="number" placeholder="max" min="0" bind:value={bpmMax} />
  </div>
  <div class="filter-row">
    <span class="filter-label">Year</span>
    <input type="number" placeholder="min" min="0" bind:value={yearMin} />
    <span class="dash">–</span>
    <input type="number" placeholder="max" min="0" bind:value={yearMax} />
  </div>
  <div class="filter-row">
    <span class="filter-label">Rating</span>
    <input type="number" placeholder="min" min="0" max="5" bind:value={ratingMin} />
    <span class="dash">–</span>
    <input type="number" placeholder="max" min="0" max="5" bind:value={ratingMax} />
  </div>

  <details class="genres">
    <summary>Genres <span class="summary-count">{genreSummary}</span></summary>
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

  .genres summary {
    font-weight: 400;
    color: var(--ink-secondary);
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
