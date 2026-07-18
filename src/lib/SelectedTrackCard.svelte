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
    trackById,
    updateTrack,
  } from '../stores'
  import type { Writable } from 'svelte/store'
  import { normalizeKey } from '../core/keys'
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
    editing = false
  })

  // Vinyl minimal (v12 WS13): hand-entered key/BPM/genre for records with no
  // digital file, plus the vinyl provenance flag. ✎ opens the inline editor.
  let editing = $state(false)
  let editKey = $state('')
  let editBpm = $state('')
  let editGenre = $state('')
  function startEdit() {
    if (selectedTrack === null) return
    editKey = selectedTrack.key ?? ''
    editBpm = selectedTrack.bpm !== null ? String(selectedTrack.bpm) : ''
    editGenre = selectedTrack.genre ?? ''
    editing = true
  }
  function commitEdit() {
    if (selectedTrack === null) return
    // A number input binds a NUMBER in Svelte 5 — never assume string here.
    const bpmRaw = String(editBpm).trim()
    const bpm = Number(bpmRaw)
    updateTrack(selectedTrack.id, {
      key: normalizeKey(editKey),
      bpm: bpmRaw !== '' && Number.isFinite(bpm) && bpm > 0 ? bpm : null,
      genre: editGenre.trim() === '' ? null : editGenre.trim(),
    })
    editing = false
  }
  function toggleVinyl() {
    if (selectedTrack === null) return
    updateTrack(selectedTrack.id, { isVinyl: !selectedTrack.isVinyl })
  }
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
      {#if selectedTrack.isVinyl}<span class="vinyl-chip" title="Vinyl-only: no digital file"
          >VINYL</span
        >{/if}
    </strong>
    <span class="artist">{selectedTrack.artist ?? 'Unknown artist'}</span>
    {#if editing}
      <div class="edit-grid">
        <label>Key <input placeholder="8A" bind:value={editKey} /></label>
        <label>BPM <input type="number" min="1" bind:value={editBpm} /></label>
        <label>Genre <input placeholder="Techno" bind:value={editGenre} /></label>
        <label class="vinyl-row">
          <input type="checkbox" checked={selectedTrack.isVinyl} onchange={toggleVinyl} />
          Vinyl only (no file)
        </label>
        <span class="edit-actions">
          <button onclick={() => (editing = false)}>Cancel</button>
          <button class="save" onclick={commitEdit}>Save</button>
        </span>
      </div>
    {:else}
      <dl>
        <dt>Key</dt>
        <dd>{selectedTrack.key ?? 'missing'}</dd>
        <dt>BPM</dt>
        <dd>{selectedTrack.bpm ?? 'missing'}</dd>
        <dt>Genre</dt>
        <dd>{selectedTrack.genre ?? 'missing'}</dd>
      </dl>
    {/if}
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
      <button
        class="mark-toggle"
        class:on={$linkArmed}
        aria-pressed={$linkArmed}
        aria-label="Mark a combo with another track"
        title="Mark a combo you know works: click another track on the wheel to link or unlink it"
        onclick={() => linkArmed.update((v) => !v)}
      >
        🔗{linkedCount > 0 ? linkedCount : ''}
      </button>
      <button
        class="mark-toggle"
        class:on={editing}
        aria-pressed={editing}
        aria-label="Edit key, BPM and genre by hand"
        title="Hand-enter key, BPM and genre — for vinyl-only records and fixes"
        onclick={() => (editing ? (editing = false) : startEdit())}
      >
        ✎
      </button>
      <InfoTooltip label="About these marks" align="right">
        <strong>Marks for suggested sets</strong>
        <span>★ — strongly favour including this track.</span>
        <span>⏮ — open generated sets with it.</span>
        <span>⏭ — close generated sets with it.</span>
        <span>🔗 — mark a combo you know works: suggestions treat it as a road.</span>
      </InfoTooltip>
    </div>
    {#if $linkArmed}
      <p class="link-hint">Click another track on the wheel to mark or unmark the combo.</p>
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
  }

  .vinyl-chip {
    margin-left: 6px;
    padding: 0 5px;
    border: 1px solid var(--walk);
    border-radius: 999px;
    color: var(--walk);
    font-size: 9.5px;
    letter-spacing: 1px;
    vertical-align: 1px;
  }

  .edit-grid {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin: 4px 0 8px;
  }

  .edit-grid label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ink-muted);
  }

  .edit-grid input:not([type='checkbox']) {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
  }

  .edit-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .edit-actions .save {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
