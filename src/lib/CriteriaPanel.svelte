<script lang="ts">
  import {
    CRITERION_FIELDS,
    demandedCount,
    toggleCriterion,
    toggleDemanded,
    type CriterionField,
  } from '../core/combos'
  import { METHOD_LABEL } from '../core/genre'
  import FiltersSection from './FiltersSection.svelte'
  import GenresSection from './GenresSection.svelte'
  import InfoTooltip from './InfoTooltip.svelte'
  import LockIcon from './LockIcon.svelte'
  import PlaylistsSection from './PlaylistsSection.svelte'
  import RatingBoxes from './RatingBoxes.svelte'
  import {
    comboPairCount,
    criteria,
    library,
    selectedId,
    settings,
    visibleLibrary,
  } from '../stores'

  // Easy mode (v12 WS4): the panel keeps its stats and Playlists — filters,
  // genres and the criteria machinery hide behind their current values.
  const easy = $derived($settings.uiMode === 'easy')

  const enabledCount = $derived(CRITERION_FIELDS.filter((f) => $criteria[f].enabled).length)

  // Demanded (locked) criteria are mandatory and floor the threshold (v14 C2).
  const floor = $derived(demandedCount($criteria))

  // Lock/unlock a criterion as mandatory. Hidden while the criterion is
  // disabled, so this only fires on an enabled row.
  function toggleLock(field: CriterionField): void {
    criteria.update((c) => toggleDemanded(c, field, !c[field].demanded))
  }

  const keyMoves = $derived(
    [
      $criteria.key.plusTwo ? '+2' : null,
      $criteria.key.plusSeven ? '+7' : null,
      $criteria.key.vinylMode ? 'vinyl' : null,
    ].filter((m) => m !== null),
  )

  // Enabling/disabling goes through toggleCriterion (v11 issue 2b): enabling
  // while "require all" was set keeps requiring all; disabling clamps.
  function setEnabled(field: CriterionField, event: Event): void {
    const checked = event.currentTarget instanceof HTMLInputElement && event.currentTarget.checked
    criteria.update((c) => toggleCriterion(c, field, checked))
  }

  // Keep the threshold valid when criteria get disabled elsewhere (e.g. a
  // loaded project); a deliberate 0 stays 0. A demanded criterion floors it
  // (v14 C2): the bar can never sit below the locked count.
  $effect(() => {
    if ($criteria.threshold > enabledCount && enabledCount > 0) {
      criteria.update((c) => ({ ...c, threshold: enabledCount }))
    } else if ($criteria.threshold < floor) {
      criteria.update((c) => ({ ...c, threshold: floor }))
    }
  })
</script>

