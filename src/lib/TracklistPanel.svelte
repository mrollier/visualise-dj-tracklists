<script lang="ts">
  import { evaluateCombo, type CriterionField } from '../core/combos'
  import { exportTracklistCsv } from '../core/exporters/csv'
  import { exportM3u } from '../core/exporters/m3u'
  import type { Track } from '../core/model'
  import { suggestWalk } from '../core/suggest'
  import {
    criteria,
    genreMatcher,
    libraryName,
    mustInclude,
    pinnedFirst,
    pinnedLast,
    selectedId,
    settings,
    suggestionHistory,
    suggestionIndex,
    trackById,
    tracklist,
    visibleLibrary,
  } from '../stores'

  const walkTracks = $derived(
    $tracklist.map((id) => $trackById.get(id)).filter((t): t is Track => t !== undefined),
  )

  const FIELD_SHORT: Record<CriterionField, string> = {
    key: 'key',
    bpm: 'bpm',
    genre: 'genre',
    year: 'year',
  }

  function transition(a: Track, b: Track) {
    return evaluateCombo(a, b, $criteria, $genreMatcher)
  }

  function removeAt(index: number) {
    tracklist.update((ids) => ids.toSpliced(index, 1))
  }

  function move(index: number, delta: -1 | 1) {
    tracklist.update((ids) => {
      const target = index + delta
      if (target < 0 || target >= ids.length) return ids
      const next = [...ids]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function download(filename: string, content: string, mime: string) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportBase = $derived(($libraryName || 'tracklist').replace(/\.[a-z0-9]+$/i, ''))

  // Suggestion history: ◀ steps back, ▶ steps forward through earlier
  // suggestions and generates a fresh one at the head. No confirmations —
  // the previous suggestion is always one ◀ away.
  function showSuggestion(index: number) {
    suggestionIndex.set(index)
    tracklist.set($suggestionHistory[index])
  }

  function suggestNew() {
    if ($suggestionIndex < $suggestionHistory.length - 1) {
      showSuggestion($suggestionIndex + 1)
      return
    }
    const walk = suggestWalk($visibleLibrary, $criteria, {
      seedId: $pinnedFirst ?? $selectedId,
      endId: $pinnedLast,
      length: $settings.suggestLength,
      randomness: $settings.suggestRandomness,
      seed: $suggestionHistory.length,
      progression: $settings.bpmProgression,
      mustIncludeIds: $mustInclude,
    })
    suggestionHistory.update((h) => [...h, walk])
    showSuggestion($suggestionHistory.length - 1)
  }

  function suggestPrevious() {
    if ($suggestionIndex > 0) showSuggestion($suggestionIndex - 1)
  }

  // Pins and must-include marks are library-scoped (design-v6 §C): they
  // survive set edits — the Set order pickers set them before a set even
  // exists — and clear only when their track leaves the library.
  $effect(() => {
    if ($pinnedFirst !== null && !$trackById.has($pinnedFirst)) pinnedFirst.set(null)
    if ($pinnedLast !== null && !$trackById.has($pinnedLast)) pinnedLast.set(null)
    if ($mustInclude.some((id) => !$trackById.has(id)))
      mustInclude.update((ids) => ids.filter((id) => $trackById.has(id)))
  })

  function togglePin(store: typeof pinnedFirst, id: string, pinned: boolean) {
    store.set(pinned ? null : id)
  }
</script>

<aside>
  <div class="head">
    <h2 class="micro-label">Your set</h2>
    <span class="count">{walkTracks.length} tracks</span>
  </div>

  <div class="suggest-row">
    {#if $suggestionHistory.length === 0}
      <button onclick={suggestNew} disabled={$visibleLibrary.length === 0}>
        ✨ Suggest a set{$selectedId !== null ? ' from selection' : ''}
      </button>
    {:else}
      <button
        class="arrow"
        onclick={suggestPrevious}
        disabled={$suggestionIndex <= 0}
        title="Back to the previous suggestion"
      >
        ◀ previous
      </button>
      <button
        class="arrow primary"
        onclick={suggestNew}
        disabled={$visibleLibrary.length === 0}
        title="Suggest a new set"
      >
        {$suggestionIndex < $suggestionHistory.length - 1 ? 'next' : '✨ new'} ▶
      </button>
    {/if}
  </div>

  {#if walkTracks.length === 0}
    <p class="hint">
      Double-click a track on the wheel to start your set. Each next double-click appends;
      transitions are checked against your combo criteria. Or let the app suggest a walk and edit
      from there.
    </p>
  {:else}
    <ol>
      {#each walkTracks as track, i (i)}
        {#if i > 0}
          {@const t = transition(walkTracks[i - 1], track)}
          <li class="transition" class:good={t.isCombo} class:rough={!t.isCombo}>
            {#if t.matched.length > 0}
              {#each t.matched as field (field)}<span class="match">{FIELD_SHORT[field]}</span
                >{/each}
            {:else}
              <span class="none">no criteria match</span>
            {/if}
          </li>
        {/if}
        <li class="track" class:active={track.id === $selectedId}>
          <button class="row" onclick={() => selectedId.set(track.id)}>
            <span class="index">{i + 1}</span>
            <span class="names">
              <strong>{track.title}</strong>
              <small>{track.artist ?? 'Unknown artist'}</small>
            </span>
            <span class="meta tabular">{track.key ?? '—'} · {track.bpm ?? '—'}</span>
          </button>
          {#if i === 0 || i === walkTracks.length - 1}
            {@const isFirst = i === 0}
            {@const pinned = isFirst ? $pinnedFirst === track.id : $pinnedLast === track.id}
            <button
              class="pin"
              class:pinned
              title={isFirst
                ? 'Keep as the opening track of suggested sets'
                : 'Keep as the closing track of suggested sets'}
              aria-label={isFirst ? 'Pin as first track' : 'Pin as last track'}
              aria-pressed={pinned}
              onclick={() => togglePin(isFirst ? pinnedFirst : pinnedLast, track.id, pinned)}
            >
              📌
            </button>
          {/if}
          <span class="actions">
            <button title="Move up" aria-label="Move up" onclick={() => move(i, -1)}>↑</button>
            <button title="Move down" aria-label="Move down" onclick={() => move(i, 1)}>↓</button>
            <button title="Remove" aria-label="Remove" onclick={() => removeAt(i)}>✕</button>
          </span>
        </li>
      {/each}
    </ol>

    <div class="footer">
      <button
        onclick={() => download(`${exportBase}.m3u8`, exportM3u(walkTracks), 'audio/x-mpegurl')}
      >
        Export M3U8
      </button>
      <button
        onclick={() => download(`${exportBase}.csv`, exportTracklistCsv(walkTracks), 'text/csv')}
      >
        Export CSV
      </button>
      <button class="danger" onclick={() => tracklist.set([])}>Clear</button>
    </div>
  {/if}
</aside>

<style>
  aside {
    width: 280px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--page);
    border-left: 1px solid var(--border);
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 12px 14px 6px;
  }

  h2 {
    font-size: 14px;
    margin: 0;
  }

  .count {
    color: var(--ink-muted);
    font-size: 12px;
  }

  .suggest-row {
    padding: 0 14px 8px;
    display: flex;
    gap: 6px;
  }

  .suggest-row button {
    width: 100%;
    font-size: 12px;
  }

  .suggest-row .arrow {
    width: auto;
    flex: 1;
    white-space: nowrap;
  }

  .suggest-row .primary {
    flex: 1.4;
  }

  .hint {
    padding: 0 14px;
    color: var(--ink-muted);
    font-size: 12px;
  }

  ol {
    list-style: none;
    margin: 0;
    padding: 4px 10px;
    overflow-y: auto;
    flex: 1;
  }

  .track {
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid transparent;
    border-radius: 6px;
  }

  .track.active {
    border-color: var(--accent);
  }

  .row {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    padding: 6px 4px;
    text-align: left;
    min-width: 0;
  }

  .index {
    color: var(--ink-muted);
    font-size: 11px;
    width: 16px;
    text-align: right;
  }

  .names {
    min-width: 0;
    flex: 1;
  }

  .names strong {
    display: block;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .names small {
    color: var(--ink-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    display: block;
  }

  .meta {
    color: var(--ink-secondary);
    font-size: 11px;
    white-space: nowrap;
  }

  .pin {
    display: none;
    background: none;
    border: none;
    padding: 1px 2px;
    font-size: 11px;
    filter: grayscale(1);
    opacity: 0.5;
  }

  .track:hover .pin,
  .track:focus-within .pin,
  .pin.pinned {
    display: inline-flex;
  }

  .pin.pinned {
    filter: none;
    opacity: 1;
  }

  .actions {
    display: none;
    gap: 2px;
  }

  .track:hover .actions,
  .track:focus-within .actions {
    display: inline-flex;
  }

  .actions button {
    padding: 1px 6px;
    font-size: 11px;
  }

  .transition {
    display: flex;
    gap: 4px;
    padding: 1px 0 1px 30px;
    font-size: 10px;
    align-items: center;
  }

  .transition::before {
    content: '↓';
    color: var(--ink-muted);
  }

  .match {
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0 6px;
    color: var(--ink-secondary);
  }

  .transition.rough .none {
    color: var(--walk-bright);
  }

  .footer {
    display: flex;
    gap: 6px;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
  }

  .footer button {
    font-size: 12px;
  }

  .danger {
    margin-left: auto;
    color: var(--ink-secondary);
  }
</style>
