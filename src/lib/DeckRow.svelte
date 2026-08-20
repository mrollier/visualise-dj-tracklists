<script lang="ts">
  import type { DeckId } from '../core/audio/decks'
  import { reasonLabel, type UnplayableReason } from '../core/audio/reasons'
  import { formatDuration } from '../core/properties'
  import LockIcon from './LockIcon.svelte'
  import PlayIcon from './PlayIcon.svelte'

  interface Props {
    deck: DeckId
    /** Shown for deck A only: it is not the selection, so nothing else names it. */
    label: string | null
    playing: boolean
    position: number
    duration: number | null
    reason: UnplayableReason | null
    reasonContext: { sampleLibrary: boolean; rootName: string | null }
    locked: boolean
    onToggle: () => void
    onSeek: (seconds: number) => void
    onLock: () => void
  }
  const {
    deck,
    label,
    playing,
    position,
    duration,
    reason,
    reasonContext,
    locked,
    onToggle,
    onSeek,
    onLock,
  }: Props = $props()

  const disabled = $derived(duration === null || reason !== null)
  // While the thumb is held, the playhead must not write back or the two fight.
  let dragging = $state(false)
  let dragValue = $state(0)
  const shown = $derived(dragging ? dragValue : position)
</script>

<div class="deck" class:is-a={deck === 'a'}>
  <button
    class="transport"
    {disabled}
    onclick={onToggle}
    aria-label={playing ? 'Pause' : 'Play'}
    title={playing ? 'Pause' : 'Play'}
  >
    <PlayIcon {playing} />
  </button>

  {#if label !== null}
    <span class="label" title={label}>{label}</span>
  {/if}

  {#if reason !== null}
    <span class="reason">{reasonLabel(reason, reasonContext)}</span>
  {:else}
    <span class="clock tabular">{formatDuration(shown)}</span>
    <input
      class="line"
      type="range"
      min="0"
      max={duration ?? 1}
      step="0.01"
      value={shown}
      {disabled}
      aria-label="Position"
      onpointerdown={() => (dragging = true)}
      onpointerup={() => (dragging = false)}
      oninput={(e) => {
        dragValue = e.currentTarget.valueAsNumber
        dragging = true
      }}
      onchange={(e) => {
        dragging = false
        onSeek(e.currentTarget.valueAsNumber)
      }}
    />
    <span class="clock tabular">{duration === null ? '–:––' : formatDuration(duration)}</span>
  {/if}

  {#if deck === 'b'}
    <button
      class="lock"
      class:on={locked}
      disabled={duration === null && reason !== null}
      onclick={onLock}
      aria-pressed={locked}
      aria-label={locked ? 'Unpin the top track' : 'Pin this track to compare against'}
      title={locked ? 'Unpin the top track' : 'Pin this track to compare against'}
    >
      <LockIcon {locked} />
    </button>
  {/if}
</div>

<style>
  .deck {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .transport,
  .lock {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.28rem 0.5rem;
    flex-shrink: 0;
  }

  .lock.on {
    background: var(--accent);
    color: var(--on-accent);
  }

  .label {
    flex-shrink: 1;
    min-width: 0;
    max-width: 22ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    color: var(--ink-secondary);
  }

  .clock {
    font-size: 11.5px;
    color: var(--ink-muted);
    flex-shrink: 0;
  }

  .line {
    flex: 1;
    min-width: 0;
    padding: 0;
  }

  .reason {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: var(--ink-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
