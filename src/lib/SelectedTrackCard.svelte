<script lang="ts">
  // The selected track's card: details + the suggestion marks (design-v6
  // §C). Since v9 (issue 19) it docks under the right panel — the bottom
  // right of the whole app. Since v11 (issue 15) the three marks are one
  // compact icon row (★ ⏮ ⏭) with an ⓘ explaining them, reclaiming the
  // vertical space the labelled buttons ate.
  import { mustInclude, pinnedFirst, pinnedLast, selectedId, trackById } from '../stores'
  import type { Writable } from 'svelte/store'
  import InfoTooltip from './InfoTooltip.svelte'

  const selectedTrack = $derived(
    $selectedId === null ? null : ($trackById.get($selectedId) ?? null),
  )
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
    <strong>{selectedTrack.title}</strong>
    <span class="artist">{selectedTrack.artist ?? 'Unknown artist'}</span>
    <dl>
      <dt>Key</dt>
      <dd>{selectedTrack.key ?? 'missing'}</dd>
      <dt>BPM</dt>
      <dd>{selectedTrack.bpm ?? 'missing'}</dd>
      <dt>Genre</dt>
      <dd>{selectedTrack.genre ?? 'missing'}</dd>
    </dl>
    <div class="marks">
      <button
        class="mark-toggle"
        class:on={isMustIncluded}
        aria-pressed={isMustIncluded}
        aria-label="Must include in suggested sets"
        title="Suggested sets will strongly favour including this track"
        onclick={toggleMustInclude}
      >
        {isMustIncluded ? '★' : '☆'}
      </button>
      <button
        class="mark-toggle"
        class:on={isFirst}
        aria-pressed={isFirst}
        aria-label="Open suggested sets with this track"
        title="Open suggested sets with this track"
        onclick={() => togglePin(pinnedFirst)}
      >
        ⏮
      </button>
      <button
        class="mark-toggle"
        class:on={isLast}
        aria-pressed={isLast}
        aria-label="Close suggested sets with this track"
        title="Close suggested sets with this track"
        onclick={() => togglePin(pinnedLast)}
      >
        ⏭
      </button>
      <InfoTooltip label="About these marks" align="right">
        <strong>Marks for suggested sets</strong>
        <span>★ — strongly favour including this track.</span>
        <span>⏮ — open generated sets with it.</span>
        <span>⏭ — close generated sets with it.</span>
      </InfoTooltip>
    </div>
  </div>
{/if}

<style>
  .selected-card {
    background: var(--surface-raised);
    border-top: 1px solid var(--border);
    padding: 8px 14px 10px;
    font-size: 12px;
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
</style>
