<script lang="ts">
  import { get } from 'svelte/store'
  import { matchedGenrePairs } from '../core/combos'
  import { METHOD_LABEL_LONG, METHOD_PICK_ORDER, type GenreMethod } from '../core/genre'
  import type { Track } from '../core/model'
  import { type BpmProgression } from '../core/settings'
  import type { TrackSortField } from '../core/trackSort'
  import {
    criteria,
    mustInclude,
    pinnedFirst,
    pinnedLast,
    rightPanel,
    settings,
    trackById,
    viewMode,
    visibleLibrary,
  } from '../stores'

  // --- Set & suggestions (v7, issue 10) ---
  // Opener/closer/must-include are CHOSEN in the Tracks view (or via the 📌
  // pins on the set rows); this menu only lists the current choices with a
  // remove button — the picker selects were too messy here.
  const PROGRESSION_LABEL: Record<BpmProgression, string> = {
    any: 'any (no preference)',
    steady: 'steady — hold the tempo',
    rising: 'rising — build up',
    falling: 'falling — wind down',
    sawtooth: 'sawtooth — build, drop, repeat',
  }
  const PROGRESSIONS = Object.keys(PROGRESSION_LABEL) as BpmProgression[]

  function trackLabel(track: Track): string {
    return `${track.artist ?? '?'} — ${track.title}`
  }
  function unmark(id: string) {
    mustInclude.update((ids) => ids.filter((x) => x !== id))
  }
  const pinnedFirstTrack = $derived(
    $pinnedFirst === null ? null : ($trackById.get($pinnedFirst) ?? null),
  )
  const pinnedLastTrack = $derived(
    $pinnedLast === null ? null : ($trackById.get($pinnedLast) ?? null),
  )
  function goToTracksView() {
    viewMode.set('tracks')
  }

  // --- Tracks-table columns (v8 issue 15) ---
  const ALL_COLUMNS: readonly TrackSortField[] = [
    'artist',
    'title',
    'key',
    'bpm',
    'genre',
    'year',
    'rating',
    'album',
    'dateAdded',
    'durationSec',
  ]
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
  function toggleColumn(field: TrackSortField) {
    settings.update((s) => ({
      ...s,
      trackColumns: s.trackColumns.includes(field)
        ? s.trackColumns.filter((f) => f !== field)
        : [...s.trackColumns, field],
    }))
  }
  // Live feedback for the k/threshold sliders (issue 12): on the wheel the
  // genre criterion is often masked by the other criteria, so show directly
  // how many genre pairs the current settings link.
  const genrePairCount = $derived(
    matchedGenrePairs(
      $visibleLibrary.map((t) => t.genre),
      $criteria,
    ).length,
  )

  const mustIncludeTracks = $derived(
    $mustInclude.map((id) => $trackById.get(id)).filter((t): t is Track => t !== undefined),
  )

  interface MethodInfo {
    text: string
    sources: { label: string; href: string }[]
  }

  const METHOD_EXPLAINER: Record<GenreMethod, MethodInfo> = {
    exact: {
      text: 'Only identical genres match, after alias normalization (DnB = Drum & Bass). Strict but blind to relatedness.',
      sources: [
        {
          label: 'Schreiber 2015',
          href: 'https://archives.ismir.net/ismir2015/paper/000102.pdf',
        },
      ],
    },
    lexical: {
      text: 'Word overlap (token Jaccard): Melodic House ~ House, but not Techno ~ Tech House. No data pack, no opinions.',
      sources: [
        {
          label: 'Tversky 1977',
          href: 'https://doi.org/10.1037/0033-295X.84.4.327',
        },
      ],
    },
    graph: {
      text: 'Shortest path through a curated genre-relation graph (editable JSON in the repo), decaying per step: Techno ~ Tech House. Treats every link as equally long — its known weakness.',
      sources: [{ label: 'Rada et al. 1989', href: 'https://doi.org/10.1109/21.24528' }],
    },
    taxonomy: {
      text: 'Lin similarity over a rooted genre tree: pairs sharing a deep, specific ancestor (Liquid DnB & Neurofunk) score high; pairs relating only through umbrella nodes (Electronic) score low.',
      sources: [
        {
          label: 'Lin 1998',
          href: 'https://dl.acm.org/doi/10.5555/645527.657297',
        },
      ],
    },
    embedding: {
      text: 'Statistical relatedness learned from ~2M real-world tag co-occurrences (AcousticBrainz), via PPMI + truncated SVD, with mutual-proximity hub correction.',
      sources: [
        {
          label: 'Levy & Goldberg 2014',
          href: 'https://papers.nips.cc/paper_files/paper/2014/hash/feab05aa91085b7a8012516bc3533958-Abstract.html',
        },
        {
          label: 'Schnitzer et al. 2012',
          href: 'https://jmlr.org/papers/v13/schnitzer12a.html',
        },
      ],
    },
    hybrid: {
      text: 'The embedding retrofitted toward the curated tree: real-world data where it exists, hand-audited lineage where it doesn’t. Best coverage of club subgenres — the recommended method.',
      sources: [{ label: 'Epure et al. 2020', href: 'https://arxiv.org/abs/2009.07755' }],
    },
  }

  function close() {
    rightPanel.set('set')
  }

  // --- section memory (v8 issue 17): all folded on first use, then the
  // menu remembers which sections the user keeps open, across sessions.
  // MUST be bind:open: Svelte 5 treats a plain open={} as controlled and
  // re-asserts the declared value after every user toggle, so a one-way
  // attribute (reactive or static) permanently slams the sections shut.
  const SECTION_IDS = ['genre', 'keybpm', 'display', 'tracks', 'set'] as const
  type SectionId = (typeof SECTION_IDS)[number]
  // One-time init from the store: settings is a svelte store, not runes state.
  const initiallyOpen = get(settings).advancedOpen
  const sectionState = $state(
    Object.fromEntries(SECTION_IDS.map((id) => [id, initiallyOpen.includes(id)])) as Record<
      SectionId,
      boolean
    >,
  )
  // Persist SYNCHRONOUSLY on the toggle event, not via a deferred $effect:
  // a pending effect is discarded when the panel unmounts right after a
  // toggle (open section → Escape), silently forgetting the change.
  function persistToggle(id: SectionId, event: Event) {
    const open = event.currentTarget instanceof HTMLDetailsElement && event.currentTarget.open
    settings.update((s) =>
      s.advancedOpen.includes(id) === open
        ? s
        : {
            ...s,
            advancedOpen: open ? [...s.advancedOpen, id] : s.advancedOpen.filter((x) => x !== id),
          },
    )
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') close()
  }}
