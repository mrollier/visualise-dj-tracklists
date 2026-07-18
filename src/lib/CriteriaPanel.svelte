<script lang="ts">
  import { toggleCriterion, type CriterionField } from '../core/combos'
  import { METHOD_LABEL } from '../core/genre'
  import FiltersSection from './FiltersSection.svelte'
  import GenresSection from './GenresSection.svelte'
  import InfoTooltip from './InfoTooltip.svelte'
  import PlaylistsSection from './PlaylistsSection.svelte'
  import RatingBoxes from './RatingBoxes.svelte'
  import { comboPairCount, criteria, library, settings, visibleLibrary } from '../stores'

  // Easy mode (v12 WS4): the panel keeps its stats and Playlists — filters,
  // genres and the criteria machinery hide behind their current values.
  const easy = $derived($settings.uiMode === 'easy')

  const enabledCount = $derived(
    [$criteria.key, $criteria.bpm, $criteria.genre, $criteria.year].filter((c) => c.enabled).length,
  )

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
  // loaded project); a deliberate 0 stays 0.
  $effect(() => {
    if ($criteria.threshold > enabledCount && enabledCount > 0) {
      criteria.update((c) => ({ ...c, threshold: enabledCount }))
    }
  })
</script>

<!-- With no library loaded, the criteria/filters act on nothing — make the
     whole panel inert and muted so only Import / Load sample invite a click
     (v10 additional issue). -->
<aside class:empty={$library.length === 0} inert={$library.length === 0}>
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

  <PlaylistsSection />

  {#if !easy}
    <FiltersSection />

    <GenresSection />

    <details open>
      <summary class="micro-label">Combo criteria</summary>

      <div class="criterion">
        <label>
          <input
            type="checkbox"
            checked={$criteria.key.enabled}
            onchange={(e) => setEnabled('key', e)}
          />
          Key <span class="hint">adjacent on the wheel</span>
        </label>
        <!-- The minor/major ring switch moved to the Filters section (v9
           issue 6) — it always was a visibility filter, not a criterion.
           The advanced key moves are surfaced here as a subtle note (v10
           issue 2), like the BPM ratios below. -->
        {#if keyMoves.length > 0}
          <p class="sub-option ratio-note">moves: {keyMoves.join(' · ')}</p>
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
        <label>
          <input
            type="checkbox"
            checked={$criteria.genre.enabled}
            onchange={(e) => setEnabled('genre', e)}
          />
          Genre
          <span class="hint">
            {#if $criteria.genre.method === 'exact'}
              same genre
            {:else if $criteria.genre.mode === 'topk'}
              top-{$criteria.genre.k} mutual
            {:else}
              ≥ {$criteria.genre.threshold.toFixed(2)}
            {/if}
          </span>
        </label>
        <!-- The method + its parameters (mode/k/threshold) and the sourced
           explainers live in the advanced menu now (v10 issue 2); here only
           a subtle note of which method is active. -->
        <p class="sub-option ratio-note">method: {METHOD_LABEL[$criteria.genre.method]}</p>
      </div>

      <div class="criterion">
        <label>
          <input
            type="checkbox"
            checked={$criteria.year.enabled}
            onchange={(e) => setEnabled('year', e)}
          />
          Year within
          <input type="number" min="0" max="50" bind:value={$criteria.year.maxYears} /> years
        </label>
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
    padding: 7px 0;
    border-top: 1px solid var(--grid);
  }

  .criterion label {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
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

  .hint {
    color: var(--ink-muted);
    font-size: 12px;
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
