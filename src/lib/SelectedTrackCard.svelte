<script lang="ts">
  // The selected track's card: details + the "must include" mark (design-v6
  // §C). Since v9 (issue 19) it docks under the right panel — the bottom
  // right of the whole app — instead of floating on the wheel, where it
  // crowded the legend and zoom controls.
  import { mustInclude, pinnedFirst, pinnedLast, selectedId, trackById } from '../stores'
  import type { Writable } from 'svelte/store'

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
    <button
      class="must-toggle"
      class:on={isMustIncluded}
      aria-pressed={isMustIncluded}
      title="Suggested sets will strongly favour including this track"
      onclick={toggleMustInclude}
    >
      {isMustIncluded ? '★ in suggested sets' : '☆ must include in suggested sets'}
    </button>
    <div class="pins">
      <button
        class="pin-toggle"
        class:on={isFirst}
        aria-pressed={isFirst}
        title="Open suggested sets with this track"
        onclick={() => togglePin(pinnedFirst)}
      >
        ⏮ open
      </button>
      <button
        class="pin-toggle"
        class:on={isLast}
        aria-pressed={isLast}
        title="Close suggested sets with this track"
        onclick={() => togglePin(pinnedLast)}
      >
        close ⏭
      </button>
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

  .must-toggle {
    width: 100%;
    font-size: 11px;
    color: var(--ink-secondary);
  }

  .must-toggle.on {
    color: var(--accent);
    border-color: var(--accent);
  }

  .pins {
    display: flex;
    gap: 6px;
    margin-top: 6px;
  }

  .pin-toggle {
    flex: 1;
    font-size: 11px;
    color: var(--ink-secondary);
  }

  .pin-toggle.on {
    color: var(--accent);
    border-color: var(--accent);
  }
</style>
