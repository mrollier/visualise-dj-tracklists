<script lang="ts">
  import { evaluateCombo, type CriterionField } from '../core/combos'
  import { exportTracklistCsv } from '../core/exporters/csv'
  import { exportM3u } from '../core/exporters/m3u'
  import type { Track } from '../core/model'
  import { suggestWalk } from '../core/suggest'
  import { promptExportName } from './exportName'
  import { canAddSet, MAX_SETS } from '../core/sets'
  import {
    activateAdjacentSet,
    activeSet,
    activeSetId,
    addSet,
    criteria,
    hoveredId,
    deleteSet,
    genreMatcher,
    libraryName,
    mustInclude,
    pinnedFirst,
    pinnedLast,
    renameSet,
    selectedId,
    setGeneratedTracklist,
    sets,
    settings,
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

  /** Ask for a name first (ISSUES.md #15); cancelling aborts the export. */
  function download(ext: string, content: () => string, mime: string) {
    const filename = promptExportName(exportBase, ext)
    if (filename === null) return
    const url = URL.createObjectURL(new Blob([content()], { type: mime }))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportBase = $derived(($libraryName || 'tracklist').replace(/\.[a-z0-9]+$/i, ''))

  // The sets ARE the suggestion browser (v8 issue 18): ◀/▶ and the dropdown
  // navigate the (≤ 8) named sets. ✨ regenerates IN PLACE while the active
  // set is untouched generator output or empty — successive presses are one
  // Cmd+Z apart, which replaces the old ◀-history — and otherwise starts a
  // NEW set so a hand-edited one is never overwritten. Generator writes go
  // through setGeneratedTracklist so the ✨ badge appears and disappears
  // again on the first manual edit.
  let suggestSeed = 0
  const canRegenerateInPlace = $derived($activeSet.generated || $activeSet.trackIds.length === 0)
  const suggestDisabled = $derived(
    $visibleLibrary.length === 0 || (!canRegenerateInPlace && !canAddSet($sets)),
  )

  function suggest() {
    if (suggestDisabled) return
    if (!canRegenerateInPlace) addSet() // a fresh set, activated
    const walk = suggestWalk($visibleLibrary, $criteria, {
      seedId: $pinnedFirst ?? $selectedId,
      endId: $pinnedLast,
      length: $settings.suggestLength,
      randomness: $settings.suggestRandomness,
      seed: suggestSeed++,
      progression: $settings.bpmProgression,
      mustIncludeIds: $mustInclude,
    })
    setGeneratedTracklist(walk)
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

  // Set naming (issue 18): the header shows a switcher over the project's
  // named sets; ✎ renames inline (no native prompt), ＋ adds "Second Set" …
  let renaming = $state(false)
  let renameValue = $state('')
  function startRename() {
    renameValue = $activeSet.name
    renaming = true
  }
  function commitRename() {
    renameSet($activeSetId, renameValue)
    renaming = false
  }
  function focusAndSelect(el: HTMLInputElement) {
    el.focus()
    el.select()
  }
</script>

<aside>
  <div class="head">
    {#if renaming}
      <input
        class="rename"
        aria-label="Set name"
        use:focusAndSelect
        bind:value={renameValue}
        onblur={commitRename}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitRename()
          if (e.key === 'Escape') renaming = false
        }}
      />
    {:else}
      {@const activeIndex = $sets.findIndex((s) => s.id === $activeSetId)}
      <button
        class="nav"
        title="Previous set"
        aria-label="Previous set"
        onclick={() => activateAdjacentSet(-1)}
        disabled={activeIndex <= 0}>◀</button
      >
      <select
        class="set-switch micro-label"
        aria-label="Active set"
        value={$activeSetId}
        onchange={(e) => activeSetId.set(e.currentTarget.value)}
      >
        {#each $sets as s (s.id)}
          <option value={s.id}>{s.name}</option>
        {/each}
      </select>
      <button
        class="nav"
        title="Next set"
        aria-label="Next set"
        onclick={() => activateAdjacentSet(1)}
        disabled={activeIndex >= $sets.length - 1}>▶</button
      >
      {#if $activeSet.generated}
        <span class="badge" title="Untouched generated set">✨</span>
      {/if}
      <span class="set-actions">
        <button title="Rename this set" aria-label="Rename set" onclick={startRename}>✎</button>
        <button
          title={canAddSet($sets) ? 'Start a new set' : `${MAX_SETS} sets at most`}
          aria-label="New set"
          onclick={addSet}
          disabled={!canAddSet($sets)}>＋</button
        >
        <button
          title="Delete this set"
          aria-label="Delete set"
          onclick={() => deleteSet($activeSetId)}
          disabled={$sets.length <= 1}>🗑</button
        >
      </span>
    {/if}
    <span class="count">{walkTracks.length} tracks</span>
  </div>

  <div class="suggest-row">
    <button
      class="primary"
      onclick={suggest}
      disabled={suggestDisabled}
      title={suggestDisabled && $visibleLibrary.length > 0
        ? `All ${MAX_SETS} sets are hand-edited — clear or delete one first`
        : canRegenerateInPlace
          ? 'Generate a set (replaces this untouched one — Cmd+Z steps back)'
          : 'Generate a new set alongside this hand-edited one'}
    >
      ✨ Suggest a set{$selectedId !== null && canRegenerateInPlace ? ' from selection' : ''}
    </button>
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
        <li
          class="track"
          class:active={track.id === $selectedId}
          onmouseenter={() => hoveredId.set(track.id)}
          onmouseleave={() => hoveredId.set(null)}
        >
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
      <button onclick={() => download('.m3u8', () => exportM3u(walkTracks), 'audio/x-mpegurl')}>
        Export M3U8
      </button>
      <button onclick={() => download('.csv', () => exportTracklistCsv(walkTracks), 'text/csv')}>
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
    align-items: center;
    gap: 4px;
    padding: 10px 14px 6px;
  }

  .set-switch {
    border: none;
    background: none;
    padding: 2px 0;
    max-width: 130px;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .rename {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    padding: 2px 6px;
  }

  .badge {
    font-size: 10px;
    cursor: default;
  }

  .set-actions {
    display: flex;
    gap: 2px;
  }

  .set-actions button {
    padding: 1px 5px;
    font-size: 11px;
    color: var(--ink-muted);
    background: none;
    border: none;
  }

  .set-actions button:hover:not(:disabled) {
    color: var(--ink);
  }

  .count {
    color: var(--ink-muted);
    font-size: 12px;
    margin-left: auto;
    white-space: nowrap;
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

  .suggest-row .primary {
    flex: 1;
  }

  .head .nav {
    padding: 1px 5px;
    font-size: 10px;
    background: none;
    border: none;
    color: var(--ink-muted);
  }

  .head .nav:not(:disabled):hover {
    color: var(--ink);
  }

  .head .nav:disabled {
    opacity: 0.3;
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
