<script lang="ts">
  import { NOT_IN_PLAYLIST } from '../core/filter'
  import { filters, library, playlists } from '../stores'

  // Only tracks that actually exist in the collection count.
  const libraryIds = $derived(new Set($library.map((t) => t.id)))
  const counts = $derived(
    new Map($playlists.map((p) => [p.name, p.trackIds.filter((id) => libraryIds.has(id)).length])),
  )
  const leftoverCount = $derived.by(() => {
    const inAny = new Set($playlists.flatMap((p) => p.trackIds))
    return $library.filter((t) => !inAny.has(t.id)).length
  })

  const allNames = $derived([...$playlists.map((p) => p.name), NOT_IN_PLAYLIST])
  const selected = $derived(new Set($filters.playlists ?? allNames))

  function toggle(name: string, on: boolean) {
    filters.update((f) => {
      const current = f.playlists ?? allNames
      const next = on
        ? current.includes(name)
          ? current
          : [...current, name]
        : current.filter((n) => n !== name)
      return { ...f, playlists: next }
    })
  }

  function setAll(on: boolean) {
    filters.update((f) => ({ ...f, playlists: on ? [...allNames] : [] }))
  }

  // Just the selection scope ("2/9"); the track total lives in the Filters
  // summary, where it reads as the filter's denominator (v8 issue 1).
  const summary = $derived.by(() => {
    const chosen = $filters.playlists
    return chosen === null || chosen.length >= allNames.length
      ? 'all'
      : `${chosen.length}/${allNames.length}`
  })
</script>

{#if $playlists.length > 0}
  <details open>
    <summary class="micro-label">
      Playlists
      <span class="summary-count">{summary}</span>
    </summary>
    <div class="actions">
      <button onclick={() => setAll(true)}>All</button>
      <button onclick={() => setAll(false)}>None</button>
    </div>
    <ul>
      {#each $playlists as playlist (playlist.name)}
        <li>
          <label>
            <input
              type="checkbox"
              checked={selected.has(playlist.name)}
              onchange={(e) => toggle(playlist.name, e.currentTarget.checked)}
            />
            <span class="name">{playlist.name}</span>
            <span class="count">{counts.get(playlist.name)}</span>
          </label>
        </li>
      {/each}
      <li class="leftover">
        <label>
          <input
            type="checkbox"
            checked={selected.has(NOT_IN_PLAYLIST)}
            onchange={(e) => toggle(NOT_IN_PLAYLIST, e.currentTarget.checked)}
          />
          <span class="name">Not in a playlist</span>
          <span class="count">{leftoverCount}</span>
        </label>
      </li>
    </ul>
  </details>
{/if}

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

  .actions {
    display: flex;
    gap: 6px;
    margin: 4px 0;
  }

  .actions button {
    font-size: 11px;
    padding: 1px 8px;
  }

  ul {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    max-height: 200px;
    overflow-y: auto;
  }

  li label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-size: 13px;
    /* Clicking the row toggles the box (the whole label is the target); the
       name is a label, not selectable text — so dragging to read never
       accidentally highlights it (ISSUES.md #1). */
    -webkit-user-select: none;
    user-select: none;
  }

  .name {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .count {
    color: var(--ink-muted);
    font-size: 11px;
  }

  .leftover {
    border-top: 1px solid var(--border);
    margin-top: 4px;
    padding-top: 4px;
    color: var(--ink-secondary);
  }
</style>
