<script lang="ts">
  // The selected track's card: details + the suggestion marks (design-v6
  // §C). Since v9 (issue 19) it docks under the right panel — the bottom
  // right of the whole app. Since v11 (issue 15) the three marks are one
  // compact icon row (★ ⏮ ⏭) with an ⓘ explaining them, reclaiming the
  // vertical space the labelled buttons ate.
  import {
    linkArmed,
    manualEdges,
    mustInclude,
    pinnedFirst,
    pinnedLast,
    selectedId,
    settings,
    trackById,
  } from '../stores'
  import type { Writable } from 'svelte/store'
  import InfoTooltip from './InfoTooltip.svelte'

  const selectedTrack = $derived(
    $selectedId === null ? null : ($trackById.get($selectedId) ?? null),
  )

  // Manual combos (v12 WS9): 🔗 arms link mode — the next wheel click marks
  // (or unmarks) the pair; the selection stays put so several partners can be
  // marked in a row. Changing the selection or Escape disarms.
  const linkedCount = $derived(
    $selectedId === null
      ? 0
      : $manualEdges.filter((e) => e.a === $selectedId || e.b === $selectedId).length,
  )
  $effect(() => {
    void $selectedId
    linkArmed.set(false)
  })

  const isMustIncluded = $derived($selectedId !== null && $mustInclude.includes($selectedId))
  const isFirst = $derived($selectedId !== null && $pinnedFirst === $selectedId)
  const isLast = $derived($selectedId !== null && $pinnedLast === $selectedId)
  function toggleMustInclude() {
    const id = $selectedId
    if (id === null) return
    mustInclude.update((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }
  function togglePin(store: Writable<string | null>) {
    const id = $selectedId
    if (id === null) return
    store.update((cur) => (cur === id ? null : id))
  }
</script>

{#if selectedTrack}
  <div class="selected-card">
    <strong>
      {selectedTrack.title}
    </strong>
    <span class="artist">{selectedTrack.artist ?? 'Unknown artist'}</span>
    <dl>
      <dt>Key</dt>
      <dd>{selectedTrack.key ?? 'missing'}</dd>
      <dt>BPM</dt>
      <dd>{selectedTrack.bpm ?? 'missing'}</dd>
      <dt>Genre</dt>
      <dd>{selectedTrack.genre ?? 'missing'}</dd>
    </dl>
    <!-- Easy mode hides the suggestion marks entirely (v14 WS6): easy runs on
         defaults, so ★/pins/🔗 are both out of sight and inert. -->
    {#if $settings.uiMode !== 'easy'}
      <div class="marks">
        <button
          class="mark-toggle"
          class:on={isMustIncluded}
          aria-pressed={isMustIncluded}
          aria-label="Must include in suggested constellations"
          title="Guaranteed a place in suggested constellations"
          onclick={toggleMustInclude}
        >
          {isMustIncluded ? '★' : '☆'}
        </button>
        <button
          class="mark-toggle"
          class:on={isFirst}
          aria-pressed={isFirst}
          aria-label="Open suggested constellations with this track"
          title="Open suggested constellations with this track"
          onclick={() => togglePin(pinnedFirst)}
        >
          ⏮
        </button>
        <button
          class="mark-toggle"
          class:on={isLast}
          aria-pressed={isLast}
          aria-label="Close suggested constellations with this track"
          title="Close suggested constellations with this track"
          onclick={() => togglePin(pinnedLast)}
        >
          ⏭
        </button>
        <button
          class="mark-toggle"
          class:on={$linkArmed}
          aria-pressed={$linkArmed}
          aria-label="Mark a combo with another track"
          title="Mark a combo you know works: click another track on the wheel or in the Tracks view to link or unlink it"
          onclick={() => linkArmed.update((v) => !v)}
        >
          🔗{linkedCount > 0 ? linkedCount : ''}
        </button>
        <InfoTooltip label="About these marks" align="right">
          <span><strong>Marks for suggested constellations</strong></span>
          <span>★ — guaranteed to appear in suggested constellations (forcing a transition if it must).</span>
          <span>⏮ — open generated constellations with it.</span>
          <span>⏭ — close generated constellations with it.</span>
          <span>🔗 — mark a combo you know works: suggestions treat it as a road.</span>
        </InfoTooltip>
      </div>
      {#if $linkArmed}
        <p class="link-hint">
          Click another track on the wheel or in the Tracks view to mark or unmark the combo.
        </p>
      {/if}
    {/if}
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape') linkArmed.set(false)
  }}
/>

<style>
  .selected-card {
    background: var(--surface-raised);
    border-top: 1px solid var(--border);
    padding: 8px 14px 10px;
    font-size: 12px;
    /* v14 R1: never let the card's contents widen the fixed right rail. */
    min-width: 0;
  }

  .selected-card strong {
    display: block;
  }

  .selected-card .artist {
    color: var(--ink-secondary);
    display: block;
    margin-bottom: 4px;
  }

  .selected-card dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 10px;
    margin: 0 0 6px;
    font-size: 12px;
  }

  .selected-card dt {
    color: var(--ink-muted);
  }

  .selected-card dd {
    margin: 0;
    color: var(--ink-secondary);
  }

  .marks {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .mark-toggle {
    flex: 1;
    padding: 2px 0;
    font-size: 12px;
    color: var(--ink-secondary);
  }

  .mark-toggle.on {
    color: var(--accent);
    border-color: var(--accent);
  }

  .link-hint {
    margin: 6px 0 0;
    color: var(--accent);
    font-size: 11.5px;
    /* v14 R1: the longer two-line copy wraps within the rail, never stretches
       it. */
    overflow-wrap: break-word;
  }
</style>