<!-- With no library loaded, the criteria/filters act on nothing — make the
     whole panel inert and muted so only Import / Load sample invite a click
     (v10 additional issue). Clicking empty panel space (not a control) clears
     the track selection, mirroring the wheel's background-click deselect
     (ISSUES.md #4) — mouse convenience only, keyboard uses Escape/Tab. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside
  class:empty={$library.length === 0}
  class:easy
  inert={$library.length === 0}
  onclick={(e) => {
    if (e.target === e.currentTarget) selectedId.set(null)
  }}
>
  <div class="stats">
    <div class="stat">
      <span class="value">
        {$visibleLibrary.length}{#if $visibleLibrary.length !== $library.length}<small>
            /{$library.length}</small
          >{/if}
      </span>
      <span class="label">tracks</span>
    </div>
    <div class="stat">
      <span class="value">{$comboPairCount}</span>
      <span class="label">combo suggestions</span>
    </div>
  </div>

  <!-- In easy mode Playlists is the only section, so let it grow into the
       freed vertical space instead of stranding a short list (ISSUES.md #5). -->
  <PlaylistsSection fill={easy} />

  {#if !easy}
    <FiltersSection />

    <GenresSection />

    <details open data-tour="criteria">
      <summary class="micro-label">Combo criteria</summary>

      <div class="criterion">
        <!-- One line per criterion (ISSUES.md #2): the explanatory hint and
             the advanced-move note fold into an info icon so the row never
             wraps. The minor/major ring switch lives in Filters (v9 issue 6). -->
        <div class="criterion-head">
          <label>
            <input
              type="checkbox"
              checked={$criteria.key.enabled}
              onchange={(e) => setEnabled('key', e)}
            />
            Key
          </label>
          <InfoTooltip label="How key matching works">
            A combo needs harmonically adjacent keys — the same key, its relative major/minor, or a
            ±1 step around the harmonic key wheel.
            {#if keyMoves.length > 0}
              Extra moves on: {keyMoves.join(' · ')}.
            {/if}
            Change key moves in advanced settings → Key &amp; BPM.
          </InfoTooltip>
          {#if $criteria.key.enabled}
            <button
              type="button"
              class="lock"
              class:on={$criteria.key.demanded}
              aria-pressed={$criteria.key.demanded}
              title="Must match"
              onclick={() => toggleLock('key')}><LockIcon locked={$criteria.key.demanded} /></button
            >
          {/if}
        </div>
      </div>

      <div class="criterion">
        <div class="criterion-head">
          <label>
            <input
              type="checkbox"
              checked={$criteria.bpm.enabled}
              onchange={(e) => setEnabled('bpm', e)}
            />
            BPM within
            <input type="number" min="0" max="50" bind:value={$criteria.bpm.maxPercent} /> %
          </label>
          {#if $criteria.bpm.enabled}
            <button
              type="button"
              class="lock"
              class:on={$criteria.bpm.demanded}
              aria-pressed={$criteria.bpm.demanded}
              title="Must match"
              onclick={() => toggleLock('bpm')}><LockIcon locked={$criteria.bpm.demanded} /></button
            >
          {/if}
        </div>
        <!-- The metric-ratio toggles live in advanced → Key & BPM; surface
           their effect here so a bare "8%" is never silently misleading. -->
        {#if !$criteria.bpm.unitTime || $criteria.bpm.halfDouble || $criteria.bpm.twoThirds}
          <p class="sub-option ratio-note" class:warn={!$criteria.bpm.unitTime}>
            ratios:
            {[
              $criteria.bpm.unitTime ? '×1' : null,
              $criteria.bpm.halfDouble ? '×2' : null,
              $criteria.bpm.twoThirds ? '×3∕2' : null,
            ]
              .filter((r) => r !== null)
              .join(' ') || 'none'}
            {#if !$criteria.bpm.unitTime}— unit time off{/if}
          </p>
        {/if}
      </div>

      <div class="criterion">
        <div class="criterion-head">
          <label>
            <input
              type="checkbox"
              checked={$criteria.energy.enabled}
              onchange={(e) => setEnabled('energy', e)}
            />
            Energy within
            <input type="number" min="0" max="9" bind:value={$criteria.energy.maxSteps} />
          </label>
          {#if $criteria.energy.enabled}
            <button
              type="button"
              class="lock"
              class:on={$criteria.energy.demanded}
              aria-pressed={$criteria.energy.demanded}
              title="Must match"
              onclick={() => toggleLock('energy')}
              ><LockIcon locked={$criteria.energy.demanded} /></button
            >
          {/if}
        </div>
      </div>

      <div class="criterion">
        <!-- The active method + its parameters fold into the info icon (they
             already lived in advanced settings, v10 issue 2) so the row is
             one line (ISSUES.md #2). -->
        <div class="criterion-head">
          <label>
            <input
              type="checkbox"
              checked={$criteria.genre.enabled}
              onchange={(e) => setEnabled('genre', e)}
            />
            Genre
          </label>
          <InfoTooltip label="How genre matching works">
            Method: {METHOD_LABEL[$criteria.genre.method]} —
            {#if $criteria.genre.method === 'exact'}
              only exactly the same genre combos.
            {:else if $criteria.genre.mode === 'topk'}
              each genre links to its top {$criteria.genre.k} mutual neighbours.
            {:else}
              genres combo when their similarity is ≥ {$criteria.genre.threshold.toFixed(2)}.
            {/if}
            Change the method and cutoff in advanced settings → Genre distance.
          </InfoTooltip>
          {#if $criteria.genre.enabled}
            <button
              type="button"
              class="lock"
              class:on={$criteria.genre.demanded}
              aria-pressed={$criteria.genre.demanded}
              title="Must match"
              onclick={() => toggleLock('genre')}
              ><LockIcon locked={$criteria.genre.demanded} /></button
            >
          {/if}
        </div>
      </div>

      <div class="criterion">
        <div class="criterion-head">
          <label>
            <input
              type="checkbox"
              checked={$criteria.year.enabled}
              onchange={(e) => setEnabled('year', e)}
            />
            Year within
            <input type="number" min="0" max="50" bind:value={$criteria.year.maxYears} /> y
          </label>
          {#if $criteria.year.enabled}
            <button
              type="button"
              class="lock"
              class:on={$criteria.year.demanded}
              aria-pressed={$criteria.year.demanded}
              title="Must match"
              onclick={() => toggleLock('year')}
              ><LockIcon locked={$criteria.year.demanded} /></button
            >
          {/if}
        </div>
      </div>

      <div class="criterion threshold">
        <div class="threshold-head">
          <span>
            Require <strong>{Math.min($criteria.threshold, enabledCount)}</strong> of
            <strong>{enabledCount}</strong> to match
          </span>
          <InfoTooltip label="How matching counts">
            Missing data never blocks a combo: for each pair, only criteria known on both sides
            count towards the bar.
          </InfoTooltip>
        </div>
        <RatingBoxes
          value={Math.min($criteria.threshold, Math.max(enabledCount, 1))}
          max={Math.max(enabledCount, 1)}
          floor={Math.min(floor, Math.max(enabledCount, 1))}
          onchange={(v) => criteria.update((c) => ({ ...c, threshold: v }))}
          label="Required matches"
        />
      </div>
    </details>
  {/if}
</aside>

<style>
  aside {
    width: var(--left-rail);
    flex-shrink: 0;
    padding: 14px;
    background: var(--page);
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }

  /* Easy mode: only stats + Playlists remain, so lay the panel out as a
     column and let PlaylistsSection (fill) claim the freed height, scrolling
     internally rather than leaving dead space (ISSUES.md #5). Advanced mode
     keeps the default block flow + panel scroll. */
  aside.easy {
    display: flex;
    flex-direction: column;
  }

  aside.empty {
    opacity: 0.45;
  }

  /* Separators between the panel's top-level dropdown sections
     (Playlists/Filters/Genres/Combo criteria) — same colour and spacing as
     Advanced Settings' .section divider (AdvancedMenu.svelte: padding: 8px 0,
     border-bottom var(--grid)), just realized as a border-top here since it
     reaches into each child component's root <details> instead of wrapping
     them in a shared .section div. :first-of-type (not :first-child) skips
     the .stats div and naturally lands on whichever section renders first
     (Easy mode's lone Playlists, or Filters when no playlists are loaded),
     so no divider ever appears with nothing above it. */
  aside > :global(details) {
    border-top: 1px solid var(--grid);
    margin-top: 8px;
    padding-top: 8px;
  }

  aside > :global(details:first-of-type) {
    border-top: none;
    margin-top: 0;
    padding-top: 0;
  }

  .stats {
    display: flex;
    gap: 18px;
    margin-bottom: 14px;
  }

  .stat .value {
    display: block;
    font-size: 22px;
    font-weight: 600;
  }

  .stat .label {
    color: var(--ink-muted);
    font-size: 12px;
  }

  .stat small {
    color: var(--ink-muted);
    font-size: 13px;
    font-weight: 400;
  }

  summary {
    cursor: pointer;
    color: var(--ink-secondary);
    font-weight: 600;
    margin-bottom: 8px;
  }

  .criterion {
    position: relative;
    /* Matches .filter-row's 4px 0 rhythm (Filters section) so the two
       dropdowns' row spacing reads as identical. */
    padding: 4px 0;
  }

  /* --baseline is the intra-section divider token, shared by every
     sub-divider inside the left panel's dropdowns (a bit darker than
     --grid, which divides the dropdowns themselves). */
  .criterion.threshold {
    border-top: 1px solid var(--baseline);
  }

  /* The lock affordance: a small toggle at the row's right edge that pins the
     criterion as mandatory (v14 C2). Muted when open, accent when locked — so
     a demanded criterion reads at a glance. Last child of its row's flex
     head, pushed to the edge by margin-left: auto; fixed width so the
     LockIcon swap can't shift the row (ISSUES.md #6).

     Width is the icon plus a hair of chrome (v27): at rest the icon is the
     only thing visible, so every px of padding is a px the padlock sits
     short of the right edge that the track counts, the ↺ buttons and the
     all/only switches all share — 4px of it, plus 3px of slack inside the
     old icon's viewBox, read as "not aligned with the rest". The locked
     state's pill still ends exactly on that shared edge. */
  .lock {
    margin-left: auto;
    flex-shrink: 0;
    width: 20px;
    display: inline-flex;
    justify-content: center;
    align-items: center;
    padding: 2px 1px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    line-height: 1;
    cursor: pointer;
    opacity: 0.45;
    transition:
      opacity 0.12s ease,
      border-color 0.12s ease;
  }

  .lock:hover {
    opacity: 0.8;
  }

  .lock.on {
    opacity: 1;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .criterion label {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    /* Clicking the row toggles the criterion; its label text isn't
       drag-selectable, so reading it never highlights letters (ISSUES.md #1). */
    -webkit-user-select: none;
    user-select: none;
  }

  /* Every criterion row's head: the label (+ info icon on Key/Genre) and the
     lock share one line (ISSUES.md #2), vertically centered against the
     label text so the icons don't read as top-offset. */
  .criterion-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .criterion-head label {
    padding-right: 0;
    flex-wrap: nowrap;
  }

  .criterion .sub-option {
    margin: 4px 0 0 22px;
  }

  .ratio-note {
    color: var(--ink-muted);
    font-size: 11.5px;
  }

  .ratio-note.warn {
    color: var(--walk-bright);
  }

  input[type='number'] {
    width: 58px;
    padding: 2px 6px;
  }

  .threshold-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }

  .threshold-head span {
    flex: 1;
  }
</style>
