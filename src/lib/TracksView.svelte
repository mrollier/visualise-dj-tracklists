<script lang="ts">
  // The Tracks central view (issue 7): the selected playlists as a classic
  // sortable table, like the browser in DJ software. Rows share the global
  // selection with the wheel; tracks connected to the selection in the combo
  // graph highlight; double-click appends to the set; per-row toggles mark
  // a track as essential (must-include) or as the opener/closer of
  // generated sets — the same pins as everywhere else.
  import { sortTracks, type TrackSort, type TrackSortField } from '../core/trackSort'
  import {
    appendToSet,
    mustInclude,
    neighbours,
    pinnedFirst,
    pinnedLast,
    playlistScopedLibrary,
    selectedId,
  } from '../stores'

  const COLUMNS: { field: TrackSortField; label: string }[] = [
    { field: 'artist', label: 'Artist' },
    { field: 'title', label: 'Title' },
    { field: 'key', label: 'Key' },
    { field: 'bpm', label: 'BPM' },
    { field: 'genre', label: 'Genre' },
    { field: 'year', label: 'Year' },
    { field: 'rating', label: 'Rating' },
  ]

  let sort = $state<TrackSort>({ field: 'artist', dir: 'asc' })
  function toggleSort(field: TrackSortField) {
    sort =
      sort.field === field
        ? { field, dir: sort.dir === 'asc' ? 'desc' : 'asc' }
        : { field, dir: 'asc' }
  }

  const rows = $derived(sortTracks($playlistScopedLibrary, sort))
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
          {#each COLUMNS as { field, label } (field)}
            <th
              aria-sort={sort.field === field
                ? sort.dir === 'asc'
                  ? 'ascending'
                  : 'descending'
                : undefined}
            >
              <button class="sort" onclick={() => toggleSort(field)}>
                {label}
                {#if sort.field === field}<span class="dir">{sort.dir === 'asc' ? '▲' : '▼'}</span
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
            <td class="ellipsis">{track.artist ?? '—'}</td>
            <td class="ellipsis title">{track.title}</td>
            <td class="tabular">{track.key ?? '—'}</td>
            <td class="tabular">{track.bpm ?? '—'}</td>
            <td class="ellipsis">{track.genre ?? '—'}</td>
            <td class="tabular">{track.year ?? '—'}</td>
            <td class="tabular">{track.rating ?? '—'}</td>
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
    content-visibility: auto;
    contain-intrinsic-height: 30px;
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

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
