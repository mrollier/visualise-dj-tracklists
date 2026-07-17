<script lang="ts">
  import { METHOD_LABEL, METHOD_PICK_ORDER } from '../core/genre'
  import FiltersSection from './FiltersSection.svelte'
  import GenresSection from './GenresSection.svelte'
  import PlaylistsSection from './PlaylistsSection.svelte'
  import { criteria, edges, library, visibleLibrary } from '../stores'

  const enabledCount = $derived(
    [$criteria.key, $criteria.bpm, $criteria.genre, $criteria.year].filter((c) => c.enabled).length,
  )

  // Keep the threshold valid when criteria get disabled.
  $effect(() => {
    if ($criteria.threshold > enabledCount && enabledCount > 0) {
      criteria.update((c) => ({ ...c, threshold: enabledCount }))
    }
  })
</script>

<aside>
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
      <span class="value">{$edges.length}</span>
      <span class="label">combo suggestions</span>
    </div>
  </div>

  <PlaylistsSection />

  <FiltersSection />

  <GenresSection />

  <details open>
    <summary class="micro-label">Combo criteria</summary>

    <div class="criterion">
      <label>
        <input type="checkbox" bind:checked={$criteria.key.enabled} />
        Key <span class="hint">adjacent on the wheel</span>
      </label>
      <!-- The minor/major ring switch moved to the Filters section (v9
           issue 6) — it always was a visibility filter, not a criterion. -->
    </div>

    <div class="criterion">
      <label>
        <input type="checkbox" bind:checked={$criteria.bpm.enabled} />
        BPM within
        <input
          type="number"
          min="0"
          max="50"
          bind:value={$criteria.bpm.maxPercent}
          disabled={!$criteria.bpm.enabled}
        /> %
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
        <input type="checkbox" bind:checked={$criteria.genre.enabled} />
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
      <!-- The method itself is a first-class choice; its parameters
           (mode/k/threshold) and the sourced explainers stay in the
           advanced menu — here only a subtle "recommended" marker. -->
      <label class="sub-option method">
        <select bind:value={$criteria.genre.method} disabled={!$criteria.genre.enabled}>
          {#each METHOD_PICK_ORDER as method (method)}
            <option value={method}>
              {METHOD_LABEL[method]}{method === 'hybrid' ? ' — recommended' : ''}
            </option>
          {/each}
        </select>
      </label>
    </div>

    <div class="criterion">
      <label>
        <input type="checkbox" bind:checked={$criteria.year.enabled} />
        Year within
        <input
          type="number"
          min="0"
          max="50"
          bind:value={$criteria.year.maxYears}
          disabled={!$criteria.year.enabled}
        /> years
      </label>
    </div>

    <div class="criterion threshold">
      <label for="threshold">
        Require <strong>{Math.min($criteria.threshold, enabledCount)}</strong> of
        <strong>{enabledCount}</strong> to match
      </label>
      <input
        id="threshold"
        type="range"
        min="1"
        max={Math.max(enabledCount, 1)}
        bind:value={$criteria.threshold}
      />
      <p class="hint">
        Missing data never blocks a combo: for each pair, only criteria known on both sides count
        towards the bar.
      </p>
    </div>
  </details>
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

  .criterion .method select {
    width: 100%;
    font-size: 12px;
  }

  input[type='number'] {
    width: 58px;
    padding: 2px 6px;
  }

  input[type='range'] {
    width: 100%;
    padding: 0;
  }

  .hint {
    color: var(--ink-muted);
    font-size: 12px;
  }

  .threshold p {
    margin: 6px 0 0;
  }
</style>
