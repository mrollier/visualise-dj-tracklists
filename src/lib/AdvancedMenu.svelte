<script lang="ts">
  import { get } from 'svelte/store'
  import { matchedGenrePairs } from '../core/combos'
  import { METHOD_LABEL_LONG, METHOD_PICK_ORDER, type GenreMethod } from '../core/genre'
  import type { Track } from '../core/model'
  import { resetAdvancedCriteria, resetAdvancedSettings } from '../core/reset'
  import { type BpmProgression } from '../core/settings'
  import { COLUMN_LABELS } from '../core/columns'
  import { PROPERTY_BY_KEY } from '../core/properties'
  import type { TrackSortField } from '../core/trackSort'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import InfoTooltip from './InfoTooltip.svelte'
  import SliderRow from './SliderRow.svelte'
  import { startTour } from './tour'
  import {
    criteria,
    filters,
    mustInclude,
    pinnedFirst,
    pinnedLast,
    rightPanel,
    selectedId,
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

  // v9 issue 3: reset everything the advanced panel owns and nothing else.
  let resetConfirm: ConfirmDialog
  function resetToDefaults() {
    settings.update(resetAdvancedSettings)
    criteria.update(resetAdvancedCriteria)
  }

  // --- Track properties (v11 issue 1): one table decides, per property,
  // whether it shows as a Tracks-view column and as a left-panel filter.
  // Hiding a filter also clears it, so a hidden filter never keeps acting.
  function toggleFilterVisible(key: TrackSortField) {
    const nowShown = !$settings.visibleFilters.includes(key)
    settings.update((s) => ({
      ...s,
      visibleFilters: nowShown
        ? [...s.visibleFilters, key]
        : s.visibleFilters.filter((k) => k !== key),
    }))
    if (!nowShown) {
      filters.update((f) => {
        const properties = { ...f.properties }
        Reflect.deleteProperty(properties, key)
        return { ...f, properties }
      })
    }
  }

  // Column checkboxes list the columns in the user's own order and toggle
  // only the hidden set — a re-enabled column reappears at its previous
  // position (v8 issue 15, v9 issue 12).
  function toggleColumn(field: TrackSortField) {
    settings.update((s) => ({
      ...s,
      hiddenColumns: s.hiddenColumns.includes(field)
        ? s.hiddenColumns.filter((f) => f !== field)
        : [...s.hiddenColumns, field],
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
  // 'filters' merged into 'tracks' in v11 (issue 1) — the surviving id keeps
  // old saves' fold memory for the section that remains.
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
      <span class="label-with-info">
        Method
        <InfoTooltip label="About this method">
          {METHOD_EXPLAINER[$criteria.genre.method].text}
          {#each METHOD_EXPLAINER[$criteria.genre.method].sources as source (source.href)}
            <a href={source.href} target="_blank" rel="noreferrer">[{source.label}]</a>
          {/each}
        </InfoTooltip>
      </span>
      <select bind:value={$criteria.genre.method}>
        {#each METHOD_PICK_ORDER as method (method)}
          <option value={method}>{METHOD_LABEL_LONG[method]}</option>
        {/each}
      </select>
    </label>
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
          Link each genre to its nearest
          <input
            class="classes-input"
            type="number"
            min="1"
            max="8"
            bind:value={$criteria.genre.k}
          />
        </label>
        <SliderRow
          label="Minimum score"
          bind:value={$criteria.genre.threshold}
          min={0}
          max={1}
          step={0.05}
          display={(v) => v.toFixed(2)}
        />
        <p class="hint">
          Genres link when each is in the other's top-k — self-calibrating where genre space is
          dense (electronic) or sparse; umbrella tags never count as neighbours.
          <a href="https://jmlr.org/papers/v11/radovanovic10a.html" target="_blank" rel="noreferrer"
            >[Radovanović et al. 2010]</a
          >
        </p>
      {:else}
        <SliderRow
          label="Similarity ≥"
          bind:value={$criteria.genre.threshold}
          min={0}
          max={1}
          step={0.05}
          display={(v) => v.toFixed(2)}
        />
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
      allow +2 moves
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.key.plusSeven} />
      allow +7-semitone moves
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.key.vinylMode} />
      vinyl mode
      <InfoTooltip label="About vinyl mode">
        Beatmatching on vinyl shifts pitch with tempo, so keys are compared after the shift needed
        to beatmatch. Tempo gaps landing on a whole semitone transpose the key; gaps in between
        detune it — even same-key tracks lose their match. Gaps beyond the BPM tolerance can't
        beatmatch at all.
      </InfoTooltip>
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.bpm.unitTime} />
      ± unit time
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.bpm.halfDouble} />
      ± half/double time
    </label>
    <label class="row">
      <input type="checkbox" bind:checked={$criteria.bpm.twoThirds} />
      ± 2/3 time
      <InfoTooltip label="About metric ratios">
        The BPM criterion matches at every enabled metric ratio, each within the same % tolerance.
        Switching unit time off hides the ordinary matches so only the exotic combos remain — expect
        most edges to vanish.
      </InfoTooltip>
    </label>
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
    <!-- One consistent rule (v11 issue 13): a control whose effect is not
         visible in the CURRENT view dims (with a title saying where it
         acts) but stays adjustable — never disabled. The colour scheme
         stays live everywhere. -->
    <SliderRow
      label="Same-key spread"
      bind:value={$settings.slotSpreadFactor}
      min={0}
      max={2}
      step={0.05}
      display={(v) => `×${v.toFixed(2)}`}
      dimmed={$viewMode !== 'wheel'}
      title="Only affects the Wheel view"
    />
    <!-- Edges are focus-only (v9): these dim unless a wheel track is
         selected, but stay adjustable in advance (v11 issue 13). -->
    <SliderRow
      label="Edge opacity"
      bind:value={$settings.edgeOpacity}
      min={0}
      max={0.9}
      step={0.05}
      display={(v) => v.toFixed(2)}
      dimmed={$viewMode !== 'wheel' || $selectedId === null}
      title="Only visible around a selected track on the Wheel"
    />
    <label
      class="row"
      class:off-view={$viewMode !== 'wheel' || $selectedId === null}
      title="Only visible around a selected track on the Wheel"
    >
      <input type="checkbox" bind:checked={$settings.focusClusterEdges} />
      Interconnect the selection's cluster
      <InfoTooltip label="About focus edges">
        Edges only appear around the selected track: its own connections by default; this also draws
        how those neighbours link amongst themselves.
      </InfoTooltip>
    </label>
    <label class:off-view={$viewMode !== 'wheel'} title="Only affects the Wheel view">
      Node icons (Wheel view)
      <select bind:value={$settings.iconMode}>
        <option value="families">Genre families (curated tree)</option>
        <option value="playlists">Playlists (first one wins)</option>
        <option value="clusters">Genre clusters (hybrid space)</option>
      </select>
    </label>
    <label
      class:off-view={$viewMode === 'tracks'}
      title="Affects the Wheel and Genres views' symbols"
    >
      <span class="label-with-info">
        Max symbol classes
        <InfoTooltip label="About symbol classes">
          Distinct node shapes (circle, square, triangle, …) mark up to this many classes: curated
          genre families, the selected playlists, or similarity clusters. The largest classes keep a
          symbol; smaller families merge into a broader umbrella when they exceed the cap. The genre
          map always shows genre families, whatever the icon mode.
        </InfoTooltip>
      </span>
      <input
        class="classes-input"
        type="number"
        min="1"
        max="8"
        bind:value={$settings.maxGenreClasses}
      />
    </label>
  </details>

  <details
    class="section"
    bind:open={sectionState.tracks}
    ontoggle={(e) => persistToggle('tracks', e)}
  >
    <summary>Track properties</summary>
    <p class="hint">
      Column = shown in the Tracks view (drag the table headers to reorder; a hidden column
      remembers its place). Filter = shown in the left panel; hiding a filter also clears it.
    </p>
    <div class="scroll-list">
      <!-- The header lives INSIDE the scroll list (sticky) so it shares the
           exact scrollbar gutter as the rows and its columns always line up
           with the checkboxes (ISSUES.md #9). -->
      <div class="prop-head" aria-hidden="true">
        <span class="prop-name"></span>
        <span>column</span>
        <span>filter</span>
      </div>
      {#each $settings.trackColumns as field (field)}
        <div class="prop-row">
          <span class="prop-name">{COLUMN_LABELS[field]}</span>
          <input
            type="checkbox"
            aria-label="{COLUMN_LABELS[field]} column"
            checked={!$settings.hiddenColumns.includes(field)}
            onchange={() => toggleColumn(field)}
          />
          {#if PROPERTY_BY_KEY.get(field)?.filterable === true}
            <input
              type="checkbox"
              aria-label="{COLUMN_LABELS[field]} filter"
              checked={$settings.visibleFilters.includes(field)}
              onchange={() => toggleFilterVisible(field)}
            />
          {:else}
            <span></span>
          {/if}
        </div>
      {/each}
    </div>
  </details>

  <details class="section" bind:open={sectionState.set} ontoggle={(e) => persistToggle('set', e)}>
    <summary>Set & suggestions</summary>
    <label>
      Suggested set length
      <input type="number" min="2" max="99" bind:value={$settings.suggestLength} />
    </label>
    <SliderRow
      label="Adventurousness"
      bind:value={$settings.suggestRandomness}
      min={0}
      max={1}
      step={0.05}
      display={(v) => v.toFixed(2)}
    />
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
    <SliderRow
      label="Manual-combo pull"
      bind:value={$settings.manualEdgeWeight}
      min={0}
      max={10}
      step={0.5}
      display={(v) => v.toFixed(1)}
    />
    <p class="hint">
      How hard a track pair you marked "mix well" pulls suggested walks. 0 ignores the mark (it
      still counts as an edge); 5 ranks it like an essential; 10 lets it dominate.
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

  <!-- The guided tour otherwise only replays from a link buried in the
       header's import-details tooltip, which needs a live $lastImportReport
       to even render — gone again after a reload. This is the reliable,
       always-there way back to it. -->
  <button class="reset-defaults" onclick={startTour}>↻ Replay the guided tour</button>

  <!-- v9 issue 3: everything this panel owns, back to its default value.
       Filters, playlists, sets, pins, and the theme are deliberately not
       touched — they live elsewhere. Confirmed first (v11 issue 14): it
       changes a lot at once and sits where a stray click can reach it. -->
  <button class="reset-defaults" onclick={() => resetConfirm.open(resetToDefaults)}>
    ↺ Return to default settings
  </button>
  <ConfirmDialog
    bind:this={resetConfirm}
    title="Reset all advanced settings?"
    body="Genre matching, key & BPM moves, display options and suggestion settings all return to their defaults. Filters, playlists and your sets are kept."
    confirmLabel="Reset settings"
    danger
  />
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
    /* Keep the label text beside its checkbox, never wrapped under it (v10
       issue 19). */
    flex-wrap: nowrap;
  }

  .label-with-info {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  /* A fixed-height scroll box for the long property list (v10 issue 22),
     matching the Genres/Playlists lists on the left. */
  .scroll-list {
    max-height: 200px;
    overflow-y: auto;
    /* Always reserve the scrollbar gutter so the header (a sticky child, so it
       shares this exact gutter) and the rows never disagree (ISSUES.md #9). */
    scrollbar-gutter: stable;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0 8px 4px;
  }

  /* The per-property Column/Filter grid (v11 issue 1). */
  .prop-head,
  .prop-row {
    display: grid;
    grid-template-columns: 1fr 48px 48px;
    align-items: center;
    justify-items: center;
    gap: 2px;
  }

  .prop-head {
    /* Sticky inside .scroll-list: no horizontal padding (the list's 8px + the
       shared scrollbar gutter position it identically to the rows), a top
       inset for breathing room, and the panel bg to hide rows scrolling under
       it (ISSUES.md #9). */
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--page);
    padding: 4px 0 2px;
    color: var(--ink-muted);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .prop-row {
    padding: 2px 0;
  }

  .prop-name {
    justify-self: start;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  label.off-view {
    color: var(--ink-muted);
    opacity: 0.6;
  }

  /* v9 issue 1: retired with the ↻ re-jitter button above.
  .re-jitter {
    padding: 1px 7px;
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-muted);
  }

  .re-jitter:hover:not(:disabled) {
    color: var(--ink);
  }
  */

  .to-tracks {
    margin-top: 6px;
    font-size: 11px;
    color: var(--ink-secondary);
  }

  .classes-input {
    width: 58px;
    padding: 2px 6px;
  }

  .reset-defaults {
    margin: 12px 0 4px;
    width: 100%;
    font-size: 12px;
    color: var(--ink-secondary);
  }

  .reset-defaults:hover {
    color: var(--ink);
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
