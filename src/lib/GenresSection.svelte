<script lang="ts">
  // The genre checklist as its own top-level section (v9 issue 7): it used
  // to nest INSIDE the Filters disclosure at the same visual width, which
  // broke the hierarchy — as a sibling it mirrors the Playlists pattern,
  // summary count included. Still playlist-scoped, still part of `filters`.
  import { nextGenreSelection } from '../core/filter'
  import { filters, scopedGenres } from '../stores'

  function toggleGenre(genre: string, on: boolean) {
    filters.update((f) => ({
      ...f,
      genres: nextGenreSelection(f.genres, $scopedGenres, genre, on),
    }))
  }

  function setAllGenres(on: boolean) {
    filters.update((f) => ({ ...f, genres: on ? null : [] }))
  }

  const activeGenres = $derived(new Set($filters.genres ?? $scopedGenres))
  const genreSummary = $derived(
    $filters.genres === null
      ? `${$scopedGenres.length}/${$scopedGenres.length}`
      : `${$filters.genres.length}/${$scopedGenres.length}`,
  )
</script>

<details>
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
    /* The whole row toggles the box; the genre name isn't drag-selectable, so
       clicking never accidentally highlights the text (ISSUES.md #1). */
    -webkit-user-select: none;
    user-select: none;
  }
</style>