/>

<!-- Lives in the right aside, swapping with "Your set" (design-v5 §E), so
     the wheel stays visible while settings change. -->
<aside class="panel">
  <div class="head">
    <h2 class="micro-label">Advanced settings</h2>
    <button
      class="close"
      aria-label="Close advanced settings"
      title="Back to your set"
      onclick={close}
    >
      ✕
    </button>
  </div>

  <!-- Grouped into collapsible sections (ISSUES.md #16). All sections
       start folded on first use; which ones stay open is remembered in
       settings (v8 issue 17). -->
  <details
    class="section"
    bind:open={sectionState.genre}
    ontoggle={(e) => persistToggle('genre', e)}
  >
    <summary>Genre matching</summary>
    <label>
      Method
      <select bind:value={$criteria.genre.method}>
        {#each METHOD_PICK_ORDER as method (method)}
          <option value={method}>{METHOD_LABEL_LONG[method]}</option>
        {/each}
      </select>
    </label>
    <p class="hint">
      {METHOD_EXPLAINER[$criteria.genre.method].text}
      {#each METHOD_EXPLAINER[$criteria.genre.method].sources as source (source.href)}
        <a href={source.href} target="_blank" rel="noreferrer">[{source.label}]</a>
      {/each}
    </p>
    {#if $criteria.genre.method !== 'exact'}
      <div class="mode-row">
        <label class="row">
          <input type="radio" value="topk" bind:group={$criteria.genre.mode} />
          k nearest (mutual)
        </label>
        <label class="row">
          <input type="radio" value="threshold" bind:group={$criteria.genre.mode} />
          score threshold
        </label>
      </div>
      {#if $criteria.genre.mode === 'topk'}
        <label>
          Link each genre to its <strong>{$criteria.genre.k}</strong> nearest
          <input type="range" min="1" max="15" step="1" bind:value={$criteria.genre.k} />
        </label>
        <label>
          Minimum score <strong>{$criteria.genre.threshold.toFixed(2)}</strong>
          <input type="range" min="0" max="1" step="0.05" bind:value={$criteria.genre.threshold} />
        </label>
        <p class="hint">
          Genres link when each is in the other's top-k — self-calibrating where genre space is
          dense (electronic) or sparse; umbrella tags never count as neighbours.
          <a href="https://jmlr.org/papers/v11/radovanovic10a.html" target="_blank" rel="noreferrer"
            >[Radovanović et al. 2010]</a
          >
        </p>
      {:else}
        <label>
          Similarity ≥ <strong>{$criteria.genre.threshold.toFixed(2)}</strong>
          <input type="range" min="0" max="1" step="0.05" bind:value={$criteria.genre.threshold} />
        </label>
        <p class="hint">
          Lower = looser matching. With the graph method, 0.6 accepts direct relatives, 0.36 two
          steps apart.
        </p>
      {/if}
      <p class="hint pair-count">
        <strong>{genrePairCount}</strong>
        genre {genrePairCount === 1 ? 'pair' : 'pairs'} in your library match at these settings.
      </p>
    {/if}
  </details>

  <details
    class="section"
    bind:open={sectionState.keybpm}
    ontoggle={(e) => persistToggle('keybpm', e)}
  >
    <summary>Key & BPM</summary>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.key.plusTwo} />
      allow +2 moves (energy jump)
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.key.plusSeven} />
      allow +7-semitone moves
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.key.vinylMode} />
      vinyl mode
    </label>
    <p class="hint">
      Beatmatching on vinyl shifts pitch with tempo, so keys are compared after the shift needed to
      beatmatch. Tempo gaps landing on a whole semitone transpose the key (+7 Camelot); gaps in
      between detune it — even same-key tracks lose their match. Gaps beyond the BPM tolerance (the
      pitch fader's range) can't beatmatch at all.
    </p>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.bpm.unitTime} />
      ± unit time (normal 1:1 matching)
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.bpm.halfDouble} />
      ± half/double time (85 ↔ 170)
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.bpm.twoThirds} />
      ± 2/3 time (triplet ↔ four-on-the-floor)
    </label>
    <p class="hint">
      The BPM criterion matches at every enabled metric ratio, each within the same % tolerance.
      Switching unit time off hides the ordinary matches so only the exotic combos remain — expect
      most edges to vanish.
    </p>
  </details>

  <details
    class="section"
    bind:open={sectionState.display}
    ontoggle={(e) => persistToggle('display', e)}
  >
    <summary>Display</summary>
    <label>
      Colour scheme
      <select bind:value={$settings.colorScheme}>
        <option value="blue">Blue</option>
        <option value="aqua">Aqua</option>
        <option value="violet">Violet</option>
      </select>
    </label>
    <!-- Spread and edge opacity only affect the wheel (issue 4); the colour
         scheme and genre classes stay live everywhere. -->
    <label class:off-view={$viewMode !== 'wheel'} title="Only affects the Wheel view">
      Same-key spread <strong>×{$settings.slotSpreadFactor.toFixed(2)}</strong>
      <button
        class="re-jitter"
        title="Re-shuffle the same-key fan order"
        aria-label="Re-jitter same-key fans"
        disabled={$viewMode !== 'wheel'}
        onclick={(e) => {
          e.preventDefault()
          settings.update((s) => ({ ...s, jitterSeed: Math.floor(Math.random() * 2 ** 31) }))
        }}>↻</button
      >
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        bind:value={$settings.slotSpreadFactor}
        disabled={$viewMode !== 'wheel'}
      />
    </label>
    <label class:off-view={$viewMode !== 'wheel'} title="Only affects the Wheel view">
      Edge opacity <strong>{$settings.edgeOpacity.toFixed(2)}</strong>
      <input
        type="range"
        min="0"
        max="0.9"
        step="0.05"
        bind:value={$settings.edgeOpacity}
        disabled={$viewMode !== 'wheel'}
      />
    </label>
    <label>
      Node icons
      <select bind:value={$settings.iconMode}>
        <option value="families">Genre families (curated tree)</option>
        <option value="playlists">Playlists (first one wins)</option>
        <option value="clusters">Genre clusters (hybrid space)</option>
      </select>
    </label>
    <label>
      Max symbol classes <strong>{$settings.maxGenreClasses}</strong>
      <input type="range" min="2" max="6" step="1" bind:value={$settings.maxGenreClasses} />
    </label>
    <p class="hint">
      Distinct node shapes (circle, square, triangle, …) mark up to this many classes: curated genre
      families, the selected playlists, or similarity clusters. The largest classes keep a symbol;
      everything stays a circle when nothing separates. Playlist icons don't apply on the genre map.
    </p>
  </details>

  <details
    class="section"
    bind:open={sectionState.tracks}
    ontoggle={(e) => persistToggle('tracks', e)}
  >
    <summary>Tracks table</summary>
    <p class="hint">Columns shown in the Tracks view — drag the table headers to reorder them.</p>
    {#each ALL_COLUMNS as field (field)}
      <label class="row">
        <input
          type="checkbox"
          checked={$settings.trackColumns.includes(field)}
          onchange={() => toggleColumn(field)}
        />
        {COLUMN_LABEL[field]}
      </label>
    {/each}
  </details>

  <details class="section" bind:open={sectionState.set} ontoggle={(e) => persistToggle('set', e)}>
    <summary>Set & suggestions</summary>
    <label>
      Suggested set length
      <input type="number" min="2" max="99" bind:value={$settings.suggestLength} />
    </label>
    <label>
      Adventurousness <strong>{$settings.suggestRandomness.toFixed(2)}</strong>
      <input type="range" min="0" max="1" step="0.05" bind:value={$settings.suggestRandomness} />
    </label>
    <p class="hint">
      0 always picks the safest transition; higher values embrace dissonance. Genre closeness always
      counts in the ranking.
    </p>
    <label>
      BPM progression
      <select bind:value={$settings.bpmProgression}>
        {#each PROGRESSIONS as p (p)}
          <option value={p}>{PROGRESSION_LABEL[p]}</option>
        {/each}
      </select>
    </label>
    <p class="hint">
      Nudges each next pick toward the preferred tempo trajectory — combo criteria still come first.
    </p>
    <!-- Read-only listing (issue 10): the choices themselves are made in the
         Tracks view (or via the 📌 pins on the set's first/last rows). -->
    <div class="must-block">
      <span class="must-title">Set order</span>
      {#if pinnedFirstTrack === null && pinnedLastTrack === null && mustIncludeTracks.length === 0}
        <p class="hint">
          Pick the opening and closing track, and mark essential tracks, in the Tracks view —
          suggested sets will honour them.
        </p>
      {:else}
        <ul class="must-list">
          {#if pinnedFirstTrack !== null}
            <li>
              <span class="must-name">Opens: {trackLabel(pinnedFirstTrack)}</span>
              <button
                class="unmark"
                title="Remove the opening pin"
                aria-label="Remove the opening pin"
                onclick={() => pinnedFirst.set(null)}>✕</button
              >
            </li>
          {/if}
          {#if pinnedLastTrack !== null}
            <li>
              <span class="must-name">Closes: {trackLabel(pinnedLastTrack)}</span>
              <button
                class="unmark"
                title="Remove the closing pin"
                aria-label="Remove the closing pin"
                onclick={() => pinnedLast.set(null)}>✕</button
              >
            </li>
          {/if}
          {#each mustIncludeTracks as t (t.id)}
            <li>
              <span class="must-name">★ {trackLabel(t)}</span>
              <button
                class="unmark"
                title="Remove from must-include"
                aria-label="Remove {t.title} from must-include"
                onclick={() => unmark(t.id)}>✕</button
              >
            </li>
          {/each}
        </ul>
      {/if}
      <button class="to-tracks" onclick={goToTracksView}>Choose in the Tracks view →</button>
    </div>
  </details>
</aside>

<style>
  .panel {
    width: 280px;
    flex-shrink: 0;
    background: var(--page);
    border-left: 1px solid var(--border);
    overflow-y: auto;
    padding: 0 14px 12px;
  }

  .head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 12px 0 2px;
  }

  h2 {
    font-size: 14px;
    margin: 0;
  }

  .close {
    background: none;
    border: none;
    color: var(--ink-muted);
    font-size: 12px;
    padding: 2px 4px;
  }

  .close:hover {
    color: var(--ink);
  }

  .section {
    padding: 8px 0;
    border-bottom: 1px solid var(--grid);
  }

  .section:last-child {
    border-bottom: none;
  }

  summary {
    cursor: pointer;
    margin: 0 0 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--ink-muted);
    user-select: none;
  }

  summary:hover {
    color: var(--ink-secondary);
  }

  .must-block {
    margin-top: 6px;
  }

  .must-title {
    display: block;
    font-size: 11px;
    color: var(--ink-secondary);
  }

  .must-list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .must-list li {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    background: var(--surface-raised);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2px 4px 2px 8px;
  }

  .must-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unmark {
    background: none;
    border: none;
    color: var(--ink-muted);
    font-size: 11px;
    padding: 1px 4px;
  }

  .unmark:hover {
    color: var(--ink);
  }

  select {
    max-width: 160px;
  }

  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 3px 0;
    font-size: 13px;
    flex-wrap: wrap;
  }

  label.row {
    justify-content: flex-start;
  }

  label.off-view {
    color: var(--ink-muted);
    opacity: 0.6;
  }

  .re-jitter {
    padding: 1px 7px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-muted);
  }

  .re-jitter:hover:not(:disabled) {
    color: var(--ink);
  }

  .to-tracks {
    margin-top: 6px;
    font-size: 11px;
    color: var(--ink-secondary);
  }

  /* Two radio choices; each label keeps its circle and text on one line
     (issue 11: the old single-label layout wrapped mid-choice). The row
     itself may wrap BETWEEN the choices when the panel is narrow. */
  .mode-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 2px 16px;
  }

  .mode-row label {
    flex-wrap: nowrap;
    white-space: nowrap;
  }

  input[type='range'] {
    width: 100%;
    padding: 0;
  }

  input[type='number'] {
    width: 64px;
    padding: 2px 6px;
  }

  .hint {
    color: var(--ink-muted);
    font-size: 11px;
    margin: 2px 0 0;
  }

  .hint a {
    color: var(--ink-secondary);
    margin-left: 4px;
    text-decoration: underline dotted;
  }
</style>
