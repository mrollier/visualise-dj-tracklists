<script lang="ts">
  // The Tracks central view (issue 7): the selected playlists as a classic
  // sortable table, like the browser in DJ software. Rows share the global
  // selection with the wheel; tracks connected to the selection in the combo
  // graph highlight; double-click appends to the set; per-row toggles mark
  // a track as essential (must-include) or as the opener/closer of
  // generated sets — the same pins as everywhere else.
  import type { Track } from '../core/model'
  import { sortTracks, type TrackSortField } from '../core/trackSort'
  import {
    appendToSet,
    mustInclude,
    neighbours,
    pinnedFirst,
    pinnedLast,
    playlistScopedLibrary,
    selectedId,
    settings,
    trackSort,
  } from '../stores'

  const COLUMN_LABEL: Record<TrackSortField, string> = {
    artist: 'Artist',
    title: 'Title',
    key: 'Key',
    bpm: 'BPM',
    genre: 'Genre',
    year: 'Year',
    rating: 'Rating',
    album: 'Album',
    dateAdded: 'Date added',
    durationSec: 'Length',
  }

  // Columns = the settings list: membership AND order (v8 issue 15).
  const columns = $derived($settings.trackColumns)
  const STRING_FIELDS = new Set<TrackSortField>(['artist', 'title', 'genre', 'album'])

  function toggleSort(field: TrackSortField) {
    trackSort.update((sort) =>
      sort.field === field
        ? { field, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' },
    )
  }

  function cellText(track: Track, field: TrackSortField): string {
    const value = track[field]
    if (value === null) return '—'
    if (field === 'durationSec') {
      const secs = Math.round(value as number)
      return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
    }
    return String(value)
  }

  // Sorting always runs over the whole selection, but only the top window is
  // mounted: thousands of rows with per-row controls take seconds to build,
  // and the top of the sorted order is what gets scanned anyway. Narrowing
  // the playlist selection (or flipping the sort) reaches the rest.
  const MAX_ROWS = 500
  const sorted = $derived(sortTracks($playlistScopedLibrary, $trackSort))
  const rows = $derived(sorted.slice(0, MAX_ROWS))
  const connectedIds = $derived($selectedId === null ? null : $neighbours.get($selectedId))
  const mustSet = $derived(new Set($mustInclude))

  function selectRow(id: string) {
    selectedId.update((current) => (current === id ? null : id))
  }

  function toggleMust(id: string) {
    mustInclude.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  function togglePin(store: typeof pinnedFirst, id: string) {
    store.update((current) => (current === id ? null : id))
  }
</script>

<section class="tracks-view">
  {#if rows.length === 0}
    <div class="empty-hint">
      <strong>Nothing to list yet.</strong>
      <span>Select a playlist on the left to fill the table.</span>
    </div>
  {:else}
    <table>
      <thead>
        <tr>
          {#each columns as field (field)}
            <th
              aria-sort={$trackSort.field === field
                ? $trackSort.dir === 'asc'
                  ? 'ascending'
                  : 'descending'
                : undefined}
            >
              <button class="sort" onclick={() => toggleSort(field)}>
                {COLUMN_LABEL[field]}
                {#if $trackSort.field === field}<span class="dir"
                    >{$trackSort.dir === 'asc' ? '▲' : '▼'}</span
                  >{/if}
              </button>
            </th>
          {/each}
          <th class="tags-col"><span class="visually-hidden">Set tags</span></th>
        </tr>
      </thead>
      <tbody>
        {#each rows as track (track.id)}
          <tr
            class:selected={track.id === $selectedId}
            class:connected={connectedIds?.has(track.id) === true}
            onclick={() => selectRow(track.id)}
            ondblclick={() => appendToSet(track.id)}
          >
            {#each columns as field (field)}
              {#if field === 'rating'}
                <td
                  class="tabular rating"
                  aria-label={track.rating === null ? undefined : `${track.rating} of 5`}
                >
                  {#if track.rating === null}—{:else}<span class="stars"
                      >{'★'.repeat(track.rating)}</span
                    ><span class="stars off">{'☆'.repeat(5 - track.rating)}</span>{/if}
                </td>
              {:else}
                <td
                  class:ellipsis={STRING_FIELDS.has(field)}
                  class:tabular={!STRING_FIELDS.has(field)}
                  class:title={field === 'title'}>{cellText(track, field)}</td
                >
              {/if}
            {/each}
            <td class="tags">
              <button
                class="tag"
                class:on={mustSet.has(track.id)}
                title="Essential: must appear in generated sets"
                aria-label="Mark essential"
                aria-pressed={mustSet.has(track.id)}
                onclick={(e) => {
                  e.stopPropagation()
                  toggleMust(track.id)
                }}>★</button
              >
              <button
                class="tag"
                class:on={$pinnedFirst === track.id}
                title="Open generated sets with this track"
                aria-label="Pin as opening track"
                aria-pressed={$pinnedFirst === track.id}
                onclick={(e) => {
                  e.stopPropagation()
                  togglePin(pinnedFirst, track.id)
                }}>⏮</button
              >
              <button
                class="tag"
                class:on={$pinnedLast === track.id}
                title="Close generated sets with this track"
                aria-label="Pin as closing track"
                aria-pressed={$pinnedLast === track.id}
                onclick={(e) => {
                  e.stopPropagation()
                  togglePin(pinnedLast, track.id)
                }}>⏭</button
              >
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if sorted.length > MAX_ROWS}
      <p class="capped">
        Showing the first {MAX_ROWS} of {sorted.length} tracks — flip the sort or narrow the playlist
        selection to reach the rest.
      </p>
    {/if}
  {/if}
</section>

<style>
  .tracks-view {
    flex: 1;
    min-width: 0;
    overflow: auto;
    background: var(--surface);
  }

  .empty-hint {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--ink-secondary);
    font-size: 13px;
  }

  .empty-hint span {
    color: var(--ink-muted);
    font-size: 12px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }

  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface);
    border-bottom: 1px solid var(--baseline);
    text-align: left;
    padding: 0;
  }

  .sort {
    width: 100%;
    background: none;
    border: none;
    border-radius: 0;
    padding: 8px 10px;
    text-align: left;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--ink-muted);
    white-space: nowrap;
  }

  .sort:hover {
    color: var(--ink);
  }

  .dir {
    color: var(--accent);
    margin-left: 3px;
  }

  tbody tr {
    cursor: pointer;
  }

  tbody tr:hover {
    background: color-mix(in srgb, var(--ink) 5%, transparent);
  }

  tbody tr.connected {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  tbody tr.selected {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }

  td {
    padding: 5px 10px;
    border-bottom: 1px solid var(--grid);
    color: var(--ink-secondary);
    white-space: nowrap;
  }

  td.title {
    color: var(--ink);
  }

  .ellipsis {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tags-col {
    width: 74px;
  }

  .tags {
    text-align: right;
  }

  .tag {
    background: none;
    border: none;
    padding: 0 3px;
    font-size: 12px;
    color: var(--ink-muted);
    opacity: 0;
  }

  tbody tr:hover .tag,
  tbody tr:focus-within .tag,
  .tag.on {
    opacity: 0.65;
  }

  .tag.on {
    color: var(--accent);
    opacity: 1;
  }

  .stars {
    color: var(--accent);
    letter-spacing: 1px;
  }

  .stars.off {
    color: var(--ink-muted);
    opacity: 0.45;
  }

  .capped {
    margin: 8px 12px 12px;
    color: var(--ink-muted);
    font-size: 12px;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
