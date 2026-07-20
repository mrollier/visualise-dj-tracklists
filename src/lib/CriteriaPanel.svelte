<script lang="ts">
  import {
    demandedCount,
    toggleCriterion,
    toggleDemanded,
    type CriterionField,
  } from '../core/combos'
  import { METHOD_LABEL } from '../core/genre'
  import FiltersSection from './FiltersSection.svelte'
  import GenresSection from './GenresSection.svelte'
  import InfoTooltip from './InfoTooltip.svelte'
  import PlaylistsSection from './PlaylistsSection.svelte'
  import RatingBoxes from './RatingBoxes.svelte'
  import { comboPairCount, criteria, library, selectedId, settings, visibleLibrary } from '../stores'

  // Easy mode (v12 WS4): the panel keeps its stats and Playlists — filters,
  // genres and the criteria machinery hide behind their current values.
  const easy = $derived($settings.uiMode === 'easy')

  const enabledCount = $derived(
    [$criteria.key, $criteria.bpm, $criteria.genre, $criteria.year].filter((c) => c.enabled).length,
  )

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

    <details open>
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
            A combo needs harmonically adjacent keys — the same key, its
            relative major/minor, or a ±1 step around the Camelot wheel.
            {#if keyMoves.length > 0}
              Extra moves on: {keyMoves.join(' · ')}.
            {/if}
            Change key moves in advanced settings → Key &amp; BPM.
          </InfoTooltip>
        </div>
        {#if $criteria.key.enabled}
          <button
            type="button"
            class="lock"
            class:on={$criteria.key.demanded}
            aria-pressed={$criteria.key.demanded}
            title="Must match"
            onclick={() => toggleLock('key')}>{$criteria.key.demanded ? '🔒' : '🔓'}</button
          >
        {/if}
      </div>

      <div class="criterion">
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
            onclick={() => toggleLock('bpm')}>{$criteria.bpm.demanded ? '🔒' : '🔓'}</button
          >
        {/if}
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
        </div>
        {#if $criteria.genre.enabled}
          <button
            type="button"
            class="lock"
            class:on={$criteria.genre.demanded}
            aria-pressed={$criteria.genre.demanded}
            title="Must match"
            onclick={() => toggleLock('genre')}>{$criteria.genre.demanded ? '🔒' : '🔓'}</button
          >
        {/if}
      </div>

      <div class="criterion">
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
            onclick={() => toggleLock('year')}>{$criteria.year.demanded ? '🔒' : '🔓'}</button
          >
        {/if}
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
    width: 250px;
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
    padding: 7px 0;
    border-top: 1px solid var(--grid);
  }

  /* The lock affordance: a small toggle at the row's right edge that pins the
     criterion as mandatory (v14 C2). Muted when open, accent when locked — so
     a demanded criterion reads at a glance. */
  .lock {
    position: absolute;
    top: 6px;
    right: 0;
    padding: 1px 4px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    opacity: 0.45;
    filter: grayscale(1);
    transition:
      opacity 0.12s ease,
      border-color 0.12s ease;
  }

  .lock:hover {
    opacity: 0.8;
  }

  .lock.on {
    opacity: 1;
    filter: none;
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }

  .criterion label {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding-right: 26px;
    /* Clicking the row toggles the criterion; its label text isn't
       drag-selectable, so reading it never highlights letters (ISSUES.md #1). */
    -webkit-user-select: none;
    user-select: none;
  }

  /* Key/Genre rows: the label + its info icon share one line, the head owns
     the clearance for the absolute lock (ISSUES.md #2). */
  .criterion-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-right: 26px;
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
