<script lang="ts">
  import { evaluateCombo, type CriterionField } from '../core/combos'
  import { exportTracklistCsv } from '../core/exporters/csv'
  import { exportM3u } from '../core/exporters/m3u'
  import type { Track } from '../core/model'
  import { buildSetPortrait } from '../core/exporters/portrait'
  import { suggestWalk } from '../core/suggest'
  import { walkRevealPlan } from '../core/walkReveal'
  import { promptExportName } from './exportName'
  import { svgToPngBlob } from './portraitPng'
  import { effectiveTheme } from './theme'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import SparkleBurst from './SparkleBurst.svelte'
  import { canAddSet, MAX_SETS } from '../core/sets'
  import {
    activeSet,
    activeSetId,
    addSet,
    criteria,
    hoveredId,
    deleteSet,
    genreMatcher,
    libraryName,
    manualEdges,
    mustInclude,
    pinnedFirst,
    pinnedLast,
    renameSet,
    selectedId,
    radialAxis,
    setGeneratedTracklist,
    sets,
    settings,
    suggestHotkeyTick,
    trackById,
    tracklist,
    visibleLibrary,
    bumpWalkReveal,
    walkRevealSeen,
    walkRevealTick,
  } from '../stores'
  import { get } from 'svelte/store'

  let clearDialog: ConfirmDialog

  const walkTracks = $derived(
    $tracklist.map((id) => $trackById.get(id)).filter((t): t is Track => t !== undefined),
  )

  // Rows cascade in while the wheel draws the walk (v12 WS1). Keying the list
  // on the tick restarts the animation cleanly per suggestion; once `seen`
  // catches up, re-renders (view switches, undo) replay nothing.
  const revealing = $derived($walkRevealTick > $walkRevealSeen)
  const revealPlan = $derived(walkRevealPlan($tracklist))

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
    saveBlob(new Blob([content()], { type: mime }), filename)
  }

  function saveBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  /**
   * The set portrait (v12 WS3): the walk over the wheel as a poster. PNG by
   * default; a name typed with .svg gets the vector original instead (the
   * prompt's ensureExtension turns that into "….svg.png", undone here).
   */
  async function downloadPortrait() {
    const filename = promptExportName(`${exportBase}-portrait`, '.png')
    if (filename === null) return
    const svg = buildSetPortrait({
      setName: $activeSet.name,
      libraryName: $libraryName,
      walk: walkTracks,
      library: $visibleLibrary,
      radialAxis: $radialAxis,
      theme: $effectiveTheme,
      scheme: $settings.colorScheme,
    })
    const wantsSvg = /\.svg\.png$/i.test(filename)
    if (wantsSvg) {
      saveBlob(new Blob([svg], { type: 'image/svg+xml' }), filename.replace(/\.png$/i, ''))
    } else {
      saveBlob(await svgToPngBlob(svg), filename)
    }
  }

  const exportBase = $derived(($libraryName || 'tracklist').replace(/\.[a-z0-9]+$/i, ''))

  // The sets ARE the suggestion browser (v8 issue 18): the dropdown
  // navigates the (≤ 8) named sets. ✨ regenerates IN PLACE while the active
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

  // When a suggestion stops short of the target length, the button morphs
  // into a force variant (v11 issue 16b) — mirroring the wheel hub — and a
  // notice reports how many steps had to break the criteria. The window is
  // tied to the set the suggestion wrote (a suggest may itself CREATE a set
  // via addSet, so a bare on-id-change reset would wipe it immediately);
  // navigating to any other set closes it.
  let shortBy = $state(0)
  let forcedSteps = $state<number | null>(null)
  let forceForSetId = $state<string | null>(null)
  $effect(() => {
    if ($activeSet.id !== forceForSetId) {
      shortBy = 0
      forcedSteps = null
    }
  })

  // The ✨/⚡ press throws a short spark burst (v12 WS2) — pure celebration,
  // remounted per press so rapid presses restart it.
  let bursting = $state(false)
  let burstTimer: ReturnType<typeof setTimeout> | undefined
  function burst() {
    clearTimeout(burstTimer)
    bursting = false
    requestAnimationFrame(() => (bursting = true))
    burstTimer = setTimeout(() => (bursting = false), 600)
  }

  function suggest(force = false) {
    if (suggestDisabled) return
    burst()
    if (!canRegenerateInPlace) addSet() // a fresh set, activated
    const walk = suggestWalk($visibleLibrary, $criteria, {
      seedId: $pinnedFirst ?? $selectedId,
      endId: $pinnedLast,
      length: $settings.suggestLength,
      randomness: $settings.suggestRandomness,
      seed: suggestSeed++,
      progression: $settings.bpmProgression,
      mustIncludeIds: $mustInclude,
      force,
      manualEdges: $manualEdges,
    })
    setGeneratedTracklist(walk.ids)
    bumpWalkReveal(walkRevealPlan(walk.ids).totalMs)
    forceForSetId = $activeSet.id
    shortBy = force ? 0 : Math.max(0, $settings.suggestLength - walk.ids.length)
    forcedSteps = force ? walk.forced : null
  }

  // The s hotkey (v12 WS14) presses whichever suggest button is showing —
  // ⚡ force when the walk stopped short, plain ✨ otherwise.
  let lastSuggestHotkey = get(suggestHotkeyTick)
  $effect(() => {
    const tick = $suggestHotkeyTick
    if (tick === lastSuggestHotkey) return
    lastSuggestHotkey = tick
    suggest(shortBy > 0)
  })

  // Pins and must-include marks are library-scoped (design-v6 §C): they
  // survive set edits — the Set order pickers set them before a set even
  // exists — and clear only when their track leaves the library.
  $effect(() => {
    if ($pinnedFirst !== null && !$trackById.has($pinnedFirst)) pinnedFirst.set(null)
    if ($pinnedLast !== null && !$trackById.has($pinnedLast)) pinnedLast.set(null)
    if ($mustInclude.some((id) => !$trackById.has(id)))
      mustInclude.update((ids) => ids.filter((id) => $trackById.has(id)))
    // Manual combos too (v12 WS9): a mark dies with either of its tracks.
    if ($manualEdges.some((e) => !$trackById.has(e.a) || !$trackById.has(e.b)))
      manualEdges.update((edges) => edges.filter((e) => $trackById.has(e.a) && $trackById.has(e.b)))
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
      <!-- v9 issue 18: the ◀/▶ arrows are gone (the dropdown covers set
           switching) — the name gets the room and a bigger face instead. -->
      <select
        class="set-switch"
        aria-label="Active set"
        value={$activeSetId}
        onchange={(e) => activeSetId.set(e.currentTarget.value)}
      >
        {#each $sets as s (s.id)}
          <option value={s.id}>{s.name}</option>
        {/each}
      </select>
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
    {#if shortBy > 0}
      <!-- The walk stopped short: offer to push through to full length with
           rule-breaking picks, like the wheel hub's force (v11 issue 16b). -->
      <button
        class="primary force"
        onclick={() => suggest(true)}
        disabled={suggestDisabled}
        title="The criteria ran out {shortBy} track{shortBy === 1 ? '' : 's'} early — fill the rest
        with the closest non-matching picks"
      >
        ⚡ Force to {$settings.suggestLength}
        <SparkleBurst active={bursting} />
      </button>
    {:else}
      <button
        class="primary"
        onclick={() => suggest()}
        disabled={suggestDisabled}
        title={suggestDisabled && $visibleLibrary.length > 0
          ? `All ${MAX_SETS} sets are hand-edited — clear or delete one first`
          : canRegenerateInPlace
            ? 'Generate a set (replaces this untouched one — Cmd+Z steps back)'
            : 'Generate a new set alongside this hand-edited one'}
      >
        ✨ Suggest a set from the wheel
        <SparkleBurst active={bursting} />
      </button>
    {/if}
  </div>
  {#if forcedSteps !== null && forcedSteps > 0}
    <p class="forced-note">
      ⚡ {forcedSteps} of {$settings.suggestLength - 1} transitions were forced past the criteria.
    </p>
  {/if}

  {#if walkTracks.length === 0}
    <p class="hint">
      Double-click a track on the wheel to start your set. Each next double-click appends;
      transitions are checked against your combo criteria. Or let the app suggest a walk and edit
      from there.
    </p>
  {:else}
    <ol>
      {#key $walkRevealTick}
        {#each walkTracks as track, i (i)}
          {#if i > 0}
            {@const t = transition(walkTracks[i - 1], track)}
            <li
              class="transition"
              class:good={t.isCombo}
              class:rough={!t.isCombo}
              class:reveal={revealing}
              style:animation-delay="{(i - 0.5) * revealPlan.stepMs}ms"
            >
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
            class:reveal={revealing}
            style:animation-delay="{i * revealPlan.stepMs}ms"
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
      {/key}
    </ol>

    <div class="footer">
      <button onclick={() => download('.m3u8', () => exportM3u(walkTracks), 'audio/x-mpegurl')}>
        Export M3U8
      </button>
      <button onclick={() => download('.csv', () => exportTracklistCsv(walkTracks), 'text/csv')}>
        Export CSV
      </button>
      <button
        onclick={downloadPortrait}
        title="Save the walk as a poster image (PNG; name it .svg for the vector)"
      >
        Portrait
      </button>
      <button
        class="danger"
        onclick={() => {
          if ($tracklist.length > 0) clearDialog.open(() => tracklist.set([]))
        }}>Clear</button
      >
    </div>
  {/if}
</aside>

<ConfirmDialog
  bind:this={clearDialog}
  title="Clear this set?"
  body="Every track will be removed from the current set."
  confirmLabel="Clear set"
  danger
/>

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
    flex: 1;
    min-width: 0;
    max-width: 190px;
    font-size: 14px;
    font-weight: 600;
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
    position: relative; /* anchors the ✨ spark burst (v12 WS2) */
  }

  /* The rule-breaking variant borrows the wheel hub's warning look. */
  .suggest-row .force {
    color: var(--walk-bright);
    border-color: var(--walk-bright);
  }

  .forced-note {
    margin: 0;
    padding: 0 14px 8px;
    color: var(--walk-bright);
    font-size: 11.5px;
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

  /* Walk-draw cascade (v12 WS1): rows arrive as the wheel reaches them.
     Hidden until each row's inline animation-delay elapses. */
  li.reveal {
    opacity: 0;
    animation: row-reveal 240ms ease-out forwards;
  }

  @keyframes row-reveal {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    li.reveal {
      animation: none;
      opacity: 1;
    }
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
    /* Springy press (v12 WS2): squash on :active, overshoot on release. */
    transition: transform 160ms cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .pin:active {
    transform: scale(0.75);
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
